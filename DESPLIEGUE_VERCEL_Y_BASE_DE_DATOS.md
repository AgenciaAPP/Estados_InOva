# Guía de Vercel y de datos para In-Ova

## Antes de desplegar: hay dos aplicaciones distintas en este repositorio

La aplicación de la **raíz** sirve React con Vite y Express atiende `/api`, consulta MySQL y, opcionalmente, In-Ova. Ahora incluye una entrada serverless para Vercel en `api/index.ts` y el enrutamiento de `vercel.json`. Para que las consultas reales funcionen, Vercel también debe poder acceder a MySQL y el panel necesita el almacén compartido Upstash.

La carpeta [`estados/`](./estados/) contiene otra configuración, preparada para una **Preview de demostración** en Vercel. Usa contratos e informes ficticios y Turso para la sesión del supervisor. No consulta el MySQL institucional ni In-Ova real. Su guía detallada es [`estados/DESPLIEGUE_VERCEL.md`](./estados/DESPLIEGUE_VERCEL.md).

Puedes desplegar la demo seleccionando `estados/` como **Root Directory**. Para el sistema institucional de la raíz, selecciona `.` como **Root Directory** y sigue la sección de despliegue más abajo. No combines las variables institucionales con el proyecto de demo.

## Qué datos debe tener MySQL

El backend consulta una tabla llamada exactamente `contratos` dentro de la base seleccionada por `DB_NAME`. No crea tablas, no carga datos iniciales ni transforma el esquema: el administrador de la base debe confirmar y aprovisionar las columnas y los permisos.

| Columna | Uso y formato requerido |
| --- | --- |
| `nitCc` | Identificador consultado por el usuario. Almacénalo como texto (`VARCHAR`), no como tipo numérico, para preservar ceros iniciales. La entrada aceptada por la web contiene solo dígitos, sin espacios, puntos ni guiones. |
| `contratista` | Nombre directo del contratista como texto (`VARCHAR`/`TEXT`), no una clave foránea. Debe ser un nombre verificable, no un código numérico. |
| `numeroContrato` | Número completo del contrato, preferiblemente texto para conservar prefijos, mayúsculas y ceros iniciales. Debe coincidir exactamente con el número asociado a los informes en In-Ova. |
| `supervisor` | Nombre del supervisor, texto o `NULL`. |
| `apoyoSupervision` | Nombre del apoyo a supervisión, texto o `NULL`. |
| `apoyoJuridico` | Nombre del apoyo jurídico, texto o `NULL`. |
| `apoyoLogistico` | Nombre del apoyo logístico, texto o `NULL`. |
| `fechaActualizacion` | Fecha/hora válida para ordenar versiones del registro. Si hay varias filas de una cédula, se elige la de actualización más reciente. |
| `estado` | Necesaria para el panel. El listado selecciona contratos cuyo valor sea exactamente `EN EJECUCIÓN`. |

Las ocho primeras columnas del listado (incluida `fechaActualizacion`) se validan al iniciar el modo MySQL; `estado` se necesita para cargar los contratos del panel. Si `contratista` es una referencia, primero hay que documentar y validar la relación correcta: la aplicación no la resuelve automáticamente.

La consulta individual que ejecuta el backend equivale a:

```sql
SELECT nitCc, contratista, numeroContrato, supervisor, apoyoSupervision,
       apoyoJuridico, apoyoLogistico
FROM contratos
WHERE nitCc = ?
ORDER BY fechaActualizacion DESC
LIMIT 1;
```

El valor de `?` se envía como texto mediante una consulta parametrizada. Si no existe una fila para la cédula, se informa «Cédula no encontrada». Si la fila más reciente tiene `numeroContrato` vacío, se informa «Contrato no encontrado». Los campos de responsables pueden estar vacíos o ser `NULL`; se mostrarán como no registrados.

### Datos adicionales para el panel de supervisión

El panel no lista cualquier contrato: filtra `estado = 'EN EJECUCIÓN'` y números que comienzan con `PS`, distingue el prefijo respetando mayúsculas y elige una sola fila reciente por cédula. La consulta del listado usa funciones de ventana (`ROW_NUMBER`), por lo que el servidor debe ser MySQL 8.0 o compatible. En el alcance piloto, los números permitidos deben coincidir exactamente con `numeroContrato`.

