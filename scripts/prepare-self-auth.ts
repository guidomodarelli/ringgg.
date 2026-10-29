import { getMigrations } from 'better-auth/db/migration';
import { createPostgresPool } from '../src/server/postgres';
import { getSelfAuth, selfAuthConfigured } from '../src/server/self-auth';
import { AUTH } from '../src/constants/auth';
import { terminal } from './utils/terminal';
import { importVerifiedIdentities } from '../src/server/identity-import';
import type { Database } from '../src/server/database';

const ui = terminal();
let pool: ReturnType<typeof createPostgresPool> | undefined;
ui.line('Ringgg · Preparar acceso con Google');
try {
  ui.line('[1/3] Revisar la configuración del acceso');
  if (!selfAuthConfigured()) throw new Error('Falta configurar la base de autenticación, el secreto o las credenciales de Google.');
  const schema = process.env.SELF_AUTH_SCHEMA || AUTH.selfManagedDefaultSchema;
  pool = createPostgresPool(process.env.SELF_AUTH_DATABASE_URL!);
  await ui.wait('[2/3] Preparar el esquema separado', () => pool!.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`));
  await ui.wait('[3/3] Crear las tablas necesarias', async () => { const migrations = await getMigrations(getSelfAuth().options); await migrations.runMigrations(); });
  if (process.argv.includes('--import-identities')) {
    const database: Database = {
      query: async <Row>(sql: string, params: unknown[] = []) => { const result = await pool!.query(sql, params); return { rows: result.rows as Row[] }; },
      transaction: async <Result>(work: (transaction: Database) => Promise<Result>) => {
        const client = await pool!.connect();
        try {
          await client.query('BEGIN');
          const result = await work({ query: async <Row>(sql: string, params: unknown[] = []) => { const rows = await client.query(sql, params); return { rows: rows.rows as Row[] }; }, transaction: async () => { throw new Error('Nested transactions are unsupported'); } });
          await client.query('COMMIT'); return result;
        } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
      },
    };
    const count = await ui.wait('Copiando identidades verificadas sin contraseñas ni sesiones', () => importVerifiedIdentities(database, schema));
    ui.success(`Identidades conservadas: ${count}.`);
  }
  ui.success('Acceso con Google preparado. Las tablas de autenticación anteriores siguen intactas.');
} catch (error) {
  const message = error instanceof Error && error.message.startsWith('Falta configurar') ? error.message : 'No se pudo preparar el acceso. Revisá la configuración y volvé a intentar.';
  ui.error(`ERROR · ${message}`); process.exitCode = 1;
} finally { await pool?.end(); }
