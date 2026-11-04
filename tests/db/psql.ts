import { spawnSync } from 'node:child_process';

// Drives a real Postgres through the psql CLI, so the migration files are
// tested exactly as they will be run. Values go in as psql variables and are
// read with :'name' (psql quotes them), never spliced into SQL text.

export interface PsqlResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export interface PsqlOptions {
  vars?: Record<string, string>;
  readOnly?: boolean;
}

function run(url: string, args: string[], { vars = {}, readOnly = false }: PsqlOptions, input?: string): PsqlResult {
  const varArgs = Object.entries(vars).flatMap(([k, v]) => ['-v', `${k}=${v}`]);
  const res = spawnSync('psql', [url, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', ...varArgs, ...args], {
    encoding: 'utf8',
    input,
    env: { ...process.env, PGOPTIONS: readOnly ? '-c default_transaction_read_only=on' : '' },
  });
  if (res.error) throw res.error;
  return { ok: res.status === 0, stdout: res.stdout.trim(), stderr: res.stderr.trim() };
}

/** Runs a .sql file. */
export function psqlFile(url: string, file: string, opts: PsqlOptions = {}): PsqlResult {
  return run(url, ['-f', file], opts);
}

/** Runs SQL written in the test, via stdin (psql only expands :'vars' there, not in -c). */
export function psql(url: string, sql: string, opts: PsqlOptions = {}): PsqlResult {
  return run(url, ['-f', '-'], opts, sql);
}

/** Like psql() but throws on failure and returns stdout. */
export function query(url: string, sql: string, opts: PsqlOptions = {}): string {
  const res = psql(url, sql, opts);
  if (!res.ok) throw new Error(`psql failed: ${res.stderr}`);
  return res.stdout;
}

/** These tests drop and recreate tables: refuse anything but a local server. */
export function assertLocal(url: string): void {
  const { hostname } = new URL(url);
  if (!['localhost', '127.0.0.1', '::1', '[::1]', ''].includes(hostname)) {
    throw new Error('TEST_DATABASE_URL must point at a local Postgres (localhost), never Supabase');
  }
}

export function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}
