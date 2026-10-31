# Decisiones de implementación

| Módulo | Responsabilidad |
| --- | --- |
| `src/server/database.ts` | PostgreSQL externo (`poolDatabase`) y embebido, migraciones versionadas y transacciones |
| `src/server/doorbell.ts` | Registro, idempotencia, aviso único por visita, respuestas, mensajes, pausa, horario de descanso y purga |
| `src/server/rate-limit.ts` | Identificación anónima del visitante y límites por cliente y por casa |
| `src/server/push.ts` | Dispositivos (alta, renovación, nombre), envío por política, salud y recibos |
| `src/server/environment.ts` | Variables que necesita un build de producción |
| `src/server/config.ts` | Origen público, orígenes permitidos y credenciales de push por entorno |
| `src/server/errors.ts` | Errores seguros para el navegador y logs con la causa |
| `src/server/cron.ts` | Autorización de Vercel Cron |
| `src/server/http.ts` | Envoltorio de las rutas: Origin en mutaciones, `no-store`, validación, errores y cookies de sesión renovadas |
| `src/server/auth.ts`, `residents.ts` | Identidad (Neon Auth o Better Auth propio, que se renueva en las rutas de la API), acceso por casa (`requireHome`), residentes y sus nombres |
| `src/server/session-cookies.ts` | Reenvío de `Set-Cookie` de auth y el contexto de la ruta (AsyncLocalStorage) donde se juntan las cookies renovadas |
| `src/server/homes.ts`, `panel-home.ts` | Crear y eliminar casas; elegir la casa del panel (`?home=`, cookie o la primera) |
| `src/server/device-names.ts`, `src/lib/names.ts` | Nombres únicos por casa: comparación sin mayúsculas ni tildes y sufijo numérico |
| `src/proxy.ts` | Renovación de sesiones antes del panel y del cartel (Neon Auth y Better Auth propio) |
| `src/instrumentation.ts` | Log de errores de render y de rutas que nadie atrapó |
| `src/app/api/<recurso>/route.ts` | Un route handler por operación; `api/[...path]` solo responde 404 en JSON |
| `src/app/cartel/page.tsx` | Cartel imprimible con el QR en SVG, renderizado en servidor |
| `src/components/dashboard.tsx` y `dashboard/*` | Panel: estado y polling (`use-dashboard-state`), notificaciones de este navegador (`use-push-device`) y secciones |
| `src/components/home-switcher.tsx`, `resident-name-dialog.tsx` | Selector de casas con «Agregar casa» y el «¿Quién sos?» obligatorio |
| `src/components/visitor.tsx`, `use-stored-visit.ts`, `src/lib/visit-storage.ts` | Tocar timbre, esperar una respuesta explícita, dejar un mensaje (o chatear) y retomar el timbrazo después de recargar |
| `src/components/dashboard/use-awaiting-visits.ts` | Conteo de visitas por responder que el panel publica para la marca de «Timbrazos» |
| `chat/` | Worker de Cloudflare del chat: valida tokens (`index.ts`), un Durable Object por visita (`chat-room.ts`, `room-store.ts`) y el aviso firmado a la app (`notify.ts`) |
| `src/lib/chat-protocol.ts`, `src/constants/chat.ts` | Contrato del chat que comparten la app, el navegador y el Worker: tokens, firmas y mensajes |
| `src/server/chat.ts`, `src/app/api/chat/*`, `api/door/[token]/visits/[id]/chat` | Tokens de la visita y de los residentes, y el aviso del Worker convertido en push |
| `src/components/chat/` | Chat de una visita: conexión (`use-chat-connection`), envíos pendientes (`use-chat-outbox`), estado (`use-visit-chat`) y la interfaz (`visit-chat`) |
| `src/service-worker/` | Service worker en TypeScript; `npm run build:sw` lo compila a `public/sw.js` |
| `src/lib/push-notification.ts` | Lectura del payload, acciones y URLs del service worker, compartido con sus tests |

El shell y los datos iniciales se renderizan en servidor; las hojas interactivas manejan formularios, notificaciones, QR y polling. Las rutas `/`, `/t/[token]` y `/cartel` tienen skeleton y los errores de datos se contienen en `error.tsx`. El layout raíz no espera datos.

## Varias casas

Una cuenta puede ser residente de varias casas. La casa es parte de cada operación: las rutas reciben `home` (en el body o en `?home=`) y el servidor verifica la membresía con `requireHome`; la respuesta a un timbrazo, que puede venir de una notificación, usa la casa de la visita. Las tablas por casa son `home_members` (con el nombre que esa casa usa para cada residente), `home_revocations` y `device_homes` (un dispositivo por endpoint, con un nombre por casa). Cada casa tiene su QR, su historial, sus límites de timbrazos y hasta diez celulares.

