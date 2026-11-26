# Consulta de estados de informes · In-Ova

Aplicación local de solo lectura para consultar por cédula los estados de gestión, supervisión y Cuenta de cobro y Pago de Seguridad Social. Funciona en demostración completa, con MySQL y estados simulados, o con MySQL y estados obtenidos por HTTPS de In-Ova. El navegador se comunica únicamente con Express.

## Ejecutar la aplicación

Requiere Node.js 24 o posterior y npm. Ejecuta los comandos desde el directorio que contiene `package.json`.

```sh
npm ci
npm run build
npm start
```

Abre **http://127.0.0.1:3001**. Un solo servidor entrega la interfaz compilada y el endpoint de consulta. Para detenerlo, pulsa Ctrl+C.

En el menú inicial, **Soy contratista** abre la consulta individual por cédula. **Soy supervisor** abre el acceso institucional al listado de contratos activos. Ambas pantallas permiten volver al menú.

Sin archivo `.env`, ambos proveedores usan datos ficticios. `PORT` vale 3001 por defecto. Node carga `.env` únicamente en el backend. Vite tiene desactivada la carga de archivos de entorno.

### Desarrollo

Después de instalar las dependencias, ejecuta los siguientes comandos en dos terminales.

| Terminal | Comando | Función |
| --- | --- | --- |
| Frontend | `npm run dev` | Vite compila React en `dist/client` y vuelve a compilar cuando guardas cambios. |
| Backend | `npm run dev:api` | Node ejecuta Express desde TypeScript y se reinicia al cambiar su código. |

Espera a que termine la primera compilación y abre la misma dirección del servidor. Actualiza la pestaña para ver los cambios del frontend. Tanto la interfaz como la API utilizan el puerto configurado en el backend.

## Probar la demostración

Conserva los ceros iniciales. Escribe una de estas cédulas o selecciona un ejemplo en la interfaz y pulsa **Consultar estados**.

| Cédula ficticia | Contrato seleccionado | Gestión | Supervisión | Cuenta de cobro |
| --- | --- | --- | --- | --- |
| `00000001` | DEMO-001 · Contratista Alfa | Aprobado | En revisión | Pendiente |
| `00000002` | DEMO-002 · Contratista Beta | Devuelto para ajustes | Sin registros | Sin registros |
| `00000003` | Cédula no encontrada | — | — | — |
| `00000004` | Contratista registrado sin número de contrato | — | — | — |
| `00000005` | DEMO-0010 · Contratista Épsilon | Sin registros | Aprobado | Aprobado |

Los nombres y las equivalencias de estados pertenecen a la demostración. Por ejemplo, la última cédula permite comprobar que buscar `DEMO-001` excluye el registro más reciente de `DEMO-0010`.

## Flujo de consulta

1. React valida la entrada y solicita `GET /api/consulta-informes?cedula=00000001`. La cédula se conserva como texto. El backend repite la validación para atender también a otros clientes.
2. El servicio de contratos busca por cédula, ordena por fecha de actualización descendente y toma una sola fila. De ella obtiene el nombre, el número de contrato, el supervisor y los apoyos a la supervisión, jurídico y logístico. Los campos de responsables nulos, vacíos o compuestos solo por espacios se devuelven como `null` y se muestran como «No registrado». Una fila con número de contrato vacío produce «Contrato no encontrado». La ausencia de filas produce «Cédula no encontrada».
3. Una sola búsqueda en MySQL proporciona el contrato para las tres consultas independientes en paralelo. El endpoint devuelve sus resultados en `informes.gestion`, `informes.supervision` e `informes.cobro`. En demostración, el backend simula coincidencias parciales paginadas. Con MySQL y estados simulados genera tres estados ficticios reproducibles.
4. El adaptador real verifica el formulario y la igualdad exacta del contrato, recorre la paginación y selecciona el envío más reciente. Una fecha ambigua o una lectura incompleta produce un aviso en la fila del informe afectado. El simulador conserva su criterio provisional de tomar la primera fila en caso de empate.
5. Cada fila muestra la descripción del estado observado, «sin registros» para una búsqueda completa sin coincidencias, o un aviso si no se pudo verificar el resultado. Un identificador real desconocido muestra «Estado no identificado».

El endpoint responde con HTTP 200 y los datos de la consulta, 400 para entradas inválidas, 404 para cédulas o contratos ausentes y 500 con un mensaje genérico ante fallos del servicio. La API usa `Cache-Control: no-store`. La interfaz borra el resultado anterior al editar la cédula. Tanto el resultado como `GET /api/configuracion` incluyen `fuentes.contratos` y `fuentes.informes`. En modo mixto la pantalla identifica los estados como simulados y oculta los ejemplos del catálogo ficticio.

## Estructura