Para un piloto institucional, configura en el backend:

```dotenv
SUPERVISOR_SCOPE=pilot
SUPERVISOR_PILOT_CONTRACTS=["PS001","PS002"]
```

Reemplaza esos dos valores ficticios por una lista JSON de hasta diez números completos autorizados por el responsable. No cambies los números a formato numérico ni elimines ceros. `SUPERVISOR_SCOPE=all` amplía el listado a todos los contratos que cumplan el filtro; úsalo solo con autorización. El panel requiere además una contraseña configurada en el servidor; consulta la sección «Panel de supervisores» del [README](./README.md).

## Variables para probar MySQL localmente

Parte de `.env.example` y completa los valores únicamente con los datos proporcionados por el administrador autorizado:

```dotenv
CONTRACT_SOURCE=mysql
INOVA_SOURCE=mock
DB_HOST=
DB_PORT=3306
DB_USER=
DB_PASSWORD=
DB_NAME=
DB_TLS=true
DB_TLS_MODE=VERIFY_IDENTITY
DB_TLS_SERVERNAME=
DB_SSL_CA_FILE=
```

- `DB_HOST`, `DB_PORT`: host y puerto accesibles desde el servidor donde se ejecuta Node.
- `DB_USER`, `DB_PASSWORD`: cuenta de solo lectura con `SELECT` sobre las columnas requeridas de `contratos` y permisos para leer los metadatos de su esquema.
- `DB_NAME`: nombre exacto de la base que contiene `contratos`; el programa no escoge entre bases de nombre parecido.
- `DB_TLS=true`: conserva TLS. El modo predeterminado `VERIFY_IDENTITY` valida la cadena y que el certificado corresponda al DNS/IP utilizado. Si el administrador confirma otro DNS oficial, configúralo en `DB_TLS_SERVERNAME`.
- `DB_SSL_CA_FILE`: ruta local a la CA en PEM, si la configuración TLS autorizada la requiere. En Vercel usa `DB_SSL_CA_CONTENT` con el contenido PEM privado. No configures ambas opciones a la vez ni desactives la verificación TLS para resolver un error de certificado.

Ejecuta estos comandos desde la carpeta que contiene el `package.json` de la raíz:

```powershell
npm.cmd ci
npm.cmd run db:check
npm.cmd run build
npm.cmd start
```

`db:check` valida la conexión TLS, el esquema y el permiso de lectura sin buscar una cédula ni recuperar datos personales. Solo después de que termine correctamente, prueba una consulta con una cédula autorizada, introducida en la pantalla. No pegues credenciales, cédulas reales ni resultados con datos personales en Git, tickets o logs compartidos. `.env`, certificados y la contraseña de supervisor son privados y no deben subirse al repositorio.

## Activar informes reales de In-Ova

La integración real usa el número de contrato que encontró MySQL; por eso un valor incompleto, con formato diferente o con ceros perdidos no encontrará el informe esperado. Empieza con `INOVA_SOURCE=mock`, valida MySQL y confirma un caso de prueba institucional antes de cambiar a datos reales.

`INOVA_SOURCE=real` requiere simultáneamente `CONTRACT_SOURCE=mysql` y estas opciones privadas del backend:

```dotenv
INOVA_SOURCE=real
INOVA_API_KEY=
INOVA_BASE_URL=https://databridge-api.in-ova-bi.co
INOVA_FORM_GESTION=nPozbdjobkkpiIsdgI0zFXrvPdUm8FgJRw==
INOVA_FORM_SUPERVISION=_qCVahYhHpXHyjBWlcl5ozFNf4UxLTxO_w==
INOVA_FORM_COBRO=lmW2bbWMwGFOru75HQCIwvIaT6txPRPsCA==
INOVA_RUTA_CONTRATO_GESTION=
INOVA_RUTA_CONTRATO_SUPERVISION=
INOVA_RUTA_CONTRATO_ENTIDAD=/identification
```

