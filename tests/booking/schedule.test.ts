import { describe, expect, it } from 'vitest';
import {
  addDays, alternativeDates, buildSlotList, conflictBetween, DEFAULT_SLOTS,
  findConflict, pakistanDate, serviceBlock,
} from '../../lib/booking/schedule';

describe('serviceBlock', () => {
  it('matches service names case-insensitively and adds the travel buffer', () => {
    expect(serviceBlock('AC Repair')).toEqual({ jobDurationMins: 120, travelBufferMins: 30, totalBlockMins: 150 });
    expect(serviceBlock('emergency plumber')).toEqual({ jobDurationMins: 90, travelBufferMins: 30, totalBlockMins: 120 });
  });

  it('falls back to 90 minutes for unknown or missing services', () => {
    expect(serviceBlock('dog walking').totalBlockMins).toBe(120);
    expect(serviceBlock(undefined).totalBlockMins).toBe(120);
  });
});

describe('conflictBetween', () => {
  const block = 120;
  it.each([
    ['10:00', '10:00', 'booked'],
    ['11:00', '10:00', 'buffer_after_earlier'],
    ['11:59', '10:00', 'buffer_after_earlier'],
    ['12:00', '10:00', null],
    ['09:00', '10:00', 'overlaps_next'],
    ['08:00', '10:00', null],
  ])('requested %s vs existing %s -> %s', (requested, existing, expected) => {
    expect(conflictBetween(requested, existing, block)).toBe(expected);
  });

  it('prefers an exact booking over a buffer conflict', () => {
    expect(findConflict('10:00', ['09:00', '10:00'], 120)).toBe('booked');
  });
});

describe('buildSlotList', () => {
  it('marks booked, buffered and overlapping slots, and nothing else', () => {
    const list = buildSlotList(DEFAULT_SLOTS, ['11:00'], 120);
    const byTime = Object.fromEntries(list.map((s) => [s.time, s]));

    expect(byTime['11:00']).toMatchObject({ available: false, blocked_reason: 'booked', label: '11:00 AM' });
    expect(byTime['12:00']).toMatchObject({ available: false, blocked_reason: 'within 120min buffer of earlier booking' });
    expect(byTime['10:00']).toMatchObject({ available: false, blocked_reason: 'would overlap next booking' });
    expect(byTime['09:00']).toMatchObject({ available: true, blocked_reason: null });
    expect(list.filter((s) => s.available).map((s) => s.time)).toEqual(['09:00', '14:00', '15:00', '16:00', '17:00']);
  });

  it('never marks slots busy without a booking (no simulated offline slots)', () => {
    expect(buildSlotList(DEFAULT_SLOTS, [], 150).every((s) => s.available)).toBe(true);
  });
});

describe('dates', () => {
  it('uses the Pakistan date, not UTC', () => {
    // 2026-11-04 20:30 UTC is already 2026-11-05 01:30 in Karachi.
    expect(pakistanDate(new Date('2026-11-04T20:30:00Z'))).toBe('2026-11-05');
    expect(pakistanDate(new Date('2026-11-04T18:00:00Z'))).toBe('2026-11-04');
  });

  it('adds days across month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });
});

describe('alternativeDates', () => {
  it('lists the next three days with up to three real free slots each', () => {
    const booked = new Map([['2026-11-05', ['09:00']]]);
    const alts = alternativeDates('2026-11-04', booked, DEFAULT_SLOTS, 120);

    expect(alts.map((a) => [a.date, a.label])).toEqual([
      ['2026-11-05', 'Kal (Tomorrow)'],
      ['2026-11-06', 'Parson'],
      ['2026-11-07', '3 din baad'],
    ]);
    expect(alts[0].slots).toEqual(['11:00', '12:00', '14:00']);
    expect(alts[1].slots).toEqual(['09:00', '10:00', '11:00']);
  });
});
