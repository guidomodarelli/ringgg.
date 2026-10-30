# ringgg.

Timbre digital instalable: un QR en la puerta y notificaciones en los celulares de tu casa. Cada persona puede tener varias casas (hasta diez), cada una con su QR y hasta diez celulares.

**Producción:** [ringgg-nine.vercel.app](https://ringgg-nine.vercel.app). Los cambios en `main` se despliegan automáticamente desde GitHub a Vercel; cada PR corre la CI (lint, tipos, tests, build y E2E) y genera un preview con su propia base.

## Desarrollo

Requiere Node.js 24, npm y [Bun](https://bun.sh) canary (`bun upgrade --canary`), que corre `bun check` (tipos) y `bun lint` (golfo-lint).

```sh
npm install
npm run dev
```

Abrir http://localhost:3000. `npm run dev` y `npm run build` generan antes el service worker (`public/sw.js`) desde `src/service-worker/` con `npm run build:sw`; ese archivo no se versiona.

### Entornos

| Entorno | Base y Neon Auth | Variables |
| --- | --- | --- |
| Producción | rama Neon `production` | Vercel, entorno Production |
| Previews de PR | rama Neon `preview`, con claves de push propias | Vercel, entorno Preview |
| Desarrollo local | rama Neon `dev`, con claves de push propias | `.env.local` (Next.js y los scripts lo priorizan sobre `.env`) |
| CI | PostgreSQL embebido (PGlite) y Neon Auth de la rama `ci` | secrets de GitHub |

Nunca apuntes el entorno local a `production`: regenerar el QR, pausar o probar avisos afectaría la casa real, y las migraciones se aplican solas al primer acceso. `.env.local` y `.env` no se suben a Git. Sin `DATABASE_URL`, el desarrollo de datos usa PGlite en `.data/postgres` (no abrir dos procesos contra el mismo directorio).

Las ramas nuevas creadas con `neon checkout` vencen a los 7 días por la política de `neon.ts`; `dev`, `preview` y `ci` se crearon sin vencimiento.

## Acceso y residentes

El acceso usa **Neon Auth** (Better Auth administrado) con correo y contraseña: registro, verificación por código, recuperación de contraseña y cierre de sesión. Registrarse no da acceso: el correo tiene que estar verificado y autorizado.

- `RESIDENT_ADMIN_EMAILS` y `RESIDENT_EMAILS` son correos de arranque de la casa original y dan el mismo acceso.
- Todos los residentes de una casa tienen los mismos permisos en ella (gestión compartida): cualquiera puede autorizar o quitar residentes, cambiarles el nombre, rotar el QR, pausar el timbre o desconectar un celular. Solo se impide quitar al último residente.
- Autorizar un correo no crea la cuenta ni envía un email: el panel ofrece **Compartir invitación** (WhatsApp u otra app en el celular, o copiar el texto).
- Quitar a un residente revoca su acceso a esa casa y desconecta de ella los celulares que registró.
- **Varias casas**: el selector de la barra superior lista tus casas y permite **Agregar casa** (solo a quien ya es residente de alguna). La casa queda en la dirección (`/?home=<id>`). Una casa se puede eliminar desde Configuración si sos su único residente y tenés otra.
- **Nombres**: la primera vez en cada casa, **¿Quién sos?** pide tu nombre (obligatorio, hasta 40 caracteres). No se repiten nombres de residentes ni de celulares dentro de una casa, sin importar mayúsculas ni tildes.

Detalle en [casas, residentes y nombres](docs/residentes.md).

## Uso

1. Ingresar en `/sign-in`, verificar el correo, elegir tu nombre en **¿Quién sos?** y cambiar el nombre de la casa en **Configuración**.
2. Instalar Ringgg desde el navegador. En iPhone: Compartir → Agregar a Inicio → abrir desde su ícono.
3. Activar las notificaciones. El celular se registra con un nombre sugerido (por ejemplo «iPhone de Guido», o «iPhone de Guido 2» si ya existe en la casa) que se puede cambiar en **Dispositivos**. En otra casa, el mismo celular se conecta con **Conectar este dispositivo** y tiene un nombre propio. En una computadora se puede elegir **Seguir sin avisos en este dispositivo**.
4. En **Dispositivos**, **Probar mis celulares** envía una prueba a tus celulares. Cada celular muestra de quién es y el estado de su último aviso: recibido (confirmado por el celular), enviado o fallido.
5. En **Mi código QR**, **Imprimir cartel para la puerta** abre un cartel con el QR, el nombre de la casa y las instrucciones para la visita (se imprime o se guarda como PDF).
6. Al recibir una visita, responder dentro de dos minutos con una respuesta rápida: **Ya voy**, **En 5 minutos**, **Dejalo en la puerta** o **No estoy**. El visitante ve la respuesta elegida, nunca quién respondió. En Android, **Ya voy** y **Dejalo en la puerta** aparecen como botones de la notificación.
7. Si nadie responde a tiempo o la respuesta fue **No estoy**, el visitante puede dejar un único mensaje durante los 15 minutos siguientes al timbrazo. Llega como notificación y queda en el historial.
8. En **Configuración**, el timbre se puede pausar **durante 1 hora**, **hasta mañana a las 8** o **hasta que lo reactive**, y definir un **horario de descanso** diario (en hora de Buenos Aires). El visitante ve hasta cuándo dura.

## Avisos

- Web Push nativo (`web-push`). El timbrazo viaja con urgencia alta y vence a los 90 segundos (responder después no sirve). La nota de la visita viaja con urgencia normal y vence a las 12 horas.
- Las notificaciones de una misma visita se reemplazan y vuelven a sonar (`renotify`): la nota que llega después de un timbrazo sin responder no queda silenciosa.
- El service worker confirma al servidor cada aviso que recibe: el historial muestra cuántos celulares lo recibieron y cada dispositivo su último aviso recibido, enviado o fallido. Un envío aceptado por el proveedor no confirma la entrega; la confirmación del celular sí.
- El título de cada notificación dice de qué casa es, y tocarla abre esa casa.
- Si el navegador renueva la suscripción (`pushsubscriptionchange`), el service worker la vuelve a registrar sobre el mismo dispositivo (`/api/renew-subscription`), con sus casas y sus nombres.
- La app no puede ignorar el modo silencio o Concentración ni sonar en bucle estando cerrada. Sin dispositivos, el timbrazo se registra pero el visitante ve que no se pudo enviar una notificación.

## Contratos y límites

- Panel y endpoints privados protegidos con sesiones validadas por el SDK de Neon. El proxy de Next.js renueva cookies antes de renderizar el panel y el cartel. Las mutaciones validan Origin; en un preview sin `APP_URL` se aceptan su URL de rama y la del deployment.
- El QR es una capacidad pública revocable: permite tocar el timbre, nunca administrar.
- Límites por visitante y por casa con bloqueo transaccional, contados por separado en cada casa: el mismo cliente espera 30 s entre timbrazos y puede tocar hasta 4 veces cada 10 minutos; la casa acepta hasta 12 timbrazos cada 10 minutos. El cliente se identifica con un hash con sal de su dirección de red (`x-forwarded-for`, que Vercel sobrescribe).
- El panel consulta cada 5 s solo mientras una visita se puede responder; si no, cada 30 s, o cada 60 s si el navegador recibe notificaciones (el push lo actualiza al instante y la consulta queda de respaldo). No consulta oculto y refresca al recuperar el foco. La espera del visitante consulta cada 5 s y termina a los dos minutos.
- Retención: el panel muestra hasta 50 visitas de los últimos 30 días. Un Vercel Cron diario (`/api/cron/purge`, protegido con `CRON_SECRET`) borra las visitas más viejas con sus mensajes y recibos, y los límites vencidos, aunque nadie toque el timbre.
- Los errores inesperados se registran en JSON con la causa (nombre, mensaje recortado, código y stack), sin mensajes de visitantes, endpoints push, credenciales ni el token del QR. Las respuestas llevan un `requestId` para correlacionarlos. `instrumentation.ts` registra los errores de render.
- Un build de producción con variables faltantes o inválidas falla en `next.config.ts` y el deployment anterior sigue sirviendo; un contacto VAPID de ejemplo solo genera una advertencia.

## Verificación

```sh
npm run lint        # golfo-lint: solo reglas de calidad, todo como error
npm run typecheck   # bun check: app y service worker
npm test            # Vitest con PostgreSQL embebido real
npm run build
npx playwright install chromium
npm run test:e2e    # Playwright; con E2E_NEON_AUTH_* también el login real
npm run db:check
npm run auth:check
npm run test:neon
```

Las pruebas usan PostgreSQL real embebido y el service worker real (Chromium recibe pushes por el protocolo de DevTools), sin mocks de servicios internos. Las E2E usan su propio directorio `.data/e2e-<pid>`. Las de acceso real necesitan `E2E_NEON_AUTH_EMAIL`, `E2E_NEON_AUTH_PASSWORD` y `E2E_NEON_AUTH_BASE_URL` de una cuenta sintética verificada de la rama `ci`; sin ellas se omiten. La CI de GitHub las recibe como secrets.

`npm run test:neon` requiere la app iniciada y las variables reales: crea una cuenta sintética temporal, prueba registro, login, sesión, logout y bloqueo del panel sin verificar, y la elimina.

El envío y la recepción física de Web Push deben validarse con un dispositivo real; las pruebas locales no afirman entrega por Apple, Google o Mozilla.

Más detalle: [decisiones de implementación](docs/decisiones.md), [residentes](docs/residentes.md), [despliegue](docs/vercel.md), [Neon](docs/neon-setup.md) y [validación](docs/validacion.md).
