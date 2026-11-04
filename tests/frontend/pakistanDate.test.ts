import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pakistanDate } from '../../lib/booking/schedule';
import { pakistanToday } from '../../src/lib/pakistanDate';

describe('pakistanToday', () => {
  it.each([
    ['2026-11-04T19:30:00Z', '2026-11-05'], // 00:30 PKT: UTC still says the 4th
    ['2026-11-04T18:59:59Z', '2026-11-04'], // 23:59:59 PKT
    ['2026-11-04T19:00:00Z', '2026-11-05'], // midnight PKT
    ['2026-11-04T10:00:00Z', '2026-11-04'],
    ['2026-12-31T20:00:00Z', '2027-01-01'], // year rollover
    ['2028-02-28T19:00:00Z', '2028-02-29'], // leap day
  ])('%s -> %s', (instant, expected) => {
    expect(pakistanToday(new Date(instant))).toBe(expected);
  });

  it('agrees with the server-side pakistanDate() every 30 minutes for two days', () => {
    for (let t = Date.parse('2026-11-04T00:00:00Z'); t < Date.parse('2026-11-06T00:00:00Z'); t += 30 * 60 * 1000) {
      expect(pakistanToday(new Date(t))).toBe(pakistanDate(new Date(t)));
    }
  });

  it('is what MatchView uses for booking_date', () => {
    const view = readFileSync(resolve(__dirname, '../../src/views/MatchView.tsx'), 'utf8');
    expect(view).toContain('const today = pakistanToday();');
    expect(view).not.toMatch(/toISOString\(\)\.split\('T'\)\[0\]/);
  });
});