Los IDs de formulario tienen valores predeterminados en el proyecto; confírmalos con el responsable de In-Ova antes del uso institucional. `INOVA_API_KEY` debe ser una clave vigente y autorizada para consultar esos formularios. No la pongas en una variable `VITE_*`, en el frontend ni en un archivo versionado.

Las dos rutas `INOVA_RUTA_CONTRATO_GESTION` y `INOVA_RUTA_CONTRATO_SUPERVISION` deben ser punteros JSON confirmados al número de contrato dentro de cada fila `results[]` del formulario respectivo; déjalas vacías solo si se verificará el número mediante la entidad relacionada. Para cobro se comprueba la entidad y `/identification` por defecto. No adivines las rutas: pueden depender de cómo el formulario almacena `answers`.

El backend espera que cada página de In-Ova contenga un arreglo `results` y un `next` que sea `null` al terminar o un cursor/enlace válido a la siguiente página. Cada fila debe identificar su `form_id`; el estado se lee de `estado_id` y, si hay varios envíos del mismo contrato, la fecha de `date` debe ser un instante ISO con zona horaria explícita para elegir el más reciente. La coincidencia del contrato es textual y exacta; una búsqueda parcial o una respuesta sin todas sus páginas no confirma que no existan informes.

Con MySQL configurado, la comprobación de estructura de In-Ova puede explorar los formularios para una cédula de prueba autorizada:

```powershell
# Ejecutar solo en el equipo/entorno autorizado; la entrada de la cédula no se incluye
# en el comando ni se imprime en el diagnóstico.
$caso = Read-Host 'Cédula del caso de prueba autorizado' -AsSecureString
try {
  [System.Net.NetworkCredential]::new('', $caso).Password |
    npm.cmd run inova:check -- --estructura
} finally {
  $caso.Dispose()
  Remove-Variable caso
}
```

Confirma con el responsable que cada ruta identifica el número contractual completo y que el estado que presenta la aplicación corresponde al envío más reciente. La comprobación no reemplaza esa validación funcional. Cuando las rutas estén verificadas, configura `INOVA_SOURCE=real` en el entorno privado y repite la prueba con un caso autorizado.

## Desplegar la aplicación institucional de la raíz en Vercel

### 1. Importar el proyecto

Importa este repositorio en Vercel y configura:

| Ajuste | Valor |
| --- | --- |
| Root Directory | `.` |
| Node.js | 24.x |
| Install Command | `npm ci` |
| Build Command | `npm run build:vercel` |
| Output Directory | `dist/client` |

Estos ajustes están en [`vercel.json`](./vercel.json). La función `api/index.ts` compone la fábrica `crearApp()` con los proveedores y rutas del backend; no llama a `app.listen()`. El servidor local continúa arrancando desde `backend/index.ts`. La instalación ejecuta el `postinstall` existente, que verifica y aplica el ajuste de TLS para la versión fijada de `mysql2`; si el build informa que esa versión no está verificada, no omitas el error ni desactives TLS.

### 2. Crear el almacenamiento compartido del panel

Crea una base Redis REST en Upstash y configura, como variables **sensibles** de Vercel:

| Variable | Contenido |
| --- | --- |
| `UPSTASH_REDIS_REST_URL` | URL HTTPS REST entregada por Upstash. |
| `UPSTASH_REDIS_REST_TOKEN` | Token privado de esa base. |

El panel guarda en ese almacén la sesión y el resultado del lote para recuperarlos entre funciones; los registros expiran al cerrar sesión o tras el vencimiento de la sesión. El resultado contiene cédulas, nombres, números de contrato e informes. Antes de usar datos reales, confirma con la institución que Upstash y su región están autorizados para almacenar esos datos. Usa una base separada de la demo y no compartas esos secretos con Preview no autorizadas.

### 3. Configurar las variables privadas

Agrega en **Project → Settings → Environment Variables** los valores autorizados. No subas `.env`, certificados, claves ni hashes al repositorio. Empieza con **Preview** autorizada; activa **Production** solo después de validar la conectividad y un caso de prueba institucional.

