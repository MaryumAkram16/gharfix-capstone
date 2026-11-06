import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { arrived, checklistFor, completed, enRoute, feedback, guardStage, pktClock, type StageFacts } from '../../lib/quality/stages';
import type { BookingRecord } from '../../lib/booking/records';

// Checked against the original n8n Code nodes from n8n-workflows/WF5_*.json
// on the same inputs. Clock-based fields (n8n used the server's local time)
// and n8n's invented inputs are compared separately.

const workflow = JSON.parse(readFileSync(resolve(__dirname, '../../n8n-workflows/WF5_Service_Quality_Loop.json'), 'utf8')) as {
  nodes: Array<{ name: string; parameters: { jsCode?: string } }>;
};
function n8n(name: string) {
  const code = workflow.nodes.find((n) => n.name === name)?.parameters.jsCode;
  if (!code) throw new Error(`n8n node not found: ${name}`);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function('$', '$input', 'console', code) as (...a: unknown[]) => Array<{ json: any }>;
  return (data: Record<string, unknown>) => fn(() => ({ first: () => ({ json: data }) }), { first: () => ({ json: data }) }, { log: () => {} })[0].json;
}

const NOW = new Date('2026-11-06T06:00:00Z');
const f = (over: Partial<StageFacts> = {}): StageFacts => ({
  booking_id: 'BK-TEST-5', provider_id: 'osm:node/1', provider_name: 'Ali Plumbers', service_type: 'plumber', location: 'G-13',
  user_email: 'customer@example.test', price_pkr: 1800, final_price_pkr: null, distance_km: 4.2, provider_rating: 4.1,
  provider_review_count: 28, arrival_time: null, ...over,
});
const asN8n = (x: StageFacts, extra: Record<string, unknown> = {}) => ({ ...x, ...extra });

describe('en_route matches n8n when the distance is known', () => {
  it.each([0.5, 1.6, 4.2, 5, 12.3])('%f km', (km) => {
    const ours = enRoute(f({ distance_km: km }), NOW).body;
    const theirs = n8n('En Route Update')(asN8n(f({ distance_km: km })));
    expect(ours.eta_minutes).toBe(theirs.eta_minutes);
    expect(ours.checklist_reminder).toEqual(theirs.checklist_reminder);
    for (const k of ['status', 'booking_id', 'provider_name', 'service_type', 'customer_location', 'live_tracking_simulated', 'workflow']) expect(ours[k]).toEqual(theirs[k]);
  });

  it('with no distance: no ETA, instead of n8n\'s random 5-15 km', () => {
    const ours = enRoute(f({ distance_km: null }), NOW);
    expect(ours.body).toMatchObject({ eta_minutes: null, estimated_arrival_time: null });
    expect(ours.patch.eta_minutes).toBeNull();
    const a = n8n('En Route Update')(asN8n(f({ distance_km: null }))).eta_minutes;
    expect(a).toBeGreaterThanOrEqual(20); // 5..15 km * 3 + 5: invented
  });

  it('arrival time is Pakistan time', () => {
    expect(enRoute(f({ distance_km: 5 }), NOW).body.estimated_arrival_time).toBe('11:20');
    expect(pktClock(NOW)).toBe('11:00');
  });
});

describe('arrived matches n8n checklists', () => {
  it.each(['plumber', 'Electrician', 'AC installation', 'split AC gas refill', 'painter'])('%s', (service) => {
    const ours = arrived(f({ service_type: service }), NOW).body;
    const theirs = n8n('Arrived — Build Checklist')(asN8n(f({ service_type: service })));
    expect(ours.service_checklist).toEqual(theirs.service_checklist);
  });

  it('an unknown service gets a generic checklist, not the AC-repair one', () => {
    expect(checklistFor('tutor')[0]).toBe('Confirm the job with the customer');
    expect(n8n('Arrived — Build Checklist')(asN8n(f({ service_type: 'tutor' }))).service_checklist[0].task).toBe('Check power supply & thermostat');
  });
});

