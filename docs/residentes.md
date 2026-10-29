# Acceso y administración de residentes

El correo solicitado se autorizó en `.env.local` como residente y administrador inicial. Se conservaron los demás correos y variables existentes. No se cambió la verificación de identidad de Neon ni se creó una contraseña o una sesión por el usuario.

La comprobación actualizada en Neon confirmó que la cuenta del propietario existe, su correo está verificado y se resuelve como administrador. Para ingresar:

1. Abrir `http://localhost:3000/sign-in`.
2. Ingresar con el correo autorizado y la contraseña de la cuenta ya creada.
3. Si Neon solicita nuevamente verificación, completar el código recibido por correo.
4. Abrir la sección **Residentes**, disponible para el administrador.

## Agregar otros correos

En **Residentes**, escribir el correo y tocar **Autorizar correo**. La autorización se guarda en PostgreSQL y no requiere reiniciar la app. No se envía una invitación por email ni se crea una cuenta automáticamente: esa persona debe registrarse y verificar su correo. Los residentes normales no pueden consultar ni modificar la lista de accesos.

**Quitar acceso** requiere confirmación. La revocación bloquea nuevas operaciones y elimina los dispositivos vinculados a esa cuenta. Los dispositivos antiguos sin asociación, si existen, se desconectan manualmente desde **Dispositivos**. Los administradores de arranque y los accesos declarados en variables de entorno se muestran protegidos y no se pueden borrar desde el panel.

`RESIDENT_ADMIN_EMAILS` permite administrar los accesos de arranque. `RESIDENT_EMAILS` conserva compatibilidad con accesos configurados antes de esta sección. Los nuevos residentes se guardan en la tabla `residents`; no se agregan al archivo de entorno.

## Decisiones

- El permiso de administrador se resuelve en el servidor a partir de la sesión verificada y la configuración protegida.
- La UI no adelanta éxitos de permisos: conserva la lista anterior hasta que el servidor confirma.
- Agregar y quitar son idempotentes; un reintento tras una respuesta perdida no duplica ni concede permisos adicionales.
- Registro de dispositivos y revocación usan el mismo bloqueo de vivienda para evitar conservar una suscripción por una carrera.
- La lista inicial se obtiene en servidor en paralelo con el dashboard. No agrega consultas periódicas al polling del panel.
- El MVP sigue teniendo una única vivienda; los invitados no se convierten en administradores.

## Validación

- 20 pruebas de integración aprobadas con PostgreSQL real embebido, sin mocks de módulos internos.
- Tipos y build aprobados.
- Navegador: 4 E2E aprobadas y 2 omitidas por requerir una cuenta real verificada. La nueva prueba monta el componente React real, usa HTTP y PostgreSQL real embebido, y valida autorización, doble click, confirmación, cancelación y recuperación de errores con una identidad de prueba inyectada en el borde de autenticación. No suplanta Neon ni afirma que el propietario haya iniciado sesión.
- Comprobación con Neon real: configuración del correo solicitado autorizada y protegida; todavía no existe su cuenta.
- `db:check` y `auth:check` aprobados con los servicios reales.
- Revisión independiente del cambio sin hallazgos importantes.

## Comprobación con la cuenta ya verificada

Se consultó el registro real del propietario en `neon_auth.user` y se comprobó su autorización usando esos datos, sin cambiar el estado de verificación. Los mismos servicios del panel permitieron leer el dashboard, autorizar un correo temporal de prueba en Neon, repetir la autorización sin duplicarlo y revocarlo. El permiso temporal quedó eliminado y no se envió ningún email.

Las seis pruebas focales de residentes y la prueba de navegador del componente se ejecutaron nuevamente. `auth:check` confirmó el servicio administrado y el proxy; `/sign-in` respondió HTTP 200.

La herramienta de control del navegador falló dos veces al iniciar con `failed to write kernel assets: The system cannot find the path specified`. Por ese motivo, esta comprobación no afirma haber inspeccionado la cookie de la pestaña del propietario ni haber navegado el panel con su sesión. El permiso y las operaciones contra Neon sí quedaron comprobados; la sesión de esa pestaña se verifica abriendo el panel normalmente.

Cobertura registrada con el CLI, `validate`: 0 errores y 0 advertencias. Se creó `ringgg.residents.manage` y se revaluaron `ringgg.resident` y `ringgg.login`, en modo completo sobre el código final. En las tres unidades: boundaries de Next.js verificados; UI/UX y acciones parciales hasta recorrer el acceso real del propietario; rendimiento parcial hasta un benchmark representativo. No se fabricó evidencia de una sesión del propietario.
