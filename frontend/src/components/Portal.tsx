import { Hero } from './Hero'
import { Icon } from './Icon'

export function Cabecera({ volver = false }: { volver?: boolean }) {
  return <header className="site-header"><div className="wrap header-row">
    <div className="brand"><img src="/marca.svg" alt=""/><span>In-Ova</span></div>
    <span className="portal">Portal de consultas</span>
    {volver && <a className="menu-link" href="#inicio">Volver al menú</a>}
  </div></header>
}

export function Inicio() {
  return <><Cabecera/><main className="wrap">
    <Hero descripcion="Selecciona tu modalidad de acceso para consultar los estados de los informes."/>
    <nav className="opciones" aria-label="Modalidades de acceso">
      <a href="#contratista" className="panel opcion">
        <span className="icon-tile"><Icon name="id"/></span>
        <div><h2>Soy contratista</h2><p>Consulta tus informes con tu número de cédula.</p></div><Icon name="arrow"/>
      </a>
      <a href="#supervisor" className="panel opcion">
        <span className="icon-tile"><Icon name="shield"/></span>
        <div><h2>Soy supervisor</h2><p>Ingresa con tu cuenta para consultar los contratos activos.</p></div><Icon name="arrow"/>
      </a>
    </nav>
  </main></>
}
