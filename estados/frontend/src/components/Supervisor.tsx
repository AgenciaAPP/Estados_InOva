import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { columnasPanel, esColumnaPanel, maximoTextoFiltro, textoCeldaPanel, type ColumnaPanel, type PaginaPanel, type SesionPanel } from '../../../shared/supervisor.ts'
import { descargarExcel, ErrorPanel, mensajePanel, pedirPanel } from '../services/supervisor'
import { EstadoDocumento } from './EstadoDocumento'
import { Cabecera } from './Portal'
import { Icon } from './Icon'

const fechaColombia = new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', dateStyle: 'long', timeStyle: 'medium' })
const columnas = Object.entries(columnasPanel)

function avanceConsulta(datos: PaginaPanel) {
  if (datos.estado === 'fallida') return 'No se pudo leer el listado de contratos. Comprueba el acceso de lectura y vuelve a consultar.'
  if (datos.candidatos === null) return 'Buscando contratos activos…'
  const balance = `Encontrados ${datos.candidatos} · Procesados ${datos.procesados} · Excluidos por ausencia de estado ${datos.excluidos}`
  if (datos.estado === 'enCurso') return `${balance} · Incluidos hasta ahora ${datos.incluidos}.`
  if (datos.candidatos === 0) return 'No se encontraron contratos activos en esta consulta.'
  return `Consulta completada. ${balance}.`
}

function Tabla({ datos, cambiar, esperando }: { datos: PaginaPanel; cambiar: (pagina: number) => void; esperando: boolean }) {
  return <>
    <div className="tabla-activos" role="region" aria-label="Contratos activos" tabIndex={0}>
      <table><thead><tr>{columnas.map(([clave, texto]) => <th key={clave} scope="col">{texto}</th>)}</tr></thead>
        <tbody>{datos.filas.map((fila, i) => <tr key={i}>
          <td className="mono">{textoCeldaPanel(fila, 'cedula')}</td><td>{textoCeldaPanel(fila, 'contratista')}</td>
          <td className="mono">{textoCeldaPanel(fila, 'numeroContrato')}</td><td>{textoCeldaPanel(fila, 'supervisor')}</td>
          <td>{textoCeldaPanel(fila, 'apoyoSupervision')}</td><td>{textoCeldaPanel(fila, 'apoyoLogistico')}</td>
          {(['gestion', 'supervision', 'cobro'] as const).map(tipo => <td key={tipo}><EstadoDocumento estado={fila.informes[tipo]}/></td>)}
        </tr>)}</tbody>
      </table>
    </div>
    {datos.paginas > 1 && <nav aria-label="Páginas de contratos" className="paginador">
      <button className="secundario" disabled={esperando || datos.pagina === 1} onClick={() => cambiar(datos.pagina - 1)}>Anterior</button>
      <span>Página {datos.pagina} de {datos.paginas}</span>
      <button className="secundario" disabled={esperando || datos.pagina === datos.paginas} onClick={() => cambiar(datos.pagina + 1)}>Siguiente</button>
    </nav>}
  </>
}

