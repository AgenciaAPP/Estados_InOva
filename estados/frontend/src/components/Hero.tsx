export function Hero({ descripcion = 'Consulta el estado de tus informes de gestión y supervisión mediante tu número de cédula' }: { descripcion?: string }) {
  return <section className="hero" aria-labelledby="page-title">
    <div className="hero-copy">
      <h1 id="page-title">Consulta de estados<br/> de informes</h1>
      <p>{descripcion}</p>
    </div>
    <svg className="hero-art" viewBox="0 0 420 240" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="page" x2="1" y2="1" gradientUnits="objectBoundingBox"><stop stopColor="#e1fff1"/><stop offset="1" stopColor="#91ceba"/></linearGradient>
        <linearGradient id="edge" x2="1" y2="1"><stop stopColor="#a7ebce"/><stop offset="1" stopColor="#459683"/></linearGradient>
        <linearGradient id="seal" x2="1" y2="1"><stop stopColor="#b9f4a2"/><stop offset="1" stopColor="#78cc99"/></linearGradient>
        <pattern id="dots" width="15" height="15" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill="#96e6c8" opacity=".35"/></pattern>
      </defs>
      <rect width="420" height="240" fill="url(#dots)" opacity=".58"/>
      <g stroke="#8bd3b6" opacity=".28" strokeLinejoin="round">
        <path d="m7 166 100 50 64-30m146-34 71-34 36 17M82 36l52-25 47 24M180 224l42 20 101-52" strokeDasharray="4 5"/>
        <path d="m14 128 66 33m255-76 59-29m-96 162 40-20"/>
        <circle cx="14" cy="128" r="3"/><circle cx="394" cy="56" r="3"/>
      </g>
      <g strokeLinejoin="round">
        <path d="m68 139 119-62 141 69v9l-121 65-139-70z" fill="#398a76" stroke="#76bfa4"/>
        <path d="m68 139 119-62 141 69-121 65z" fill="#63ad94" stroke="#98d6b7"/>
        <path d="m71 124 119-62 141 69v9l-121 65-139-70z" fill="#5da48e" stroke="#9ad1b7"/>
        <path d="m71 124 119-62 141 69-121 65z" fill="#93ceb4" stroke="#b7e3cc"/>
        <path d="m75 106 114-58 143 68v9l-119 63-138-70z" fill="url(#edge)" stroke="#b8e7cf"/>
        <path d="m75 106 112-59 26 1 119 68-119 63z" fill="url(#page)" stroke="#d8fbe9"/>
        <path d="m187 47 7 12 19-11z" fill="#88c7b0"/>
      </g>
      <g transform="matrix(1.06 .52 -1 .51 184 61)">
        <rect x="0" y="0" width="22" height="22" rx="3" fill="#45947f"/>
        <path d="M5 16v-4m5 4V8m5 8V5" stroke="#dcf8e5" strokeWidth="2"/>
        <rect x="30" y="3" width="51" height="5" rx="2" fill="#4c9a84"/>
        <rect x="30" y="14" width="34" height="4" rx="2" fill="#91c1ac"/>
        <g fill="#92c4af"><rect y="35" width="85" height="4" rx="2"/><rect y="46" width="72" height="4" rx="2"/><rect y="57" width="78" height="4" rx="2"/><rect y="68" width="53" height="4" rx="2"/></g>
      </g>
      <g transform="rotate(9 297 149)">
        <rect x="271" y="125" width="49" height="49" rx="14" fill="#448a70" stroke="#4c9275"/>
        <rect x="270" y="121" width="49" height="49" rx="14" fill="url(#seal)" stroke="#d7f7c4"/>
        <path d="m282 145 8 8 16-18" stroke="#215c46" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
      </g>
    </svg>
  </section>
}
