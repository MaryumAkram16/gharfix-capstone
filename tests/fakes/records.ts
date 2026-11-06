import { PROVIDER_FAULT_STATUSES, type BookingPatch, type BookingRecord, type BookingRecords } from '../../lib/booking/records';
import { RepositoryError } from '../../lib/booking/repository';
import type { EmailMessage, EmailSender } from '../../lib/email/types';

type Op = 'find' | 'update' | 'providerHistory';

/** In-memory bookings for the one-booking workflows, with the same compare-and-set as the PostgREST filter. */
export class FakeRecords implements BookingRecords {
  rows: BookingRecord[] = [];
  calls: Op[] = [];
  updates: Array<{ id: string; patch: BookingPatch; ifStatus?: readonly string[] }> = [];
  failWhen: (op: Op) => boolean = () => false;
  /** Runs between a read and the update: where a racing request lands. */
  beforeUpdate: (() => void) | null = null;

  seed(...rows: Array<Partial<BookingRecord> & { booking_id: string }>): this {
    for (const r of rows) {
      this.rows.push({
        status: 'confirmed', user_name: 'Test User', user_email: 'customer@example.test', service_type: 'plumber',
        provider_id: 'osm:node/1', provider_name: 'Ali Plumbers', location: 'G-13, Islamabad', slot: '16:00',
        booking_date: '2026-11-06', price_pkr: 2000, final_price_pkr: null, customer_rating: null, feedback_sentiment: null, ...r,
      });
    }
    return this;
  }

  get(id: string) { return this.rows.find((r) => r.booking_id === id); }

  private check(op: Op) {
    this.calls.push(op);
    if (this.failWhen(op)) throw new RepositoryError('unavailable', `Supabase ${op} timed out`);
  }

  async find(id: string) {
    this.check('find');
    const r = this.get(id);
    return r ? { ...r } : null;
  }

  async update(id: string, patch: BookingPatch, ifStatus?: readonly string[]) {
    this.check('update');
    this.beforeUpdate?.();
    this.updates.push({ id, patch, ifStatus });
    const r = this.get(id);
    if (!r || (ifStatus && !ifStatus.includes(String(r.status)))) return null;
    Object.assign(r, patch);
    return { ...r };
  }

  async providerHistory(providerId: string) {
    this.check('providerHistory');
    const mine = this.rows.filter((r) => r.provider_id === providerId);
    return { total: mine.length, noShowOrCancelled: mine.filter((r) => (PROVIDER_FAULT_STATUSES as readonly string[]).includes(String(r.status))).length };
  }
}

export class FakeMailer implements EmailSender {
  sent: EmailMessage[] = [];
  fail = false;
  async send(m: EmailMessage) {
    if (this.fail) throw new Error('SMTP down');
    this.sent.push(m);
  }
}
