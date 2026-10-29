import { createPostgresPool, checkPostgres } from '../src/server/postgres';
import { terminal } from './utils/terminal';

const ui = terminal();
let pool: ReturnType<typeof createPostgresPool> | undefined;
ui.line('Ringgg · Conexión con Neon');
try {
  ui.line('[1/3] Revisar DATABASE_URL');
  if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL. Pegá la conexión pooled de Neon en .env.local y volvé a ejecutar npm run db:check.');
  pool = createPostgresPool(process.env.DATABASE_URL);
  await ui.wait('[2/3] Comprobar conexión y transacción de solo lectura', () => checkPostgres(pool!));
  ui.success('[3/3] OK · PostgreSQL conectado. No se modificaron datos.');
  ui.success('+---------------------------------------------+\n| Conexión lista. Ejecutá npm run dev.          |\n| El esquema se crea al primer acceso al panel.|\n+---------------------------------------------+');
} catch (error) {
  // Never render raw pg errors: they may contain a connection string or provider details.
  const missing = !process.env.DATABASE_URL;
  ui.error(`ERROR · ${missing && error instanceof Error ? error.message : 'No se pudo verificar PostgreSQL. Revisá la URL, la contraseña, el estado de Neon y tu conexión. Las credenciales no se muestran.'}`);
  process.exitCode = 1;
} finally { await pool?.end(); }
