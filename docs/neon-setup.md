# Integración de Neon y autenticación administrada

## Infraestructura conectada

- Organización: `org-sparkling-rain-48651750`.
- Proyecto: `broad-meadow-57190517` (`ringgg.`).
- Rama: `production` (`br-icy-poetry-b6hyxe9j`).
- Servicios utilizados: PostgreSQL y Neon Auth administrado. `neon deploy` confirmó que ya coincidían con la política; no cambió configuración remota existente.
- `neon.ts` fue generado por el CLI con `auth: true` y su política de ramas. El segundo `init` conservó ese archivo.
- El contexto `.neon` y `.env.local` quedan ignorados por Git.

## Herramientas instaladas

1. Se instaló `neon@latest` globalmente mediante npm.
2. El primer `neon init` instaló el plugin de Neon para Codex y Claude Code, y la integración de VS Code. La instalación opcional para GitHub Copilot CLI falló con `plugins CLI failed`; no es necesaria para Ringgg.
3. Se descargó y leyó la skill solicitada desde `https://neon.com/.well-known/agent-skills/neon/SKILL.md`.
4. Se instalaron las skills `neon`, `neon-auth` y `neon-postgres` a nivel proyecto en `.agents/skills/`, con su `skills-lock.json`.
5. Se agregó `.codex/config.toml` con el MCP `https://mcp.neon.tech/mcp?projectId=broad-meadow-57190517`. Usa OAuth y no incluye una API key. La conexión del MCP requiere autorizarse en el cliente cuando se use; las operaciones de esta entrega se realizaron con el CLI.

La configuración previa del proyecto se conservó. El primer intento de `init` falló al refrescar la sesión del CLI (`fetch failed`); el intento posterior logró vincular el proyecto. No se creó otro proyecto ni uno temporal para sustituirlo.

## Variables

`neon deploy` y el `init` posterior escribieron cinco variables administradas en `.env.local`:

- `DATABASE_URL`: conexión pooled usada por `pg` en los handlers de Next.js.
- `DATABASE_URL_UNPOOLED`: conexión directa disponible para herramientas de esquema.
- `NEON_BRANCH`.
- `NEON_AUTH_BASE_URL`.
- `NEON_AUTH_JWKS_URL`.

Además, se generó `NEON_AUTH_COOKIE_SECRET` estable para el SDK de Next.js y se dejó `RESIDENT_EMAILS` pendiente de los correos que indique el usuario. Se conservaron las claves VAPID y las demás variables existentes. `ADMIN_PASSWORD` y `SESSION_SECRET`, si todavía existen en el archivo local, ya no se leen ni habilitan acceso.

No se publican credenciales, contraseñas, tokens ni contenido de sesiones en este informe.

## Código modificado

- `src/server/neon-auth.ts`: instancia perezosa del SDK administrado. La ausencia de configuración falla cerrada y no impide compilar.
- `src/lib/auth-client.ts`: cliente oficial de Neon hacia el proxy del mismo origen.
- `src/app/api/auth/[...path]/route.ts`: handler oficial para GET/POST/PUT/PATCH/DELETE.
- `src/proxy.ts`: renovación de cookies antes del render del panel. Solo protege `/`; login, recuperación, assets y QR público quedan fuera del matcher.
- `src/server/auth.ts`: obtiene la identidad real de Neon y elimina la sesión local compartida.
- `src/server/resident-access.ts`: exige correo verificado y presencia en `RESIDENT_EMAILS`. No asigna propiedad al primer registro.
- `src/app/page.tsx` y la API privada: comprueban autorización antes de acceder a datos privados.
- Login: correo/contraseña, registro, verificación OTP, reenvío de código, recuperación y cambio de contraseña. Las acciones esperan confirmación y bloquean doble envío.
- Dashboard: cierre de sesión mediante Neon.
- Se mantienen PostgreSQL, `pg`, los endpoints existentes y el QR público. La integración no agrega Functions, Data API ni proveedores de SMS/llamadas.
- Se agregaron `npm run auth:check` y `npm run test:neon`, más pruebas de autorización y UI. Se actualizaron README y variables de ejemplo.

## Evidencia ejecutada