- **Crear**: solo quien ya es residente de alguna casa, hasta diez; la app sigue cerrada a cuentas que nadie invitó. Un advisory lock por persona evita pasar el límite con dos pedidos a la vez.
- **Eliminar**: solo el único residente y si tiene otra casa, para no borrar una casa que otros usan ni dejar a nadie sin casa. El mismo lock por persona serializa los borrados: dos pedidos a la vez no eliminan las dos últimas casas. El borrado arrastra visitas, residentes y registros de celulares; un celular sin casas se olvida.
- **Elegir**: `?home=` manda; si falta, la cookie `ringgg-home` (la escribe el proxy) o la primera casa. Una casa ajena nunca se elige. La dirección conserva la casa en cada sección, así que recargar o compartir el enlace abre la misma.
- **Nombres**: «¿Quién sos?» es obligatorio la primera vez en cada casa y viene precargado con el último nombre elegido o el de la cuenta. Los nombres de residentes y de celulares son únicos por casa sin importar mayúsculas, tildes ni espacios (`nameKey`); el servidor lo verifica bajo el bloqueo de la casa y un índice único es la última barrera. Al registrar un celular con un nombre ocupado se agrega un número. Las casas de una persona no repiten nombre al crearlas o renombrarlas; una invitación puede juntar dos casas con el mismo nombre, y se resuelve renombrando una.
- **Migración**: la versión 4 es aditiva. Crea la secuencia de `homes`, copia `residents` y `resident_revocations` a la casa original, agrega `visits.home_id` con valor por defecto 1 y asigna los celulares existentes a la casa original numerando los nombres repetidos. Un rollback de la app sigue funcionando con la casa original. Mientras se mantenga ese rollback, las altas y bajas de la casa original, incluida su eliminación, se reflejan en la misma transacción en `residents` y `resident_revocations`, las únicas tablas de acceso que lee la versión anterior: así, alguien quitado después de la migración no recupera el acceso si se vuelve a esa versión, aunque su correo siga entre los de arranque. Las demás casas no tocan esas tablas. Riesgo residual: la versión anterior manda los timbrazos de la casa original a todos los celulares registrados, incluidos los que solo están en otras casas, y su panel muestra las visitas y los celulares de todas las casas.

## Gestión compartida

Todos los residentes verificados de una casa tienen los mismos permisos en ella: cualquiera puede autorizar o quitar residentes, rotar el QR, pausar el timbre o desconectar un celular, por ejemplo uno perdido. Se eliminaron los restos del modelo de administrador (`isAdmin`, `requireResidentAdmin`, la fuente «administrador»). `RESIDENT_ADMIN_EMAILS` y `RESIDENT_EMAILS` quedan como correos de arranque equivalentes para no romper deployments existentes. Solo se impide quitar al último residente.

## Ciclo de vida de las acciones

Ninguna operación es optimista salvo enviar un mensaje del chat: todas las demás tienen un efecto visible para el visitante, para otros residentes o para el proveedor de notificaciones.

- **Confirmadas por el servidor**: tocar timbre, dejar mensaje, responder, regenerar el QR, desconectar o renombrar un celular, probar avisos, activar notificaciones, residentes, ingreso y salida.
- **Pendiente primero**: nombre de la casa, pausa y horario de descanso. Cambian lo que ve el visitante, así que el panel muestra «Guardando…» o «Pausando…» y confirma con la respuesta.
- **Solo locales**: «Seguir sin avisos en este dispositivo» (se recuerda en `localStorage`, con alternativa si no está disponible) y «Compartir invitación» (Web Share o portapapeles).
- **Optimista**: enviar un mensaje del chat. Aparece al instante como «Enviando…» y se confirma con el broadcast de la sala. Su id lo elige el navegador, así que reenviarlo al reconectar o con «Reintentar» nunca lo duplica. Sin confirmación a los 10 s queda «No pudimos confirmar el envío», no «falló»: pudo haber llegado, y el reintento es seguro igual.

Cada acción declara cómo reconcilia (`Reconcile` en `src/components/dashboard/types.ts`). Las rutas que devuelven el snapshot (`settings`, `pause`, `quiet-hours`, `rotate`, `rename-device`) o la visita (`answer`) se aplican sin otro `GET`. Guardar el nombre ya no envía el estado de la pausa: antes un formulario viejo podía reactivar un timbre que otro residente acababa de pausar.

## Sesión del acceso con Google

