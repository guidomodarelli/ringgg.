import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Pool } from 'pg';
import { initialize, poolDatabase, type Database } from '../../src/server/database';
import { errorResponse, logError } from '../../src/server/errors';
import { createPostgresPool } from '../../src/server/postgres';
import type { ResidentIdentity } from '../../src/types/auth';
import { POSTGRES_SKIP_REASON, TEST_POSTGRES_URL } from './postgres-environment';

export { TEST_POSTGRES_URL } from './postgres-environment';

/** Every schema the suite creates is this prefix, the run id and an optional suffix; a run only drops its own. */
const RUN_SCHEMA_PREFIX = 'ringgg_test_';
const RUN_ID_BYTES = 6;
const SCHEMA_PATTERN = /^ringgg_test_[0-9a-f]{12}(?:_[a-z]+)?$/;
const SCHEMA_SUFFIX_PATTERN = /^[a-z]+$/;
/** How often a held lock counts the requests queued behind it, and how long it waits for all of them. */
const LINE_UP = { pollMs: 25, timeoutMs: 30_000 };
/** How long a terminated backend may take to leave `pg_stat_activity`. */
const TERMINATION_TIMEOUT_MS = 10_000;
/** Who invited the residents the suite seeds. */
const SEED_INVITER = 'postgres-suite';

/** A statement and its parameters. */
export type Statement = [sql: string, params?: unknown[]];

function quotedSchema(schema: string) {
  if (!SCHEMA_PATTERN.test(schema)) throw new Error(`PostgresRun: refusing schema "${schema}", which is not a suite schema`);
  return `"${schema}"`;
}

/**
 * The app's database port, with `schema` as its search path. The Neon pooler (PgBouncer in transaction mode)
 * rejects startup options, and a session `SET` stays on whichever server connection ran it, so every statement
 * runs in a transaction that first sets its search path locally; a lone statement gets a transaction of its own.
 */
export function inSchema(database: Database, schema: string): Database {
  const searchPath = quotedSchema(schema);
  async function enter(transaction: Database) {
    await transaction.query(`SELECT set_config('search_path', $1, true)`, [searchPath]);
    return transaction;
  }
  return {
    close: database.close,
    query: <Row>(sql: string, params?: unknown[]) => database.transaction(async (transaction) => (await enter(transaction)).query<Row>(sql, params)),
    transaction: <Result>(work: (transaction: Database) => Promise<Result>) => database.transaction(async (transaction) => work(await enter(transaction))),
  };
}

/** Backends waiting on a lock of `$1`, directly or queued behind another waiting backend. */
const QUEUED_BEHIND = `WITH RECURSIVE queued (pid) AS (
    SELECT pid FROM pg_stat_activity WHERE $1 = ANY (pg_blocking_pids(pid))
    UNION SELECT activity.pid FROM pg_stat_activity activity JOIN queued ON queued.pid = ANY (pg_blocking_pids(activity.pid))
  ) SELECT COUNT(*)::int AS count FROM queued`;

/** Polls until `expected` backends queue behind `pid`, the requests settle or the time runs out; returns the last count. */
async function waitForQueue(pool: Pool, pid: number, expected: number, settled: Promise<unknown>) {
  let done = false;
  void settled.then(() => { done = true; });
  const deadline = Date.now() + LINE_UP.timeoutMs;
  let queued = 0;
  while (!done && queued < expected && Date.now() < deadline) {
    await delay(LINE_UP.pollMs);
    queued = (await pool.query<{ count: number }>(QUEUED_BEHIND, [pid])).rows[0].count;
  }
  return queued;
}

/** `count` requests that alternate between the instances, as a load balancer spreads them. */
export function spread<T>(instances: Database[], count: number, send: (instance: Database, index: number) => Promise<T>): Array<() => Promise<T>> {
  return Array.from({ length: count }, (_unused, index) => () => send(instances[index % instances.length], index));
}

/** The values of the requests that succeeded, in request order. */
export function fulfilledValues<T>(outcomes: Array<PromiseSettledResult<T>>): T[] {
  return outcomes.flatMap((outcome) => outcome.status === 'fulfilled' ? [outcome.value] : []);
}

/** What the API answers to each request that failed: the status and code of the error response its route sends. */
export async function errorAnswers(outcomes: Array<PromiseSettledResult<unknown>>): Promise<Array<{ status: number; code: string }>> {
  const reasons = outcomes.flatMap((outcome) => outcome.status === 'rejected' ? [outcome.reason as unknown] : []);
  return Promise.all(reasons.map(async (reason) => {
    const response = errorResponse(reason, 'postgres-suite');
    const body = await response.json() as { code: string };
    return { status: response.status, code: body.code };
  }));
}

/** A verified account unique to the run, so its per-person locks never meet another run's or the app's. */
export function residentOf(run: PostgresRun, label: string): ResidentIdentity {
  return { id: `${label}-${run.id}`, email: `${label}.${run.id}@ringgg.test`, name: label, emailVerified: true };
}

/** A home created directly, with its own QR token and these residents. */
export async function seedHome(database: Database, name: string, residents: string[] = []): Promise<{ id: number; token: string }> {
  const [home] = (await database.query<{ id: number; token: string }>('INSERT INTO homes (name, token) VALUES ($1, $2) RETURNING id, token', [name, randomUUID()])).rows;
  for (const email of residents) await database.query('INSERT INTO home_members (home_id, email, invited_by) VALUES ($1, $2, $3)', [home.id, email, SEED_INVITER]);
  return home;
}