Salida relevante del CLI:

```text
Linked .neon
  Project         ringgg. (broad-meadow-57190517)
  Branch          production
  Org             org-sparkling-rain-48651750

No changes — branch production already matches the policy.
Utilized services: Postgres, Neon Auth
Pulled 5 Neon variables into .env.local
```

Build:

```text
npm run build
✓ Compiled successfully
✓ Generating static pages (4/4)
ƒ /api/auth/[...path]
ƒ /reset-password
ƒ /sign-in
ƒ Proxy (Middleware)
```

Conexiones reales:

```text
npm run db:check
[3/3] OK · PostgreSQL conectado. No se modificaron datos.

npm run auth:check
Neon Auth responde y el proxy funciona.
```

Pruebas:

```text
npm test
Test Files  3 passed (3)
Tests       14 passed (14)

npm run test:e2e
3 passed
2 skipped

npm run test:neon
Neon real: registro, login, sesión y logout correctos;
la vivienda deniega cuentas sin verificar.
Cuenta sintética de prueba eliminada.
1 passed
```

La prueba real creó una cuenta sintética temporal, comprobó registro y sesión contra el servicio, el bloqueo de la vivienda sin verificar, el cierre de sesión y un nuevo login. Después eliminó esa cuenta mediante el CLI. No se enviaron códigos ni enlaces de recuperación a personas. Se confirmó previamente que el proveedor no envía automáticamente correos al registrar.

## Pendientes y limitaciones

La cobertura quedó registrada mediante el CLI de golfo-kit, sin editar sus records manualmente. Las unidades ya existían; `ringgg.login` se actualizó para incluir las rutas de Neon. `validate` terminó con **0 errores y 0 advertencias**.

| Unidad | Decisión de check | Boundaries Next.js | UI/UX y acciones | Rendimiento |
| --- | --- | --- | --- | --- |
| `ringgg.login` | full | verificado | parcial: falta correo real para OTP/recuperación y acceso invitado | parcial: falta benchmark representativo |
| `ringgg.resident` | full en UI/UX/rendimiento; incremental en acciones/boundaries, revisado en modo full | verificado | parcial: faltan las pruebas privilegiadas con residente verificado | parcial: falta benchmark representativo |

- El correo solicitado por el usuario se configuró localmente en `RESIDENT_EMAILS` y `RESIDENT_ADMIN_EMAILS`. La comprobación posterior confirmó que la cuenta existe, tiene el correo verificado y accede como administrador a los servicios de autorización. Se probó alta y revocación real de un permiso temporal en Neon; detalles en `docs/residentes.md`. Las cuentas no invitadas permanecen bloqueadas.
- Dos E2E de administración privilegiada se omiten explícitamente hasta disponer de una cuenta real de prueba verificada (`E2E_NEON_AUTH_EMAIL` y `E2E_NEON_AUTH_PASSWORD`). La base de esas pruebas es local y aislada, para no rotar el QR ni cambiar la vivienda de producción.
- Falta probar recepción real de OTP y recuperación en el correo del residente, y regreso tras el vencimiento de la caché de sesión. El proxy de renovación se revisó contra el SDK instalado; no se afirma haber simulado envejecimiento real de sesión.
- Para publicar: definir el origen HTTPS de la web y registrarlo como dominio confiable de Neon Auth; revisar el proveedor de correo de producción. No se desplegó la web en Vercel.
- La instalación inicial del SDK arrastraba dependencias Better Auth/Zod con avisos críticos/altos. Se aplicaron parches mediante overrides y se validaron con build y login real. El último audit de producción informa **0 críticos, 0 altos y 7 bajos** transitivos del árbol de UI/correo.
- La revisión independiente terminó con cero hallazgos importantes abiertos después de incorporar el proxy de renovación.
- Engram no estaba disponible; no se usó otro sistema de memoria.

## SMS o llamada

Se respondió la consulta: se puede agregar un canal de SMS o llamada con mensaje grabado/sintetizado mediante un proveedor de telefonía. Esta integración no lo implementa ni contrata servicios telefónicos; mantiene Web Push. El canal de avisos del timbre y la identidad de los residentes son decisiones separadas.
