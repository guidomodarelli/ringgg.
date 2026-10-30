# Despliegue de Ringgg

Aplicación: **https://ringgg-nine.vercel.app**

Repositorio: https://github.com/guidomodarelli/ringgg.

## Probar desde el celular

1. Abrir la URL de producción desde el navegador del teléfono.
2. Instalar la PWA. En iPhone: Safari → Compartir → Agregar a pantalla de inicio. Abrirla desde ese ícono.
3. Ingresar con la cuenta verificada del residente.
4. En **Dispositivos**, ponerle un nombre al celular y tocar **Activar notificaciones**. Aceptar el permiso del sistema.
5. Tocar **Probar aviso** junto al dispositivo y comprobar que llegue la notificación.
6. Desde otra computadora o teléfono, abrir el QR del panel publicado y tocar **Tocar timbre**. Probar también con el celular bloqueado.
7. Abrir el aviso y responder **Ya voy**. La página del visitante mostrará la respuesta.

Descargar el QR desde el panel de producción: los QR generados antes en localhost no sirven para el acceso desde la calle. Para esta prueba se configuró Web Push; no se habilitaron SMS ni llamadas.

## Configuración aplicada

- Proyecto Vercel `ringgg`, conectado al repositorio GitHub y a la rama de producción `main`.
- Dominio estable `ringgg-nine.vercel.app`, autorizado en Neon Auth sin quitar el soporte de localhost.
- Node.js 24, coincidente con el runtime validado localmente.
- PostgreSQL y Neon Auth usan la rama Neon `production` existente; no se copió una base local ni se creó otra vivienda.
- Variables de producción: `DATABASE_URL`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_JWKS_URL`, `NEON_AUTH_COOKIE_SECRET`, `RESIDENT_EMAILS`, `RESIDENT_ADMIN_EMAILS`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `APP_URL`, `CRON_SECRET` y las del acceso con Google preparado (`AUTH_PROVIDER`, `SELF_AUTH_*`, `GOOGLE_*`). `next.config.ts` las valida en cada build de producción: si falta una, el build falla nombrándola y sigue sirviendo el deployment anterior.
- Variables de Preview (2026-10-30): `DATABASE_URL`, `NEON_AUTH_BASE_URL` y `NEON_AUTH_JWKS_URL` de la rama Neon `preview`; un `NEON_AUTH_COOKIE_SECRET` y un par VAPID propios del entorno; `VAPID_SUBJECT` y los correos de arranque. Sin `APP_URL`: cada preview usa su URL de rama y acepta también la del deployment. Para iniciar sesión en un preview, su URL de rama tiene que estar en los dominios confiables de Neon Auth de la rama `preview` (ver `docs/neon-setup.md`).
- Vercel Cron (`vercel.json`): `/api/cron/purge` todos los días a las 09:15 UTC borra visitas de más de 30 días y límites vencidos. Vercel envía `CRON_SECRET` como `Authorization: Bearer`; sin ese secreto la ruta responde 503.
- El secreto de cookies de producción es independiente del local. Las claves Web Push son estables.
- Credenciales y correos de acceso se almacenan como variables sensibles de Vercel; `APP_URL` es configuración pública. Los valores no se guardan en Git ni en este documento.
- `.vercelignore` excluye archivos de entorno, datos locales, configuración de agentes y artefactos de pruebas del paquete subido.
- `.vercel/`, `.neon`, `.env.local` y `.data/` quedan ignorados por Git.

## Comprobaciones realizadas

- Vercel completó el build remoto y confirmó el despliegue como **Ready**.
- La página privada redirige al login y `/api/dashboard` responde 401 sin sesión.
- Las mutaciones de otro origen responden 403.
- El proxy de sesiones de Neon responde correctamente desde el dominio público.
- Manifest standalone, íconos, service worker activo y contexto HTTPS verificados en navegador.
- La página pública del timbre carga sin login y funciona en viewport móvil sin desbordamiento.
- Las solicitudes de timbre con datos inválidos se rechazan sin enviar avisos.
- Se comprobó la coherencia criptográfica del par de claves VAPID configurado.
- Una prueba contra la web de producción y Neon real validó registro temporal, login, sesión, logout y denegación de vivienda para un correo no verificado. La cuenta temporal se eliminó.

No se envió un timbrazo ni un push a los dispositivos de los residentes durante las comprobaciones automáticas. La recepción física, el sonido y el comportamiento con el teléfono bloqueado se completan con **Probar aviso** desde el teléfono instalado. La configuración de silencio y Concentración sigue dependiendo del dispositivo.

## Incidencias resueltas

El CLI de Vercel no tenía sesión: el usuario completó la autorización del navegador. La carga en lote de variables por API fue rechazada; se cargaron individualmente, se confirmó cada alta y se verificó el listado sin mostrar secretos. El build de producción se completó después de cargar todas las variables.
