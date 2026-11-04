// Slot times reach us as "09:00", "9:00 am", "4 PM", "16:00"... Everything in
// the booking code works on 24h "HH:MM"; normaliseSlot is the only parser.
// db/001_booking_integrity.sql mirrors these rules in normalize_slot().

const SLOT_PATTERN = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/;

/** Returns "HH:MM" (24h), or null when the input is not a valid time. */
export function normaliseSlot(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const match = SLOT_PATTERN.exec(input.trim().toLowerCase().replace(/\./g, ''));
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = match[2] === undefined ? 0 : Number(match[2]);
  const period = match[3];

  if (minutes > 59) return null;
  if (period) {
    if (hours < 1 || hours > 12) return null;
    if (period === 'am' && hours === 12) hours = 0;
    if (period === 'pm' && hours !== 12) hours += 12;
  } else if (hours > 23) {
    return null;
  }

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** "HH:MM" -> minutes since midnight. Expects a normalised slot. */
export function slotToMinutes(slot: string): number {
  const [h, m] = slot.split(':').map(Number);
  return h * 60 + m;
}

/** "HH:MM" -> "4:00 PM", the label format the frontend already shows. */
export function slotLabel(slot: string): string {
  const [h, m] = slot.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hour}:${String(m).padStart(2, '0')} ${period}`;
}