| Ruta | Contenido |
| --- | --- |
| `frontend/src/main.tsx` | Formulario, carga, validación, errores y coordinación de resultados. |
| `frontend/src/components/` | Encabezado ilustrado, formulario, tabla de resultados y ejemplos seleccionables. |
| `frontend/src/services/consulta.ts` | Peticiones al backend del mismo origen. |
| `frontend/src/style.css`, `frontend/public/` | Estilos responsive y recursos gráficos locales. |
| `shared/consulta.ts` | Tipos de respuesta y validación compartida. |
| `backend/index.ts`, `backend/app.ts`, `backend/config.ts` | Arranque local, rutas HTTP, selección independiente de proveedores y configuración del servidor. |
| `backend/services/contratos.ts`, `backend/mysql/contratos.ts` | SQL parametrizado, pool MySQL, revisión del esquema, conversión de la fila y diagnóstico. |
| `backend/services/consulta.ts`, `informes.ts`, `estados.ts` | Coordinación de servicios, selección del registro y equivalencias de estados. |
| `backend/mock/` | Datos ficticios, simulación de los proveedores y normalización de las respuestas. |
| `backend/inova/` | Configuración, cliente HTTPS, selección de registros, catálogo oficial y diagnóstico de estructura. |
| `scripts/comprobar-inova.ts`, `tests/inova.test.ts` | Comprobación controlada por cédula y pruebas del proveedor con respuestas sintéticas. |
| `tests/consulta.test.ts`, `tests/mysql.test.ts` | Pruebas del modo demo, adaptador MySQL, flujo mixto y errores sobre loopback. |
| `.env.example`, `package.json`, `package-lock.json` | Plantilla de configuración, comandos y versiones de dependencias. |

## Activar MySQL con informes simulados

Desde PowerShell, crea el archivo de entorno si todavía no existe. El archivo está excluido de Git. Si ya existe, edítalo conservando la configuración local que necesites.

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

En `.env`, selecciona los proveedores y completa los campos de conexión con la configuración autorizada. Confirma el nombre de la base con su responsable. El documento menciona `agenciaapp_contrato` y `agenciaapp_contratos`. La aplicación exige un `DB_NAME` explícito y no elige entre ellos.

```dotenv
CONTRACT_SOURCE=mysql
INOVA_SOURCE=mock
DB_HOST=
DB_PORT=3306
DB_CONNECT_TIMEOUT_MS=15000
DB_USER=
DB_PASSWORD=
DB_NAME=
DB_TLS=true
DB_TLS_MODE=VERIFY_IDENTITY
DB_TLS_SERVERNAME=
DB_SSL_CA_FILE=
```

| Variable | Valor o criterio |
| --- | --- |
| `DB_HOST` | Destino de la conexión TCP. Acepta un nombre DNS, una IPv4 o una IPv6 sin corchetes. |
| `DB_PORT` | Puerto MySQL, 3306 por defecto. |
| `DB_CONNECT_TIMEOUT_MS` | Plazo compartido desde la conexión TCP hasta la autenticación, en milisegundos. Por defecto vale `15000`. Se aplica al backend y a `db:check`. |
| `DB_USER`, `DB_PASSWORD` | Cuenta aprovisionada por el administrador con permisos de solo lectura sobre las columnas necesarias. Verificar los privilegios efectivos de la cuenta, incluidos sus roles. |
| `DB_NAME` | Nombre confirmado de la base que contiene `contratos`. |
| `DB_TLS` | Mantén `true` para la conexión institucional. Ambos modos usan TLS 1.2 o superior y exigen una cadena de confianza vigente antes del login. |
| `DB_TLS_MODE` | `VERIFY_IDENTITY` por defecto. Comprueba también el nombre DNS o la IP. `VERIFY_CA` requiere autorización institucional para esta cuenta y un PEM explícito. |
| `DB_TLS_SERVERNAME` | DNS opcional enviado como SNI. En `VERIFY_IDENTITY`, Node verifica este DNS o, si está vacío, el valor de `DB_HOST`. En `VERIFY_CA` se puede dejar vacío cuando se conecta por IP. |
| `DB_SSL_CA_FILE` | Ruta al archivo PEM de la CA institucional. Es obligatoria para `VERIFY_CA`. En `VERIFY_IDENTITY`, dejarla vacía utiliza las autoridades de confianza de Node. |

Tras guardar el archivo, ejecuta desde la raíz del proyecto con Node 24 o posterior.

```sh
npm ci
npm run db:check
npm run build
npm start
```

### Conectar por IP con VERIFY_IDENTITY

Conserva `CONTRACT_SOURCE=mysql`, `INOVA_SOURCE=mock`, `DB_TLS=true` y la IP institucional en `DB_HOST`. En el modo predeterminado, `VERIFY_IDENTITY`, elige el valor de `DB_TLS_SERVERNAME` según la identidad confirmada por el administrador.

| Identidad del certificado | Configuración |
| --- | --- |
| La IP institucional figura como entrada **IP Address** en el SAN (Subject Alternative Name) | Deja `DB_TLS_SERVERNAME=` vacío. Node comprueba esa IP y el cliente omite SNI para el literal IP. |
| El certificado identifica al servicio con un DNS | Escribe el nombre DNS completo y concreto del servidor en `DB_TLS_SERVERNAME`. El socket sigue conectando a la IP de `DB_HOST`. Ese DNS se usa para SNI y para comprobar el certificado, sin tener que resolverlo en el equipo cliente. |

Solicita al administrador el **DNS oficial del servicio y los SAN del certificado**, y confirma si la IP suministrada está incluida como IP. Si utilizan una autoridad privada, pide su CA en PEM por un canal institucional y configura `DB_SSL_CA_FILE`. El servidor debe presentar los certificados intermedios necesarios. Si ninguna identidad coincide, hace falta el endpoint correcto o un certificado emitido para la identidad prevista.

