import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, test } from 'vitest';
import { initialize, MIGRATIONS, poolDatabase, type Database } from '../../src/server/database';
import { TEST_POSTGRES_URL, openRun, spread, type PostgresRun } from '../support/postgres-run';

const WORK_FAILURE = 'Doorbell:sendRing failed: the provider rejected the push';
const UNIQUE_VIOLATION = '23505';
const ROWS_TABLE = 'adapter_rows';

/** Ways a transaction fails after it wrote a row: its work throws, or the server rejects a statement and aborts it. */
const FAILED_WORK: Array<[failure: string, fail: (transaction: Database, table: string, id: string) => Promise<unknown>, expected: object]> = [
  ['el trabajo falla después de escribir', () => Promise.reject(new Error(WORK_FAILURE)), { message: WORK_FAILURE }],
  ['el servidor rechaza una sentencia', (transaction, table, id) => transaction.query(`INSERT INTO ${table} (id) VALUES ($1)`, [id]), { code: UNIQUE_VIOLATION }],
];

describe.skipIf(!TEST_POSTGRES_URL)('el adaptador de pg y las migraciones contra PostgreSQL real', () => {
  let run: PostgresRun;
  let rows: string;
  const countRows = (database: Database, id: string) => database.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM ${rows} WHERE id = $1`, [id]);

  beforeAll(async () => {
    run = await openRun();
    rows = run.table(ROWS_TABLE);
    await run.admin.query(`CREATE TABLE ${rows} (id TEXT PRIMARY KEY)`);
    return () => run.close();
  });

  describe('poolDatabase', () => {
    test.each(FAILED_WORK)('si %s, la transacción vuelve atrás y su conexión sigue sirviendo al pool', async (_failure, fail, expected) => {
      const pool = run.pool();
      const database = poolDatabase(pool);
      const id = randomUUID();

      const failed = database.transaction(async (transaction) => {
        await transaction.query(`INSERT INTO ${rows} (id) VALUES ($1)`, [id]);
        return fail(transaction, rows, id);
      });

      await expect(failed).rejects.toMatchObject(expected);
      expect(pool.totalCount).toBe(1);
      // The same connection answers next: without the ROLLBACK it would still be inside the failed transaction.
      await expect(countRows(database, id)).resolves.toEqual({ rows: [{ count: 0 }] });
      expect(pool.totalCount).toBe(1);
    });
  });

  describe('initialize', () => {
    test('dos instancias que arrancan a la vez sobre una base vacía aplican cada versión una sola vez', async () => {
      const schema = await run.createSchema('fresh');

      // A table created and not committed under the migrations' name stops both cold starts right where they create it.
      const outcomes = await run.lineUp(['CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY)'], spread(run.instancesIn(schema), 2, (instance) => initialize(instance)), schema);

      expect(outcomes).toEqual([{ status: 'fulfilled', value: undefined }, { status: 'fulfilled', value: undefined }]);
      const versions = await run.admin.query<{ version: number }>(`SELECT version FROM ${run.table('schema_migrations', schema)} ORDER BY version`);
      expect(versions.rows.map((row) => row.version)).toEqual(MIGRATIONS.map((_migration, index) => index + 1));
    });
  });
});