function Panel({ sesion, salir, renovar }: { sesion: SesionPanel; salir: (aviso?: string) => void; renovar: (vence: number) => void }) {
  const [datos, setDatos] = useState<PaginaPanel | null>(null)
  const [pagina, setPagina] = useState(1)
  const [columna, setColumna] = useState<ColumnaPanel>('cedula')
  const [texto, setTexto] = useState('')
  const termino = texto.trim()
  const [revision, revisar] = useState(0)
  const [leyendo, setLeyendo] = useState(true)
  const [accion, setAccion] = useState<'iniciar' | 'salir' | 'exportar' | null>(null)
  const descarga = useRef<AbortController | null>(null)
  useEffect(() => () => descarga.current?.abort(), [])
  const [error, setError] = useState('')
  const [falloLectura, setFalloLectura] = useState(false)
  const enCurso = datos?.estado === 'enCurso'
  const informar = useCallback((e: unknown) => {
    if (e instanceof ErrorPanel && e.status === 401) salir()
    else setError(mensajePanel(e))
  }, [salir])

  useEffect(() => {
    const abortar = new AbortController()
    let timer: number
    setLeyendo(true)
    setFalloLectura(false)
    async function leer() {
      try {
        const opciones = { signal: abortar.signal, renovar }
        const resultado = termino
          ? await pedirPanel<PaginaPanel | null>('consulta/filtrar', { ...opciones, csrf: sesion.csrf, cuerpo: { pagina, columna, texto: termino } })
          : await pedirPanel<PaginaPanel | null>('consulta?pagina=' + pagina, opciones)
        if (abortar.signal.aborted) return
        setDatos(resultado)
        setError('')
        if (resultado?.estado === 'enCurso') timer = window.setTimeout(leer, 1000)
      } catch (e) {
        if (!abortar.signal.aborted) { setFalloLectura(true); informar(e) }
      } finally { if (!abortar.signal.aborted) setLeyendo(false) }
    }
    if (termino) timer = window.setTimeout(leer, 180)
    else void leer()
    return () => { abortar.abort(); window.clearTimeout(timer) }
  }, [pagina, columna, termino, revision, sesion.csrf, informar, renovar])

  async function iniciar() {
    setAccion('iniciar')
    setError('')
    try {
      const nuevo = await pedirPanel<PaginaPanel>('consulta', { cuerpo: {}, csrf: sesion.csrf, renovar })
      setDatos(nuevo)
      setPagina(1)
      setTexto('')
      setColumna('cedula')
      revisar(n => n + 1)
    } catch (e) {
      informar(e)
      if (e instanceof ErrorPanel && e.status === 409) setFalloLectura(true)
    } finally { setAccion(null) }
  }
  async function cerrar() {
    setAccion('salir')
    try { await pedirPanel('logout', { cuerpo: {}, csrf: sesion.csrf }); salir() }
    catch (e) { informar(e) } finally { setAccion(null) }
  }
  async function exportar() {
    if (!datos || datos.estado !== 'completa' || !datos.coincidencias || descarga.current) return
    const controlador = new AbortController()
    descarga.current = controlador
    setAccion('exportar')
    setError('')
    try {
      await descargarExcel({ cuerpo: { consulta: datos.fecha, columna, texto: termino }, csrf: sesion.csrf, renovar, signal: controlador.signal })
    } catch (e) {
      if (!controlador.signal.aborted) {
        if (e instanceof ErrorPanel && e.status === 401) salir('La sesión venció. Vuelve a ingresar y realiza nuevamente la consulta.')
        else informar(e)
      }
    } finally { descarga.current = null; setAccion(null) }
  }
  const modo = sesion.alcance === 'demo' ? 'Modo demostración' : sesion.alcance === 'piloto' ? 'Lote autorizado' : 'Consulta general'
  return <main className="wrap supervision">
    <section className="hero panel-hero"><div><h1>Panel de supervisión – Consulta de contratos activos</h1>
      <p>{modo} · Contratos en ejecución{sesion.fuentes.contratos === 'mysql' && sesion.fuentes.informes === 'mock' && ' · Estados simulados'}</p>
    </div></section>
    <section className="panel">
      <div className="acciones-panel">
        <button className="submit" onClick={iniciar} disabled={leyendo || accion !== null || enCurso || falloLectura}>
          {enCurso || accion === 'iniciar' ? <span className="spinner"/> : <Icon name="search" size={18}/>}
          {accion === 'iniciar' ? 'Iniciando consulta' : enCurso ? 'Consulta en curso' : datos ? 'Actualizar consulta' : 'Consultar hasta el día de hoy'}
        </button>
        <button className="secundario" onClick={cerrar} disabled={accion !== null}>{accion === 'salir' ? 'Cerrando sesión…' : 'Cerrar sesión'}</button>
      </div>
      {error && <p className="invalid aviso-panel" role="alert">{error}</p>}
      {falloLectura && <button className="secundario" onClick={() => revisar(n => n + 1)}>Volver a leer la consulta</button>}
      {datos ? <>
        <div className="resumen-panel">
          <h2>{datos.total === null ? 'Consulta de contratos' : datos.total === 1 ? '1 contrato incluido' : `${datos.total} contratos incluidos`}{sesion.alcance === 'piloto' && ' en el lote autorizado'}</h2>
          <p><time dateTime={datos.fecha}>{fechaColombia.format(new Date(datos.fecha))}</time> · Hora de Colombia</p>
        </div>
        <p className="avance" role="status">{avanceConsulta(datos)}</p>
        <div className="filtro-panel">
          {datos.estado === 'completa' && <>
            <label>Filtrar por
              <select value={columna} onChange={e => {
                if (esColumnaPanel(e.target.value)) { setColumna(e.target.value); setPagina(1) }
              }}>{columnas.map(([clave, nombre]) => <option key={clave} value={clave}>{nombre}</option>)}</select>
            </label>
            <label>Buscar
              <input type="search" value={texto} maxLength={maximoTextoFiltro} autoComplete="off" spellCheck={false}
                onChange={e => { setTexto(e.target.value); setPagina(1) }}/>
            </label>
            <button className="secundario" disabled={!texto} onClick={() => { setTexto(''); setPagina(1) }}>Limpiar filtro</button>
          </>}
          <button className="secundario descargar-excel" onClick={exportar}
            disabled={datos.estado !== 'completa' || !datos.coincidencias || leyendo || falloLectura || accion !== null}>
            <Icon name="download" size={17}/>{accion === 'exportar' ? 'Preparando Excel…' : 'Descargar Excel'}
          </button>
        </div>
        {datos.estado === 'completa' && <p className="avance" role="status">{leyendo ? 'Buscando…' : !falloLectura &&
          `Mostrando ${datos.coincidencias} de ${datos.incluidos} contratos`}</p>}
        {(datos.estado === 'completa' || datos.filas.length > 0) && <Tabla datos={datos} cambiar={setPagina} esperando={leyendo || falloLectura}/>}
      </> : <div className="empty" role="status"><span className="empty-icon"><Icon name="list"/></span>
        <strong>{leyendo ? 'Comprobando la consulta…' : 'Aún no hay una consulta'}</strong>
        <p>Al consultar aparecerán los contratos activos y los estados de sus tres documentos.</p></div>}
    </section>
  </main>
}