describe('completed matches n8n on payment', () => {
  it.each([[null], [1800], [2300], [1500]])('final price on the booking %s', (final) => {
    const ours = completed(f({ final_price_pkr: final }), { before_photo_url: null, after_photo_url: null, checklist_completed: true }, NOW).body;
    const theirs = n8n('Service Completed — Summary')(asN8n(f(), { final_price_pkr: final ?? undefined, checklist_completed: true }));
    expect(ours.payment).toEqual(theirs.payment);
    expect(ours.feedback_payload_example).toEqual(theirs.feedback_payload_example);
    expect(ours.checklist_completed).toBe(true);
  });

  it('duration comes from the saved arrival timestamp', () => {
    expect(completed(f({ arrival_time: '2026-11-06T05:15:00' }), { before_photo_url: null, after_photo_url: null, checklist_completed: false }, NOW).body.duration).toBe('45 minutes');
    expect(completed(f(), { before_photo_url: null, after_photo_url: null, checklist_completed: false }, NOW).body.duration).toBe('Not recorded');
  });
});

describe('feedback matches n8n given the same old rating (n8n always used 4.1 over 28 reviews)', () => {
  it.each([
    [5, 'Bahut acha aur professional kaam, waqt par'],
    [4, ''],
    [3, 'theek tha'],
    [3, 'late aaya aur kaam slow tha'],
    [2, 'acha tha'],
    [1, 'bakwaas, nahi aaya'],
    [4, 'worst, bad, kharab'],
  ])('rating %i "%s"', (rating, review) => {
    const ours = feedback(f(), { rating, review, transcript_text: '', transcript_included: false, images: [] }, NOW, 'confirmed').body;
    const theirs = n8n('Feedback Processor')(asN8n(f(), { rating, review }));
    for (const k of ['submitted_rating', 'sentiment', 'sentiment_signals', 'reputation_update', 'matching_impact', 'escalate_to_wf6', 'escalation_reason', 'customer_message', 'evidence_summary']) {
      expect(ours[k], k).toEqual(theirs[k]);
    }
  });

  it('a provider with no rating on record: the first rating is the rating, not (4.1*28+r)/29', () => {
    const r = feedback(f({ provider_rating: null, provider_review_count: null }), { rating: 2, review: '', transcript_text: '', transcript_included: false, images: [] }, NOW, 'confirmed');
    expect(r.body.reputation_update).toEqual({ old_rating: null, new_rating: 2, delta: null, review_count_new: 1, direction: 'First rating on record' });
    expect(r.patch).toMatchObject({ provider_new_rating: 2, status: 'feedback_done', previous_status: 'confirmed', tracking_locked: true, flagged_for_review: true });
    expect(r.escalate).toBe(true);
  });
});

describe('Trace Guard', () => {
  const row = (over: Partial<BookingRecord>): BookingRecord => ({ booking_id: 'B', status: 'confirmed', current_status: null, last_action: null, ...over } as BookingRecord);
  it('allows the stages in order only', () => {
    expect(guardStage(row({}), 'en_route').kind).toBe('allow');
    expect(guardStage(row({}), 'arrived').kind).toBe('invalid_state');
    expect(guardStage(row({ current_status: 'en_route', last_action: 'en_route' }), 'arrived').kind).toBe('allow');
    expect(guardStage(row({ current_status: 'arrived', last_action: 'arrived' }), 'feedback').kind).toBe('invalid_state');
    expect(guardStage(row({ current_status: 'completed', last_action: 'completed' }), 'feedback').kind).toBe('allow');
  });
  it('a repeat is a repeat; feedback locks; disputed bookings are not tracked', () => {
    expect(guardStage(row({ current_status: 'en_route', last_action: 'en_route' }), 'en_route').kind).toBe('repeat');
    expect(guardStage(row({ status: 'feedback_done' }), 'en_route').kind).toBe('locked');
    expect(guardStage(row({ tracking_locked: true }), 'feedback').kind).toBe('locked');
    expect(guardStage(row({ status: 'disputed' }), 'en_route').kind).toBe('invalid_state');
  });
});
