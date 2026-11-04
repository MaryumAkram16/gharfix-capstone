import {
  ACTIVE_STATUSES, BookingConflictError, CONSTRAINTS, RepositoryError,
  type BookingRepository, type BookingRow, type NewBooking,
} from '../../lib/booking/repository';
import { normaliseSlot } from '../../lib/booking/slot';

type Op = 'bookedSlots' | 'findByIdempotencyKey' | 'insert';

/**
 * In-memory bookings table that enforces the same unique rules as Postgres:
 * booking_id, idempotency_key, and one active booking per provider/date/slot.
 */
export class FakeBookingDb implements BookingRepository {
  rows: BookingRow[] = [];
  calls: Op[] = [];
  /** Return true to make that call fail as if Supabase were unreachable. */
  failWhen: (op: Op) => boolean = () => false;
  /** Runs after the pre-check and just before the insert: the window a racing request lands in. */
  beforeInsert: ((row: NewBooking) => void) | null = null;

  seed(...rows: Array<Partial<BookingRow> & Pick<BookingRow, 'booking_id'>>): this {
    for (const r of rows) this.rows.push({ status: 'confirmed', ...r } as BookingRow);
    return this;
  }

  goDown(): this {
    this.failWhen = () => true;
    return this;
  }

  private enter(op: Op) {
    this.calls.push(op);
    if (this.failWhen(op)) throw new RepositoryError('unavailable', `Supabase GET network error`);
  }

  async bookedSlots(providerId: string, dates: string[]) {
    this.enter('bookedSlots');
    const result = new Map<string, string[]>(dates.map((d) => [d, []]));
    for (const r of this.rows) {
      if (r.provider_id !== providerId || !ACTIVE_STATUSES.includes(r.status as never)) continue;
      const slot = normaliseSlot(r.slot);
      if (slot) result.get(r.booking_date)?.push(slot);
    }
    return result;
  }

  async findByIdempotencyKey(key: string) {
    this.enter('findByIdempotencyKey');
    return structuredClone(this.rows.find((r) => r.idempotency_key === key) ?? null);
  }

  /** Raw insert with constraint checks, used by tests to play a competing request. */
  insertNow(row: NewBooking): BookingRow {
    if (this.rows.some((r) => r.booking_id === row.booking_id)) {
      throw new BookingConflictError('booking_id', CONSTRAINTS.bookingId, '23505');
    }
    if (row.idempotency_key && this.rows.some((r) => r.idempotency_key === row.idempotency_key)) {
      throw new BookingConflictError('idempotency_key', CONSTRAINTS.idempotencyKey, '23505');
    }
    const clash = this.rows.some(
      (r) =>
        r.provider_id === row.provider_id &&
        r.booking_date === row.booking_date &&
        ACTIVE_STATUSES.includes(r.status as never) &&
        normaliseSlot(r.slot) === normaliseSlot(row.slot),
    );
    if (clash) throw new BookingConflictError('slot', CONSTRAINTS.slot, '23505');
    const stored = structuredClone(row) as BookingRow;
    this.rows.push(stored);
    return structuredClone(stored);
  }

  async insert(row: NewBooking) {
    this.enter('insert');
    const hook = this.beforeInsert;
    this.beforeInsert = null;
    hook?.(row);
    return this.insertNow(row);
  }
}

export class FakeEmail {
  sent: Array<{ to: string; subject: string; html: string; text: string }> = [];
  behaviour: 'ok' | 'fail' | 'hang' = 'ok';

  async send(message: { to: string; subject: string; html: string; text: string }) {
    if (this.behaviour === 'fail') throw new Error('535 Authentication failed for booking-test@example.test');
    if (this.behaviour === 'hang') return new Promise<void>(() => {});
    this.sent.push(message);
  }
}
