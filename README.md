# ringgg.

Timbre digital instalable: un QR en la puerta y notificaciones en los celulares de tu casa. MVP para una vivienda con hasta diez dispositivos.

## Desarrollo

Requiere Node.js 22 o superior y npm.

```sh
npm install
npm run dev
```

Abrir http://localhost:3000. Al cargar la página, la terminal muestra una **clave local aleatoria** para ingresar al panel. La clave y las claves VAPID automáticas duran hasta reiniciar el proceso. Para conservar sesiones y suscripciones entre reinicios, copiar `.env.example` a `.env.local` y configurar credenciales propias. Nunca subir ese archivo a Git.

En esta entrega ya existe un `.env.local` privado con credenciales locales y claves VAPID estables. La clave de acceso está en `ADMIN_PASSWORD` de ese archivo. No se usa ninguna credencial de producción.

Los datos se guardan en PostgreSQL embebido (PGlite) en `.data/postgres`; sobreviven a reinicios. Sin `DATABASE_URL` no se contacta ningún servicio externo de base de datos. No abrir dos procesos contra el mismo directorio.

## Uso

1. Ingresar al panel. Cambiar el nombre de la casa en Configuración.
2. Instalar Ringgg desde el navegador. En iPhone: Compartir → Agregar a Inicio → abrir desde su ícono.
3. En Dispositivos, nombrar el celular, activar las notificaciones y enviar una prueba.
4. Descargar el QR y colocarlo en la puerta. El visitante no instala nada ni inicia sesión.
5. Al recibir una visita, tocar **Ya voy** dentro de dos minutos. El visitante verá **¡Ya van!**.

Los avisos se envían con Web Push nativo (`web-push`), urgencia alta y vencimiento de 90 segundos. Un envío aceptado por el proveedor no confirma entrega o sonido. La app no puede ignorar silencio o Concentración ni reproducir un sonido en bucle estando cerrada. Sin dispositivos, el timbrazo se registra pero el visitante ve que no se pudo enviar una notificación.

## Conectar Neon

La app ya está preparada para Neon usando el cliente PostgreSQL `pg`. No requiere una API key de Neon ni cambiar el frontend.

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

Este proyecto se prepara localmente para Vercel; no está desplegado ni vinculado a servicios pagos.

1. Crear la base Neon y obtener su conexión pooled como se explica arriba.
2. Configurar estas variables en Vercel:
   - `DATABASE_URL`: conexión pooled de Neon. Obligatoria en Vercel; nunca se usa almacenamiento local allí. Configurar ramas diferentes para Preview y Production cuando se necesite aislamiento.
   - `APP_URL`: origen HTTPS definitivo, por ejemplo `https://timbre.example.com`. Se verifica para proteger las mutaciones. Usar un valor distinto para cada deployment de preview.
   - `ADMIN_PASSWORD`: clave de residente, mínimo 12 caracteres. Todos los residentes de esta vivienda comparten esta clave.
   - `SESSION_SECRET`: secreto aleatorio de al menos 32 caracteres. Cambiarlo invalida las sesiones.
   - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`: par estable de claves generado con `npx web-push generate-vapid-keys`.
   - `VAPID_SUBJECT`: un contacto válido con formato `mailto:tu-email@example.com`.
3. Build: `npm run build`. El esquema se inicializa de manera idempotente al primer acceso.
4. Enlazar un dominio estable antes de imprimir el QR.
5. Probar la instalación y la notificación con el teléfono bloqueado, usando datos móviles y la configuración habitual de sonido.

Web Push requiere HTTPS, excepto localhost. Una IP HTTP de la red local no sirve para probar permisos en un teléfono. Para probar en un dispositivo real, usar un deployment HTTPS o un túnel HTTPS y establecer `APP_URL` a ese origen. Las claves VAPID deben mantenerse; si se cambian, los dispositivos necesitan suscribirse nuevamente.

## Contratos y límites

- Panel protegido por cookie HttpOnly con firma HMAC, SameSite Strict y Secure bajo HTTPS; las mutaciones validan Origin.
- El QR es una capacidad pública revocable: permite tocar el timbre, nunca administrar. No demuestra presencia física.
- Cooldown global de 30 segundos con bloqueo transaccional; IDs de operación persistidos evitan duplicar timbrazos al reintentar.
- Se espera a que finalicen los envíos a un máximo de diez dispositivos. Se distinguen envío total, parcial y no disponible; no se reenvía automáticamente un push de resultado incierto.
- Suscripciones inválidas o vencidas (404/410) se eliminan. Solo se aceptan proveedores Apple, Mozilla y FCM por HTTPS.
- El panel y la página de espera consultan cada cinco segundos; no se superponen consultas y el panel deja de consultar oculto. La espera del visitante termina a los dos minutos.
- Se muestran hasta 50 visitas. Al registrar una nueva se purgan visitas con más de 30 días. No se guardan nombres de visitantes separados, teléfono, dirección ni IP de visitas.
- El service worker solo guarda la pantalla sin conexión. No cachea el panel, mensajes ni respuestas privadas.
- Para más viviendas, invitaciones o cuentas individuales, agregar un modelo multiusuario y autorización por vivienda antes de ampliar este MVP.

## Verificación

```sh
npm test
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
```

Las pruebas de integración ejecutan PostgreSQL real embebido, sin mocks de servicios internos. Las E2E recorren login, QR, doble toque, respuesta del residente, pausa, rotación, acceso privado y tamaños móviles. Cada ejecución E2E usa su propio directorio `.data/e2e-<pid>` para no alterar tus datos.

El envío y la recepción física de Web Push deben validarse con un dispositivo real y credenciales estables. Las pruebas locales no afirman entrega por Apple/Google/Mozilla.
