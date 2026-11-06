import { describe, expect, it } from 'vitest';
import { createApp } from '../lib/app';
import type { EmailMessage } from '../lib/email/types';

// khadmat-quality through /api/proxy, only HTTP faked: a PostgREST stand-in
// that applies the booking_id / status / current_status filters.

const env = { SUPABASE_URL: 'https://project.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key-not-real' };

function fakeSupabase(row: Record<string, any>) {
  const patches: Array<{ params: URLSearchParams; body: any }> = [];
  const matches = (p: URLSearchParams) => {
    if (p.get('booking_id') !== `eq.${row.booking_id}`) return false;
    const st = p.get('status');
    if (st && st !== `in.("${row.status}")`) return false;
    const cs = p.get('current_status');
    if (cs && !(cs === 'is.null' ? row.current_status == null : cs === `eq.${row.current_status}`)) return false;
    return true;
  };
  const fetchImpl = async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (url.pathname === '/rest/v1/workflow_incidents') return new Response('', { status: 201 });
    const p = url.searchParams;
    if (init.method === 'GET') {
      if (p.get('provider_id')) return Response.json([{ status: row.status }]);
      return Response.json(matches(p) ? [row] : []);
    }
    const body = JSON.parse(String(init.body));
    patches.push({ params: p, body });
    if (!matches(p)) return Response.json([]);
    Object.assign(row, body);
    return Response.json([row]);
  };
  return { patches, fetch: fetchImpl };
}

describe('khadmat-quality through /api/proxy', () => {
  it('tracks a booking to the end; a 1-star review is saved and escalated to WF6', async () => {
    const row = {
      booking_id: 'BK-TEST-88', status: 'confirmed', current_status: null, last_action: null, user_email: 'customer@example.test',
      user_name: 'Test', provider_id: 'osm:node/1', provider_name: 'Ali Plumbers', service_type: 'plumber', location: 'G-13',
      slot: '16:00', booking_date: '2026-11-06', price_pkr: 2000, provider_distance_km: 2, provider_rating: null, provider_review_count: null,
    };
    const net = fakeSupabase(row);
    const sent: EmailMessage[] = [];
    const app = createApp({ env, fetch: net.fetch, email: { send: async (m) => { sent.push(m); } }, logSink: () => {} });
    const call = (action: string, extra = {}) => app.proxy({ endpoint: 'khadmat-quality', action, booking_id: 'BK-TEST-88', user_email: 'customer@example.test', ...extra }, { requestId: null });

    for (const a of ['en_route', 'arrived', 'completed']) expect((await call(a)).status).toBe(200);
    const fb = await call('feedback', { rating: 1, review: 'nahi aaya time par, bakwaas' });
    expect(fb.body).toMatchObject({ status: 'feedback_saved_and_escalated', wf6_triggered: true });
    expect(row).toMatchObject({ status: 'disputed', previous_status: 'feedback_done', customer_rating: 1, tracking_locked: true });
    // The first stage was a compare-and-set on "not tracked yet".
    expect(net.patches[0].params.get('current_status')).toBe('is.null');
    expect(sent.map((m) => m.subject.split(' (')[0])).toEqual([
      'Your GharFix Provider is On the Way! 🚗', 'Your GharFix Provider Has Arrived! ✅', 'Your GharFix Service is Complete! 🎉', 'Dispute Update - Booking BK-TEST-88',
    ]);
  });
});
