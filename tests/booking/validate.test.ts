import { describe, expect, it } from 'vitest';
import { DEFAULT_SLOTS } from '../../lib/booking/schedule';
import { isValidDate, validateConfirm, validateGetSlots, type Validated } from '../../lib/booking/validate';

// The project tsconfig is not strict, so `if (result.ok)` does not narrow the union.
function failure<T>(result: Validated<T>) {
  expect(result.ok).toBe(false);
  return result as Extract<Validated<T>, { ok: false }>;
}

const confirmBody = {
  action: 'confirm',
  provider_id: 'ChIJ-test-provider',
  provider_name: 'Ali AC Services',
  service_type: 'AC Repair',
  location: 'DHA Phase 5, Lahore',
  price_pkr: 2500,
  slot: '4:00 PM',
  booking_date: '2026-11-10',
  user_name: 'Test User',
  user_email: 'booking-test@example.test',
};

describe('isValidDate', () => {
  it('accepts real calendar dates only', () => {
    expect(isValidDate('2026-11-10')).toBe(true);
    expect(isValidDate('2028-02-29')).toBe(true);
    expect(isValidDate('2026-02-29')).toBe(false);
    expect(isValidDate('2026-13-01')).toBe(false);
    expect(isValidDate('10-11-2026')).toBe(false);
    expect(isValidDate(20261110)).toBe(false);
  });
});

describe('validateConfirm', () => {
  it('normalises the slot to 24h and fills defaults', () => {
    const result = validateConfirm({ ...confirmBody, user_name: undefined });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.slot).toBe('16:00');
    expect(result.value.userName).toBe('Guest User');
    expect(result.value.idempotencyKey).toBeNull();
    expect(result.value.candidateSlots).toEqual(DEFAULT_SLOTS);
  });

  it('accepts place_id in place of provider_id, and a numeric-string price', () => {
    const { provider_id, ...rest } = confirmBody;
    const result = validateConfirm({ ...rest, place_id: provider_id, price_pkr: '1800' });
    expect(result.ok && result.value.providerId).toBe(provider_id);
    expect(result.ok && result.value.pricePkr).toBe(1800);
  });

  it('lists every missing field in the WF4 message format', () => {
    const result = failure(validateConfirm({ action: 'confirm' }));
    expect(result.message).toBe(
      'Missing fields: provider_id, provider_name, service_type, location, price_pkr, slot, booking_date',
    );
  });

  it('rejects invalid values separately from missing ones', () => {
    const result = failure(validateConfirm({
      ...confirmBody, slot: '25:00', booking_date: '2026-02-30', price_pkr: -5,
      user_email: 'not-an-email', idempotency_key: 'short',
    }));
    expect(result.fields.sort()).toEqual(['booking_date', 'idempotency_key', 'price_pkr', 'slot', 'user_email']);
    expect(result.message).toMatch(/^Invalid fields: /);
  });

  it('accepts price 0 (only a missing price is missing)', () => {
    expect(validateConfirm({ ...confirmBody, price_pkr: 0 }).ok).toBe(true);
  });

  it('keeps user text exactly as sent, including quotes and Urdu', () => {
    const name = 'Ali "Bhai" \\ AC — علی';
    const result = validateConfirm({ ...confirmBody, provider_name: name });
    expect(result.ok && result.value.providerName).toBe(name);
  });

  it('reads provider details the way WF4 did', () => {
    const result = validateConfirm({
      ...confirmBody, rating: 4.6, review_count: '120', verified: true,
      coordinates: { lat: 31.47, lng: 74.41 }, address: 'Street 1',
    });
    expect(result.ok && result.value.provider).toEqual({
      rating: 4.6, reviewCount: 120, address: 'Street 1', distanceKm: null, reputationScore: null,
      verified: true, googleMapsUrl: '', lat: 31.47, lng: 74.41,
    });
  });
});

describe('validateGetSlots', () => {
  it('normalises and de-duplicates availability_slots', () => {
    const result = validateGetSlots({
      provider_id: 'p1', booking_date: '2026-11-10', availability_slots: ['9:00 AM', '09:00', '4 PM'],
    });
    expect(result.ok && result.value.candidateSlots).toEqual(['09:00', '16:00']);
  });

  it('rejects an unparseable slot instead of guessing', () => {
    const result = failure(validateGetSlots({ provider_id: 'p1', booking_date: '2026-11-10', availability_slots: ['9', 'later'] }));
    expect(result.fields).toEqual(['availability_slots']);
  });

  it('requires a provider and a date', () => {
    const result = failure(validateGetSlots({}));
    expect(result.message).toBe('Missing fields: provider_id, booking_date');
  });
});
