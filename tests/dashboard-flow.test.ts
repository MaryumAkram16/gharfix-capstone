import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../lib/app';
import { handleScoreRefreshRequest } from '../lib/dashboard/refresh-http';
import type { LogRecord } from '../lib/log';
import { memoryLogger } from '../lib/log';

// WF8 through /api/proxy and WF8b through app.refreshScores, only HTTP faked.

const env = { SUPABASE_URL: 'https://project.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key-not-real' };
const rows = [
  { booking_id: 'BK-TEST-1', provider_id: 'osm:node/1', provider_name: 'Ali Plumbers', status: 'feedback_done', current_status: 'feedback_done', price_pkr: 2000, customer_rating: 5, user_email: 'a@example.test', slot: '16:00', booking_date: '2026-11-01' },
  { booking_id: 'BK-TEST-2', provider_id: 'google:ChIJx', provider_name: 'Bilal', status: 'confirmed', price_pkr: 1500, slot: '09:00', booking_date: '2026-11-01' },
];

function fake(opts: { fail?: boolean } = {}) {
  const requests: Array<{ method: string; url: URL; body?: any; headers: Record<string, string> }> = [];
  const fetchImpl = async (input: string, init: RequestInit) => {
    const url = new URL(input);
    requests.push({ method: String(init.method), url, body: init.body ? JSON.parse(String(init.body)) : undefined, headers: init.headers as Record<string, string> });
    if (url.pathname === '/rest/v1/workflow_incidents') return new Response('', { status: 201 });
    if (opts.fail) return new Response('', { status: 503 });
    if (url.pathname === '/rest/v1/provider_scores') return new Response('', { status: 201 });
    const or = url.searchParams.get('or') ?? '';
    if (or.includes('provider_id.eq.')) return Response.json(rows.filter((r) => or.includes(`"${r.provider_id}"`)));
    if (or.includes('status.in.')) return Response.json(rows.filter((r) => r.status === 'feedback_done'));
    return Response.json(rows);
  };
  return { requests, fetch: fetchImpl };
}

describe('khadmat-provider-dashboard through /api/proxy', () => {
  it('reads the provider with a quoted or-filter and answers the dashboard', async () => {
    const net = fake();
    const res = await createApp({ env, fetch: net.fetch, logSink: () => {} }).proxy({ endpoint: 'khadmat-provider-dashboard', provider_id: 'osm:node/1' }, { requestId: null });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'provider_dashboard', provider_id: 'osm:node/1', earnings: { total_completed_jobs: 1, total_earnings_pkr: 2000 }, reputation: { in_app_avg_rating: 5 } });
    const read = net.requests.find((r) => r.url.searchParams.get('or')?.includes('provider_id.eq'))!;
    expect(read.url.searchParams.get('or')).toBe('(provider_id.eq."osm:node/1",reassigned_to_provider_id.eq."osm:node/1")');
  });

  it('a crafted provider id stays inside its quotes', async () => {
    const net = fake();
    await createApp({ env, fetch: net.fetch, logSink: () => {} }).proxy({ endpoint: 'khadmat-provider-dashboard', provider_id: 'x),status.eq.confirmed,(a.eq."b' }, { requestId: null });
    expect(net.requests[0].url.searchParams.get('or')).toBe('(provider_id.eq."x),status.eq.confirmed,(a.eq.\\"b",reassigned_to_provider_id.eq."x),status.eq.confirmed,(a.eq.\\"b")');
  });

  it('400 without provider_id (n8n: validation_error), 503 with an incident when Supabase is down', async () => {
    const app = createApp({ env, fetch: fake().fetch, logSink: () => {} });
    expect(await app.proxy({ endpoint: 'khadmat-provider-dashboard' }, { requestId: null })).toMatchObject({ status: 400, body: { status: 'validation_error' } });
    const logs: LogRecord[] = [];
    const down = createApp({ env, fetch: fake({ fail: true }).fetch, logSink: (r) => logs.push(r) });
    expect((await down.proxy({ endpoint: 'khadmat-provider-dashboard', provider_id: 'osm:node/1' }, { requestId: null })).status).toBe(503);
    expect(logs.find((r) => r.event === 'incident.recorded')).toMatchObject({ workflow: 'khadmat-provider-dashboard', step: expect.stringMatching(/^supabase\./) });
  });
});

describe('nightly provider scores (WF8b)', () => {
  it('upserts one row per provider with merge-duplicates on provider_id', async () => {
    const net = fake();
    const result = await createApp({ env, fetch: net.fetch, logSink: () => {} }).refreshScores('req-n');
    expect(result).toEqual({ providers: 2, rows_written: 2 });
    const upsert = net.requests.find((r) => r.url.pathname === '/rest/v1/provider_scores')!;
    expect(upsert.url.searchParams.get('on_conflict')).toBe('provider_id');
    expect(upsert.headers.Prefer).toBe('resolution=merge-duplicates,return=minimal');
    expect(upsert.body.map((r: any) => r.provider_id).sort()).toEqual(['google:ChIJx', 'osm:node/1']);
    expect(upsert.body.find((r: any) => r.provider_id === 'osm:node/1')).toMatchObject({ total_completed_jobs: 1, avg_rating: 5 });
  });

  it('needs the CRON_SECRET bearer token', async () => {
    const run = async () => ({ providers: 0, rows_written: 0 });
    const log = memoryLogger();
    expect((await handleScoreRefreshRequest(null, 's3cret-value', run, null, log)).status).toBe(401);
    expect((await handleScoreRefreshRequest('Bearer wrong', 's3cret-value', run, null, log)).status).toBe(401);
    expect((await handleScoreRefreshRequest('Bearer s3cret-value', undefined, run, null, log)).status).toBe(500);
    expect(await handleScoreRefreshRequest('Bearer s3cret-value', 's3cret-value', run, null, log)).toEqual({ status: 200, body: { status: 'ok', providers: 0, rows_written: 0 } });
    expect((await handleScoreRefreshRequest('Bearer s3cret-value', 's3cret-value', async () => { throw new Error('db'); }, null, log)).status).toBe(503);
  });
});

describe('.github/workflows/provider-scores.yml', () => {
  const yml = readFileSync(resolve(__dirname, '../.github/workflows/provider-scores.yml'), 'utf8');
  it('runs nightly at 01:47 Pakistan time with secrets by name only, no permissions, no overlap', () => {
    expect(yml).toContain("- cron: '47 20 * * *'");
    expect(yml).toContain('PROVIDER_SCORES_URL: ${{ secrets.PROVIDER_SCORES_URL }}');
    expect(yml).toContain('CRON_SECRET: ${{ secrets.CRON_SECRET }}');
    expect(yml).toContain('--header "Authorization: Bearer ${CRON_SECRET}"');
    expect(yml).toMatch(/^permissions: \{\}$/m);
    expect(yml).toContain('cancel-in-progress: false');
    expect(yml).not.toMatch(/Bearer [A-Za-z0-9]{12,}/);
  });
});
