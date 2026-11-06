import type { SupabaseRest } from '../booking/repository.js';

// db/waitlist.sql. n8n built these bodies as JSON strings with the values
// spliced in (a quote in a location broke the request); here JSON.stringify.

export interface WaitlistEntry {
  booking_id: string;
  user_email: string;
  user_name: string | null;
  service_type: string;
  location: string;
  booking_date: string | null;
  slot: string | null;
  price_pkr: number;
  cancelled_provider_id: string;
  cancelled_provider_name: string;
  attempted_provider_name: string | null;
  reason: 'no_alternative_available' | 'no_slot_available';
  status: 'waiting';
}

export interface Waitlist {
  add(entry: WaitlistEntry): Promise<void>;
}

export function createWaitlist(rest: SupabaseRest): Waitlist {
  return {
    async add(entry) {
      await rest.request('waitlist', 'POST', null, entry, { Prefer: 'return=minimal' });
    },
  };
}