`Test-NetConnection` confirma que se puede abrir el puerto TCP desde el equipo que ejecuta la prueba. Ejecuta `npm run db:check` desde ese mismo equipo para comprobar TLS y el acceso de lectura. El diagnóstico distingue una identidad que no coincide de un fallo de red. Si falla la confianza, revisa la CA y la cadena que entrega el servidor.

### Usar VERIFY_CA bajo autorización institucional

Confirma con el administrador que la política `VERIFY_CA` está autorizada **para la cuenta de consulta de contratos de In-Ova**. La autorización concedida a otra aplicación en el mismo servidor es independiente. Este modo es menos estricto que `VERIFY_IDENTITY` porque acepta certificados de servidor vigentes firmados por la CA configurada aunque identifiquen a otro servidor. Un fallo de identidad en el modo predeterminado interrumpe la conexión y nunca activa `VERIFY_CA` automáticamente.

Tras la confirmación, ajusta estas líneas en el `.env` de este proyecto. Conserva los valores existentes de `DB_HOST`, `DB_USER`, `DB_PASSWORD` y `DB_NAME`.

```dotenv
CONTRACT_SOURCE=mysql
INOVA_SOURCE=mock
DB_TLS=true
DB_TLS_MODE=VERIFY_CA
DB_SSL_CA_FILE=C:/Users/USUARIO/Downloads/mysql-ca.pem
DB_TLS_SERVERNAME=
DB_CONNECT_TIMEOUT_MS=15000
```

Para volver al modo predeterminado, establece `DB_TLS_MODE=VERIFY_IDENTITY` y usa la IP o el DNS certificado según la tabla anterior. Cada ejecución de `db:check` carga la configuración al inicio. Reinicia el backend si ya estaba en ejecución.

### Funcionamiento del controlador y comprobación de lectura

`mysql2@3.24.6` negocia TLS en el socket MySQL después del saludo y del `SSLRequest`. En ambos modos Node verifica la cadena y su vigencia con `rejectUnauthorized: true`. La opción de conexión `ssl.verifyIdentity` controla el cotejo adicional del nombre. Solo se inicia la autenticación MySQL cuando TLS acepta el certificado según el modo elegido.

`npm ci` ejecuta `postinstall`, que aplica un ajuste local y versionado al controlador. El ajuste pasa la identidad esperada a la opción `host` de TLS cuando el controlador reutiliza el socket TCP e incluye la identidad en la clave de reanudación de sesiones. El backend coteja la huella del archivo del controlador antes de abrir un pool con TLS. Si se omitieron los scripts de instalación, ejecuta `npm run postinstall` y reinicia el proceso. Al actualizar `mysql2`, revisa el ajuste y ejecuta las pruebas de TLS.

`db:check` abre el pool, comprueba en `information_schema` las siete columnas del SELECT y la columna de ordenación `fechaActualizacion`, verifica el permiso de lectura con `LIMIT 0` y cierra el pool. El arranque en modo MySQL repite esta comprobación antes de escuchar en **http://127.0.0.1:3001**. Ambos procedimientos pueden ejecutarse sin introducir una cédula. Para probar la búsqueda de una persona utiliza únicamente una cédula autorizada.

Si `contratista` tiene una clave foránea declarada o su tipo no es textual, el arranque se detiene. Un campo de texto sin clave foránea también podría contener códigos. Su significado debe confirmarse con el responsable del esquema. Si resulta ser una referencia, se necesita la relación documentada antes de adaptar la consulta.

El pool `mysql2/promise` admite tres conexiones. Con el plazo predeterminado de 15 segundos, un saludo que llega a los 5 segundos deja aproximadamente 10 segundos para TLS y autenticación. Una vez aceptado el login, cada lectura de `db:check` tiene su propio plazo de 6 segundos, incluida la preparación de la sentencia. Si todas las conexiones están ocupadas, la petición falla sin formar una cola. La búsqueda utiliza `execute` con la cédula como parámetro de texto.

```sql
SELECT nitCc, contratista, numeroContrato, supervisor, apoyoSupervision, apoyoJuridico, apoyoLogistico
FROM contratos
WHERE nitCc = ?
ORDER BY fechaActualizacion DESC
LIMIT 1;
```

El modo mixto ejecuta únicamente lecturas. Un error de MySQL se comunica como error de consulta. La aplicación nunca sustituye silenciosamente una búsqueda fallida por un contrato ficticio.

### Diagnosticar la conexión

Desde PowerShell en la raíz del proyecto y con `DB_TLS=true`, ejecuta el diagnóstico con el mismo archivo `.env` de la aplicación.

```powershell
npm.cmd run db:check
```

Cada línea `[db:check +… ms]` identifica un hito observado en la **misma conexión**, con el tiempo transcurrido desde el inicio. Para diagnosticar un timeout comparte el bloque desde la primera línea `[db:check` hasta `[db:check FALLO]` o el resultado `OK`. Incluye el código y los tiempos. El bloque omite las direcciones, los paquetes, los nombres de cuenta y las credenciales.

