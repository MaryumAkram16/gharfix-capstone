import { beforeEach, describe, expect, it } from 'vitest';
import { handleDisputeRequest } from '../../lib/dispute/handler';
import { memoryLogger } from '../../lib/log';
import { handleQualityRequest, type QualityDeps } from '../../lib/quality/handler';
import { FakeMailer, FakeRecords } from '../fakes/records';

let now = new Date('2026-11-06T06:00:00Z');
let db: FakeRecords;
let mail: FakeMailer;
let deps: QualityDeps & { log: ReturnType<typeof memoryLogger> };
let escalations: Array<Record<string, unknown>>;

beforeEach(() => {
  now = new Date('2026-11-06T06:00:00Z');
  db = new FakeRecords().seed({ booking_id: 'BK-TEST-5', provider_distance_km: 4.2, provider_rating: 4.5, provider_review_count: 10, current_status: null, last_action: null });
  mail = new FakeMailer();
  escalations = [];
  const log = memoryLogger();
  deps = {
    records: db, email: mail, now: () => now, log,
    escalate: async (b) => { escalations.push(b); return handleDisputeRequest(b, { records: db, email: mail, now: () => now, log, newTicketId: () => 'TKT-1' }); },
  };
});

const step = (action: string, extra: Record<string, unknown> = {}) =>
  handleQualityRequest({ action, booking_id: 'BK-TEST-5', user_email: 'customer@example.test', ...extra }, deps);

