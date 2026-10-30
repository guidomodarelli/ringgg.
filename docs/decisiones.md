# Decisiones de implementación

| Módulo | Responsabilidad |
| --- | --- |
| `src/server/database.ts` | PostgreSQL externo y PostgreSQL embebido, migraciones versionadas y transacciones |
| `src/server/doorbell.ts` | Registro, idempotencia, respuestas rápidas, mensajes del visitante y horario de descanso |
| `src/server/rate-limit.ts` | Identificación anónima del visitante y límites por cliente y por casa |
| `src/server/push.ts` | Suscripciones válidas, payload de notificaciones, envío acotado y resultados parciales |
| `src/server/http.ts` | Envoltorio común de las rutas: Origin en mutaciones, `no-store`, validación y errores seguros |
| `src/server/auth.ts` | Identidad de Neon, autorización del residente y origen de las mutaciones |
| `src/server/neon-auth.ts` | SDK administrado de Neon y configuración de cookies |
| `src/server/resident-access.ts` | Autorización de correos verificados para la vivienda |
| `src/proxy.ts` | Renovación de sesiones antes del render del panel |
| `src/app/api/<recurso>/route.ts` | Un route handler por operación; `api/[...path]` solo responde 404 en JSON |
| `src/components/dashboard.tsx` | Estado del panel, polling, refresco por push y acciones confirmadas por servidor |
| `src/components/dashboard/*` | Secciones del panel: resumen, historial con respuestas, QR, dispositivos y configuración |
| `src/components/visitor.tsx` | Tocar timbre, esperar una respuesta explícita y dejar un mensaje |
| `public/sw.js` | Pantalla sin conexión, notificaciones con acciones y aviso a pestañas abiertas |

El shell y los datos iniciales se renderizan en servidor. Las hojas interactivas manejan formularios, notificaciones, QR y polling. Las rutas `/` y `/t/[token]` tienen skeleton; los errores de datos se contienen en `error.tsx`. El layout raíz no espera datos. Los enlaces inexistentes tienen una salida contextual.

Todas las mutaciones esperan confirmación del servidor. No se anticipan éxitos de autenticación, permisos, push ni respuesta al visitante. Durante una mutación se bloquea el doble disparo; las consultas anteriores no pisan el resultado. El visitante conserva su ID al reintentar ante una respuesta perdida. Los mensajes usan texto React escapado, nunca HTML del visitante.

| Flujo | Estados y recuperación | Feedback |
| --- | --- | --- |
| Acceso | inicial, pendiente, clave inválida, límite de intentos | error junto al formulario; conserva la posibilidad de reintentar |
| Visitas | vacío, esperando, atendida, vencida, error de red | historial y región viva; respuesta solo tras confirmación |
| Responder | pendiente por respuesta, confirmada, vencida | la respuesta elegida se muestra al visitante recién cuando el servidor la guarda; la primera respuesta gana |
| Mensaje del visitante | no disponible, pendiente, guardado, vencido | un solo mensaje por visita; el reintento devuelve el mensaje guardado sin otro aviso |
| Tocar timbre | pendiente, registrado, enviado/parcial, sin destinos, pausa, descanso, límite por cliente, límite de la casa | mensaje en la pantalla del visitante; reintento con el mismo ID |
| Dispositivos | no compatible, permiso denegado, pendiente, conectado, prueba fallida | instrucción y feedback persistente; se puede volver a activar |
| QR | generación, copia, descarga, renovación | confirmación antes de invalidar el QR; feedback tras persistencia |
| Configuración | guardando, confirmado, error | conserva inputs, no adelanta éxito |
| Horario de descanso | guardando, activo, desactivado, rango inválido | aviso inline si inicio y fin coinciden; el estado del panel muestra «Horario de descanso» |

No se conectó un sink de soporte externo porque no hay ninguno configurado. Los errores inesperados se correlacionan con un identificador seguro en la respuesta y logs JSON sin mensajes de visitantes, endpoints push ni credenciales. No se promete un reporte enviado a soporte.

La autenticación anterior con clave compartida se reemplazó por Neon Managed Better Auth. `/api/auth/[...path]` usa el handler oficial; nunca se aceptan usuarios enviados por el navegador como identidad de servidor. La vivienda del MVP sigue siendo única y solo acceden correos verificados incluidos en `RESIDENT_EMAILS`, sin asignar automáticamente propiedad al primer registro. El proxy protege únicamente `/`; las API privadas revalidan identidad y autorización por separado antes de abrir la base.