Con `AUTH_PROVIDER=self`, Better Auth guarda la sesión 30 días y la renueva cuando pasó un día desde la última renovación (`AUTH.sessionLifetimeSeconds` y `AUTH.sessionRenewalSeconds`). Antes regían los valores por defecto (7 días) y solo renovaba el proxy, que corre en `/` y `/cartel`. Una PWA instalada que queda en memoria solo llama a la API (consultas del panel, respuestas desde la notificación, recibos y renovación de la suscripción), así que a los 7 días todo respondía 401 aunque se usara todos los días.

- **Dónde se renueva**: `apiRoute` corre cada handler en un contexto propio (AsyncLocalStorage). Ahí `getIdentity` deja que Better Auth renueve la sesión y la respuesta lleva las cookies nuevas, también cuando la ruta falla: un 401 por sesión vencida borra la cookie. Si la sesión desaparece entre la lectura y la renovación (se cerró en otro dispositivo), la ruta responde 401 y no 503. Los server components no pueden escribir cookies: leen la sesión sin renovarla y la renueva el proxy antes de la página. El modo Neon administrado no cambia: su SDK ya renueva en las rutas.
- **Por qué 30 días**: un timbre puede pasar más de una semana sin sonar, y que la sesión venza justo entonces deja sin respuesta a la visita. Quitar a un residente revoca su acceso a la casa (y desconecta sus celulares) aunque su sesión siga vigente, así que una sesión más larga no extiende el acceso a una casa. Las sesiones creadas con la duración anterior pasan a 30 días en su primer uso.
- **Descartado**: el plugin `nextCookies` de Better Auth, porque en la carga inicial de una página un server component renovaría la sesión en la base sin poder escribir la cookie; y escribir con `cookies()` de `next/headers`, que no se puede verificar fuera de Next.
- **En el panel**: si una consulta o una acción recibe 401 `AUTH_REQUIRED`, el aviso deja de ofrecer «Reintentar ahora» (reintentar no abre una sesión cerrada) y ofrece **Ingresar de nuevo**. El enlace es la dirección del panel (`/?home=<id>`): el proxy recuerda la casa, la página manda a `/sign-in` y después de ingresar `/` abre esa casa. Las consultas siguen, así que ingresar en otra pestaña devuelve el panel solo.

## Resumen muestra la visita que espera respuesta

La app instalada abre en `/` (Resumen), donde el historial está oculto, y en iPhone la notificación no ofrece botones de respuesta. Por eso Resumen lista arriba las visitas que todavía se pueden responder, con la misma fila (`VisitRow`) y la misma acción que Timbrazos: un solo `run()`, confirmado por el servidor, con el mismo aviso. Qué visita espera respuesta lo decide una sola función (`awaitsAnswer` y `visitsAwaitingAnswer` en `src/lib/visit-format.ts`: sin responder y dentro de los 120 s); sin reloj (render en servidor e hidratación) no hay ninguna, así que los dos renders coinciden. La navegación se renderiza en el servidor y no tiene las visitas: el panel publica el conteo en un store cliente (`use-awaiting-visits.ts`, con `useSyncExternalStore` y clave por casa) que lee la marca de «Timbrazos». El dibujo de la puerta solo dice «Alguien está en la puerta» mientras haya una visita por responder.

## Polling adaptativo

El panel consultaba cada 5 segundos aunque no pasara nada: 720 pedidos por hora por pestaña visible, y el cómputo de Neon no llegaba a apagarse (la rama `production` estuvo activa unas 15 de sus primeras 19,5 horas). Ahora consulta cada 5 s solo mientras una visita se puede responder, porque otro residente puede contestarla. Si no, consulta cada 30 s, o cada 60 s si este navegador recibe notificaciones: el push del service worker actualiza el panel al instante y la consulta queda de respaldo por si el push falla en silencio, siempre dentro de la espera de dos minutos del visitante. Se descartó una cadencia de minutos por ese riesgo. Una consulta fallida muestra un aviso discreto que se borra solo con la siguiente exitosa, separado de los errores de las acciones.

Se evaluaron SSE y `LISTEN/NOTIFY`, y se descartaron: el pooler de Neon (PgBouncer en modo transacción) no mantiene `LISTEN`, y una conexión SSE abierta en Vercel consume tiempo de función.

## Chat con la visita

El chat necesita sockets abiertos, que Vercel no mantiene. Se eligió un Worker de Cloudflare con un Durable Object por visita y WebSocket Hibernation: entra en el plan gratis (100.000 requests por día) y mientras nadie escribe no se cobra duración. Neon Realtime quedó descartado: está en beta, solo en cuatro regiones (la base está en `aws-sa-east-1`) y pide logical replication. Polling contra Vercel y Neon mantendría despierto el cómputo de Neon mientras el chat esté abierto.

