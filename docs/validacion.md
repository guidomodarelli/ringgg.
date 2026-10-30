# Validación de la entrega

Revisión de mejoras y varias casas, en la rama `feature/mejoras-revision` (base `main` 847d295). Validado el 30 de octubre de 2026, antes de commitear.

## Resultado

| Verificación | Comando | Resultado |
| --- | --- | --- |
| Calidad | `npm run lint` (golfo-lint, todo como error y sin reglas silenciadas) | 0 problemas en 178 archivos |
| Tipos | `npm run typecheck` (`bun check` de la app y del service worker) | sin errores |
| Integración | `npm test` (Vitest con PostgreSQL embebido real, sin mocks de módulos internos) | 120 de 120 en 14 archivos |
| Navegador | `npm run test:e2e` (Playwright, Chromium) | 24 pasan; 1 se omite por diseño (el modo sin Neon se prueba sin credenciales reales) |
| Build | `npm run build` | aprobado, con el service worker generado |

Las E2E incluyen el login real contra la rama Neon `ci` con una cuenta sintética: «¿Quién sos?» en la primera entrada, el timbrazo de punta a punta, el cartel con sesión y la API privada (401 sin sesión, 403 desde otro origen).

### Qué cubren las pruebas nuevas

- **Varias casas** (`tests/homes.test.ts`): crear solo siendo residente, sin nombres repetidos y con límite de 10; aislamiento de visitas, respuestas y QR; límites de timbrazos por casa; eliminar casas y elegir la casa del panel.
- **Celulares** (`tests/devices.test.ts`): un celular en dos casas con nombres propios, nombres repetidos con número, límites por casa, cambio de dueño del navegador, renovación de la suscripción que conserva casas y nombres, y avisos solo a los celulares de la casa.
- **Nombres** (`tests/residents.test.ts`): obligatorios, hasta 40 caracteres, únicos sin importar mayúsculas ni tildes, editables por cualquier residente y renombrado de los celulares genéricos.
- **Migración** (`tests/doorbell.test.ts`): pasar a varias casas conserva residentes, revocaciones y celulares, y numera los nombres repetidos.
- **Navegador**: `homes.spec.ts` («¿Quién sos?» obligatorio, nombre repetido, doble click, Agregar casa), `device-names.spec.ts` (error de nombre de celular junto al campo) y `residents.spec.ts` (renombrar residentes).

### Errores encontrados y corregidos durante la validación

- La renovación de una suscripción que ya estaba registrada copiaba las casas del dispositivo viejo con `ON CONFLICT DO NOTHING`: el índice único de nombres por casa chocaba con la fila vieja y la casa se perdía en silencio. Ahora las filas se mueven al dispositivo nuevo.
- Las rutas validaban `?home=` antes de autenticar, así que un pedido sin sesión recibía 400 en lugar de 401. Ahora autentican primero, como antes de varias casas.
- El error de un nombre de celular repetido aparecía arriba de la página. Ahora aparece junto al campo, con `aria-invalid`.

## Rendimiento medido

Mediciones de esta sesión, antes (`main` 847d295) y después (esta rama), con el mismo procedimiento:

| Métrica | Antes | Después | Herramienta y condiciones |
| --- | --- | --- | --- |
| Consultas del panel por hora, sin visitas y con notificaciones | 720 | 60 | Playwright con reloj simulado sobre el Dashboard real (bundle de producción), PostgreSQL embebido, pestaña visible |
| Consultas del panel por hora, sin visitas ni notificaciones | 720 | 120 | ídem |
| Consultas del panel por hora, con una visita por responder | 720 | 720 | ídem; se mantiene en 5 s a propósito |
| Queries por consulta de `/api/dashboard` | 4 | 4 | PGlite con contador de queries |
| Queries por render del panel | 6 | 8 | ídem; +1 secuencial (lista de casas) y +1 en paralelo (nombre sugerido) |

Los conteos son deterministas (reloj simulado) y se repitieron después de fijar el código final con los mismos valores.

**Sin medir:** la latencia contra Neon remoto (TTFB del panel, p95 del timbrazo), Web Vitals en un deployment y el peso del cartel.

## Cobertura registrada

El registro está en `.golfo/skill-coverage`. En esta sesión se creó la unidad `ringgg.homes.manage` y se corrigió la ruta de `ringgg.poster`.

| Unidad | UI/UX | Ciclo de acciones | Boundaries Next.js | Rendimiento |
| --- | --- | --- | --- | --- |
| `ringgg.resident` (panel) | verificado | verificado | verificado | verificado |
| `ringgg.residents.manage` | verificado | verificado | verificado | parcial |
| `ringgg.homes.manage` (nueva) | verificado | verificado | verificado | verificado |
| `ringgg.visitor` | parcial | verificado | verificado | parcial |
| `ringgg.login` | parcial | parcial | parcial | parcial |
| `ringgg.poster` | verificado | verificado | verificado | parcial |

Cada corrida se fijó sobre el código final y sus comandos (Vitest, Playwright y build) los ejecutó el CLI: 69 evidencias, ninguna fallida. Lo parcial queda así por motivos concretos:

- **Rendimiento** de residentes, visitante, ingreso y cartel: no se midió la latencia contra Neon remoto ni Web Vitals.
- **Visitante (UI/UX)**: la revisión se centró en los cambios de varias casas; falta recorrer la espera y la nota en un teléfono real.
- **Ingreso**: solo cambió el mapeo de errores de Neon Auth; sin cobertura verificada previa, el modo incremental no alcanza para verificar y no se repasó el árbol completo de `/sign-in`.

## Límites de la verificación

- La entrega real de Web Push (Apple, Google, Mozilla), el sonido con el teléfono bloqueado y los modos de concentración necesitan un teléfono físico; las pruebas usan el service worker real en Chromium.
- No se usó un lector de pantalla: la accesibilidad se verificó con roles, nombres accesibles, foco del diálogo y `aria-invalid` en Playwright.
- Las migraciones v3 y v4 se probaron sobre PostgreSQL embebido. Se aplican solas en el primer acceso de cada entorno: conviene probar primero en el preview del PR, que usa la rama Neon `preview`.
- Antes de mergear: el build de producción valida las variables de Vercel, y un `VAPID_SUBJECT` de ejemplo solo genera una advertencia.
