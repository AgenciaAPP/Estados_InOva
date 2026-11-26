import type { FormEvent, RefObject } from 'react'
import { Icon } from './Icon'

interface Props {
  valor: string
  error: string | null
  ocupado: boolean
  campo: RefObject<HTMLInputElement | null>
  editar: (valor: string) => void
  enviar: (evento: FormEvent) => void
}
export function Formulario({ valor, error, ocupado, campo, editar, enviar }: Props) {
  return <section className="panel form-panel" aria-labelledby="form-title">
    <div className="section-heading"><span className="icon-tile"><Icon name="id"/></span><h2 id="form-title">Consulta por cédula</h2></div>
    <form onSubmit={enviar} noValidate>
      <label htmlFor="cedula">Número de cédula</label>
      <div className="controls">
        <input ref={campo} id="cedula" type="text" value={valor} disabled={ocupado} inputMode="numeric" pattern="[0-9]+" required autoComplete="off" spellCheck={false} placeholder="Ingresa tu número de cédula" aria-invalid={!!error} aria-describedby="input-hint" onChange={e => editar(e.target.value)}/>
        <button className="submit" disabled={ocupado}>{ocupado ? <span className="spinner"/> : <Icon name="search" size={18}/>} {ocupado ? 'Consultando…' : 'Consultar estados'}</button>
      </div>
      <p id="input-hint" className={error ? 'hint invalid' : 'hint'} aria-live="polite">{error || 'Escribe solo números, sin puntos ni espacios.'}</p>
    </form>
  </section>
}
