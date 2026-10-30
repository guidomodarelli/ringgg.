# Decisiones de implementación

| Módulo | Responsabilidad |
| --- | --- |
| `src/server/database.ts` | PostgreSQL externo (`poolDatabase`) y embebido, migraciones versionadas y transacciones |
| `src/server/doorbell.ts` | Registro, idempotencia, respuestas, mensajes, pausa, horario de descanso y purga |
| `src/server/rate-limit.ts` | Identificación anónima del visitante y límites por cliente y por casa |
| `src/server/push.ts` | Dispositivos (alta, renovación, nombre), envío por política, salud y recibos |
| `src/server/environment.ts` | Variables que necesita un build de producción |
| `src/server/config.ts` | Origen público, orígenes permitidos y credenciales de push por entorno |
| `src/server/errors.ts` | Errores seguros para el navegador y logs con la causa |
| `src/server/cron.ts` | Autorización de Vercel Cron |
| `src/server/http.ts` | Envoltorio de las rutas: Origin en mutaciones, `no-store`, validación y errores |
| `src/server/auth.ts`, `residents.ts` | Identidad de Neon, acceso por casa (`requireHome`), residentes y sus nombres |
| `src/server/homes.ts`, `panel-home.ts` | Crear y eliminar casas; elegir la casa del panel (`?home=`, cookie o la primera) |
| `src/server/device-names.ts`, `src/lib/names.ts` | Nombres únicos por casa: comparación sin mayúsculas ni tildes y sufijo numérico |
| `src/proxy.ts` | Renovación de sesiones antes del panel y del cartel (Neon Auth y Better Auth propio) |
| `src/instrumentation.ts` | Log de errores de render y de rutas que nadie atrapó |
| `src/app/api/<recurso>/route.ts` | Un route handler por operación; `api/[...path]` solo responde 404 en JSON |
| `src/app/cartel/page.tsx` | Cartel imprimible con el QR en SVG, renderizado en servidor |
| `src/components/dashboard.tsx` y `dashboard/*` | Panel: estado y polling (`use-dashboard-state`), notificaciones de este navegador (`use-push-device`) y secciones |
| `src/components/home-switcher.tsx`, `resident-name-dialog.tsx` | Selector de casas con «Agregar casa» y el «¿Quién sos?» obligatorio |
| `src/components/visitor.tsx` | Tocar timbre, esperar una respuesta explícita y dejar un mensaje |
| `src/service-worker/` | Service worker en TypeScript; `npm run build:sw` lo compila a `public/sw.js` |
| `src/lib/push-notification.ts` | Lectura del payload, acciones y URLs del service worker, compartido con sus tests |

El shell y los datos iniciales se renderizan en servidor; las hojas interactivas manejan formularios, notificaciones, QR y polling. Las rutas `/`, `/t/[token]` y `/cartel` tienen skeleton y los errores de datos se contienen en `error.tsx`. El layout raíz no espera datos.

## Varias casas

Una cuenta puede ser residente de varias casas. La casa es parte de cada operación: las rutas reciben `home` (en el body o en `?home=`) y el servidor verifica la membresía con `requireHome`; la respuesta a un timbrazo, que puede venir de una notificación, usa la casa de la visita. Las tablas por casa son `home_members` (con el nombre que esa casa usa para cada residente), `home_revocations` y `device_homes` (un dispositivo por endpoint, con un nombre por casa). Cada casa tiene su QR, su historial, sus límites de timbrazos y hasta diez celulares.