| Última etapa en curso | Qué se sabe en ese punto |
| --- | --- |
| Conexión TCP | Todavía se espera la confirmación de apertura del socket. |
| Saludo MySQL completo | TCP abrió. «Primeros bytes recibidos» confirma que llegaron datos. El siguiente hito requiere que mysql2 interprete el saludo con soporte TLS y escriba la petición de cambio a TLS (`SSLRequest`). |
| Negociación TLS | El cliente escribió el `SSLRequest` y espera que avance el intercambio TLS. Un timeout aquí por sí solo no identifica qué equipo dejó de responder ni prueba una CA incorrecta. |
| Verificación del certificado | Node informa de cualquier rechazo de la cadena o de su vigencia. En `VERIFY_IDENTITY`, «Cadena aceptada por Node» marca el inicio de la comparación de identidad por IP o DNS. |
| Autenticación MySQL | «Cadena de CA y vigencia verificadas» (`VERIFY_CA`) o «TLS e identidad verificados» (`VERIFY_IDENTITY`) confirma que terminó TLS. El siguiente hito, «Autenticación aceptada», confirma que MySQL aceptó el login. |
| Estructura de contratos | MySQL aceptó el login. Se están comprobando los metadatos. |
| Permisos SELECT | Las columnas pasaron la validación. Está en curso la lectura de comprobación con `LIMIT 0`. |

La primera línea muestra el modo TLS y los dos plazos efectivos. Las marcas de tiempo al escribir el `SSLRequest`, al completar TLS y al aceptar el login permiten medir la duración de cada etapa. En `VERIFY_IDENTITY` el verificador de nombre llama a `tls.checkServerIdentity` de forma síncrona. Ante un error se cierran el socket y el pool.

Si falla la verificación TLS, la salida conserva el código de Node junto al de MySQL2, por ejemplo `[MySQL2 HANDSHAKE_SSL_ERROR] [Node CERT_HAS_EXPIRED]`. El comando devuelve un código de salida distinto de cero al fallar. El resultado `OK · Permisos de lectura verificados` indica que se completaron las etapas de autenticación, estructura y permiso de lectura.

| Código observado | Acción correspondiente |
| --- | --- |
| `ERR_TLS_CERT_ALTNAME_INVALID` | Con IP, confirma que figura como **IP Address** en el SAN. Con DNS, confirma el nombre oficial que debe verificar `DB_TLS_SERVERNAME`. |
| `UNABLE_TO_VERIFY_LEAF_SIGNATURE` | Confirma los certificados intermedios que entrega el servidor y la CA emisora de confianza. El código aislado no identifica cuál falta. |
| `SELF_SIGNED_CERT_IN_CHAIN` | Confirma con el administrador la CA de confianza institucional en PEM para `DB_SSL_CA_FILE`. |
| `CERT_SIGNATURE_FAILURE` | Falló la firma de un certificado. Confirma con el administrador la cadena que presenta el servidor y el PEM distribuido. |
| `CERT_HAS_EXPIRED` | Comprueba la hora del equipo. Si es correcta, el administrador debe revisar qué certificado de la cadena está vencido. |
| `EACCES`, `ECONNREFUSED` o `ETIMEDOUT` | Revisa el acceso de red, el servicio o el tiempo de espera según la descripción. |
| `ER_ACCESS_DENIED_ERROR` | Confirma la cuenta y el origen de conexión permitido para la autenticación MySQL. |

Los diagnósticos locales omiten las cédulas, filas, parámetros SQL, contraseñas y mensajes internos del controlador. Un resultado correcto de `db:check` confirma acceso de lectura y compatibilidad estructural, pero la semántica del nombre y el alcance de los privilegios requieren confirmación institucional.

### Regresar al modo de demostración

Configura `CONTRACT_SOURCE=mock` e `INOVA_SOURCE=mock` y reinicia el backend. Las opciones `DB_*` se ignoran y no se abre ningún pool. Las variables del proceso tienen prioridad sobre `.env`.

La configuración anterior `DATA_MODE=mock` sigue funcionando. Los selectores explícitos determinan los proveedores. `DATA_MODE=real` por sí solo se rechaza para evitar una activación accidental. `INOVA_SOURCE=real` requiere `CONTRACT_SOURCE=mysql`.

## Verificar el contrato y el estado en un entorno autorizado

La integración existente de gestión y supervisión utiliza el número de contrato de la entidad, verificado en el equipo autorizado. Para Cuenta de cobro queda pendiente la primera comprobación institucional. El adaptador comprueba el formulario y la entidad de cada registro, con igualdad textual exacta frente al contrato de MySQL. Si la estructura recibida impide comprobarlo, la tabla muestra el aviso en la fila de Cuenta de cobro.

