# Decisiones de implementación

| Módulo | Responsabilidad |
| --- | --- |
| `src/server/database.ts` | PostgreSQL externo y PostgreSQL embebido, esquema y transacciones |
| `src/server/doorbell.ts` | Registro, idempotencia, cooldown y respuesta de visitas |
| `src/server/push.ts` | Suscripciones válidas, envío acotado y resultados parciales |
| `src/server/auth.ts` | Identidad de Neon, autorización del residente y origen de las mutaciones |
| `src/server/neon-auth.ts` | SDK administrado de Neon y configuración de cookies |
| `src/server/resident-access.ts` | Autorización de correos verificados para la vivienda |
| `src/proxy.ts` | Renovación de sesiones antes del render del panel |
| `src/app/api/[...path]/route.ts` | Autorización, validación y respuestas HTTP seguras |
| `src/components/dashboard.tsx` | Acciones privadas, historial y dispositivos |
| `src/components/visitor.tsx` | Tocar timbre y esperar una respuesta explícita |

El shell y los datos iniciales se renderizan en servidor. Las hojas interactivas manejan formularios, notificaciones, QR y polling. Las rutas `/` y `/t/[token]` tienen skeleton; los errores de datos se contienen en `error.tsx`. El layout raíz no espera datos. Los enlaces inexistentes tienen una salida contextual.

Todas las mutaciones esperan confirmación del servidor. No se anticipan éxitos de autenticación, permisos, push ni respuesta al visitante. Durante una mutación se bloquea el doble disparo; las consultas anteriores no pisan el resultado. El visitante conserva su ID al reintentar ante una respuesta perdida. Los mensajes usan texto React escapado, nunca HTML del visitante.

| Flujo | Estados y recuperación | Feedback |
| --- | --- | --- |
| Acceso | inicial, pendiente, clave inválida, límite de intentos | error junto al formulario; conserva la posibilidad de reintentar |
| Visitas | vacío, esperando, atendida, vencida, error de red | historial y región viva; respuesta solo tras confirmación |
| Tocar timbre | pendiente, registrado, enviado/parcial, sin destinos, pausa, cooldown | mensaje en la pantalla del visitante; reintento con el mismo ID |
| Dispositivos | no compatible, permiso denegado, pendiente, conectado, prueba fallida | instrucción y feedback persistente; se puede volver a activar |
| QR | generación, copia, descarga, renovación | confirmación antes de invalidar el QR; feedback tras persistencia |
| Configuración | guardando, confirmado, error | conserva inputs, no adelanta éxito |

No se conectó un sink de soporte externo porque no hay ninguno configurado. Los errores inesperados se correlacionan con un identificador seguro en la respuesta y logs JSON sin mensajes de visitantes, endpoints push ni credenciales. No se promete un reporte enviado a soporte.

La autenticación anterior con clave compartida se reemplazó por Neon Managed Better Auth. `/api/auth/[...path]` usa el handler oficial; nunca se aceptan usuarios enviados por el navegador como identidad de servidor. La vivienda del MVP sigue siendo única y solo acceden correos verificados incluidos en `RESIDENT_EMAILS`, sin asignar automáticamente propiedad al primer registro. El proxy protege únicamente `/`; las API privadas revalidan identidad y autorización por separado antes de abrir la base.

El SDK instalado fijaba dependencias Better Auth y Zod con avisos críticos/altos. Se fijaron parches compatibles mediante overrides, comprobados con typecheck, build y login real. Persisten avisos bajos transitivos del árbol de UI que el flujo propio no importa. No se utiliza el proveedor autohospedado de Better Auth ni se reemplaza el wrapper administrado de Neon.
