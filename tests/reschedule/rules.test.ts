import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compensationFor, pickAlternative, selectSlot, timing } from '../../lib/reschedule/rules';

// Against the original n8n Code nodes from n8n-workflows/WF7_*.json.

const workflow = JSON.parse(readFileSync(resolve(__dirname, '../../n8n-workflows/WF7_Cancellation_Auto_Reschedule.json'), 'utf8')) as {
  nodes: Array<{ name: string; parameters: { jsCode?: string } }>;
};
function n8n(name: string) {
  const code = workflow.nodes.find((n) => n.name === name)?.parameters.jsCode;
  if (!code) throw new Error(`n8n node not found: ${name}`);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function('$', '$input', 'console', code) as (...a: unknown[]) => Array<{ json: any }>;
  return (input: unknown, nodes: Record<string, unknown> = {}) =>
    fn((n: string) => ({ first: () => ({ json: nodes[n] }) }), { first: () => ({ json: input }) }, { log: () => {} })[0].json;
}

const alt = (id: string, score: number | null) => ({ id, name: id, computed_score: score, rating: null, distance_km: null, estimated_arrival: null, availability_slots: [] });

describe('Alternative Picker', () => {
  it.each([[true, 1], [false, 2], [false, 11.9], [false, 12], [false, 30]])('compensation: urgent %s, %f h', (is_urgent, hours) => {
    const theirs = n8n('Alternative Picker')({ is_urgent, hours_until_booking: hours, alternatives: [] });
    expect(compensationFor({ is_urgent, hours_until_booking: hours, is_past: false })).toEqual(theirs.compensation);
  });

  it('picks the highest score, like n8n', () => {
    const alts = [alt('a', 60), alt('b', 81), alt('c', null), alt('d', 75)];
    const theirs = n8n('Alternative Picker')({ alternatives: alts });
    const ours = pickAlternative(alts, 'x');
    expect(ours.next?.id).toBe(theirs.next_best_provider.id);
    expect(ours.remaining.map((a) => a.id)).toEqual(theirs.remaining_alternatives.map((a: any) => a.id));
  });

  it('but skips the provider who cancelled (n8n could re-pick them)', () => {
    expect(pickAlternative([alt('osm:node/1', 99), alt('b', 50)], 'osm:node/1').next?.id).toBe('b');
  });
});

describe('Slot Selector', () => {
  const slots = [
    { time: '09:00', label: '9:00 AM', available: true },
    { time: '14:00', label: '2:00 PM', available: false },
    { time: '16:00', label: '4:00 PM', available: true },
  ];
  it.each([['16:00'], ['4:00 PM'], ['14:00'], ['11:00']])('original %s', (original) => {
    const theirs = n8n('Slot Selector')({ slots }, { 'Alternative Picker': { slot: original } });
    const ours = selectSlot(slots, original);
    if (original === '16:00') {
      // n8n compared "16:00" with the label "4:00 PM", missed, and moved the customer to 09:00.
      expect(theirs).toMatchObject({ kept_original_time: false, selected_slot: { time: '09:00' } });
      return;
    }
    expect(ours.selected?.time).toBe(theirs.selected_slot.time);
    expect(ours.keptOriginal).toBe(theirs.kept_original_time);
  });

  it('keeps "16:00" when 4 PM is free (n8n compared "16:00" with the label "4:00 PM" and missed it)', () => {
    expect(selectSlot(slots, '16:00')).toMatchObject({ selected: { time: '16:00' }, keptOriginal: true });
  });

  it('nothing free -> no selection', () => {
    expect(selectSlot(slots.map((s) => ({ ...s, available: false })), '09:00')).toMatchObject({ selected: null, free: 0 });
  });
});

describe('timing', () => {
  it('uses Pakistan time', () => {
    const now = new Date('2026-11-06T04:00:00Z'); // 09:00 PKT
    expect(timing('2026-11-06', '16:00', now)).toEqual({ hours_until_booking: 7, is_urgent: false, is_past: false });
    expect(timing('2026-11-06', '11:00', now)).toMatchObject({ hours_until_booking: 2, is_urgent: true });
    expect(timing('2026-11-06', '08:00', now)).toMatchObject({ is_past: true });
  });
});
