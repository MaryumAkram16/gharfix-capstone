import { slotLabel, slotToMinutes } from './slot.js';

// Job time per service (minutes), carried over unchanged from WF4.
const SERVICE_DURATIONS: Record<string, number> = {
  'ac repair': 120,
  'ac installation': 180,
  'ac gas refill': 90,
  'plumber': 90,
  'electrician': 120,
  'carpenter': 180,
  'painter': 240,
  'tutor': 60,
  'beautician': 120,
  'generator mechanic': 120,
  'fridge repair': 120,
  'washing machine repair': 120,
  'geyser repair': 90,
  'solar installation': 300,
  'pest control': 120,
  'deep cleaning': 240,
};
const DEFAULT_DURATION_MINS = 90;

export const TRAVEL_BUFFER_MINS = 30;

export const DEFAULT_SLOTS = ['09:00', '10:00', '11:00', '12:00', '14:00', '15:00', '16:00', '17:00'];

export interface ServiceBlock {
  jobDurationMins: number;
  travelBufferMins: number;
  totalBlockMins: number;
}

export function serviceBlock(serviceType: string | undefined): ServiceBlock {
  const key = (serviceType || '').toLowerCase();
  const matched = Object.keys(SERVICE_DURATIONS).find((k) => key.includes(k));
  const jobDurationMins = matched ? SERVICE_DURATIONS[matched] : DEFAULT_DURATION_MINS;
  return {
    jobDurationMins,
    travelBufferMins: TRAVEL_BUFFER_MINS,
    totalBlockMins: jobDurationMins + TRAVEL_BUFFER_MINS,
  };
}

export type ConflictKind = 'booked' | 'buffer_after_earlier' | 'overlaps_next';

/**
 * Does a booking at `requested` clash with an existing booking at `existing`?
 * Same rule as WF4: the requested service's block must not start inside, or
 * run into, any existing booking. Both slots are normalised "HH:MM".
 */
export function conflictBetween(requested: string, existing: string, totalBlockMins: number): ConflictKind | null {
  const req = slotToMinutes(requested);
  const ex = slotToMinutes(existing);
  if (req === ex) return 'booked';
  if (req > ex && req < ex + totalBlockMins) return 'buffer_after_earlier';
  if (req < ex && req + totalBlockMins > ex) return 'overlaps_next';
  return null;
}

/** First conflict of `requested` against the booked slots, or null if free. */
export function findConflict(requested: string, booked: string[], totalBlockMins: number): ConflictKind | null {
  let found: ConflictKind | null = null;
  for (const existing of booked) {
    const kind = conflictBetween(requested, existing, totalBlockMins);
    if (kind === 'booked') return kind;
    found = found ?? kind;
  }
  return found;
}

export interface SlotEntry {
  time: string;
  label: string;
  available: boolean;
  blocked_reason: string | null;
}

export function blockedReason(kind: ConflictKind, totalBlockMins: number): string {
  if (kind === 'booked') return 'booked';
  if (kind === 'buffer_after_earlier') return `within ${totalBlockMins}min buffer of earlier booking`;
  return 'would overlap next booking';
}

export function buildSlotList(candidates: string[], booked: string[], totalBlockMins: number): SlotEntry[] {
  return candidates.map((time) => {
    const kind = findConflict(time, booked, totalBlockMins);
    return {
      time,
      label: slotLabel(time),
      available: kind === null,
      blocked_reason: kind ? blockedReason(kind, totalBlockMins) : null,
    };
  });
}

/** Today's date in Pakistan as "YYYY-MM-DD" (Vercel runs in UTC). */
export function pakistanDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const ALTERNATIVE_LABELS = ['Kal (Tomorrow)', 'Parson', '3 din baad'];
// The slot_taken screen showed three suggestions per day under n8n.
const MAX_ALTERNATIVE_SLOTS = 3;

export interface AlternativeDate {
  date: string;
  label: string;
  slots: string[];
}

/** The next three dates after `today` with the free slots on each. */
export function alternativeDates(
  today: string,
  bookedByDate: Map<string, string[]>,
  candidates: string[],
  totalBlockMins: number,
): AlternativeDate[] {
  return ALTERNATIVE_LABELS.map((label, i) => {
    const date = addDays(today, i + 1);
    const booked = bookedByDate.get(date) ?? [];
    const slots = candidates
      .filter((slot) => findConflict(slot, booked, totalBlockMins) === null)
      .slice(0, MAX_ALTERNATIVE_SLOTS);
    return { date, label, slots };
  });
}