La captura de Swagger en `Consultas_estados.docx` describe `date` como filtro por día de envío y muestra `results[].date` como un instante con zona horaria. El criterio de selección es el último **envío** del contrato. Conviene contrastar un caso con varios envíos con el responsable para verificar que ese es el informe cuyo estado debe mostrarse. El filtro `identification` del listado admite coincidencias parciales sin distinción de mayúsculas. [Swagger de In-Ova](https://databridge-api.in-ova-bi.co/api/docs#/)

1. Usa la configuración vigente de MySQL e In-Ova y su clave de lectura del backend. El diagnóstico utiliza únicamente GET sobre la API y puede ejecutarse con el proveedor web actual.
2. Usa una cédula de prueba autorizada cuyo contrato y formularios conozca la institución. Desde PowerShell en la raíz del proyecto, ejecuta el bloque siguiente. La entrada oculta evita guardar la cédula en el historial de comandos.

```powershell
$casoInova = Read-Host 'Cédula del caso de prueba autorizado' -AsSecureString
try {
  [System.Net.NetworkCredential]::new('', $casoInova).Password | npm.cmd run inova:check -- --cobro
} finally {
  $casoInova.Dispose()
  Remove-Variable casoInova
}
```

3. Revisa las líneas `[inova:check] cobro`. Al omitir `--cobro`, el diagnóstico comprueba los tres formularios por separado. Utiliza el contrato obtenido de MySQL, comprueba el `form_id` de cada fila y recorre las páginas hasta `next: null`. Lee `GET /api/entities/{id}` una vez por cada `entity_id` distinto dentro del formulario. Si la entidad devuelve un campo `id`, exige que concuerde con el solicitado. Compara `/identification` como texto conservando ceros iniciales, espacios y mayúsculas.
4. Busca **Recorrido completo**, el número de entidades con identificación exacta y los dos recuentos de `estado_id`. Cada uno distingue ID reconocido, texto sin equivalencia oficial, valor ausente o nulo, texto vacío y tipo inválido. Un grupo corresponde a las filas del contrato exacto y el otro a entidades con otra identificación. La antigua etiqueta «sin equivalencia verificable» agrupaba esas anomalías. En la muestra comunicada había una sola entidad coincidente por formulario, por lo que esa etiqueta por sí sola no demuestra una coincidencia parcial.
5. Comprueba la selección. Para una sola fila exacta basta el vínculo con el contrato. Si hay varias, todos los instantes deben ser válidos y el máximo de `results[].date` debe ser único. El diagnóstico informa la categoría del estado de ese envío y omite su valor. Un estado desconocido de un envío anterior aparece en los recuentos, independientemente del estado del envío elegido.

El diagnóstico y el adaptador web comparten la verificación de entidad, la paginación y la selección. Cada formulario dispone de 10 segundos en total, hasta 20 GET de páginas y hasta 10 GET de entidades distintas (30 solicitudes como máximo). Un ciclo, un límite alcanzado con datos pendientes o una identidad sin verificar impiden seleccionar un resultado parcial. El código de salida 2 indica que al menos un formulario carece de una selección exacta con estado reconocido, o que difiere del estado esperado indicado por el operador. Los mensajes solo contienen categorías, contadores y códigos de diagnóstico.

Para contrastar también la descripción seleccionada, puedes establecer `$env:INOVA_CHECK_ESTADO_COBRO` con la etiqueta oficial esperada para ese caso. Gestión y supervisión admiten sus respectivas variables `INOVA_CHECK_ESTADO_GESTION` e `INOVA_CHECK_ESTADO_SUPERVISION`. El comando compara el texto y solo imprime «coincide» o «difiere». La exploración original de rutas sigue disponible con `--estructura`.

Si hay identificadores sin equivalencia oficial en registros exactos de cobro, el diagnóstico muestra una huella SHA-256 por cada identificador distinto. El responsable de In-Ova puede cotejarla calculando SHA-256 sobre los bytes UTF-8 del ID de su catálogo, sin espacios añadidos ni salto de línea. Las huellas quedan pendientes de correspondencia hasta recibir la descripción oficial. La interfaz muestra «Estado no identificado» cuando ese es el caso del último envío. Un último envío sin estado válido conserva su aviso aunque haya un envío anterior aprobado.

En la instalación que lee estados reales se utilizan estas opciones de backend.

```dotenv
INOVA_SOURCE=real
INOVA_RUTA_CONTRATO_GESTION=
INOVA_RUTA_CONTRATO_SUPERVISION=
INOVA_RUTA_CONTRATO_ENTIDAD=/identification
```

### Configurar y probar los estados reales

| Variable del backend | Uso |
| --- | --- |
| `INOVA_FORM_GESTION`, `INOVA_FORM_SUPERVISION` | IDs oficiales indicados en `.env.example`, también predeterminados en el backend. |
| `INOVA_FORM_COBRO` | Cuenta de cobro y Pago de Seguridad Social - APP Medellín Contratistas. ID oficial predeterminado `lmW2bbWMwGFOru75HQCIwvIaT6txPRPsCA==`. |
| `INOVA_RUTA_CONTRATO_GESTION`, `INOVA_RUTA_CONTRATO_SUPERVISION` | Puntero JSON relativo a un elemento de `results`. Introduce la ruta confirmada para ese formulario. El adaptador admite objetos, índices de array y objetos o arrays JSON serializados en `answers`. |
| `INOVA_RUTA_CONTRATO_ENTIDAD` | Alternativa compartida para un formulario sin ruta directa, únicamente si se ha confirmado dónde está el contrato en la respuesta de `GET /api/entities/{id}`. La ruta directa configurada tiene prioridad. |

El proveedor envía un GET a `/api/forms/{form_id}/records/?identification={contrato}` por formulario. Compara el `form_id` recibido y el texto completo del contrato, incluidos ceros iniciales y mayúsculas. Una fila sin identidad verificable impide presentar un estado de ese formulario. Una búsqueda completa cuyas filas verificables pertenecen a otros contratos produce «sin registros».

En caso de varios registros exactos se elige el **envío** más reciente por `date`. Los instantes deben tener zona horaria explícita. Si falta una fecha, es inválida o empatan los envíos más recientes, la tabla muestra un aviso. Una coincidencia única no necesita fecha para desambiguar. Se aplica el catálogo oficial de nueve equivalencias exclusivamente al `estado_id` devuelto por el formulario seleccionado. La institución debe confirmar qué subconjunto utiliza cada formulario durante la prueba autorizada.

El límite por formulario es de 10 segundos en total, 20 páginas y hasta 10 lecturas de entidades distintas cuando procede. El cliente reconstruye la siguiente petición con el contrato original y el cursor. Rechaza enlaces ajenos al endpoint, redirecciones y ciclos. Un fallo HTTP, de red, de estructura o de paginación produce un aviso para ese informe. El diagnóstico del backend contiene el tipo de informe y un código técnico.

El adaptador admite un enlace del mismo endpoint con `cursor` o un token simple, y requiere `next: null` al terminar. La prueba autorizada comunicada verificó la lectura de entidad para su caso. Si un caso futuro devuelve otro formato de paginación o carece de acceso a una entidad, la comprobación lo informa como inconcluso.

Tras validar las rutas, configura `INOVA_SOURCE=real` en el `.env`. Ejecuta desde la raíz:

```powershell
npm.cmd run build
npm.cmd start
```

Abre **http://127.0.0.1:3001**, verifica que se muestre **Estados de In-Ova** e introduce la cédula del caso autorizado. Pulsa **Consultar estados** y contrasta los tres documentos en la misma tabla con el responsable institucional. Para volver a los estados simulados, establece `INOVA_SOURCE=mock` y reinicia el proceso. La selección de In-Ova es independiente de la configuración de conexión MySQL.

## Panel de supervisores

El panel requiere **Node 24.7 o posterior** con Argon2id y las dependencias del proyecto. La aplicación está diseñada para un proceso Express local. La cuenta se configura en el servidor. El identificador inicial es `supervisor_agencia_app`. El archivo privado `.supervisor.hash` se guarda en la raíz, fuera de la carpeta web y excluido de Git. La consulta individual está disponible incluso antes de crear este archivo.

### Preparar la cuenta de pruebas

En el equipo autorizado, desde la carpeta del proyecto, introduce una contraseña única generada por un gestor, de al menos 16 caracteres. PowerShell oculta la entrada y el comando escribe únicamente el hash Argon2id con una sal aleatoria de 16 bytes. El coste es de 64 MiB, tres pasadas y un hilo por comprobación. La cuenta del servicio debe poder leer el archivo. En Windows restringe su acceso mediante los permisos de la carpeta al administrador y a la cuenta del servicio.

```powershell
$codificacionAnterior = $OutputEncoding
$clavePanel = Read-Host 'Contraseña nueva del supervisor' -AsSecureString
try {
  $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
  [System.Net.NetworkCredential]::new('', $clavePanel).Password | npm.cmd run supervisor:clave
} finally {
  $clavePanel.Dispose()
  Remove-Variable clavePanel
  $OutputEncoding = $codificacionAnterior
}
```

El comando rechaza sobrescribir un hash existente. Para rotar la credencial, detén Express, retira el archivo anterior de la carpeta del proyecto, repite el procedimiento y reinicia Express. El reinicio revoca todas las sesiones. Si necesitas otro identificador, define `SUPERVISOR_USER` en el entorno privado del backend.

### Primera prueba con datos ficticios

En una **nueva ventana** de PowerShell, las siguientes variables afectan solo al proceso de demostración. Detén primero cualquier instancia que use el mismo puerto.

```powershell
$env:CONTRACT_SOURCE = 'mock'
$env:INOVA_SOURCE = 'mock'
npm.cmd run build
npm.cmd start
```

Abre **http://127.0.0.1:3001**, elige **Soy supervisor** e inicia sesión y pulsa **Consultar hasta el día de hoy**. La demostración encuentra y procesa cuatro contratos de cuatro cédulas, excluye uno y muestra tres. De los tres PS activos de Alfa, el panel elige `PS001` por su fecha. Para la cédula ficticia `00000006`, elige `PS005`. Sus tres documentos carecen de registros y el caso queda excluido aunque el contrato anterior `PS006` tenga gestión aprobada. Puedes comprobar `PS005` en la consulta individual. Beta tiene apoyos vacíos e informes sin registros. Épsilon simula un fallo en gestión y conserva los otros dos estados. **Actualizar consulta** inicia una nueva lectura. Pulsa **Cerrar sesión** al terminar.

### Piloto en el equipo institucional

1. Solicita al responsable de los datos los números completos de entre uno y diez contratos autorizados y los estados esperados. Trabaja en el entorno privado de pruebas. Conserva el usuario MySQL de solo lectura, TLS, el puerto y las credenciales actuales.
2. Cierra la ventana de demostración. En el `.env` privado del proyecto conserva `CONTRACT_SOURCE=mysql` e `INOVA_SOURCE=real`. Agrega las opciones siguientes, sustituyendo los dos valores de ejemplo por números autorizados exactos, incluidos sus ceros iniciales.

```dotenv
SUPERVISOR_SCOPE=pilot
SUPERVISOR_PILOT_CONTRACTS='["PS-FICTICIO-01","PS-FICTICIO-02"]'
SUPERVISOR_CONCURRENCY=2
```

3. Ejecuta `npm.cmd start` después de compilar. Inicia sesión y comprueba que se muestre **Lote autorizado**. Al pulsar el botón, la primera lectura del panel valida las seis columnas, `estado` y `fechaActualizacion` en la base configurada, con un SELECT que devuelve cero filas. Cada actualización ejecuta una sola consulta del listado. Un problema de esquema o permisos se comunica dentro del panel.
4. Si una cédula tiene dos contratos autorizados y elegibles, contrasta el de fecha más reciente, sus responsables y los tres estados con los datos esperados. Si autorizas solo el anterior, ese será el candidato de la cédula en el piloto. La fecha y hora del panel corresponden al inicio de la consulta y se presentan en `America/Bogota`. La lista vacía de autorizaciones bloquea el piloto.
5. Solo con autorización para **todo** el listado, establece `SUPERVISOR_SCOPE=all` y reinicia el backend. El modo predeterminado con MySQL es `pilot`. El navegador carece de opciones para cambiar ese alcance o la lista autorizada.

### Selección y procesamiento

En ambos alcances, MySQL 8 filtra por `EN EJECUCIÓN` y por el prefijo exacto `PS%` en mayúsculas. En el piloto, también filtra por los números autorizados antes de numerar las filas. La siguiente consulta general devuelve un contrato por `nitCc`. La cédula y el número de contrato llegan al navegador como texto.

```sql
WITH contratos_ordenados AS (
  SELECT nitCc, contratista, numeroContrato, supervisor, apoyoSupervision, apoyoLogistico,
         ROW_NUMBER() OVER (
           PARTITION BY nitCc
           ORDER BY (fechaActualizacion IS NULL) ASC, fechaActualizacion DESC,
                    CAST(numeroContrato AS BINARY) ASC, CAST(contratista AS BINARY) ASC,
                    CAST(supervisor AS BINARY) ASC, CAST(apoyoSupervision AS BINARY) ASC,
                    CAST(apoyoLogistico AS BINARY) ASC
         ) AS fila
  FROM contratos
  WHERE estado = ? AND numeroContrato LIKE CAST(? AS BINARY)
)
SELECT nitCc, contratista, numeroContrato, supervisor, apoyoSupervision, apoyoLogistico
FROM contratos_ordenados
WHERE fila = 1
ORDER BY contratista, numeroContrato, nitCc;
```

El piloto añade `AND CAST(numeroContrato AS BINARY) IN (?, …)` dentro del `WHERE` de la consulta interna, con un parámetro por número autorizado. Así se comprueba la coincidencia exacta antes de decidir qué contrato ocupa el primer lugar.

Cualquier fecha informada tiene prioridad sobre `NULL`. Si empatan las fechas más recientes o todas son nulas, se elige el primer número de contrato en orden binario ascendente. Si también coincide ese número, se comparan de la misma forma el nombre y los tres responsables. Las filas idénticas en esos datos producen la misma salida. La cronología se establece únicamente mediante `fechaActualizacion`. La documentación disponible no identifica una clave única de la tabla.

El backend procesa dos contratos en paralelo por defecto. `SUPERVISOR_CONCURRENCY` admite de 1 a 8 contratos. Cada contrato usa las tres consultas de formularios existentes, así que el máximo predeterminado del lote son seis lecturas In-Ova en vuelo. El adaptador comprueba el formulario y coteja exactamente la identificación de la entidad con el número de contrato. Conserva el plazo de 10 segundos por formulario, sus límites de paginación y de entidades, la selección por fecha y el catálogo oficial. Un aviso ocupa solo la celda del documento afectado.

Después de revisar los tres formularios, el backend excluye el contrato si en cada uno se confirmó una búsqueda sin registros o un último envío con `estado_id` explícitamente nulo, vacío o compuesto solo por espacios. Un ID desconocido, un campo omitido o de tipo inválido, una identidad o fecha incierta y los fallos de comunicación conservan la fila con su estado o aviso. La consulta individual sigue mostrando el contrato y el resultado de cada documento.

La respuesta inicial al botón es HTTP 202. **Encontrados** cuenta los contratos elegidos después de seleccionar una fila por cédula. Solo esos contratos pasan a In-Ova. Cada contrato procesado cuenta una vez como incluido o excluido. La ausencia confirmada en los tres formularios excluye a la persona de ese listado y termina su consulta. El total visible es provisional durante el procesamiento y definitivo al finalizar. Cada página contiene hasta 25 filas incluidas en el orden de MySQL. El servidor mantiene una sola consulta masiva en curso y un solo resultado temporal por cuenta, en memoria. Navegar entre páginas, volver al panel o recuperar una lectura interrumpida reutiliza ese resultado. Una actualización explícita lo reemplaza. Cerrar sesión, expirar o iniciar otra sesión elimina el resultado e impide iniciar más contratos del lote anterior. Las lecturas ya en curso terminan bajo sus plazos. Un reinicio descarta el trabajo.

Al terminar la consulta, selecciona una de las nueve columnas en **Filtrar por** y escribe en **Buscar**. La búsqueda parcial ignora mayúsculas, tildes y espacios en los extremos. Puedes buscar el texto visible de un estado o aviso, como «Aprobado» o «Sin registros». El indicador **Mostrando X de Y contratos** compara las coincidencias con el total incluido en el lote. Cambiar la columna, editar el término o pulsar **Limpiar filtro** vuelve a la primera página. Cada página muestra hasta 25 coincidencias en el orden original.

### Acceso al panel

**Descargar Excel** exporta todas las coincidencias de la consulta finalizada, en el orden de la tabla y con sus nueve columnas. El nombre del archivo incluye la fecha y hora de Bogotá. En la hoja **Contratos activos** puedes usar los autofiltros de Excel y desplazarte con el encabezado inmovilizado. Si la búsqueda queda vacía de resultados, el botón se deshabilita.

La ruta `POST /api/supervisor/exportar-excel` exige la sesión, el origen autorizado y el token CSRF. Recibe únicamente la referencia de la consulta visible, la columna y el término. Utiliza la misma selección en memoria que el paginador. Una sesión vencida requiere iniciar sesión y realizar nuevamente la consulta. El servidor genera el libro con ExcelJS por filas y lo entrega en la respuesta HTTP, sin guardarlo en disco. Las celdas son texto literal, incluidos los identificadores y los valores que comienzan con signos de fórmula.

Para limitar memoria se admite una exportación simultánea, hasta 50 000 filas y hasta 16 MiB tanto de texto de origen como de archivo comprimido. Si se supera un límite, el panel informa el motivo y permite acotar el filtro. Cada celda admite hasta 32 767 caracteres.

- `POST /api/supervisor/login` verifica la credencial en el backend y genera una sesión aleatoria. Solo se permite una verificación costosa en curso y cinco intentos fallidos por diez minutos para la cuenta, incluso desde direcciones diferentes. Un inicio correcto sustituye la sesión anterior.
- `GET /api/supervisor/sesion` devuelve `null` a un visitante. Solo una sesión válida recibe su token CSRF. Los endpoints GET y POST de `/api/supervisor/consulta` requieren el permiso de supervisor. Únicamente POST inicia el trabajo.
- `POST /api/supervisor/consulta/filtrar` busca en las filas incluidas en la memoria de la sesión y devuelve solo la página solicitada. El texto viaja en el cuerpo de la solicitud y se descarta después de la lectura. Buscar y paginar utilizan exclusivamente el resultado existente.
- Las operaciones POST requieren el origen permitido y JSON. Iniciar el lote, filtrar, exportar o cerrar sesión requiere además el token CSRF de la sesión. La cookie de sesión es HttpOnly y SameSite=Strict, restringida al panel. React conserva el token en memoria. Las respuestas llevan `Cache-Control: no-store`.
- La sesión expira tras 30 minutos sin actividad autenticada. La consulta de progreso renueva la sesión mientras el usuario sigue el lote. Usa `POST /api/supervisor/logout` mediante **Cerrar sesión** para revocarla antes.
- El origen predeterminado permite el acceso local en loopback. Para un proxy HTTPS institucional autorizado, configura `SUPERVISOR_ORIGIN` con el origen público HTTPS exacto, sin ruta ni barra final. Así se exige dicho origen y la cookie lleva Secure. Mantén Express en loopback y restringe los registros del proxy. Este prototipo de una cuenta y un proceso requiere revisar la identidad individual de los supervisores, sus permisos y los límites operativos antes de ampliar su uso.

Los archivos del panel se encuentran en `backend/supervisor/`, `shared/supervisor.ts`, `frontend/src/components/Portal.tsx`, `frontend/src/components/Supervisor.tsx` y `frontend/src/services/supervisor.ts`. Las pruebas de sesión, consulta y concurrencia están en `tests/supervisor.test.ts`.

## Acceso público

El conocimiento de una cédula permite consultar la información individual de ese contratista. La sesión del panel protege únicamente la consulta general. Antes de publicar se requiere autorización institucional, verificación de la identidad y del derecho a consultar cada contrato, límites de uso y una política de auditoría que excluya cuerpos, cookies, identificadores y URL con datos personales.

El servidor escucha exclusivamente en loopback. Cualquier acceso institucional remoto requiere transporte HTTPS y controles de acceso también en el proxy.

## Verificación local

```sh
npm run typecheck
npm test
npm run build
```

Las pruebas usan el ejecutor incluido con Node. Cubren los escenarios de demostración, parámetros con ceros iniciales, los resultados nulos, la verificación del esquema, etiquetas de origen, estados ficticios estables para contratos nuevos y fallos de conexión. El flujo HTTP mixto utiliza filas sintéticas inyectadas en el adaptador. La prueba de interrupción utiliza el controlador MySQL y un socket local. La verificación de la base institucional se realiza por separado con `npm run db:check` en un entorno autorizado.

Las pruebas de Cuenta de cobro cubren la misma petición por cédula con tres documentos, el cotejo de entidad, varias páginas, la ausencia de filas, los empates de fecha y un último envío sin estado. Un HTTP 503 simulado en cobro conserva los resultados de gestión y supervisión. Para probar las nueve filas en demostración, usa `00000001` para ver los tres estados con el prefijo **Estado actual:** y `00000002` para ver los apoyos a la supervisión y logístico como «No registrado».

En la verificación local con `mysql2@3.24.6`, el CLI identificó un saludo parcial, un servidor que dejó de responder tras el `SSLRequest` y una autenticación sin respuesta. Los tres casos terminaron con `ETIMEDOUT` y su etapa correspondiente. Una preparación SQL sin respuesta terminó con `PROTOCOL_SEQUENCE_TIMEOUT` dentro del plazo de lectura. Un certificado vencido y una identidad incorrecta detuvieron el flujo antes del login.

Las pruebas TLS utilizan certificados de prueba y un servidor MySQL simulado en loopback. Con el mismo certificado vigente y una IP ausente de su SAN, `VERIFY_CA` aceptó la cadena firmada por la CA configurada y `VERIFY_IDENTITY` rechazó la identidad. En `VERIFY_CA`, una CA desconocida, una firma inválida y un certificado vencido detuvieron el flujo antes de transmitir el login de prueba.
