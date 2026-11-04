import { describe, expect, it, vi } from 'vitest';
import { memoryLogger } from '../../lib/log';
import { createN8nForwarder, ENDPOINTS, routeProxy, type LocalHandler } from '../../lib/http/proxy';

const meta = { requestId: 'req-1' };

describe('routeProxy', () => {
  it('requires a known endpoint', async () => {
    const opts = { local: {}, forward: null, log: memoryLogger() };
    expect((await routeProxy({ action: 'confirm' }, opts, meta)).body).toMatchObject({
      status: 'validation_error', message: 'Endpoint is required', fields: ['endpoint'],
    });
    expect((await routeProxy({ endpoint: '../admin' }, opts, meta)).body).toMatchObject({
      status: 'validation_error', message: 'Unknown endpoint',
    });
    expect((await routeProxy(['khadmat-booking'], opts, meta)).status).toBe(400);
  });

  it('runs a ported endpoint in-process without the endpoint key', async () => {
    const booking = vi.fn<LocalHandler>(async () => ({ status: 200, body: { status: 'confirmed' } }));
    const forward = vi.fn();
    const res = await routeProxy(
      { endpoint: 'khadmat-booking', action: 'confirm', slot: '16:00' },
      { local: { 'khadmat-booking': booking }, forward, log: memoryLogger() },
      meta,
    );
    expect(res).toEqual({ status: 200, body: { status: 'confirmed' } });
    expect(booking).toHaveBeenCalledWith({ action: 'confirm', slot: '16:00' }, meta);
    expect(forward).not.toHaveBeenCalled();
  });

  it('forwards other endpoints when n8n is configured', async () => {
    const forward = vi.fn(async () => ({ status: 200, body: { status: 'success' } }));
    const res = await routeProxy({ endpoint: 'khadmat-intent', raw_message: 'AC kharab' }, { local: {}, forward, log: memoryLogger() }, meta);
    expect(res.body).toEqual({ status: 'success' });
    expect(forward).toHaveBeenCalledWith('khadmat-intent', { raw_message: 'AC kharab' });
  });

  it('answers 503 for an endpoint that is neither ported nor forwardable', async () => {
    const log = memoryLogger();
    const res = await routeProxy({ endpoint: 'khadmat-dispute' }, { local: {}, forward: null, log }, meta);
    expect(res).toEqual({
      status: 503,
      body: { endpoint: 'khadmat-dispute', retryable: false, status: 'service_unavailable', message: 'khadmat-dispute is not available yet.' },
    });
    expect(log.records[0]).toMatchObject({ event: 'proxy.endpoint_not_ported', endpoint: 'khadmat-dispute' });
  });

  it('knows every endpoint the frontend calls', () => {
    expect(ENDPOINTS).toContain('khadmat-booking');
    expect(ENDPOINTS).toHaveLength(7);
  });
});

describe('createN8nForwarder', () => {
  const now = () => new Date('2026-11-04T09:00:00.000Z');

  it('POSTs once to base/endpoint with the fields the Express proxy added', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify([{ status: 'success' }]), { status: 200 }));
    const forward = createN8nForwarder({ baseUrl: 'https://n8n.test/webhook/', fetch: fetchImpl, log: memoryLogger(), now });

    const res = await forward('khadmat-intent', { raw_message: 'AC kharab' });

    expect(res).toEqual({ status: 200, body: [{ status: 'success' }] });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://n8n.test/webhook/khadmat-intent');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      raw_message: 'AC kharab', message: 'AC kharab', timestamp: '2026-11-04T09:00:00.000Z', agent_id: 'khidmatgaar_v1',
    });
  });

  it('passes status codes and non-JSON bodies through', async () => {
    const forward = createN8nForwarder({
      baseUrl: 'https://n8n.test/webhook', log: memoryLogger(), now,
      fetch: async () => new Response('Workflow was started', { status: 202 }),
    });
    expect(await forward('khadmat-quality', {})).toEqual({ status: 202, body: 'Workflow was started' });
  });

  it.each([
    ['a network error', new TypeError('fetch failed'), 502],
    ['a timeout', Object.assign(new Error('aborted'), { name: 'TimeoutError' }), 504],
  ])('does not retry after %s', async (_label, error, status) => {
    const fetchImpl = vi.fn(async () => { throw error; });
    const log = memoryLogger();
    const forward = createN8nForwarder({ baseUrl: 'https://n8n.test/webhook', fetch: fetchImpl, log, now });

    const res = await forward('khadmat-reschedule', { booking_id: 'BK-TEST-1' });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(status);
    expect(res.body).toMatchObject({ status: 'service_unavailable', endpoint: 'khadmat-reschedule', retryable: true });
    expect(log.records.map((r) => r.event)).toEqual(['proxy.forward_failed']);
  });
});