/** The pid of the backend a transaction runs on. */
export async function backendPid(transaction: Database) {
  return (await transaction.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
}

/**
 * One run of the suite on a real PostgreSQL: its own schema (migrated, dropped with everything in it at the end),
 * two app instances with production-sized pools, and a pool of its own for fixtures, checks and held locks.
 */
export interface PostgresRun {
  /** Random per run: the schemas, names, emails and push endpoints the run creates carry it. */
  id: string;
  /** The run's own schema, migrated to the current version. */
  schema: string;
  /** Two app instances on the run's schema, each with its own pool, as two servers of a deployment. */
  instances: Database[];
  /** Fixtures and checks on the run's schema, on a pool no instance uses. */
  admin: Database;
  /** Table `name` qualified with one of the run's schemas (its own by default), for statements that run elsewhere. */
  table(name: string, schema?: string): string;
  /** Another empty schema of the run, dropped with it. */
  createSchema(suffix: string): Promise<string>;
  /** Two app instances on another schema of the run. */
  instancesIn(schema: string): Database[];
  /** A pool configured like an instance's, closed with the run. */
  pool(): Pool;
  /**
   * Holds `lock` from its own connection while the requests run, until all of them wait behind it (directly or
   * behind each other), then rolls it back: they all reach the statement it blocks before any of them goes on.
   * Fails when they do not all queue, since the case would not be concurrent.
   */
  lineUp<T>(lock: Statement, requests: Array<() => Promise<T>>, schema?: string): Promise<Array<PromiseSettledResult<T>>>;
  /** Terminates a backend, as the server does when it restarts, and waits until it is gone. */
  terminate(pid: number): Promise<void>;
  /** Closes every pool and drops the schemas the run created, even when its tests failed. */
  close(): Promise<void>;
}

/** Opens a run against `url`; a run that cannot finish opening drops what it created. */
export async function openRun(url = TEST_POSTGRES_URL): Promise<PostgresRun> {
  if (!url) throw new Error(POSTGRES_SKIP_REASON);
  const id = randomBytes(RUN_ID_BYTES).toString('hex');
  const schema = `${RUN_SCHEMA_PREFIX}${id}`;
  const adminPool = createPostgresPool(url);
  const pools: Pool[] = [];
  const schemas: string[] = [];
  const pool = () => { const created = createPostgresPool(url); pools.push(created); return created; };
  const instancesIn = (name: string) => [inSchema(poolDatabase(pool()), name), inSchema(poolDatabase(pool()), name)];

  async function lineUp<T>(lock: Statement, requests: Array<() => Promise<T>>, lockSchema = schema) {
    const client = await adminPool.connect();
    let broken: Error | undefined;
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('search_path', $1, true)`, [quotedSchema(lockSchema)]);
      await client.query(...lock);
      const { pid } = (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0];
      const outcomes = Promise.allSettled(requests.map((request) => request()));
      const queued = await waitForQueue(adminPool, pid, requests.length, outcomes);
      await client.query('ROLLBACK');
      const settled = await outcomes;
      if (queued < requests.length) throw new Error(`PostgresRun:lineUp failed: ${queued} of ${requests.length} requests queued behind the lock`, { cause: settled });
      return settled;
    } catch (error) {
      // A client left inside the transaction would keep the lock; discarding it ends the transaction on the server.
      broken = error instanceof Error ? error : new Error('PostgresRun:lineUp failed', { cause: error });
      throw error;
    } finally { client.release(broken); }
  }

  async function terminate(pid: number) {
    await adminPool.query('SELECT pg_terminate_backend($1)', [pid]);
    const deadline = Date.now() + TERMINATION_TIMEOUT_MS;
    while ((await adminPool.query('SELECT 1 FROM pg_stat_activity WHERE pid = $1', [pid])).rows.length) {
      if (Date.now() > deadline) throw new Error(`PostgresRun:terminate failed: backend ${pid} still runs after ${TERMINATION_TIMEOUT_MS} ms`);
      await delay(LINE_UP.pollMs);
    }
  }

  async function createSchema(name: string) {
    await adminPool.query(`CREATE SCHEMA ${quotedSchema(name)}`);
    schemas.push(name);
    return name;
  }

  async function close() {
    const ended = await Promise.allSettled(pools.map((created) => created.end()));
    try {
      for (const name of schemas.toReversed()) await adminPool.query(`DROP SCHEMA IF EXISTS ${quotedSchema(name)} CASCADE`);
    } finally { await adminPool.end(); }
    const failed = ended.find((outcome) => outcome.status === 'rejected');
    if (failed) throw new Error('PostgresRun:close failed to end a pool', { cause: failed.reason });
  }

  const run: PostgresRun = {
    id, schema, admin: inSchema(poolDatabase(adminPool), schema), instances: instancesIn(schema),
    table: (name, tableSchema = schema) => `${quotedSchema(tableSchema)}.${name}`,
    createSchema: (suffix) => {
      if (!SCHEMA_SUFFIX_PATTERN.test(suffix)) throw new Error(`PostgresRun:createSchema failed: "${suffix}" is not lowercase letters`);
      return createSchema(`${schema}_${suffix}`);
    },
    instancesIn, pool, lineUp, terminate, close,
  };
  try {
    await createSchema(schema);
    await initialize(run.admin);
    return run;
  } catch (error) {
    // The failure to open is what the suite reports; one cleaning up after it is logged with the schema to drop.
    await close().catch((closeError: unknown) => { logError('PostgresRun.openRun.cleanup', closeError, { schema }); });
    throw error;
  }
}
