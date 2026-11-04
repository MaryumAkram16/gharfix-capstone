import { describe, expect, it } from 'vitest';
import { normaliseSlot, slotLabel, slotToMinutes } from '../../lib/booking/slot';

describe('normaliseSlot', () => {
  it.each([
    ['09:00', '09:00'],
    ['9:00', '09:00'],
    ['9', '09:00'],
    ['16:00', '16:00'],
    ['00:00', '00:00'],
    ['23:59', '23:59'],
    ['4:00 PM', '16:00'],
    ['4:00PM', '16:00'],
    ['4 pm', '16:00'],
    ['4 p.m.', '16:00'],
    ['  11:30 am ', '11:30'],
    ['12:00 PM', '12:00'],
    ['12 AM', '00:00'],
    ['12:30 am', '00:30'],
  ])('%j -> %j', (input, expected) => {
    expect(normaliseSlot(input)).toBe(expected);
  });

  it.each([
    '', '   ', '25:00', '24:00', '4:60', '13:00 PM', '0:00 AM', '4:5', '4:000',
    'noon', '9am-10am', '-1:00', '09:00:00', 'PM',
  ])('rejects %j', (input) => {
    expect(normaliseSlot(input)).toBeNull();
  });

  it('rejects non-strings', () => {
    expect(normaliseSlot(undefined)).toBeNull();
    expect(normaliseSlot(null)).toBeNull();
    expect(normaliseSlot(900)).toBeNull();
  });
});

describe('slotToMinutes / slotLabel', () => {
  it('converts to minutes since midnight', () => {
    expect(slotToMinutes('00:00')).toBe(0);
    expect(slotToMinutes('14:30')).toBe(870);
  });

  it.each([
    ['00:00', '12:00 AM'],
    ['09:05', '9:05 AM'],
    ['12:00', '12:00 PM'],
    ['16:00', '4:00 PM'],
  ])('labels %s as %s', (slot, label) => {
    expect(slotLabel(slot)).toBe(label);
  });

  it('round-trips every label back to the same slot', () => {
    for (let mins = 0; mins < 24 * 60; mins += 15) {
      const slot = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
      expect(normaliseSlot(slotLabel(slot))).toBe(slot);
    }
  });
});