El SDK instalado fijaba dependencias Better Auth y Zod con avisos críticos/altos. Se fijaron parches compatibles mediante overrides, comprobados con typecheck, build y login real. Persisten avisos bajos transitivos del árbol de UI que el flujo propio no importa. No se utiliza el proveedor autohospedado de Better Auth ni se reemplaza el wrapper administrado de Neon.

## Esquema versionado

`initialize` ya no ejecuta todo el bootstrap en cada arranque en frío. Lee `MAX(version)` de `schema_migrations` (una consulta) y, solo si faltan versiones, las aplica en una transacción con `pg_advisory_xact_lock`, así dos instancias que arrancan a la vez no aplican la misma versión dos veces. La versión 1 es el bootstrap original con `IF NOT EXISTS`: las bases creadas antes del versionado la adoptan sin cambios. Las migraciones nuevas se agregan al final de `MIGRATIONS` y nunca se editan las ya publicadas. Se descartó correrlas en el build de Vercel porque los deployments de preview comparten la base y un build no debería escribir en ella.

## Límites del timbre

El cooldown global de 30 segundos permitía que una sola persona con una foto del QR tocara cada 30 segundos y bloqueara a todos los demás. Ahora el límite es por cliente (30 segundos entre timbrazos y 4 cada 10 minutos) más un tope de la casa (12 cada 10 minutos) que protege a los celulares de una ráfaga distribuida. El cliente es un hash con sal de la primera dirección de `x-forwarded-for`; se guarda en `rate_limits` solo hasta que vence el límite y no se asocia a la visita.

## Respuestas, mensajes y notificaciones

- Las respuestas son un conjunto cerrado (`VISIT_REPLIES`), no texto libre: el visitante nunca recibe contenido escrito por un residente. Se guarda quién respondió para el historial del panel; ese nombre no viaja a la API pública porque el QR es una capacidad pública.
- La primera respuesta gana. Reintentar o responder desde otro celular devuelve la respuesta ya guardada.
- El visitante puede dejar un mensaje cuando la visita venció sin respuesta o cuando respondieron «No estoy», hasta 15 minutos después del timbrazo y una sola vez. Solo el primer mensaje aceptado envía notificación.
- Las notificaciones de timbrazo traen la URL de la visita y, en Android, las acciones «Ya voy» y «Dejalo en la puerta». El service worker responde con la cookie del residente; si la respuesta falla (sesión vencida, timbrazo vencido), abre la visita en el panel.
- Se evaluó reemplazar el polling por SSE o `LISTEN/NOTIFY`. Se descartó: la conexión pooled de Neon (PgBouncer en modo transacción) no mantiene `LISTEN`, y una conexión SSE abierta en Vercel consume tiempo de función mientras alguien mira el panel. En su lugar, el service worker avisa a las pestañas abiertas cuando llega un push y el panel refresca al recuperar el foco.

## Permisos compartidos

Todos los residentes verificados tienen los mismos permisos (decisión de la gestión compartida): cualquiera puede rotar el QR, pausar el timbre o desconectar un celular de la casa, por ejemplo uno perdido. Por eso no se agregaron permisos por rol en estas rutas.

## Ciclo de vida de las acciones y costo por request

Ninguna operación es optimista: todas tienen un efecto visible para el visitante, para otros residentes o para el proveedor de notificaciones.

- **Confirmadas por el servidor**: tocar timbre, dejar mensaje, responder a una visita, regenerar el QR, desconectar un celular, probar avisos, activar notificaciones, residentes, ingreso y salida.
- **Pendiente primero**: nombre de la casa, pausa y horario de descanso. Cambian lo que ve el visitante en el QR, así que el panel muestra «Guardando…» y confirma recién con la respuesta.

Cada acción declara cómo reconcilia el estado al confirmarse (`Reconcile` en `src/components/dashboard/types.ts`). Las rutas que devuelven el snapshot (`settings`, `quiet-hours`, `rotate`) o la visita guardada (`answer`) se aplican directamente, sin un `GET /api/dashboard` extra; solo `subscribe` y `remove-device` vuelven a pedir el snapshot. El polling compara el snapshot serializado y no re-renderiza si no cambió. El reloj que vence los botones de respuesta solo corre mientras hay visitas dentro de la ventana de respuesta.

En el servidor, el timbrazo usa 11 round trips en vez de 15: los contadores del límite salen de una sola consulta, los dos registros del límite van en un solo `INSERT` y la respuesta sale del `UPDATE ... RETURNING` del estado del aviso. La consulta del visitante usa 1 en vez de 2 (`homes LEFT JOIN visits`). El codificador de QR se carga con `import()` después de hidratar el panel.