| Grupo | Variables y criterios |
| --- | --- |
| Proveedores | `CONTRACT_SOURCE=mysql`, `INOVA_SOURCE=mock` para la primera prueba de MySQL. Para informes reales, cambia a `INOVA_SOURCE=real` solo tras validar sus rutas y el caso de prueba. |
| MySQL | `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_TLS=true`, `DB_TLS_MODE`, `DB_TLS_SERVERNAME` según la sección de conexión local. Usa una cuenta institucional de solo lectura. |
| Certificado | Si se requiere CA privada, pega el PEM completo en `DB_SSL_CA_CONTENT`. También acepta PEM con `\n` literales. En `VERIFY_CA` es obligatorio; no configures a la vez `DB_SSL_CA_FILE`. |
| In-Ova | `INOVA_API_KEY` privada y los IDs/rutas de formulario confirmados en la sección anterior. |
| Supervisor | `SUPERVISOR_USER`, `SUPERVISOR_HASH`, `SUPERVISOR_SCOPE=pilot`, `SUPERVISOR_PILOT_CONTRACTS` y `SUPERVISOR_CONCURRENCY=2`. El hash es el contenido Argon2id producido por `npm run supervisor:clave`; no es la contraseña en texto plano. La lista piloto debe tener hasta diez números completos autorizados, codificados como texto en JSON. |
| Origen | `SUPERVISOR_ORIGIN` debe ser el origen HTTPS exacto que usarán los supervisores, por ejemplo `https://inova.ejemplo.gov.co`, sin ruta ni barra final. Si se deja vacío, la función usa `VERCEL_URL` en Preview y `VERCEL_PROJECT_PRODUCTION_URL` en Production cuando esté disponible. |

Mantén habilitadas las variables de entorno de sistema de Vercel. Si cambias una variable, crea un nuevo despliegue para que la función la reciba. En producción con un dominio personalizado, configura explícitamente `SUPERVISOR_ORIGIN` con ese dominio; el nombre de despliegue no necesariamente es el dominio que abre el usuario.

### 4. Confirmar que Vercel puede llegar a MySQL

Vercel ejecuta la función fuera de la red local. El host y puerto de MySQL deben ser accesibles desde Vercel y el firewall debe permitir la conexión con TLS e identidad válidos. Solicita al administrador la política de red y el DNS/SAN del certificado. No abras MySQL a todo Internet ni confíes en que las IP de salida sean fijas: configura el mecanismo de egreso estático autorizado si la infraestructura exige una lista de IP.

Si MySQL solo responde dentro de la red institucional y no hay egreso autorizado desde Vercel, las funciones no podrán conectarse. No hay un cambio de variables que resuelva ese bloqueo; necesitarás un túnel/proxy aprobado o ejecutar el backend en un servicio Node dentro de esa red.

### 5. Límites y comprobación funcional

El panel serverless solo permite el alcance **pilot**, con un máximo de diez contratos candidatos por consulta y concurrencia máxima de dos. La lista autorizada admite hasta diez números, pero un número puede corresponder a más de una cédula; si el resultado contiene más de diez filas, la aplicación lo rechaza para mantener la duración acotada. El lote se completa dentro de una invocación con límite configurado de 300 segundos; el plan de Vercel debe permitirlo. La descarga Excel en esta ruta se limita a 4 MiB para respetar el tamaño de respuesta de Functions. Para lotes generales o exportaciones mayores se necesita otro diseño de procesamiento/almacenamiento.

Después del despliegue:

1. Comprueba `/api/configuracion` en la URL de Preview.
2. Prueba una cédula autorizada y verifica el contrato más reciente.
3. Inicia sesión, consulta el piloto y recarga la página: la sesión, el paginado y el resultado deben persistir.
4. Prueba un filtro y una descarga Excel menor de 4 MiB.
5. Si MySQL falla, revisa los logs de Functions y el diagnóstico TLS/red; no compartas logs que contengan datos personales o secretos.

La Preview de la carpeta [`estados/`](./estados/DESPLIEGUE_VERCEL.md) sigue siendo una aplicación distinta y de datos ficticios; no uses sus variables Turso para este proyecto de la raíz.
