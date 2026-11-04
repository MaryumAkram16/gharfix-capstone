import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { afterAll, describe, expect, it } from 'vitest';

// Vercel compiles each api/*.ts to ESM (package.json has "type": "module")
// without bundling, and Node's ESM loader needs real file extensions.
// Vitest resolves './slot' happily, so it cannot catch a missing '.js'.
// This test transpiles api/ and lib/ file by file, then imports the
// functions in a plain Node process and calls them.

const root = resolve(__dirname, '../..');
// Inside the project so bare imports (e.g. nodemailer) resolve from node_modules.
const out = join(root, 'node_modules', '.cache', `esm-smoke-${process.pid}`);

function tsFiles(dir: string): string[] {
  return (readdirSync(join(root, dir), { recursive: true }) as string[])
    .filter((f) => f.endsWith('.ts'))
    .map((f) => join(dir, f));
}

afterAll(() => rmSync(out, { recursive: true, force: true }));

describe('api/ in plain Node ESM', () => {
  it('imports and answers requests without a bundler', async () => {
    await build({
      absWorkingDir: root,
      // src/lib/intent.ts is the keyword parser the server falls back to.
      entryPoints: [...tsFiles('api'), ...tsFiles('lib'), 'src/lib/intent.ts'],
      outdir: out,
      outbase: '.',
      bundle: false,
      format: 'esm',
      platform: 'node',
      target: 'node20',
      logLevel: 'silent',
    });
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'package.json'), JSON.stringify({ type: 'module' }));
    // Data files imported by lib/ must ship next to it (Vercel traces the static import).
    mkdirSync(join(out, 'db', 'seed'), { recursive: true });
    copyFileSync(join(root, 'db', 'seed', 'demo_providers.json'), join(out, 'db', 'seed', 'demo_providers.json'));

    const script = `
      const call = async (file, body) => {
        const { POST } = await import(${JSON.stringify(out)} + '/api/' + file);
        const res = await POST(new Request('https://gharfix.test/api/' + file, { method: 'POST', body: JSON.stringify(body) }));
        return [res.status, await res.json()];
      };
      const proxy = await call('proxy.js', { endpoint: 'khadmat-nope' });
      const booking = await call('booking.js', { action: 'confirm' });
      // No network needed: no Gemini key (keyword parser), and no services means no map lookup.
      const intent = await call('intent.js', { raw_message: 'hello' });
      const match = await call('provider-match.js', { location: 'G-13' });
      const { GET: reconcile } = await import(${JSON.stringify(out)} + '/api/reconcile.js');
      const r1 = await reconcile(new Request('https://gharfix.test/api/reconcile'));
      process.env.CRON_SECRET = 'smoke-secret-not-real';
      const r2 = await reconcile(new Request('https://gharfix.test/api/reconcile', { headers: { authorization: 'Bearer wrong' } }));
      const reconcileStatus = [r1.status, r2.status];
      const { loadDemoDataset } = await import(${JSON.stringify(out)} + '/lib/matching/demo.js');
      const demo = (await loadDemoDataset()).providers.length;
      console.log(JSON.stringify({ proxy, booking, intent, match, demo, reconcileStatus }));
    `;
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => !k.startsWith('SUPABASE_') && !k.startsWith('N8N_') && !k.startsWith('GMAIL_') && !k.startsWith('GEMINI_') && k !== 'CRON_SECRET'),
    );
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', env });

    expect(child.stderr).not.toContain('ERR_MODULE_NOT_FOUND');
    expect(child.status).toBe(0);
    const result = JSON.parse(child.stdout.trim().split('\n').pop()!);
    expect(result.proxy).toEqual([400, { status: 'validation_error', message: 'Unknown endpoint', fields: ['endpoint'] }]);
    // No Supabase env in the child: a logged config error and a generic 500.
    expect(result.booking).toEqual([500, { status: 'internal_error', message: 'Something went wrong. Please try again.' }]);
    expect(child.stderr).toContain('booking.config_error');
    expect(result.intent[0]).toBe(200);
    expect(result.intent[1]).toMatchObject({ status: 'clarification_needed', intent_source: 'keyword_fallback' });
    expect(result.match).toEqual([200, expect.objectContaining({ status: 'error', message: 'No services found in match result' })]);
    // The demo seed loads through a JSON import attribute in plain Node ESM.
    expect(result.demo).toBeGreaterThanOrEqual(16);
    // api/reconcile: 500 without CRON_SECRET, 401 with a wrong token.
    expect(result.reconcileStatus).toEqual([500, 401]);
  }, 30_000);
});
