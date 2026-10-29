import { test, expect } from 'vitest';
import { getPostgresConfig } from '../src/config/database';
import { terminal } from '../scripts/utils/terminal';
import { spawnSync } from 'node:child_process';

test('la conexión de Neon conserva credenciales y usa TLS verificado con pool acotado', () => {
  const input = 'postgresql://resident:p%40ss@ep-test-pooler.us-east-2.aws.neon.tech/ringgg?sslmode=require&channel_binding=require';
  const config = getPostgresConfig(input);
  const url = new URL(config.connectionString!);
  expect(url.username).toBe('resident');
  expect(url.password).toBe('p%40ss');
  expect(url.searchParams.get('sslmode')).toBe('verify-full');
  expect(url.searchParams.get('channel_binding')).toBe('require');
  expect(config.max).toBe(3);
  expect(config.connectionTimeoutMillis).toBeGreaterThan(0);
  expect(config.enableChannelBinding).toBe(true);
});

test('PostgreSQL local conserva su configuración explícita y rechaza URLs que no son PostgreSQL', () => {
  expect(getPostgresConfig('postgres://resident:password@localhost:5432/ringgg?sslmode=disable').connectionString).toContain('sslmode=disable');
  expect(() => getPostgresConfig('https://private-user:private-password@example.com/db')).toThrow('protocolo PostgreSQL');
  expect(() => getPostgresConfig('postgres://localhost')).toThrow('usuario y base');
});

test('el CLI real falla sin credenciales con salida plana y sin imprimir datos sensibles', () => {
  const result = spawnSync(process.execPath, ['--import=tsx', 'scripts/check-database.ts'], { encoding: 'utf8', env: { ...process.env, DATABASE_URL: '', NO_COLOR: '1' } });
  expect(result.status).toBe(1);
  expect(result.stdout).toContain('Falta DATABASE_URL');
  expect(result.stdout).not.toContain('\u001b');
  const invalid = spawnSync(process.execPath, ['--import=tsx', 'scripts/check-database.ts'], { encoding: 'utf8', env: { ...process.env, DATABASE_URL: 'https://private-user:private-password@example.com/db', NO_COLOR: '1' } });
  expect(invalid.status).toBe(1);
  expect(invalid.stdout).not.toContain('private-password');
  expect(invalid.stderr).not.toContain('private-password');
});

test('el helper permite color en TTY, respeta NO_COLOR y limpia la línea al fallar', async () => {
  let output = '';
  const stream = { isTTY: true, write: (message: string) => { output += message; } };
  terminal(stream, { NO_COLOR: '' }).success('OK');
  expect(output).toBe('OK\n');
  output = '';
  const ui = terminal(stream, {});
  ui.success('OK');
  expect(output).toContain('\u001b[32m');
  await expect(ui.wait('Conectando', async () => { throw new Error('provider unreachable'); })).rejects.toThrow('provider unreachable');
  expect(output.endsWith('\r\u001b[2K')).toBe(true);
});
