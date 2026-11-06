import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appointmentTime, decideDispute, type DisputeClaims, type DisputeFacts } from '../../lib/dispute/decide';

// The rules are checked against the original n8n Code nodes from
// n8n-workflows/WF6_*.json, run on the same inputs. Only inputs n8n had real
// values for are compared: where n8n invented a value (no rating, no charged
// price, no durations, a 12% cancellation rate) the port deliberately differs,
// and those cases are tested separately below.

const workflow = JSON.parse(readFileSync(resolve(__dirname, '../../n8n-workflows/WF6_Dispute_Escalation_Handler.json'), 'utf8')) as {
  nodes: Array<{ name: string; parameters: { jsCode?: string } }>;
};
function n8nNode(name: string) {
  const code = workflow.nodes.find((n) => n.name === name)?.parameters.jsCode;
  if (!code) throw new Error(`n8n node not found: ${name}`);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function('$', 'console', code) as (...args: unknown[]) => Array<{ json: any }>;
  const quiet = { log: () => {} };
  return (router: Record<string, unknown>) => fn(() => ({ first: () => ({ json: router }) }), quiet)[0].json;
}

const NOW = new Date('2026-11-06T06:00:00Z'); // 11:00 in Pakistan
const facts = (over: Partial<DisputeFacts> = {}): DisputeFacts => ({
  booking_id: 'BK-TEST-1', provider_id: 'osm:node/1', provider_name: 'Ali Plumbers', user_email: 'a@example.test', user_name: 'Ayesha',
  service_type: 'plumber', location: 'G-13', booking_date: '2026-11-06', slot: '16:00', price_pkr: 2000, final_price_pkr: null,
  customer_rating: null, feedback_sentiment: null, ...over,
});
const claims = (over: Partial<DisputeClaims>): DisputeClaims => ({
  dispute_type: 'quality_complaint', rating: null, review: '', sentiment: null, auto_escalated: false, charged_price_pkr: null,
  extra_charge_pkr: 0, customer_notified_before_overrun: false, customer_approved_overrun: false, estimated_duration_mins: null,
  actual_duration_mins: null, alternatives: [], ...over,
});
const ctx = (history: { total: number; noShowOrCancelled: number } | null = null) => ({ now: NOW, history, newTicketId: () => 'TKT-1' });
const asRouter = (f: DisputeFacts, extra: Record<string, unknown>) => ({ ...f, ...extra });

describe('price_disagreement matches n8n when the charged price is known', () => {
  const run = n8nNode('Price Disagreement Handler');
  it.each([1500, 2000, 2100, 2200, 2201, 2600, 2601, 5000])('quoted 2000, charged %i', (charged) => {
    const ours = decideDispute(facts({ final_price_pkr: charged }), claims({ dispute_type: 'price_disagreement' }), ctx());
    const theirs = run(asRouter(facts(), { final_price_pkr: charged }));
    expect(ours.price_analysis).toEqual(theirs.price_analysis);
    expect((ours.resolution as any).refund).toEqual(theirs.resolution.refund);
    expect(ours.customer_message).toBe(theirs.customer_message);
    expect(ours.status).toBe(theirs.status);
  });
});

describe('overrun matches n8n when both durations are sent', () => {
  const run = n8nNode('Overrun Handler');
  it.each([
    [{ approved: true, notified: true, extra: 800, est: 60, act: 200 }],
    [{ approved: false, notified: false, extra: 800, est: 60, act: 70 }],
    [{ approved: false, notified: false, extra: 0, est: 60, act: 70 }],
    [{ approved: false, notified: true, extra: 800, est: 60, act: 75 }],
    [{ approved: false, notified: true, extra: 100, est: 60, act: 75 }],
    [{ approved: false, notified: true, extra: 800, est: 60, act: 76 }],
  ])('%j', ({ approved, notified, extra, est, act }) => {
    const ours = decideDispute(facts(), claims({
      dispute_type: 'overrun', customer_approved_overrun: approved, customer_notified_before_overrun: notified,
      extra_charge_pkr: extra, estimated_duration_mins: est, actual_duration_mins: act,
    }), ctx());
    const theirs = run(asRouter(facts(), {
      customer_approved_overrun: approved, customer_notified_before_overrun: notified, extra_charge_pkr: extra,
      estimated_duration_mins: est, actual_duration_mins: act,
    }));
    expect(ours.resolution).toEqual(theirs.resolution);
    expect(ours.overrun_details).toEqual(theirs.overrun_details);
    expect(ours.customer_message).toBe(theirs.customer_message);
  });
});

describe('quality_complaint matches n8n when a rating is given', () => {
  const run = n8nNode('Quality Complaint Handler');
  it.each([[1, 'positive'], [2, 'negative'], [2, 'neutral'], [3, 'negative'], [4, null], [5, 'positive']] as const)('rating %i, sentiment %s', (rating, sentiment) => {
    const ours = decideDispute(facts(), claims({ rating, sentiment }), ctx());
    // n8n defaulted a missing sentiment to "negative"; pass what the port uses.
    const theirs = run(asRouter(facts(), { rating, sentiment: sentiment ?? 'none' }));
    expect(ours.status).toBe(theirs.status);
    expect((ours.decision as any).compensation).toEqual(theirs.decision.compensation);
    expect((ours.decision as any).provider_penalty.matching_score_delta).toBe(theirs.decision.provider_penalty.matching_score_delta);
    expect((ours.complaint_details as any).severity).toBe(theirs.complaint_details.severity);
    expect(ours.customer_message).toBe(theirs.customer_message);
  });

  it('takes the rating WF5 saved on the booking when the complaint has none', () => {
    const r = decideDispute(facts({ customer_rating: 1 }), claims({}), ctx());
    expect((r.complaint_details as any).severity).toBe('CRITICAL');
  });
});