export function Supervisor() {
  const [sesion, setSesion] = useState<SesionPanel | null>(null)
  const [ocupado, setOcupado] = useState(true)
  const [error, setError] = useState('')
  const salir = useCallback((aviso = '') => { setSesion(null); setError(aviso) }, [])
  const renovar = useCallback((vence: number) => setSesion(actual => actual && vence > actual.vence ? { ...actual, vence } : actual), [])
  useEffect(() => {
    const c = new AbortController()
    pedirPanel<SesionPanel | null>('sesion', { signal: c.signal }).then(setSesion)
      .catch(e => { if (!c.signal.aborted) setError(mensajePanel(e)) })
      .finally(() => { if (!c.signal.aborted) setOcupado(false) })
    return () => c.abort()
  }, [])
  useEffect(() => {
    if (!sesion) return
    const timer = window.setTimeout(() => salir('La sesión ha vencido. Vuelve a ingresar y realiza nuevamente la consulta.'), Math.max(0, sesion.vence - Date.now()))
    return () => window.clearTimeout(timer)
  }, [sesion, salir])
  async function ingresar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const valores = new FormData(form)
    setOcupado(true)
    setError('')
    try { setSesion(await pedirPanel<SesionPanel>('login', { cuerpo: { usuario: valores.get('usuario'), clave: valores.get('clave') } })) }
    catch (e) { setError(mensajePanel(e)); (form.elements.namedItem('clave') as HTMLInputElement).value = '' }
    finally { setOcupado(false) }
  }
  return <><Cabecera volver/>{sesion ? <Panel sesion={sesion} salir={salir} renovar={renovar}/> :
    <main className="wrap"><section className="panel acceso">
      <span className="icon-tile"><Icon name="shield"/></span><h1>Acceso de supervisor</h1>
      <form onSubmit={ingresar} method="post">
        <label htmlFor="usuario">Usuario institucional</label><input id="usuario" name="usuario" autoComplete="username" required maxLength={128}/>
        <label htmlFor="clave">Contraseña</label><input id="clave" name="clave" type="password" autoComplete="current-password" required maxLength={256}/>
        {error && <p className="invalid" role="alert">{error}</p>}
        <button className="submit" disabled={ocupado}>{ocupado && <span className="spinner"/>}Iniciar sesión</button>
      </form>
    </section></main>}</>
}
