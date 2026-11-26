// Cada decisión de acceso se toma con una escritura condicional en el primario.
type Filas = (string | null)[][]
export type EjecutarSql = (sql: string, ...args: string[]) => Promise<Filas>

export function clienteTurso(origen: string, token: string, enviar = fetch): EjecutarSql {
  const url = new URL(origen.replace(/^libsql:\/\//, 'https://'))
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.turso.io') || url.pathname !== '/' ||
      url.port || url.username || url.password || url.search || url.hash || !token.trim()) {
    throw new Error('Revisa la conexión privada de Turso.')
  }
  return async (sql, ...args) => {
    const stmt = { sql, args: args.map(value => ({ type: 'text', value })) }
    const r = await enviar(new URL('/v2/pipeline', url), {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ type: 'execute', stmt }, { type: 'close' }] }),
      redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(4000),
    })
    if (!r.ok) throw new Error('Almacén de sesiones no disponible.')
    const { results } = await r.json()
    if (results?.[0]?.type !== 'ok' || results[1]?.type !== 'ok') throw new Error('Operación de sesión no confirmada.')
    return results[0].response.result.rows.map((row: { value?: string }[]) => row.map(c => c.value ?? null))
  }
}

// Una base dedicada a la demo, una cuenta y una sola fila. Ningún dato contractual.
export function estadoCompartido(sql: EjecutarSql) {
  let preparada: Promise<unknown> | undefined
  async function preparar() {
    await sql(`CREATE TABLE IF NOT EXISTS inova_demo (
      id INTEGER PRIMARY KEY CHECK (id = 1), intentos TEXT NOT NULL DEFAULT '[]',
      login TEXT, login_hasta INTEGER NOT NULL DEFAULT 0,
      sesion TEXT, csrf TEXT, vence INTEGER NOT NULL DEFAULT 0, consulta TEXT,
      trabajo TEXT, trabajo_hasta INTEGER NOT NULL DEFAULT 0)`)
    await sql('INSERT OR IGNORE INTO inova_demo (id) VALUES (1)')
  }
  async function fila(consulta: string, ...args: string[]) {
    preparada ??= preparar().catch(error => { preparada = undefined; throw error })
    await preparada
    return (await sql(consulta, ...args))[0]
  }

  const recientes = "FROM json_each(intentos) WHERE value > unixepoch() - 600"
  const activa = 'sesion = ? AND vence > unixepoch()'
  return {
    reservarLogin: (turno: string) => fila(`UPDATE inova_demo SET
      intentos = json_insert((SELECT json_group_array(value) ${recientes}), '$[#]', unixepoch()),
      login = ?, login_hasta = unixepoch() + 45
      WHERE login_hasta <= unixepoch() AND (SELECT count(*) ${recientes}) < 5 RETURNING id`, turno),
    cancelarLogin: (turno: string) => fila('UPDATE inova_demo SET login = NULL, login_hasta = 0 WHERE login = ?', turno),
    iniciarSesion: (turno: string, id: string, csrf: string) => fila(`UPDATE inova_demo SET
      sesion = ?, csrf = ?, vence = unixepoch() + 1800, consulta = NULL, intentos = '[]', login = NULL, login_hasta = 0
      WHERE login = ? AND login_hasta > unixepoch() RETURNING vence`, id, csrf, turno),
    // Una solicitud con CSRF incorrecto no prolonga la sesión.
    identificar: (id: string, csrf: string | null) => fila(`UPDATE inova_demo
      SET vence = CASE WHEN ? = 'leer' OR csrf = ? THEN unixepoch() + 1800 ELSE vence END
      WHERE ${activa} RETURNING csrf, vence, consulta`, csrf === null ? 'leer' : 'escribir', csrf ?? '', id),
    cerrar: (id: string) => fila(`UPDATE inova_demo SET sesion = NULL, csrf = NULL, vence = 0, consulta = NULL
      WHERE ${activa} RETURNING id`, id),
    reservarTrabajo: (id: string, turno: string) => fila(`UPDATE inova_demo SET trabajo = ?, trabajo_hasta = unixepoch() + 45
      WHERE ${activa} AND trabajo_hasta <= unixepoch() RETURNING consulta`, turno, id),
    confirmarTrabajo: (id: string, turno: string, consulta: string) => fila(`UPDATE inova_demo SET consulta = ?, trabajo = NULL, trabajo_hasta = 0
      WHERE ${activa} AND trabajo = ? AND trabajo_hasta > unixepoch() RETURNING id`, consulta, id, turno),
    liberarTrabajo: (turno: string) => fila('UPDATE inova_demo SET trabajo = NULL, trabajo_hasta = 0 WHERE trabajo = ?', turno),
  }
}
