import { beforeEach, describe, expect, it } from 'vitest';
import { handleDisputeRequest, type DisputeDeps } from '../../lib/dispute/handler';
import { memoryLogger } from '../../lib/log';
import { FakeMailer, FakeRecords } from '../fakes/records';

const NOW = new Date('2026-11-06T06:00:00Z');
let db: FakeRecords;
let mail: FakeMailer;
let deps: DisputeDeps & { log: ReturnType<typeof memoryLogger> };

beforeEach(() => {
  db = new FakeRecords().seed({ booking_id: 'BK-TEST-1' }, { booking_id: 'BK-TEST-2', provider_id: 'osm:node/1', status: 'no_show' });
  mail = new FakeMailer();
  deps = { records: db, email: mail, now: () => NOW, log: memoryLogger(), newTicketId: () => 'TKT-1' };
});

const send = (body: Record<string, unknown>) => handleDisputeRequest({ booking_id: 'BK-TEST-1', user_email: 'customer@example.test', ...body }, deps);

describe('khadmat-dispute', () => {
  it('records a quality complaint: status disputed, flagged, previous status kept, email to the booking address', async () => {
    const res = await send({ dispute_type: 'quality_complaint', rating: 2, review: 'Leak is back' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'dispute_resolved', dispute_type: 'quality_complaint', workflow: 'WF6-QualityComplaint', email: 'sent' });
    expect(db.get('BK-TEST-1')).toMatchObject({ status: 'disputed', previous_status: 'confirmed', flagged_for_review: true, updated_at: NOW.toISOString() });
    expect(db.updates[0].ifStatus).toEqual(['confirmed']);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]).toMatchObject({ to: 'customer@example.test', subject: 'Dispute Update - Booking BK-TEST-1' });
  });

  it('defaults to a quality complaint, as n8n did', async () => {
    expect((await send({ rating: 4 })).body).toMatchObject({ dispute_type: 'quality_complaint' });
  });

  it.each([
    [{ dispute_type: 'refund_me' }, ['dispute_type']],
    [{ booking_id: '' }, ['booking_id']],
    [{ booking_id: 'BK-1&status=eq.x' }, ['booking_id']],
    [{ rating: 9 }, ['rating']],
    [{ charged_price_pkr: -5 }, ['charged_price_pkr']],
    [{ dispute_type: 'overrun' }, ['estimated_duration_mins', 'actual_duration_mins']],
    [{ customer_approved_overrun: 'yes please' }, ['customer_approved_overrun']],
  ])('rejects %j with 400 (n8n fell through to the overrun branch)', async (body, fields) => {
    const res = await send(body);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ status: 'validation_error', fields });
    expect(db.calls).toEqual([]);
  });

  it('404 for an unknown booking', async () => {
    expect((await send({ booking_id: 'BK-TEST-404' })).status).toBe(404);
    expect(db.updates).toEqual([]);
  });

  it('403 when the email does not match the booking, and nothing changes', async () => {
    const res = await send({ user_email: 'someone.else@example.test', rating: 1 });
    expect(res).toMatchObject({ status: 403, body: { status: 'forbidden' } });
    expect(db.updates).toEqual([]);
    expect(mail.sent).toEqual([]);
  });

  it('email comparison ignores case and spaces', async () => {
    expect((await send({ user_email: '  Customer@Example.TEST ', rating: 4 })).status).toBe(200);
  });

  it('uses the price on the booking, not the one in the request', async () => {
    const res = await send({ rating: 1, price_pkr: 999999 });
    expect(res.body).toMatchObject({ decision: { compensation: { refund_pkr: 1000 } } });
  });

  it('emails only the address on the booking, never one from the request body', async () => {
    db.rows[0].user_email = null;
    const res = await send({ user_email: 'victim@example.test', rating: 4 });
    expect(res.body).toMatchObject({ email: 'skipped' });
    expect(mail.sent).toEqual([]);
  });

  it('HTML-escapes values in the email', async () => {
    db.rows[0].provider_name = '<script>x</script>';
    await send({ rating: 4 });
    expect(mail.sent[0].html).not.toContain('<script>');
    expect(mail.sent[0].html).toContain('&lt;script&gt;');
  });

  it('no_show reads the provider history from the database', async () => {
    const res = await send({ dispute_type: 'no_show' });
    // BK-TEST-2 is already a no_show: 1 of 2 bookings = 50% -> suspension review.
    expect(res.body).toMatchObject({ status: 'dispute_resolved', decision: { provider_action: { cancellation_rate: 0.5, suspension_recommended: true } } });
    expect(db.calls).toContain('providerHistory');
    expect(db.get('BK-TEST-1')?.status).toBe('no_show');
  });

  it('repeating the same dispute answers again without a second update or email', async () => {
    await send({ rating: 2 });
    const again = await send({ rating: 2 });
    expect(again.body).toMatchObject({ already_recorded: true });
    expect(db.updates).toHaveLength(1);
    expect(mail.sent).toHaveLength(1);
  });

  it('409 when the booking changed between read and update (compare-and-set)', async () => {
    db.beforeUpdate = () => { db.rows[0].status = 'cancelled'; };
    const res = await send({ rating: 2 });
    expect(res).toMatchObject({ status: 409, body: { status: 'conflict', retryable: true } });
    expect(db.get('BK-TEST-1')?.status).toBe('cancelled');
    expect(mail.sent).toEqual([]);
  });

  it('503 when Supabase is down, and no email', async () => {
    db.failWhen = (op) => op === 'update';
    const res = await send({ rating: 2 });
    expect(res).toMatchObject({ status: 503, body: { status: 'service_unavailable', retryable: true } });
    expect(mail.sent).toEqual([]);
  });

  it('a failed email does not undo the dispute; the response says so', async () => {
    mail.fail = true;
    const res = await send({ rating: 2 });
    expect(res).toMatchObject({ status: 200, body: { email: 'failed' } });
    expect(db.get('BK-TEST-1')?.status).toBe('disputed');
    expect(deps.log.records.map((r) => r.event)).toContain('dispute.email_failed');
  });

  it('the frontend\'s "Other reason" complaint (text only, no rating) goes to a person', async () => {
    const res = await send({ dispute_type: 'quality_complaint', custom_reason: 'Provider was rude', review: 'Provider was rude' });
    expect(res.body).toMatchObject({ status: 'escalated_to_human', complaint_details: { severity: 'UNRATED', review_text: 'Provider was rude' } });
  });
});
