import { describe, expect, it } from 'vitest';
import { readJsonBody, requestIdOf, toResponse } from '../../lib/http/web';

const post = (body: string, headers: Record<string, string> = {}) =>
  new Request('https://gharfix.test/api/booking', { method: 'POST', body, headers });

describe('readJsonBody', () => {
  it('parses JSON and reads an empty body as {}', async () => {
    expect(await readJsonBody(post('{"action":"confirm"}'), 1000)).toEqual({ value: { action: 'confirm' }, error: null });
    expect(await readJsonBody(post(''), 1000)).toEqual({ value: {}, error: null });
  });

  it('rejects invalid JSON with a 400 validation_error', async () => {
    const res = await readJsonBody(post('{"action":'), 1000);
    expect(res).toEqual({
      value: null,
      error: { status: 400, body: { status: 'validation_error', message: 'Request body must be valid JSON', fields: ['body'] } },
    });
  });

  it('rejects bodies over the limit with 413, by header or by actual size', async () => {
    const big = JSON.stringify({ note: 'x'.repeat(200) });
    const byHeader = await readJsonBody(post('{}', { 'content-length': '5000' }), 100);
    const bySize = await readJsonBody(post(big), 100);
    for (const res of [byHeader, bySize]) {
      expect(res.error?.status).toBe(413);
    }
  });
});

describe('toResponse', () => {
  it('sends JSON with no-store', async () => {
    const res = toResponse({ status: 409, body: { status: 'slot_taken' } });
    expect(res.status).toBe(409);
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ status: 'slot_taken' });
  });

  it('passes a text body through as text', async () => {
    const res = toResponse({ status: 200, body: 'OK' });
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await res.text()).toBe('OK');
  });
});

describe('requestIdOf', () => {
  it('reads x-vercel-id', () => {
    expect(requestIdOf(post('', { 'x-vercel-id': 'bom1::abc' }))).toBe('bom1::abc');
    expect(requestIdOf(post(''))).toBeNull();
  });
});