- **Crear**: solo quien ya es residente de alguna casa, hasta diez; la app sigue cerrada a cuentas que nadie invitó. Un advisory lock por persona evita pasar el límite con dos pedidos a la vez.
- **Eliminar**: solo el único residente y si tiene otra casa, para no borrar una casa que otros usan ni dejar a nadie sin casa. El borrado arrastra visitas, residentes y registros de celulares; un celular sin casas se olvida.
- **Elegir**: `?home=` manda; si falta, la cookie `ringgg-home` (la escribe el proxy) o la primera casa. Una casa ajena nunca se elige. La dirección conserva la casa en cada sección, así que recargar o compartir el enlace abre la misma.
- **Nombres**: «¿Quién sos?» es obligatorio la primera vez en cada casa y viene precargado con el último nombre elegido o el de la cuenta. Los nombres de residentes y de celulares son únicos por casa sin importar mayúsculas, tildes ni espacios (`nameKey`); el servidor lo verifica bajo el bloqueo de la casa y un índice único es la última barrera. Al registrar un celular con un nombre ocupado se agrega un número. Las casas de una persona no repiten nombre al crearlas o renombrarlas; una invitación puede juntar dos casas con el mismo nombre, y se resuelve renombrando una.
- **Migración**: la versión 4 es aditiva. Crea la secuencia de `homes`, copia `residents` y `resident_revocations` a la casa original, agrega `visits.home_id` con valor por defecto 1 y asigna los celulares existentes a la casa original numerando los nombres repetidos. Un rollback de la app sigue funcionando con la casa original.

## Gestión compartida

Todos los residentes verificados de una casa tienen los mismos permisos en ella: cualquiera puede autorizar o quitar residentes, rotar el QR, pausar el timbre o desconectar un celular, por ejemplo uno perdido. Se eliminaron los restos del modelo de administrador (`isAdmin`, `requireResidentAdmin`, la fuente «administrador»). `RESIDENT_ADMIN_EMAILS` y `RESIDENT_EMAILS` quedan como correos de arranque equivalentes para no romper deployments existentes. Solo se impide quitar al último residente.

## Ciclo de vida de las acciones

Ninguna operación es optimista: todas tienen un efecto visible para el visitante, para otros residentes o para el proveedor de notificaciones.

- **Confirmadas por el servidor**: tocar timbre, dejar mensaje, responder, regenerar el QR, desconectar o renombrar un celular, probar avisos, activar notificaciones, residentes, ingreso y salida.
- **Pendiente primero**: nombre de la casa, pausa y horario de descanso. Cambian lo que ve el visitante, así que el panel muestra «Guardando…» o «Pausando…» y confirma con la respuesta.
- **Solo locales**: «Seguir sin avisos en este dispositivo» (se recuerda en `localStorage`, con alternativa si no está disponible) y «Compartir invitación» (Web Share o portapapeles).

Cada acción declara cómo reconcilia (`Reconcile` en `src/components/dashboard/types.ts`). Las rutas que devuelven el snapshot (`settings`, `pause`, `quiet-hours`, `rotate`, `rename-device`) o la visita (`answer`) se aplican sin otro `GET`. Guardar el nombre ya no envía el estado de la pausa: antes un formulario viejo podía reactivar un timbre que otro residente acababa de pausar.

## Polling adaptativo

El panel consultaba cada 5 segundos aunque no pasara nada: 720 pedidos por hora por pestaña visible, y el cómputo de Neon no llegaba a apagarse (la rama `production` estuvo activa unas 15 de sus primeras 19,5 horas). Ahora consulta cada 5 s solo mientras una visita se puede responder, porque otro residente puede contestarla. Si no, consulta cada 30 s, o cada 60 s si este navegador recibe notificaciones: el push del service worker actualiza el panel al instante y la consulta queda de respaldo por si el push falla en silencio, siempre dentro de la espera de dos minutos del visitante. Se descartó una cadencia de minutos por ese riesgo. Una consulta fallida muestra un aviso discreto que se borra solo con la siguiente exitosa, separado de los errores de las acciones.

Se evaluaron SSE y `LISTEN/NOTIFY`, y se descartaron: el pooler de Neon (PgBouncer en modo transacción) no mantiene `LISTEN`, y una conexión SSE abierta en Vercel consume tiempo de función.

## Avisos, recibos y salud de los dispositivos

