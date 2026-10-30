import { getMigrations } from 'better-auth/db/migration';
import { createPostgresPool } from '../src/server/postgres';
import { poolDatabase } from '../src/server/database';
import { getSelfAuth, selfAuthSettings } from '../src/server/self-auth';
import { terminal } from './utils/terminal';
import { importVerifiedIdentities } from '../src/server/identity-import';

const ui = terminal();
let pool: ReturnType<typeof createPostgresPool> | undefined;
ui.line('Ringgg · Preparar acceso con Google');
try {
  ui.line('[1/3] Revisar la configuración del acceso');
  const settings = selfAuthSettings();
  if (!settings) throw new Error('Falta configurar la base de autenticación, el secreto o las credenciales de Google.');
  const { schema } = settings;
  const authPool = createPostgresPool(settings.databaseUrl);
  pool = authPool;
  await ui.wait('[2/3] Preparar el esquema separado', () => authPool.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`));
  await ui.wait('[3/3] Crear las tablas necesarias', async () => { const migrations = await getMigrations(getSelfAuth().options); await migrations.runMigrations(); });
  if (process.argv.includes('--import-identities')) {
    const count = await ui.wait('Copiando identidades verificadas sin contraseñas ni sesiones', () => importVerifiedIdentities(poolDatabase(authPool), schema));
    ui.success(`Identidades conservadas: ${count}.`);
  }
  ui.success('Acceso con Google preparado. Las tablas de autenticación anteriores siguen intactas.');
} catch (error) {
  const message = error instanceof Error && error.message.startsWith('Falta configurar') ? error.message : 'No se pudo preparar el acceso. Revisá la configuración y volvé a intentar.';
  ui.error(`ERROR · ${message}`); process.exitCode = 1;
} finally { await pool?.end(); }
