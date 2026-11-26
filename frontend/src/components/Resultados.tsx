import type { Consulta, TipoInforme } from '../../../shared/consulta.ts'
import { Icon } from './Icon'
import { EstadoDocumento } from './EstadoDocumento'

export function Resultados({ datos, mensaje, ocupado }: { datos: Consulta | null; mensaje: string; ocupado: boolean }) {
  const conAvisos = datos && Object.values(datos.informes).some(informe => informe && 'aviso' in informe)
  function filaInforme(tipo: TipoInforme, titulo: string) {
    return <tr><th scope="row">{titulo}</th><td>
      <EstadoDocumento estado={datos?.informes[tipo] ?? null} sinRegistros={tipo === 'cobro' ? 'Sin registros' : titulo + ' sin registros.'}/>
    </td></tr>
  }
  return <section className="panel result-panel" aria-labelledby="result-title" aria-busy={ocupado}>
    <div className="section-heading"><span className="icon-tile"><Icon name="list"/></span><h2 id="result-title">Resultado de la consulta</h2></div>
    {datos ? <>
      <p className={conAvisos ? 'hint' : 'success'} role="status"><Icon name={conAvisos ? 'info' : 'check'} size={16}/>{conAvisos ? 'Consulta completada con avisos.' : 'Consulta completada correctamente.'}</p>
      <table><thead><tr><th>Campo</th><th>Información</th></tr></thead>
        <tbody>
          <tr><th scope="row">Número de cédula</th><td className="mono">{datos.cedula}</td></tr>
          <tr><th scope="row">Nombre del contratista</th><td>{datos.contratista}</td></tr>
          <tr><th scope="row">Número de contrato</th><td className="mono">{datos.numeroContrato}</td></tr>
          <tr><th scope="row">Supervisor</th><td>{datos.supervisor ?? 'No registrado'}</td></tr>
          <tr><th scope="row">Apoyo a la supervisión</th><td>{datos.apoyoSupervision ?? 'No registrado'}</td></tr>
          <tr><th scope="row">Apoyo logístico</th><td>{datos.apoyoLogistico ?? 'No registrado'}</td></tr>
          {filaInforme('gestion', 'Informe de gestión')}
          {filaInforme('supervision', 'Informe de supervisión')}
          {filaInforme('cobro', 'Cuenta de cobro y Pago de Seguridad Social')}
        </tbody>
      </table>
    </> : <div className={'empty ' + (mensaje ? 'feedback' : '')} role="status">
      <span className="empty-icon">{ocupado ? <span className="spinner"/> : <Icon name={mensaje ? 'info' : 'archive'} size={26}/>}</span>
      <strong>{ocupado ? 'Consultando informes…' : mensaje || 'Aún no hay una consulta'}</strong>
      {!ocupado && <p>{mensaje ? 'Revisa el número de cédula e intenta nuevamente.' : 'Los estados de tus informes aparecerán aquí.'}</p>}
    </div>}
  </section>
}
