# In-Ova en una sola Preview de Vercel

El proyecto sirve el menú React y las dos modalidades desde una sola URL. Vite compila el frontend y Vercel ejecuta Express y ExcelJS en una función Node. El único recurso adicional es una pequeña base **Turso Cloud** dedicada a la demo, que se conecta desde el Marketplace de Vercel. Solo hay que generar un secreto manualmente, el hash de la contraseña de **supervisor_demo**.

## 1. Comprobar la copia local

Desde PowerShell, en la carpeta que contiene `package.json`, usa Node **24.x, versión 24.7 o superior**, y Git para Windows. Ejecuta:

```powershell
node --version
git --version
npm.cmd ci
npm.cmd run build
npm.cmd test
```

Para el uso institucional habitual, `npm.cmd start` sigue leyendo el `.env` privado y escuchando en `http://127.0.0.1:3001` por defecto. Para un ensayo local con datos ficticios, abre otra ventana de PowerShell, establece `$env:CONTRACT_SOURCE = 'mock'` y `$env:INOVA_SOURCE = 'mock'`, y ejecuta el mismo comando. La configuración MySQL, la CA, la API de In-Ova y la cuenta local se administran en ese equipo. [Configuración local](README.md)

## 2. Subir el código a un GitHub privado

Crea el repositorio en la cuenta u organización autorizada. Si pertenece a una organización de GitHub y es privado, la integración Git de Vercel requiere un equipo Pro o Enterprise. Confirma que dispones del plan que corresponde antes de importar. [Repositorios privados y planes de Vercel](https://vercel.com/docs/git#deploying-private-git-repositories)

Crea en GitHub un repositorio **privado y vacío**. En una carpeta que todavía carece de historial, ejecuta `git init -b main`. Si ya tiene historial, conserva sus ramas y remoto y revisa también los commits anteriores. Desde la raíz:

```powershell
git check-ignore .env .supervisor.hash .env.demo mysql-ca.pem
git add -- .gitignore .vercelignore .env.example .env.vercel.example README.md DESPLIEGUE_VERCEL.md package.json package-lock.json tsconfig.json vite.config.ts vercel.ts api backend frontend scripts shared tests
git status --short
git ls-files -ci --exclude-standard
git diff --cached --stat
```

El primer comando debe listar los cuatro nombres y `git ls-files -ci --exclude-standard` debe quedar vacío. Revisa los archivos preparados y el contenido con `git diff --cached`. Las plantillas llevan valores vacíos para los secretos. Los cuatro `.crt` de `tests/fixtures` son certificados sintéticos públicos usados por las pruebas TLS. Si encuentras una credencial en el historial, rótala antes de subirlo.

```powershell
git commit -m "Habilitar demo protegida en una sola Preview de Vercel"
# Usa la URL de tu repositorio privado. Omite remote add si ya existe el remoto autorizado.
git remote add origin https://github.com/TU-CUENTA/TU-REPOSITORIO.git
git push -u origin main
```

## 3. Importar y proteger el proyecto

1. En Vercel elige **Add New → Project**, conecta GitHub e importa el repositorio privado. Autoriza el acceso al repositorio elegido.
2. Usa los ajustes de la tabla. La configuración está versionada en `vercel.ts`. Puedes completar la importación inicial de `main` sin secretos. Fuera de Preview, la configuración devuelve **403** para el sitio y la API.
3. En **Settings → Deployment Protection** activa **Vercel Authentication** antes de crear la Preview. El alcance **Standard Protection** incluye las Preview. También puedes elegir **All Deployments**. Concede acceso a los participantes en Vercel. [Protección de despliegues](https://vercel.com/docs/deployment-protection)
4. Mantén habilitadas las **System Environment Variables**. La función y el enrutamiento usan `VERCEL_ENV`; la sesión queda vinculada al despliegue mediante `VERCEL_URL`. [Variables del sistema](https://vercel.com/docs/environment-variables/system-environment-variables)

| Ajuste | Valor |
| --- | --- |
| Root Directory | `.` (raíz del repositorio, donde están `api/` y `package.json`) |
| Framework Preset | Vite |
| Node.js | 24.x |
| Install Command | `npm ci` |
| Build Command | `npm run build:frontend` |
| Output Directory | `dist/client` |

## 4. Conectar el almacenamiento y preparar la contraseña

En el proyecto abre **Storage / Marketplace → Turso Cloud**, crea una base dedicada y conéctala al ambiente **Preview**. La integración ofrece una opción gratuita con cuotas; elige esa opción si se ajusta al ensayo. La aplicación crea su tabla en el primer acceso que necesita almacenamiento. El token de la base de demo necesita permiso de escritura. [Integración y nombres de variables](https://vercel.com/marketplace/tursocloud) · [SQL sobre HTTPS](https://docs.turso.tech/sdk/http/quickstart)

| Variable en Preview | Cómo obtenerla |
| --- | --- |
| `TURSO_DATABASE_URL` | La inyecta la integración. URL de la base dedicada, de tipo `libsql://…turso.io` o `https://…turso.io`. |
| `TURSO_AUTH_TOKEN` | La inyecta la integración. Token privado de esa base. |
| `DEMO_SUPERVISOR_HASH` | La configuras tú como variable sensible. Usa una contraseña exclusiva para la demo. |

Genera el hash en PowerShell desde la raíz. El comando pide la contraseña sin mostrarla y copia **solo el hash** al portapapeles. El archivo `.supervisor.hash` de tu instalación local conserva su contenido.

```powershell
$codificacionAnterior = $OutputEncoding
$claveDemo = Read-Host 'Nueva contraseña de supervisor_demo (mínimo 16 caracteres)' -AsSecureString
try {
    $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $hashDemo = [System.Net.NetworkCredential]::new('', $claveDemo).Password | node scripts/clave-supervisor.ts --vercel
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo generar el hash de demo.' }
    Set-Clipboard -Value $hashDemo
} finally {
    $claveDemo.Dispose()
    Remove-Variable claveDemo, hashDemo -ErrorAction SilentlyContinue
    $OutputEncoding = $codificacionAnterior
}
```

En **Environment Variables → Add**, selecciona **Preview**, nombre `DEMO_SUPERVISOR_HASH`, marca la variable como sensible, pega y guarda. Sobrescribe el portapapeles con `Set-Clipboard -Value ' '`. El usuario del panel es **supervisor_demo**. Conserva la contraseña en el gestor autorizado. Para rotarla, genera un hash nuevo y redespliega. Retira el acceso a las Preview antiguas que aún tengan la configuración anterior. [Secretos del proyecto](https://vercel.com/docs/environment-variables/sensitive-environment-variables)

La plantilla es `.env.vercel.example`. El navegador usa rutas relativas y requiere **cero variables `VITE_*`**. Mantén las credenciales, certificados y proveedores institucionales exclusivamente en el entorno local. La Preview prescinde de `DEMO_API_ORIGIN`, `DEMO_ORIGIN_SECRET`, `SUPERVISOR_ORIGIN` y archivos de autenticación.

## 5. Abrir la Preview y comprobar ambas modalidades

Con la protección y las tres variables ya configuradas, crea una rama distinta de la rama de producción:

```powershell
git switch -c demo
git push -u origin demo
```

En Vercel abre **Deployments**, selecciona el despliegue de `demo` etiquetado **Preview** y pulsa **Visit**. Si no aparece o cambiaste las variables, elige **Deployments → Create Deployment**, escribe `demo` y selecciona la configuración de esa rama. [Despliegues desde Git](https://vercel.com/docs/git)

| Desde esa misma URL | Resultado esperado |
| --- | --- |
| Ventana privada sin sesión Vercel, tanto en `/` como en `/api/configuracion` | Vercel pide identificación o deniega acceso. Verifícalo antes de compartir el enlace. |
| Menú → **Soy contratista** → `00000001` | Contrato `DEMO-001`, nueve filas, gestión aprobada, supervisión en revisión y cobro pendiente. `00000003` debe indicar cédula no encontrada. Usa exclusivamente los ejemplos ficticios. |
| **Soy supervisor** → iniciar sesión → **Consultar hasta el día de hoy** | Cuatro candidatos procesados, un excluido y tres incluidos. Se muestran nueve columnas y dos páginas. Recarga la pantalla para recuperar el lote. |
| Filtrar por cédula `00000005` → **Descargar Excel** | Una fila de datos con esa cédula. Tras limpiar el filtro, el Excel contiene los tres incluidos, incluso los de la segunda página. |
| **Cerrar sesión** → abrir `/api/supervisor/consulta` | HTTP 401. La cookie anterior también queda revocada en las otras instancias. |

Un **403 en todo el sitio** puede indicar que abriste Production o que falta acceso en Vercel. Un **503 de la API** en Preview requiere revisar las tres variables y redesplegar. Si la consulta individual funciona pero falla el panel con 503, revisa la disponibilidad de Turso, el token y el permiso de escritura. Un **429 en login** indica una verificación en curso o el límite de intentos.

## Qué se ejecuta en cada lugar

- **Vercel** entrega los archivos de Vite y dirige `/api/*` a `api/index.ts`. La función monta únicamente los adaptadores ficticios y usa el mismo ExcelJS que el backend local. React mantiene el menú y la navegación por fragmentos. Vercel Services también admite varios servicios en un proyecto; para esta aplicación basta el frontend estático y una función. [Functions en proyectos Node](https://vercel.com/docs/functions/runtimes/node-js) · [Express en Vercel](https://vercel.com/docs/frameworks/backend/express) · [Vercel Services](https://vercel.com/docs/services)
- **Turso** conserva una fila para la cuenta de demo. Contiene la huella de la cookie aleatoria, CSRF, el vencimiento, los intentos recientes, las reservas de trabajo y la fecha de la consulta vigente. Las actualizaciones SQL condicionales verifican el estado en el servidor. Otro login sustituye la sesión anterior; un logout confirmado la revoca. La sesión vence tras 30 minutos de inactividad. Si falla el almacén, las operaciones protegidas fallan y el panel permite reintentar el cierre. Una cookie firmada por sí sola seguiría siendo reutilizable hasta su vencimiento.
- **El lote ficticio** procesa cuatro contratos con concurrencia de dos. Termina dentro de la petición, con indicadores definitivos. Las lecturas siguientes reconstruyen las mismas filas por fecha de consulta, aplican el filtro a todo el resultado y después paginan de dos en dos. El Excel usa todas las coincidencias. Hay una verificación Argon2id en curso como máximo y cinco intentos por ventana de diez minutos. Una reserva compartida serializa consulta y exportación. Si se interrumpe la función, la reserva caduca a los 45 segundos.
- **Límites de Functions.** El proyecto fija 30 segundos por invocación. El hash usa 64 MiB y el XLSX del catálogo ficticio se comprueba por debajo de 4,5 MB, el límite de respuesta ordinaria. La documentación de Vercel indica 2 GB de memoria en Hobby. El procesamiento institucional prolongado y su exportación de hasta 16 MiB pertenecen al Express local. [Límites de Vercel Functions](https://vercel.com/docs/functions/limitations)
- **Entorno institucional.** El comando `npm.cmd start` conserva el servidor persistente, MySQL con la CA y la política TLS autorizadas, la API de In-Ova, la sesión local y páginas de 25 filas. La guía de configuración institucional está en el [README](README.md). El comando opcional `start:demo` pertenece a la configuración anterior con proxy externo.

## Alcance de las pruebas

En Windows y Node 24.19 se completaron la compilación de producción y las 105 pruebas automáticas, con cero fallos. En una copia limpia se verificó también `npm.cmd start` con ambos proveedores ficticios, incluyendo la consulta individual, el acceso del supervisor, el lote, el Excel y el cierre de sesión.

Las pruebas locales compilan la entrada de la función y la ejecutan en dos procesos Node independientes. El transporte de Turso se reproduce en loopback y una base SQLite ejecuta las sentencias SQL reales. Los casos comprueban sesiones compartidas y revocadas, expiración, CSRF, límite de intentos, consultas simultáneas, fallo del almacén, filtros y el contenido de los Excel. La verificación de la URL de Vercel, de Deployment Protection y del servicio Turso contratado corresponde a la comprobación de la sección 5.