- **La app no habla con el Worker.** Firma tokens cortos (HMAC con `CHAT_SECRET`) que el navegador presenta al abrir el socket, y recibe un único pedido del Worker: el aviso firmado cuando la visita escribe y ningún residente lee. Así el Worker no necesita la base ni la sesión.
- **Una sala por visita y por origen** (`chatRoomName`): un preview y producción nunca comparten sala aunque usen el mismo Worker. El token lleva el origen que lo emitió, y el Worker solo acepta sockets desde ese origen y solo avisa a ese origen.
- **El chat reemplaza a la nota** cuando está configurado, con la misma ventana de 15 minutos. Sin configurar, todo sigue como antes. Al cerrarse la ventana con la página abierta, la visita vuelve al formulario del timbre, igual que sin chat; la conversación cerrada la leen solo los residentes. «El chat de esta visita terminó» le aparece a la visita si el Worker cierra la sala antes que su reloj.
- **Presencia sin estado propio.** «Algún residente está leyendo» son los sockets de residentes abiertos en la sala. Una pestaña oculta cierra el suyo, para que un panel olvidado en la compu no apague las notificaciones de los celulares.
- **Retención.** El Durable Object borra su SQLite con una alarma a los 30 días del cierre. Riesgo residual: eliminar una casa no borra en el momento los chats de sus visitas; desaparecen con esa alarma.

## Avisos, recibos y salud de los dispositivos

- Cada tipo de aviso tiene su política (`PUSH_POLICIES`): el timbrazo vence a los 90 s con urgencia alta; la nota, a las 12 horas con urgencia normal; la prueba, como el timbrazo.
- Las notificaciones de una visita comparten `tag` y usan `renotify`: la nota reemplaza al timbrazo sin respuesta y vuelve a sonar. Antes el reemplazo era silencioso justo en el caso en que hay nota.
- El service worker confirma cada push recibido (`/api/push-receipt`, con la cookie del residente). Se guarda `last_received_at` por dispositivo y un recibo por visita y dispositivo (`visit_receipts`, borrado en cascada con la visita). Si la sesión del celular venció, falta el recibo pero la notificación igual se muestra.
- Cada envío guarda la respuesta del proveedor por dispositivo (`last_success_at`, `last_failure_at`, `last_failure_status`) en un solo `UPDATE ... FROM unnest(...)`. Las suscripciones 404/410 se borran, con un rastro por casa (ver «Medir el embudo del timbrazo»). Si falla guardar la salud, no falla el timbrazo.
- Ante `pushsubscriptionchange`, el service worker vuelve a suscribirse y llama a `/api/renew-subscription` con `previousEndpoint`: el mismo dispositivo conserva sus casas, sus nombres y su lugar en cada límite de diez. Si la suscripción nueva ya estaba registrada, hereda las casas que le faltaban moviendo esas filas (copiarlas chocaría con el índice único de nombres del dispositivo viejo). El último endpoint se recuerda en Cache Storage, porque Chrome no informa la suscripción vieja.
- **Un aviso por visita, aunque falle el pedido.** Registrar la visita (o guardar la nota) y avisar son pasos separados: el aviso sale después del COMMIT. Para que un fallo en el medio no deje a la casa sin enterarse, y para no avisar dos veces, cada aviso se reclama en la misma sentencia que verifica que todavía corresponde (`claimNotice`). El reclamo es una fila por visita y tipo en `rate_limits` que vence a los `PUSH.claimSeconds` (20 s, más que un envío); el timbrazo se reclama dentro de la transacción que lo registra y la nota, dentro de la que la guarda. No hay cambio de esquema: `delivery` conserva los estados que leen el panel y la visita.
  - Si el envío falla antes de llegar al proveedor, el reclamo se libera y el pedido falla; el reintento de la visita, con el mismo `operationId`, avisa con el texto guardado.
  - Si el reclamo queda tomado sin enviar (se perdió la respuesta del COMMIT o la función murió), el reintento responde la visita en `registered` y la consulta de la página de la visita (`followVisit`, en `GET /api/door/[token]/visits/[id]`) envía el timbrazo cuando el reclamo vence, mientras siga sin respuesta y dentro de los dos minutos.
  - Después de dejar la nota la página no consulta nada, así que si otro pedido tiene tomado un aviso de nota sin enviar, el reintento responde 409 `NOTE_NOTICE_PENDING` y el formulario queda con el texto; el reintento posterior al vencimiento la avisa. Si la visita recarga o vuelve a escanear el QR, la página retomada muestra la nota como dejada y no ofrece reintentar, así que `followVisit` también envía la nota que quedó sin aviso una vez que vence su reclamo. Una nota enviada conserva su reclamo mientras se guarda la visita: es lo único que registra que salió.
  - Riesgo residual: si el aviso salió y falla guardar la entrega, un pedido posterior al vencimiento lo puede repetir. Las notificaciones de una visita comparten `tag` y usan `renotify`: el costo es un sonido de más, no un aviso perdido. Se descartó que el reintento espere a que venza el reclamo (hasta 20 s con la visita viendo «Tocando timbre…»).