describe('khadmat-quality', () => {
  it('runs en_route -> arrived -> completed -> feedback, saving each stage and emailing each', async () => {
    const a = await step('en_route', { distance_km: 7 });
    expect(a).toMatchObject({ status: 200, body: { status: 'en_route', eta_minutes: 18, workflow: 'WF5-EnRoute', email: 'sent' } });
    expect(db.get('BK-TEST-5')).toMatchObject({ current_status: 'en_route', last_action: 'en_route', eta_minutes: 18, trace_key: 'BK-TEST-5-en_route' });
    expect(db.updates[0].guard).toEqual({ status: ['confirmed'], current_status: null });

    now = new Date('2026-11-06T06:20:00Z');
    expect((await step('arrived')).body).toMatchObject({ status: 'arrived', arrival_time: '11:20' });
    now = new Date('2026-11-06T07:05:00Z');
    expect((await step('completed', { final_price_pkr: 99999 })).body).toMatchObject({ status: 'completed', duration: '45 minutes', payment: { final_pkr: 2000, quoted_pkr: 2000 } });
    const fb = await step('feedback', { rating: 5, review: 'Zabardast, professional' });
    expect(fb.body).toMatchObject({
      status: 'feedback_saved', tracking_locked: true, show_feedback_button: false, customer_message: expect.stringContaining('5-star'),
      reputation_update: { old_rating: 4.5, new_rating: 4.55, review_count_new: 11 }, feedback: { workflow: 'WF5-Feedback' },
    });
    expect(db.get('BK-TEST-5')).toMatchObject({ status: 'feedback_done', tracking_locked: true, customer_rating: 5, feedback_sentiment: 'positive', provider_new_rating: 4.55 });
    expect(mail.sent.map((m) => m.subject)).toEqual([
      'Your GharFix Provider is On the Way! 🚗 (Booking ID: BK-TEST-5)',
      'Your GharFix Provider Has Arrived! ✅ (Booking ID: BK-TEST-5)',
      'Your GharFix Service is Complete! 🎉 (Booking ID: BK-TEST-5)',
      'Thank You for Your Feedback! 🙏 (Booking ID: BK-TEST-5)',
    ]);
    expect(escalations).toEqual([]);

    // Locked afterwards, as n8n's tracking_locked response.
    expect((await step('en_route')).body).toMatchObject({ status: 'tracking_locked', tracking_locked: true, show_track_button: false });
  });

  it('a browser-sent final_price_pkr is never saved', async () => {
    db.rows[0].current_status = 'arrived'; db.rows[0].last_action = 'arrived';
    await step('completed', { final_price_pkr: 99999 });
    expect(db.updates[0].patch).not.toHaveProperty('final_price_pkr');
  });

  it('reopening a stage answers it again, without saving or emailing (n8n: blocked_duplicate)', async () => {
    await step('en_route');
    const again = await step('en_route');
    expect(again).toMatchObject({ status: 200, body: { status: 'en_route', already_recorded: true } });
    expect(db.updates).toHaveLength(1);
    expect(mail.sent).toHaveLength(1);
  });

  it('out of order is a 409 blocked_invalid_state, and nothing is saved', async () => {
    const res = await step('feedback', { rating: 5 });
    expect(res).toMatchObject({ status: 409, body: { status: 'blocked_invalid_state', booking_id: 'BK-TEST-5' } });
    expect(db.updates).toEqual([]);
  });

  it('a disputed booking cannot be tracked', async () => {
    db.rows[0].status = 'disputed';
    expect((await step('en_route')).status).toBe(409);
  });

  it('low feedback is saved, then escalated to WF6 in-process with the booking email', async () => {
    db.rows[0].current_status = 'completed'; db.rows[0].last_action = 'completed';
    const res = await step('feedback', { rating: 1, review: 'Bakwaas kaam, late aaya' });
    expect(res.body).toMatchObject({ status: 'feedback_saved_and_escalated', wf6_triggered: true, escalate_to_wf6: true, dispute: { status: 'escalated_to_human', complaint_details: { severity: 'CRITICAL', auto_escalated_from_wf5: true } } });
    expect(escalations[0]).toMatchObject({ dispute_type: 'quality_complaint', auto_escalated: true, rating: 1, user_email: 'customer@example.test' });
    // Feedback first, then the dispute: status disputed, previous status feedback_done.
    expect(db.get('BK-TEST-5')).toMatchObject({ status: 'disputed', previous_status: 'feedback_done', customer_rating: 1, tracking_locked: true });
    // Only the dispute email (n8n sent no thank-you on the escalation path).
    expect(mail.sent.map((m) => m.subject)).toEqual(['Dispute Update - Booking BK-TEST-5']);
  });

  it('feedback stays saved when the escalation fails', async () => {
    db.rows[0].current_status = 'completed'; db.rows[0].last_action = 'completed';
    deps.escalate = async () => ({ status: 503, body: {} });
    const res = await step('feedback', { rating: 2 });
    expect(res.body).toMatchObject({ status: 'feedback_saved', wf6_triggered: false, escalation_failed: true });
    expect(db.get('BK-TEST-5')?.status).toBe('feedback_done');
  });

  it.each([
    [{ action: 'teleport' }, ['action']],
    [{ action: 'feedback' }, ['rating']],
    [{ action: 'feedback', rating: 6 }, ['rating']],
    [{ action: 'feedback', rating: 4, image_base64_array: ['a', 'b', 'c', 'd'] }, ['image_base64_array']],
    [{ booking_id: '../x' }, ['booking_id']],
  ])('rejects %j with 400', async (extra, fields) => {
    const res = await step(String((extra as Record<string, unknown>).action ?? 'en_route'), extra);
    expect(res).toMatchObject({ status: 400, body: { fields } });
  });

  it('keeps only real image data URLs', async () => {
    db.rows[0].current_status = 'completed'; db.rows[0].last_action = 'completed';
    const jpeg = 'data:image/jpeg;base64,' + 'A'.repeat(200);
    const res = await step('feedback', { rating: 4, image_base64_array: [jpeg, 'x'.repeat(200), 'data:text/html;base64,' + 'A'.repeat(200)] });
    expect(res.body).toMatchObject({ images_attached: 1, has_image_evidence: true });
    expect(JSON.parse(db.get('BK-TEST-5')!.image_base64_data as string)).toEqual([jpeg]);
    expect(JSON.stringify(res.body)).not.toContain('AAAAAAAAAA'); // images are not echoed back
  });

  it('403 for another email; 404 for an unknown booking; 503 when Supabase is down', async () => {
    expect((await step('en_route', { user_email: 'x@example.test' })).status).toBe(403);
    expect((await step('en_route', { booking_id: 'BK-TEST-404' })).status).toBe(404);
    db.failWhen = () => true;
    expect((await step('en_route')).status).toBe(503);
  });

  it('409 when another request moved the booking first (compare-and-set)', async () => {
    db.beforeUpdate = () => { db.rows[0].current_status = 'en_route'; };
    expect((await step('en_route')).body).toMatchObject({ status: 'conflict', retryable: true });
    expect(mail.sent).toEqual([]);
  });
});