describe('no_show matches n8n given the same cancellation rate', () => {
  const run = n8nNode('No Show Handler');
  it.each([[{ total: 10, noShowOrCancelled: 0 }], [{ total: 10, noShowOrCancelled: 2 }], [{ total: 10, noShowOrCancelled: 3 }]])('%j', (history) => {
    const ours = decideDispute(facts(), claims({ dispute_type: 'no_show' }), ctx(history));
    const theirs = run(asRouter(facts(), { provider_cancellation_rate: history.noShowOrCancelled / history.total }));
    expect((ours.decision as any).refund).toEqual(theirs.decision.refund);
    expect((ours.decision as any).provider_action.suspension_recommended).toBe(theirs.decision.provider_action.blacklisted);
    expect((ours.antigravity_trace as any).escalate_to_human).toBe(theirs.antigravity_trace.escalate_to_human);
    expect(ours.customer_message).toBe(theirs.customer_message);
  });
});

describe('provider_cancelled matches n8n on rebooking', () => {
  const run = n8nNode('Provider Cancelled Handler');
  const alt = { id: 'osm:node/2', name: 'Bilal Plumbing', computed_score: 81, rating: null, distance_km: 1.2, estimated_arrival: '20 mins', availability_slots: ['11:00'] };
  it.each([[[alt]], [[]]])('alternatives %j', (alternatives) => {
    const ours = decideDispute(facts(), claims({ dispute_type: 'provider_cancelled', alternatives }), ctx());
    const theirs = run(asRouter(facts(), { alternatives }));
    const pick = (r: any) => ({ ...r.rebooking, urgency: undefined });
    expect(pick(ours)).toEqual(pick(theirs));
  });
});

describe('where the port deliberately differs from n8n', () => {
  it('a complaint with no rating is not an automatic 50% refund: a person reviews it', () => {
    const r = decideDispute(facts(), claims({ review: 'Kaam acha nahi tha' }), ctx());
    expect(r.status).toBe('escalated_to_human');
    expect(r.decision).toMatchObject({ compensation: { refund_pkr: 0, eligible: false }, human_escalation: { required: true, ticket_id: 'TKT-1' } });
    // n8n: rating defaulted to 1 -> CRITICAL, PKR 1000 refund.
    expect(n8nNode('Quality Complaint Handler')(asRouter(facts(), { review: 'Kaam acha nahi tha' })).decision.compensation.refund_pkr).toBe(1000);
  });

  it('a price dispute with no known charged price goes to a person (n8n said "no overcharge")', () => {
    const r = decideDispute(facts(), claims({ dispute_type: 'price_disagreement' }), ctx());
    expect(r.status).toBe('escalated_to_human');
    expect((r.price_analysis as any).decision).toBe('NEEDS_REVIEW');
    expect(n8nNode('Price Disagreement Handler')(asRouter(facts(), {})).price_analysis.decision).toBe('NO_OVERCHARGE');
  });

  it('the final price recorded on the booking beats the customer figure', () => {
    const r = decideDispute(facts({ final_price_pkr: 2000 }), claims({ dispute_type: 'price_disagreement', charged_price_pkr: 9000 }), ctx());
    expect((r.price_analysis as any).decision).toBe('NO_OVERCHARGE');
  });

  it('no_show uses the real history: a first offence is a warning even though n8n assumed 12%', () => {
    const r = decideDispute(facts(), claims({ dispute_type: 'no_show' }), ctx({ total: 1, noShowOrCancelled: 0 }));
    expect((r.decision as any).provider_action).toMatchObject({ cancellation_rate: 0, cancellation_rate_updated: 1, suspension_recommended: false, blacklisted: false });
  });

  it('urgency uses the booked slot in Pakistan time (n8n: midnight UTC)', () => {
    // Booked 16:00 PKT today, now 11:00 PKT: 5 h away, not urgent. n8n saw midnight UTC (11 h ago) and called it urgent.
    const later = decideDispute(facts({ slot: '16:00' }), claims({ dispute_type: 'provider_cancelled' }), ctx());
    expect((later.compensation as any).eligible).toBe(false);
    expect(n8nNode('Provider Cancelled Handler')(asRouter(facts(), {})).compensation.eligible).toBe(true);
    const soon = decideDispute(facts({ slot: '1:00 PM' }), claims({ dispute_type: 'provider_cancelled' }), ctx());
    expect((soon.compensation as any)).toMatchObject({ eligible: true, amount_pkr: 200 });
  });

  it('messages say GharFix', () => {
    for (const dispute_type of ['no_show', 'provider_cancelled', 'quality_complaint', 'price_disagreement'] as const) {
      const r = decideDispute(facts(), claims({ dispute_type, rating: 2 }), ctx({ total: 1, noShowOrCancelled: 0 }));
      expect(String(r.simulated_whatsapp)).toContain('GharFix');
      expect(JSON.stringify(r)).not.toContain('Khadmat');
    }
  });
});

describe('appointmentTime', () => {
  it('reads the date and slot as Pakistan time', () => {
    expect(appointmentTime('2026-11-06', '16:00')?.toISOString()).toBe('2026-11-06T11:00:00.000Z');
    expect(appointmentTime('2026-11-06', '4:00 PM')?.toISOString()).toBe('2026-11-06T11:00:00.000Z');
    expect(appointmentTime('2026-11-06', null)?.toISOString()).toBe('2026-11-05T19:00:00.000Z');
    expect(appointmentTime('next week', '16:00')).toBeNull();
  });
});