- Cada dispositivo se nombra al conectarlo: el nombre es obligatorio, viene sugerido (plataforma y nombre del residente, con un número si ya existe en la casa) y no puede ser genérico ni repetido. `src/lib/device-name.ts` concentra esas reglas para el cliente, que valida antes de pedir el permiso de notificaciones, y para el servidor, que las vuelve a aplicar (`DEVICE_NAME_GENERIC`, `DEVICE_NAME_TAKEN`). Los dispositivos de antes que siguen como «Mi celular» se nombran la primera vez que abren el panel. Cualquiera puede cambiar el nombre después, y volver a activar las notificaciones no lo pisa. Si el navegador pasa a otra persona, deja de sonar en las casas de la anterior.

## Medir el embudo del timbrazo

En el plan Hobby de Vercel los logs duran menos de una hora y no hay métricas de duración, así que el embudo se guarda en la base, sin datos nuevos de la visita (ni posición, ni hash del cliente, ni mensaje, ni user agent), y se borra a los 30 días como las visitas.

- **Timbrazos rechazados**: `ring_rejections` cuenta por casa, día (en hora de la casa) y código (`RING_REJECTION_CODES`: ubicación, pausa, horario de descanso y límites). Se cuenta después del rollback de la transacción del timbrazo, en su propia sentencia y como mejor esfuerzo: si falla se registra `doorbell.countRejection` y la visita recibe la misma respuesta. Un QR inválido o el reintento de un timbrazo ya registrado no cuentan. Timbrazos muestra una línea con los de hoy: cuenta timbrazos, no visitas (quien insiste desde lejos cuenta dos veces).
- **Duración**: `visits.ring_ms` se guarda en el mismo `UPDATE` que fija `delivery`. El POST toma `performance.now()` antes de todo (incluye una conexión fría a la base); si el timbrazo lo envía un reintento o `followVisit`, cuenta desde que se guardó la visita, que es lo que la visita esperó. No incluye el arranque en frío de la función.
- **Resultado por celular**: `visit_deliveries` guarda una fila por visita, celular y aviso (`ring` o `note`) con `accepted`, `failed` o `gone` y el status HTTP. Se escribe en la misma sentencia que la salud del dispositivo, el rastro y el borrado de las suscripciones vencidas, así que el timbrazo no suma idas y vueltas.
- **Bajas por el proveedor**: el borrado ante 404/410 se mantiene, pero cada casa guarda en `device_removals` el nombre que le daba, de quién era, el status y la fecha, y Dispositivos lo muestra 30 días. Se borra al conectar en esa casa un celular que toma ese nombre, o uno del mismo dueño si era su único dado de baja ahí, al quitar al residente de la casa o al vencer.

Consultas (Neon SQL Editor):

```sql
-- p50 y p95 de lo que tarda el timbrazo del lado del servidor, últimos 30 días.
SELECT COUNT(*) AS rings,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY ring_ms) AS p50_ms,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY ring_ms) AS p95_ms,
  MAX(ring_ms) AS max_ms
FROM visits WHERE ring_ms IS NOT NULL AND created_at > NOW() - INTERVAL '30 days';

-- Qué respondió el proveedor, por tipo de aviso.
SELECT kind, outcome, status, COUNT(*) AS sends FROM visit_deliveries GROUP BY kind, outcome, status ORDER BY sends DESC;

-- Embudo diario de una casa: rechazos (los de ubicación aparte) frente a timbrazos registrados.
SELECT day, SUM(count) FILTER (WHERE code IN ('LOCATION_REQUIRED', 'LOCATION_IMPRECISE', 'TOO_FAR')) AS location_rejections, SUM(count) AS rejections,
  (SELECT COUNT(*) FROM visits v WHERE v.home_id = r.home_id AND (v.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date = r.day) AS rings
FROM ring_rejections r WHERE home_id = 1 GROUP BY home_id, day ORDER BY day DESC;
```

## El service worker contra la app real

