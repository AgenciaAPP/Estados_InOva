import { Icon } from './Icon'

const ejemplos = [
  ['00000001', 'Ambos informes'],
  ['00000002', 'Solo informe de gestión'],
  ['00000003', 'Cédula inexistente'],
]
export function Ejemplos({ elegir, ocupado }: { elegir: (cedula: string) => void; ocupado: boolean }) {
  return <aside className="panel examples" aria-labelledby="examples-title">
    <div className="section-heading"><span className="icon-tile"><Icon name="flask"/></span><h2 id="examples-title">Cédulas de prueba</h2></div>
    <p>Selecciona un ejemplo para llenar el campo de cédula.</p>
    <div className="examples-list">{ejemplos.map(([id, titulo]) =>
      <button key={id} disabled={ocupado} onClick={() => elegir(id)}>
        <span><strong className="mono">{id}</strong><small>{titulo}</small></span><Icon name="arrow" size={17}/>
      </button>)}</div>
    <div className="demo-note"><Icon name="info" size={17}/><span>Los datos y estados de esta demostración son ficticios.</span></div>
  </aside>
}
