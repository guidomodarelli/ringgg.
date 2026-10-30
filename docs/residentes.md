# Casas, residentes y nombres

## Quién puede entrar

Una persona entra al panel de una casa si su correo está verificado en Neon Auth y autorizado para esa casa:

- **Correos de arranque**: `RESIDENT_ADMIN_EMAILS` y `RESIDENT_EMAILS`, configurados en el entorno. Dan acceso a la casa original (la que existía antes de que hubiera varias). Los dos dan el mismo acceso; la diferencia de nombres es histórica.
- **Correos autorizados desde el panel**: se guardan por casa en la tabla `home_members` y funcionan sin reiniciar la app.

Registrarse no da acceso, y conocer un correo autorizado tampoco: hay que verificarlo con el código que envía Neon.

## Varias casas

Una persona puede ser residente de varias casas, por ejemplo la suya y la de sus padres:

- **Elegir la casa**: el selector de la barra superior lista tus casas. La casa elegida queda en la dirección (`/?home=<id>`), así que recargar o abrir otra pestaña muestra la misma. Si entrás a `/`, se abre la última que usaste (cookie `ringgg-home`) o la primera.
- **Agregar casa**: desde el mismo selector. Solo puede crear casas quien ya es residente de alguna (la app sigue cerrada a cuentas que nadie invitó), hasta 10 por persona. Entrás a la casa nueva con el nombre que usás en las otras.
- **Eliminar casa**: en Configuración, solo si sos su único residente y tenés otra casa. Se borran su historial, su QR y los registros de sus celulares. Si otras personas la siguen usando, quitate desde Residentes.
- **Aislamiento**: cada casa tiene su QR, su historial, sus celulares, su pausa, su horario de descanso y sus límites de timbrazos. Una respuesta, una nota o un aviso nunca cruzan de una casa a otra, y las notificaciones dicen de qué casa son.
- **Un celular en varias casas**: activar las notificaciones en otra casa reutiliza la misma suscripción del navegador. El celular suena para cada casa en la que lo conectaste, con un nombre propio en cada una. Desconectarlo de una casa no lo desconecta de las demás.

## Nombres

- **¿Quién sos?**: la primera vez que entrás a una casa, el panel te pide el nombre con el que te van a ver los demás residentes. Viene precargado con el nombre que usaste en otra casa o el de tu cuenta. Es obligatorio: no se cierra con Escape, no acepta un nombre vacío y la única otra salida es Cerrar sesión. Al elegirlo, tus celulares de esa casa con nombre genérico («Mi celular», «Celular») pasan a llamarse «Celular de <nombre>».
- **Editar nombres**: en Residentes, cualquier residente puede cambiar el nombre de cualquier otro de la misma casa.
- **Sin repetidos**: dos residentes de una casa no pueden llamarse igual, y dos celulares de una casa tampoco. La comparación ignora mayúsculas, tildes y espacios repetidos, así que «Guido», «guido» y «Guídó» cuentan como el mismo nombre. Al registrar un celular con un nombre que ya existe en la casa, se le agrega un número («iPhone de Guido 2»). Las casas de una misma persona tampoco repiten nombre al crearlas o renombrarlas.
- **Límites**: el nombre de un residente tiene hasta 40 caracteres, para que entre en «iPhone de <nombre>».

Si te invitan a una casa que se llama igual que otra tuya, el selector muestra las dos con el mismo nombre: renombrá una desde Configuración.

## Gestión compartida

Todos los residentes de una casa tienen los mismos permisos en ella. En **Residentes**, cualquiera puede:

- **Autorizar un correo**: no crea la cuenta ni envía un email. Después de autorizar, **Compartir invitación** abre el menú de compartir del celular (por ejemplo WhatsApp) o copia el texto: «Te sumé al timbre de … Creá tu cuenta con … en …/sign-in y verificá tu correo para entrar».
- **Editar el nombre** de cualquier residente.
- **Quitar acceso**, con confirmación: revoca el acceso a esa casa y desconecta de ella los celulares que esa persona registró. Sus otras casas no cambian. También se puede quitar un correo de arranque; queda revocado hasta que alguien lo vuelva a autorizar.

Una casa nunca se queda sin residentes: el último no se puede quitar. Si alguien se quita a sí mismo, vuelve al inicio.

## Decisiones

- La autorización se resuelve en el servidor a partir de la sesión verificada y de la casa pedida; nunca se confía en identificadores enviados por el navegador. Una respuesta desde una notificación usa la casa de la visita, no la que mande el cliente.
- La UI no adelanta éxitos de permisos ni de nombres: conserva lo anterior hasta que el servidor confirma, y los errores de nombre repetido aparecen junto al campo.
- Agregar, quitar y renombrar son idempotentes; un reintento tras una respuesta perdida no duplica ni concede permisos.
- Registrar dispositivos, renombrar y revocar residentes usan el bloqueo de la casa, para no conservar una suscripción ni repetir un nombre por una carrera. Los índices únicos por casa son la última barrera si dos personas guardan el mismo nombre a la vez.
- Una solicitud iniciada antes de una revocación no puede restaurar el acceso ni revocar a otros.
- La migración a varias casas es aditiva: copia residentes y revocaciones a las tablas por casa y deja las anteriores, para que un rollback de la app siga funcionando con la casa original.

## Validación

- Integración con PostgreSQL embebido real:
  - `tests/residents.test.ts`: arranque, verificación, idempotencia, gestión compartida, último residente, revocación con sus dispositivos, solicitudes viejas y nombres (obligatorios, únicos sin importar mayúsculas ni tildes, editables por cualquier residente, renombrado de celulares genéricos).
  - `tests/homes.test.ts`: crear casas (solo residentes, sin nombres repetidos, límite de 10), aislamiento de visitas, respuestas y QR, límites de timbrazos por casa, eliminar casas y elección de la casa del panel.
  - `tests/devices.test.ts`: un celular en dos casas con nombres propios, nombres repetidos con número, límites por casa, cambio de dueño del navegador, renovación de la suscripción y avisos solo a los celulares de la casa.
  - `tests/doorbell.test.ts`: la migración a varias casas conserva residentes, revocaciones y celulares, y numera los nombres repetidos.
- Componentes reales en el navegador:
  - `tests/e2e/residents.spec.ts`: autorizar con doble click, compartir la invitación, renombrar con un nombre repetido y recuperarse, cancelar y confirmar la revocación y recuperar un error sin perder el correo escrito.
  - `tests/e2e/homes.spec.ts`: «¿Quién sos?» obligatorio y precargado, nombre repetido junto al campo, doble click sin doble envío, y «Agregar casa» con un nombre repetido y uno válido.
- Login real con una cuenta sintética de la rama Neon `ci` (`tests/e2e/doorbell.spec.ts`), también en la CI.