- `tests/e2e/service-worker.spec.ts` prueba el worker con un servidor propio: el aviso, sus respuestas y que un payload ajeno no abra otro origen. Ese servidor responde HTML a cualquier ruta, así que no ve las llamadas a la API.
- `service-worker-answers.spec.ts` y `service-worker-subscription.spec.ts` corren el worker de la app que levanta Playwright, con el residente real de la rama `ci` (se omiten sin sus credenciales) y una casa nueva por test. DevTools entrega cada push con el payload de `pushPayload`. Cubren «Ya voy» y «Ya respondieron» desde la notificación, la visita vencida (409), el recibo y la renovación de la suscripción, que conserva casas y nombres.
- Para suscribirse hace falta un perfil persistente y Google Chrome: Chromium y Chrome for Testing reciben endpoints de un host de push de staging que la app no acepta. La primera suscripción de un perfil tarda unos 30 s, así que esos tests comparten el navegador. Chromium no deja enfocar ni abrir una ventana desde un `notificationclick` construido por script: el toque sin respuesta se prueba hasta ese rechazo y, aparte, que el panel abre la visita con el mensaje que manda el worker.
- El worker avisa a los paneles (`ringgg:push`) recién cuando la notificación que muestra se asentó. Chromium borra para siempre una notificación de `getNotifications()` si se lee mientras se está mostrando: el test que la leía apenas llegaba el push fallaba en 3 de 27 corridas de CI (se reprodujo 2 de 20 veces localmente, y 0 de 20 con el arreglo). Los tests esperan ese mensaje antes de leer.

## Actualización de la app instalada

- La PWA instalada puede quedar días en memoria y el panel nunca navega, así que seguía con el código viejo hasta cerrarla del todo. El service worker ya se activa solo (`skipWaiting` y `clients.claim`) y solo guarda la página offline: lo viejo era la página abierta.
- Cada build fija su versión (`VERCEL_DEPLOYMENT_ID`, si no el commit, si no la hora del build) y `/api/version` la devuelve. El `env` de `next.config.ts` también la deja escrita en el código del cliente, así que la página sabe qué versión corre. El panel consulta `/api/version` al abrir y cada vez que vuelve al frente, y la compara con la suya, no con la primera respuesta: si la primera lectura falla o la página abre en segundo plano y hay un deploy en el medio, igual se entera. Si cambió, se recarga.
- Nunca recarga en medio de algo. La recarga solo pasa en el momento en que la app vuelve al frente, cuando llega la respuesta de `/api/version`, y solo si en ese momento no corre ninguna acción del panel, no hay pedidos que cambian datos sin respuesta (`api()` cuenta todas sus llamadas POST, también las de formularios con su propio estado, como residentes o crear y eliminar casa) ninguna navegación del panel sigue cargando su página (`useTrackedNavigation` corre cada `router.push`, `replace` o `refresh` del panel en una transición y la cuenta hasta que la página siguiente se muestra, porque la dirección recién cambia al final) y la dirección no cambió mientras se leía la versión. Si hay algo en curso, no se agenda nada: la actualización queda para la próxima vuelta al frente. Así nunca corta una acción ni la navegación que la sigue (el aviso, o abrir la casa recién creada): ninguna recarga queda esperando a que terminen. Antes se esperaba un tiempo fijo después del último pedido, y no alcanzaba: con una conexión lenta, la navegación a la casa nueva todavía no había terminado y la recarga la cortaba.
- Se descartó el `deploymentId` de Next: solo detecta el cambio al navegar.
- No se aplica a la página del visitante: su espera dura minutos, y aunque ahora retoma el timbrazo al recargar, una recarga en medio de un envío lo cortaría.

## Pausa temporal y retención

- La pausa puede durar una hora, hasta las 8 de la mañana siguiente en la hora de la casa (si es antes de las 8, ese mismo día) o hasta que alguien la reactive. `paused_until` vence sola: no hace falta ningún job. El cálculo de «mañana a las 8» se hace en PostgreSQL con `AT TIME ZONE`.
- La promesa de 30 días se cumple aunque nadie toque el timbre: el snapshot filtra por fecha y un Vercel Cron diario borra visitas viejas (con sus mensajes y recibos) y límites vencidos; la misma sentencia borra los conteos de timbrazos rechazados y el rastro de celulares dados de baja de más de 30 días, y los resultados por celular se borran en cascada con su visita. La ruta exige `Authorization: Bearer <CRON_SECRET>`, con comparación en tiempo constante, y falla cerrada sin secreto.

## Tocar solo desde la puerta

