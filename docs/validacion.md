# Validación de la entrega

Se creó el MVP en un directorio inicialmente vacío. No se hicieron commits, publicaciones ni conexiones a servicios pagos.

## Resultado

- `npm test`: 6 pruebas de integración aprobadas con PostgreSQL embebido real, sin mocks de módulos internos.
- `npm run test:e2e`: 3 pruebas aprobadas con Chromium. Incluyen clave incorrecta/correcta, QR, doble click, confirmación del residente, vuelta tras dos minutos, snapshot viejo retenido, nombre del shell, pausa, rotación y viewport móvil sin desbordamiento.
- `npm run typecheck`: aprobado.
- `npm run build`: aprobado, sin advertencias de empaquetado.
- `npm audit --omit=dev`: cero vulnerabilidades conocidas al momento de la comprobación. La instalación completa también informó cero vulnerabilidades.
- Build de producción ejecutado localmente en `http://localhost:3000`, con capturas reales del panel y del timbre móvil en `docs/screenshots/`.
- Revisión independiente: primera ronda con tres hallazgos importantes y uno menor, todos corregidos; segunda ronda del delta con cero hallazgos importantes o menores pendientes.

Las regresiones corregidas fueron formato de fecha diferente entre servidor UTC y cliente argentino, snapshots de polling anteriores a una mutación, confirmaciones recibidas mientras el visitante tenía suspendida la pestaña y actualización del nombre en el shell.

## Cobertura registrada

El registro está en `.golfo/skill-coverage`. Las tres unidades se crearon en esta ejecución y partieron de decisión `full`.

| Unidad | UI/UX | Ciclo de acciones | Boundaries Next.js | Rendimiento |
| --- | --- | --- | --- | --- |
| `ringgg.resident` | parcial | verificado | verificado | parcial |
| `ringgg.visitor` | parcial | verificado | verificado | parcial |
| `ringgg.login` | verificado | verificado | verificado | parcial |

UI/UX pendiente: teléfono físico, permisos y entrega real de Web Push, lector de pantalla y recuperación sin conexión en HTTPS. Rendimiento pendiente: benchmark representativo con PostgreSQL remoto y medición de Web Vitals en despliegue. No se afirma una mejora de rendimiento medida.

## Límites de la verificación

La recepción con el teléfono bloqueado, el sonido, los modos de concentración y la entrega por Apple/Google/Mozilla requieren prueba real. No se configuró Vercel, una base remota ni un dominio. El QR local contiene localhost y sirve para probar en esta computadora; el QR definitivo debe generarse después de configurar un origen HTTPS estable.

Engram no estaba disponible en la sesión; no se recuperó ni guardó memoria persistente por otro mecanismo.

Referencia de implementación PWA: [guía oficial de Next.js](https://nextjs.org/docs/app/guides/progressive-web-apps).
