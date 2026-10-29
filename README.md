# ringgg.

Timbre digital instalable: un QR en la puerta y notificaciones en los celulares de tu casa. MVP para una vivienda con hasta diez dispositivos.

**Producción:** [ringgg-nine.vercel.app](https://ringgg-nine.vercel.app). Los cambios en `main` se despliegan automáticamente desde GitHub a Vercel.

## Desarrollo

Requiere Node.js 22 o superior y npm.

```sh
npm install
npm run dev
```

Abrir http://localhost:3000. El acceso usa **Better Auth administrado por Neon**, mediante correo y contraseña. Ya no se acepta la clave compartida anterior ni sus cookies. El código incluye registro, verificación por código, recuperación de contraseña y cierre de sesión.

`.env.local` contiene las URLs que obtiene `neon deploy`, un secreto local estable `NEON_AUTH_COOKIE_SECRET` y las claves VAPID. Nunca subir este archivo a Git. Para habilitar residentes, configurar `RESIDENT_EMAILS` con sus correos separados por coma. Cada correo debe estar verificado en Neon; registrarse por cuenta propia no concede acceso al panel.

El administrador inicial se configura en `RESIDENT_ADMIN_EMAILS`. Puede abrir **Residentes** en el panel para autorizar más correos y quitar accesos. Los nuevos permisos se guardan en PostgreSQL y funcionan sin reiniciar la app. Autorizar un correo no crea su cuenta ni envía un email: esa persona debe registrarse y verificarlo. Los residentes normales no pueden modificar esta lista.

Al quitar un residente se revoca su acceso al panel y se eliminan los dispositivos que registró con su cuenta. Los dispositivos anteriores a esta asociación, si existen, se desconectan manualmente desde Dispositivos. Los accesos declarados en las variables de entorno se muestran protegidos y no se pueden eliminar desde la UI.

La app usa el PostgreSQL remoto de Neon cuando existe `DATABASE_URL`. Sin esa variable, el desarrollo de datos puede usar PostgreSQL embebido (PGlite) en `.data/postgres`; esto no reemplaza a Neon Auth. Nunca se simula el proveedor de identidad ni se habilita un acceso alternativo. No abrir dos procesos contra el mismo directorio local.

## Uso

1. Crear una cuenta o ingresar en `/sign-in`. Verificar el correo mediante el código de Neon. El administrador debe incluirlo en `RESIDENT_EMAILS`. Luego cambiar el nombre de la casa en Configuración.
2. Instalar Ringgg desde el navegador. En iPhone: Compartir → Agregar a Inicio → abrir desde su ícono.
3. En Dispositivos, nombrar el celular, activar las notificaciones y enviar una prueba.
4. Descargar el QR y colocarlo en la puerta. El visitante no instala nada ni inicia sesión.
5. Al recibir una visita, tocar **Ya voy** dentro de dos minutos. El visitante verá **¡Ya van!**.

Los avisos se envían con Web Push nativo (`web-push`), urgencia alta y vencimiento de 90 segundos. Un envío aceptado por el proveedor no confirma entrega o sonido. La app no puede ignorar silencio o Concentración ni reproducir un sonido en bucle estando cerrada. Sin dispositivos, el timbrazo se registra pero el visitante ve que no se pudo enviar una notificación.

## Conectar Neon

El proyecto está vinculado a `broad-meadow-57190517`, organización `org-sparkling-rain-48651750`, rama `production`. `neon.ts` declara Auth; PostgreSQL forma parte de cada rama. Se conservan los Route Handlers de Next.js y el driver `pg`, con conexiones pooled para tráfico de la app y `DATABASE_URL_UNPOOLED` disponible para herramientas de esquema.

```sh
neon login
neon init -y --no-agent-setup --org-id org-sparkling-rain-48651750 --project-id broad-meadow-57190517 --branch production --services "postgres,auth"
neon deploy
npm run db:check
npm run auth:check
```

El login del CLI se completa en el navegador. `neon deploy` obtiene `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `NEON_BRANCH`, `NEON_AUTH_BASE_URL` y `NEON_AUTH_JWKS_URL`. El secreto de cookies es propio de la aplicación y debe tener al menos 32 caracteres; no se obtiene de Neon. Se generó uno local sin alterar las claves VAPID. El servicio acepta localhost; para publicar, agregar el origen HTTPS de la app a los dominios confiables de Neon Auth.

La configuración de herramientas incluye `.codex/config.toml` con MCP OAuth limitado al proyecto, las skills `neon`, `neon-auth` y `neon-postgres` en `.agents/skills/` y `skills-lock.json`. No se guardan tokens en los archivos de configuración versionables.

Si se configura manualmente la base, los pasos son:

1. En tu proyecto de Neon, abrí **Connect** y seleccioná la rama, base de datos y rol que usará Ringgg. Para pruebas, conviene una rama de desarrollo separada de producción.
2. Activá **Connection pooling** y copiá la URL completa (el servidor incluye `-pooler`). El rol debe poder crear tablas en esa base para la inicialización del MVP.
3. Pegala en `DATABASE_URL` dentro de `.env.local`, conservando las otras claves locales:

   ```dotenv
   DATABASE_URL="postgresql://USUARIO:CONTRASEÑA@ep-PROYECTO-pooler.REGION.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
   ```

4. Ejecutá `npm run db:check`. Valida conexión y una transacción de solo lectura sin mostrar credenciales ni modificar tablas. Si falla, sale con código distinto de cero. No usa la base embebida como sustituto de una conexión remota fallida.
5. Reiniciá `npm run dev` y abrí el panel. La app inicializa el esquema automáticamente en el primer acceso autenticado. No se copian los datos de `.data/postgres`: Neon empieza con una vivienda y un QR nuevos. Descargá ese nuevo QR y conectá nuevamente los dispositivos.

La conexión usa hasta tres clientes por instancia, timeout de conexión de 15 segundos, rotación de conexiones y verificación TLS completa para endpoints Neon. Se conserva la URL pooled proporcionada por Neon, con `sslmode` normalizado a `verify-full`. Los fallos temporales de inicialización permiten reintentar después.

Referencia: [connection pooling de Neon](https://neon.com/docs/connect/connection-pooling) y [TLS de node-postgres](https://node-postgres.com/features/ssl).

## Vercel + Neon

El backend está conectado al proyecto Neon indicado y la web está publicada en Vercel con Node.js 24. El origen de producción `https://ringgg-nine.vercel.app` está autorizado en Neon Auth. Las variables de producción se configuran en Vercel; `.env.local` conserva su origen localhost para desarrollo.

1. Crear la base Neon y obtener su conexión pooled como se explica arriba.
2. Configurar estas variables en Vercel:
   - `DATABASE_URL`: conexión pooled de Neon. Obligatoria en Vercel; nunca se usa almacenamiento local allí. Configurar ramas diferentes para Preview y Production cuando se necesite aislamiento.
   - `APP_URL`: origen HTTPS definitivo, por ejemplo `https://timbre.example.com`. Se verifica para proteger las mutaciones. Usar un valor distinto para cada deployment de preview.
   - `NEON_AUTH_BASE_URL`: URL del servicio administrado de la misma rama.
   - `NEON_AUTH_COOKIE_SECRET`: secreto estable aleatorio de al menos 32 caracteres; usar uno propio del entorno publicado.
   - `RESIDENT_EMAILS`: lista de residentes de esta única vivienda, separados por coma. Deben tener el correo verificado.
   - `RESIDENT_ADMIN_EMAILS`: administradores iniciales protegidos, separados por coma. Pueden gestionar residentes desde el panel; también deben verificar su correo.
   - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`: par estable de claves generado con `npx web-push generate-vapid-keys`.
   - `VAPID_SUBJECT`: un contacto válido con formato `mailto:tu-email@example.com`.
3. Build: `npm run build`. El esquema se inicializa de manera idempotente al primer acceso.
4. Enlazar un dominio estable antes de imprimir el QR.
5. Probar la instalación y la notificación con el teléfono bloqueado, usando datos móviles y la configuración habitual de sonido.

Web Push requiere HTTPS, excepto localhost. Una IP HTTP de la red local no sirve para probar permisos en un teléfono. Para probar en un dispositivo real, usar un deployment HTTPS o un túnel HTTPS y establecer `APP_URL` a ese origen. Las claves VAPID deben mantenerse; si se cambian, los dispositivos necesitan suscribirse nuevamente.

## Contratos y límites

- Panel y endpoints privados protegidos con sesiones validadas por el SDK de Neon. El proxy de Next.js renueva cookies antes de renderizar el panel; login, recuperación, auth y QR público quedan fuera del matcher. La autorización exige correo verificado y allowlist; las mutaciones de negocio validan Origin.
- El QR es una capacidad pública revocable: permite tocar el timbre, nunca administrar. No demuestra presencia física.
- Cooldown global de 30 segundos con bloqueo transaccional; IDs de operación persistidos evitan duplicar timbrazos al reintentar.
- Se espera a que finalicen los envíos a un máximo de diez dispositivos. Se distinguen envío total, parcial y no disponible; no se reenvía automáticamente un push de resultado incierto.
- Suscripciones inválidas o vencidas (404/410) se eliminan. Solo se aceptan proveedores Apple, Mozilla y FCM por HTTPS.
- El panel y la página de espera consultan cada cinco segundos; no se superponen consultas y el panel deja de consultar oculto. La espera del visitante termina a los dos minutos.
- Se muestran hasta 50 visitas. Al registrar una nueva se purgan visitas con más de 30 días. No se guardan nombres de visitantes separados, teléfono, dirección ni IP de visitas.
- El service worker solo guarda la pantalla sin conexión. No cachea el panel, mensajes ni respuestas privadas.
- Ya existen cuentas individuales, todas asociadas mediante allowlist a esta única vivienda. Para más viviendas o administración de invitaciones desde la app, agregar membresías y permisos por vivienda antes de ampliar este MVP.

## Verificación

```sh
npm test
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
npm run db:check
npm run auth:check
npm run test:neon
```

Las pruebas de integración ejecutan PostgreSQL real embebido, sin mocks de servicios internos. Las E2E usan su propio directorio `.data/e2e-<pid>` para no alterar la vivienda remota. Las pruebas de acceso privilegiado requieren `E2E_NEON_AUTH_EMAIL` y `E2E_NEON_AUTH_PASSWORD` de una cuenta de prueba verificada; sin ellas se omiten explícitamente y no se inventan sesiones.

`npm run test:neon` requiere la app iniciada y las variables reales. Crea una cuenta sintética temporal en el proveedor, prueba registro, login, sesión, logout y bloqueo del panel sin verificar, y la elimina mediante el CLI. Con la configuración actual de Neon no se envía automáticamente correo al registrar; la prueba nunca solicita OTP ni recuperación. La recepción de códigos y el ingreso de un residente verificado se completan con un correo real autorizado.

El envío y la recepción física de Web Push deben validarse con un dispositivo real y credenciales estables. Las pruebas locales no afirman entrega por Apple/Google/Mozilla.