- Es opcional por casa y viene apagado. Un residente guarda la ubicación de la puerta parado ahí (se rechaza una lectura con más de 50 m de error: solo se guardan las coordenadas, así que el error de la puerta se sumaría a cada comparación) y recién entonces puede activar el requisito; borrar la ubicación lo apaga, así una casa nunca queda sin poder recibir timbrazos.
- El visitante manda una lectura nueva en cada timbrazo. El servidor la compara (radio de 150 m más el error que informa el propio celular) y la descarta: no se guarda dónde estaba la visita. La página pública solo dice si la casa pide ubicación, nunca dónde está la puerta.
- Sin permiso, o con la ubicación bloqueada, el aviso que la pide no se puede cerrar y el formulario para tocar no existe; si la visita la habilita en el navegador, la página lo nota sola. El servidor exige la lectura igual, así que saltear la interfaz no alcanza.
- La ubicación la informa el celular de la visita: frena los timbrazos casuales a distancia (alguien con una foto del QR), no a quien la falsea. Un reintento del mismo timbrazo ya registrado no vuelve a pedirla.
- Una lectura con más de 300 m de error no alcanza para comparar. La página lo detecta antes de mostrar el formulario y muestra los pasos para activar la ubicación precisa en iPhone y Android, con un botón que pide una lectura nueva (`maximumAge: 0`, también al tocar): antes la visita escribía, tocaba y recién ahí recibía un rechazo de una línea. Si el servidor rechaza igual (`LOCATION_IMPRECISE`, `TOO_FAR` o `LOCATION_REQUIRED`, que el cliente lee de `ApiError.code`), la página muestra la guía que corresponde. Los umbrales no cambiaron.

## La visita retoma su timbrazo

El navegador de la visita guarda en `localStorage` la referencia de su timbrazo en cada puerta (`ringgg:visit:<token>`: id de la visita, id de la operación y hora del timbrazo; nunca el mensaje ni la ubicación). Al volver a abrir el QR, la página relee esa visita y retoma la espera, la respuesta y la nota, en lugar de ofrecer tocar otra vez (antes eso duplicaba el aviso o daba «Ya tocaste el timbre hace poco»). Se usa `localStorage` porque volver a escanear abre otra pestaña; una cookie viajaría en cada request. La referencia deja de usarse al cerrar la ventana de la nota (15 minutos) y se borra cuando vence con la página abierta, con «Volver a tocar» o la próxima vez que se abre cualquier timbre de Ringgg en ese navegador, que barre las referencias vencidas de todas las puertas. La política de privacidad lo dice así.

## Legibilidad en el celular