- Cada tipo de aviso tiene su política (`PUSH_POLICIES`): el timbrazo vence a los 90 s con urgencia alta; la nota, a las 12 horas con urgencia normal; la prueba, como el timbrazo.
- Las notificaciones de una visita comparten `tag` y usan `renotify`: la nota reemplaza al timbrazo sin respuesta y vuelve a sonar. Antes el reemplazo era silencioso justo en el caso en que hay nota.
- El service worker confirma cada push recibido (`/api/push-receipt`, con la cookie del residente). Se guarda `last_received_at` por dispositivo y un recibo por visita y dispositivo (`visit_receipts`, borrado en cascada con la visita). Si la sesión del celular venció, falta el recibo pero la notificación igual se muestra.
- Cada envío guarda la respuesta del proveedor por dispositivo (`last_success_at`, `last_failure_at`, `last_failure_status`) en un solo `UPDATE ... FROM unnest(...)`. Las suscripciones 404/410 se borran. Si falla guardar la salud, no falla el timbrazo.
- Ante `pushsubscriptionchange`, el service worker vuelve a suscribirse y llama a `/api/renew-subscription` con `previousEndpoint`: el mismo dispositivo conserva sus casas, sus nombres y su lugar en cada límite de diez. Si la suscripción nueva ya estaba registrada, hereda las casas que le faltaban moviendo esas filas (copiarlas chocaría con el índice único de nombres del dispositivo viejo). El último endpoint se recuerda en Cache Storage, porque Chrome no informa la suscripción vieja.
- Los dispositivos se registran con un nombre sugerido (plataforma y nombre del residente) que cualquiera puede cambiar. Volver a activar las notificaciones no pisa el nombre elegido. Si el navegador pasa a otra persona, deja de sonar en las casas de la anterior.

## Pausa temporal y retención

- La pausa puede durar una hora, hasta las 8 de la mañana siguiente en la hora de la casa (si es antes de las 8, ese mismo día) o hasta que alguien la reactive. `paused_until` vence sola: no hace falta ningún job. El cálculo de «mañana a las 8» se hace en PostgreSQL con `AT TIME ZONE`.
- La promesa de 30 días se cumple aunque nadie toque el timbre: el snapshot filtra por fecha y un Vercel Cron diario borra visitas viejas (con sus mensajes y recibos) y límites vencidos. La ruta exige `Authorization: Bearer <CRON_SECRET>`, con comparación en tiempo constante, y falla cerrada sin secreto.

## Esquema versionado

`initialize` lee `MAX(version)` de `schema_migrations` y, solo si faltan versiones, las aplica en una transacción con `pg_advisory_xact_lock`. La versión 3 agrega `paused_until`, el dueño y la salud de los dispositivos y `visit_receipts`; la 4, las tablas de varias casas. Un paso de migración puede ser SQL o una función (por ejemplo, para numerar nombres repetidos). Las migraciones nuevas se agregan al final de `MIGRATIONS`, nunca se editan las publicadas. Se aplican al primer acceso, no en el build: por eso desarrollo y previews tienen ramas Neon propias y nunca aplican una migración de un PR sin mergear sobre la casa real.

## Configuración y observabilidad

- `next.config.ts` valida las variables de producción durante el build (`VERCEL_ENV=production`): si falta una, el build falla con el nombre de la variable y el deployment anterior sigue sirviendo. Nunca se imprime un valor. Un `VAPID_SUBJECT` de ejemplo solo genera una advertencia.
- Ningún entorno desplegado cae a `localhost`, a claves VAPID generadas o a un contacto de ejemplo. Un preview sin `APP_URL` usa su URL de rama y acepta también la del deployment.
- La sal del hash del visitante sale del secreto de auth; un deployment sin ese secreto falla en lugar de usar un valor público.
- Los logs de error incluyen el nombre, el mensaje recortado, el código del driver (SQLSTATE) y la cadena de causas, sin `detail`, parámetros, mensajes de visitantes, endpoints ni tokens. Los `AppError` de servidor (503) también se registran y devuelven un `requestId`.
- El login traduce los errores de Neon Auth aunque el cliente los lance (`AuthApiError`, con códigos como `invalid_credentials`) en lugar de devolverlos: una contraseña incorrecta mostraba «No pudimos conectar».

## Calidad

- golfo-lint (`npm run lint`): reglas de calidad del preset, todas como error y sin comentarios para silenciarlas. La CI también valida los workflows con actionlint y zizmor.
- `bun check` reemplaza a `tsc` en `npm run typecheck` (mismos errores, en una fracción del tiempo) y revisa por separado el service worker, que usa la librería `webworker`.
- La CI de GitHub corre lint, tipos, tests, build y las E2E, incluido el login real contra la rama `ci`. Dependabot propone actualizaciones semanales; las dependencias fijadas por seguridad en `overrides` se actualizan juntas y validando el login.
