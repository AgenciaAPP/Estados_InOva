import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { validarCedula, type Fuentes, type ResultadoConsulta } from '../../shared/consulta.ts'
import { Hero } from './components/Hero'
import { Formulario } from './components/Formulario'
import { Resultados } from './components/Resultados'
import { Ejemplos } from './components/Ejemplos'
import { Icon } from './components/Icon'
import { Inicio } from './components/Portal'
import { Supervisor } from './components/Supervisor'
import { consultarInformes, obtenerFuentes } from './services/consulta'
import { sinConexion } from './services/api'
import './style.css'

function ConsultaIndividual() {
  const [valor, setValor] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState('')
  const [datos, setDatos] = useState<ResultadoConsulta | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const campo = useRef<HTMLInputElement>(null)
  const [configuracion, setConfiguracion] = useState<Fuentes | null>(null)
  const fuentes = datos?.fuentes ?? configuracion
  const demo = fuentes?.contratos === 'mock'
  const [falloConfiguracion, setFalloConfiguracion] = useState(false)
  useEffect(() => { obtenerFuentes().then(setConfiguracion).catch(() => setFalloConfiguracion(true)) }, [])

  function editar(nuevo: string) {
    setValor(nuevo)
    setError(null)
    setMensaje('')
    setDatos(null)
  }
  async function enviar(evento: FormEvent) {
    evento.preventDefault()
    if (ocupado) return
    const problema = validarCedula(valor)
    setError(problema)
    if (problema) { campo.current?.focus(); return }
    setDatos(null)
    setMensaje('')
    setOcupado(true)
    try {
      const resultado = await consultarInformes(valor)
      setConfiguracion(resultado.fuentes)
      setDatos(resultado)
    } catch (e) {
      const conocidos = ['Cédula no encontrada.', 'Contrato no encontrado.', 'Error durante la consulta. Inténtalo de nuevo.']
      setMensaje(e instanceof Error && conocidos.includes(e.message) ? e.message : sinConexion)
    } finally { setOcupado(false) }
  }
  return <>
    <header className="site-header"><div className="wrap header-row">
      <div className="brand"><img src="/marca.svg" alt=""/><span>In-Ova</span></div>
      <span className="portal">Portal de contratistas</span>
      {fuentes && <span className="mode"><i/>{demo ? 'Modo demostración' : fuentes.informes === 'real' ? 'Estados de In-Ova' : 'Estados simulados'}</span>}
    </div></header>
    <main className="wrap">
      <Hero/>
      <div className={demo ? 'dashboard' : 'dashboard solo'}>
        <div className="primary">
          <Formulario valor={valor} error={error} ocupado={ocupado} campo={campo} editar={editar} enviar={enviar}/>
          {fuentes?.contratos === 'mysql' && <p className="hint">Los datos contractuales provienen de MySQL. {fuentes.informes === 'real' ? 'Los estados se consultan en In-Ova.' : 'Los estados son simulados.'}</p>}
          <Resultados datos={datos} mensaje={mensaje || (!fuentes && falloConfiguracion ? sinConexion : '')} ocupado={ocupado}/>
        </div>
        {demo && <Ejemplos ocupado={ocupado} elegir={id => { editar(id); campo.current?.focus() }}/>}
      </div>
    </main>
    <footer className="wrap"><span><b>In-Ova</b><span className="footer-divider">/</span>Portal de contratistas</span><a href="#inicio">Volver al menú</a><span><Icon name="shield" size={15}/>Consulta de solo lectura</span></footer>
  </>
}

function App() {
  const [ruta, cambiarRuta] = useState(window.location.hash)
  useEffect(() => {
    function navegar() { cambiarRuta(window.location.hash); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', navegar)
    return () => window.removeEventListener('hashchange', navegar)
  }, [])
  if (ruta === '#contratista') return <ConsultaIndividual/>
  if (ruta === '#supervisor') return <Supervisor/>
  return <Inicio/>
}

createRoot(document.getElementById('root')!).render(<App/>)