- Los botones primarios usan `--primary-action` (#cc472a), el naranja de marca oscurecido en OKLCH con el mismo tono y croma: con texto blanco da 4,66:1 (WCAG 1.4.3 pide 4,5:1; sobre `--accent` daba 3,11:1). El hover pasa a `--accent-dark` (5,89:1) y el anillo de foco usa el mismo color (4,35:1 sobre `--paper`). `--accent` queda para lo decorativo.
- En pantallas de hasta 700 px o táctiles (`any-pointer: coarse`), `input`, `textarea` y `select` usan 16 px: iOS Safari hace zoom al enfocar un campo más chico y no vuelve. Nunca se desactiva el zoom.
- «Tocar timbre» conserva en el celular sus 14 px y 54 px: la regla compacta de `.button` para celular lo achicaba.
- Estas reglas viven en un bloque al final de `globals.css` y `tests/e2e/mobile-readability.spec.ts` las verifica a 375x812.
- No molestar: una PWA no puede saltearlo. Dispositivos muestra los pasos para agregar a Ringgg como excepción en iPhone y Android.

## Esquema versionado

`initialize` lee `MAX(version)` de `schema_migrations` y, solo si faltan versiones, las aplica en una transacción con `pg_advisory_xact_lock`. La versión 3 agrega `paused_until`, el dueño y la salud de los dispositivos y `visit_receipts`; la 4, las tablas de varias casas; la 6, el registro del embudo (`ring_rejections`, `visits.ring_ms`, `visit_deliveries` y `device_removals`). Un paso de migración puede ser SQL o una función (por ejemplo, para numerar nombres repetidos). Las migraciones nuevas se agregan al final de `MIGRATIONS`, nunca se editan las publicadas. Se aplican al primer acceso, no en el build: por eso desarrollo y previews tienen ramas Neon propias y nunca aplican una migración de un PR sin mergear sobre la casa real.

## Configuración y observabilidad

- `next.config.ts` valida las variables de producción durante el build (`VERCEL_ENV=production`): si falta una, el build falla con el nombre de la variable y el deployment anterior sigue sirviendo. Nunca se imprime un valor. Un `VAPID_SUBJECT` de ejemplo solo genera una advertencia.
- Ningún entorno desplegado cae a `localhost`, a claves VAPID generadas o a un contacto de ejemplo. Un preview sin `APP_URL` usa su URL de rama y acepta también la del deployment.
- La sal del hash del visitante sale del secreto de auth; un deployment sin ese secreto falla en lugar de usar un valor público.
- Los logs de error incluyen el nombre, el mensaje recortado, el código del driver (SQLSTATE) y la cadena de causas, sin `detail`, parámetros, mensajes de visitantes, endpoints ni tokens. Los `AppError` de servidor (503) también se registran y devuelven un `requestId`.
- El login traduce los errores de Neon Auth aunque el cliente los lance (`AuthApiError`, con códigos como `invalid_credentials`) en lugar de devolverlos: una contraseña incorrecta mostraba «No pudimos conectar».

## Calidad

- golfo-lint (`npm run lint`): reglas de calidad del preset, todas como error y sin comentarios para silenciarlas. La CI también valida los workflows con actionlint y zizmor.
- `bun check` reemplaza a `tsc` en `npm run typecheck` (en una fracción del tiempo) y revisa por separado el service worker, que usa la librería `webworker`. No siempre da los mismos errores: dejó pasar una conversión de tipos que `next build` rechazó y el preview de Vercel falló. Por eso la CI corre además `npm run typecheck:build`, el mismo `tsc` del build (unos 7 s).
- La CI de GitHub corre lint, tipos, tests, la suite contra PostgreSQL real (contenedor `postgres:18.6`, la versión de Neon, fijado por digest y actualizado a mano: Dependabot no actualiza imágenes de `services`), build y las E2E en jobs paralelos, con las E2E repartidas en dos shards (cada uno con su servidor y su base local), incluido el login real contra la rama `ci`. Un check que falla se ve por su nombre y no frena a los demás. Dependabot propone actualizaciones semanales; las dependencias fijadas por seguridad en `overrides` se actualizan juntas y validando el login.
- En CI, una E2E que falla guarda su trace de Playwright (`retain-on-failure`) en el artefacto `playwright-results-N`: con `npx playwright show-trace` se ve en qué paso se trabó, cosa que la captura sola no muestra.
- Las corridas de Dependabot no reciben secrets, así que corren sin auth configurado. El chequeo de `/cartel` sin sesión sigue la navegación hasta `/sign-in` en vez de exigir el 307 del proxy, que solo existe con auth: antes todos los PRs de Dependabot quedaban en rojo.
- Los tests de integración con Better Auth usan el driver `pg` real contra un PGlite en memoria servido por el protocolo de PostgreSQL (`tests/support/pglite-server.ts`); solo se simula el reloj.
- Los locks que sostienen la idempotencia y los límites se prueban en `tests/postgres` contra PostgreSQL real: el `FOR UPDATE` de la casa en el timbrazo y al conectar un celular, el advisory lock por persona al crear y borrar casas, el de las migraciones y el reclamo atómico del aviso. PGlite corre cada transacción sola, y los tests de concurrencia de `npm test` pasaban aunque se borrara cualquiera de esos locks. Para que cada caso sea concurrente en todas las corridas, un lock tomado desde otra conexión frena los pedidos justo antes del paso protegido y se suelta cuando todos esperan detrás (`pg_blocking_pids`). Sacar cualquiera de los locks hace fallar su test; se probó uno por uno.
- Cada archivo de esa suite usa un esquema propio y lo borra al final. El pooler de Neon (PgBouncer en modo transacción) rechaza `options=-c search_path=…`, así que cada sentencia fija su `search_path` con `set_config(…, true)` dentro de su propia transacción, lo que vale igual con el pooler y con el contenedor de la CI.
- Esa suite encontró un bug: pg-pool no escucha el evento `error` de un cliente prestado, y pg lo emite cuando el servidor corta la conexión aunque no haya una consulta en curso. Si Neon cortaba la conexión en medio de una transacción, el proceso recibía una excepción no capturada. `poolDatabase` ahora escucha mientras dura la transacción y descarta esa conexión.

## Región de las funciones

Las funciones corren en `gru1` (São Paulo), junto a Neon en `aws-sa-east-1`. Sin `regions`, Vercel las corría en `iad1`: cada consulta cruzaba el continente (~113 ms), un timbrazo hacía diez antes de que saliera el aviso y en 4 de 6 timbrazos medidos además abría una conexión nueva (+0,85 s); `POST /api/door` tardaba p50 2,43 s (n=6). El servicio de avisos de Apple está en EE. UU., así que desde São Paulo el envío a un iPhone suma unos 0,3 s, mucho menos de lo que se ahorra.
