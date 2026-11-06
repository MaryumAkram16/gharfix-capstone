import type { EmailMessage } from '../email/types.js';
import { maskEmails } from '../log.js';
import type { Incident } from './incidents.js';

// The plain-language alert email: what broke, what was tried, what to do.
// The whole text goes through maskEmails, and it is built only from the
// incident, the policy description and our own error messages (which never
// contain keys; see tests/resilience).

const STEP_NAMES: Record<string, string> = {
  'supabase.bookedSlots': 'reading booked slots from Supabase',
  'supabase.findByIdempotencyKey': 'looking up a booking by idempotency key in Supabase',
  'supabase.insert': 'saving a new booking in Supabase',
  'supabase.markConfirmationSent': 'recording that a confirmation email was sent',
  'supabase.activeBookingCounts': "reading providers' booking counts from Supabase",
  'supabase.findBooking': 'reading a booking from Supabase',
  'supabase.updateBooking': 'updating a booking in Supabase',
  'supabase.providerHistory': "reading a provider's booking history from Supabase",
  'supabase.addToWaitlist': 'adding a customer to the waitlist in Supabase',
  'supabase.providerBookings': "reading a provider's bookings for the dashboard",
  'supabase.platformDone': 'reading completed bookings for platform averages',
  'supabase.allBookings': 'reading all bookings for the nightly provider scores',
  'supabase.upsertScores': 'saving the nightly provider scores',
  'supabase.findUnconfirmed': 'finding bookings whose confirmation email was not sent',
  'gemini.parse': 'understanding the customer request with Gemini',
  'osm.searchNearby': 'searching OpenStreetMap (Overpass) for nearby providers',
  'google.searchText': 'searching Google Places for nearby providers',
  'osm.geocode': 'finding the location with OpenStreetMap (Nominatim)',
  'smtp.send': 'sending an email through Gmail SMTP',
};

export function adviceFor(incident: Pick<Incident, 'step' | 'error_class'>): string {
  const { step, error_class: e } = incident;
  if (step === 'config') {
    return 'A required environment variable is missing or invalid (named in the error above). Set it in Vercel -> Project -> Settings -> Environment Variables and redeploy.';
  }
  if (step.startsWith('supabase.')) {
    if (e.includes(':unavailable')) {
      return 'Supabase did not answer. Check https://status.supabase.com and whether the project is paused (free projects pause after a week without activity; resume it in the dashboard). Nothing else is needed if it recovers: customers who hit this were asked to try again.';
    }
    if (/:(401|403)\b/.test(e)) return 'Supabase rejected the key. Check SUPABASE_SERVICE_ROLE_KEY (and SUPABASE_URL) in the Vercel project settings, then redeploy.';
    if (/:(42703|42P01|PGRST204|PGRST205)\b/.test(e)) {
      return 'A table or column is missing. Run the pending migration(s) in db/ (001_booking_integrity.sql, 002_incidents.sql) in the Supabase SQL editor.';
    }
    return 'Supabase returned an unexpected error. Open the Vercel logs for the request id below.';
  }
  if (step === 'google.searchText') {
    return 'Google Places did not answer. HTTP 403: the key in GOOGLE_MAPS_API_KEY is wrong, restricted, the Places API (New) is not enabled for its project, or billing is off. HTTP 429: quota used up. Timeouts or 5xx: Google outage, raise GOOGLE_PLACES_TIMEOUT_MS if it keeps happening. Meanwhile OpenStreetMap was searched instead (and demo providers after that, with USE_DEMO_PROVIDERS=1). Remove GOOGLE_MAPS_API_KEY to stop using Google.';
  }
  if (step.startsWith('osm.')) {
    return 'The public OpenStreetMap servers were slow or unreachable (the Overpass mirror was tried too). Nothing to do if it recovers. If it keeps happening: raise OVERPASS_TIMEOUT_MS / NOMINATIM_TIMEOUT_MS, or point OVERPASS_URL / OVERPASS_FALLBACK_URL / NOMINATIM_URL at your own or a commercial instance. With USE_DEMO_PROVIDERS=1, customers were shown labelled demo providers meanwhile; otherwise they were asked to try again.';
  }
  if (step === 'gemini.parse') {
    if (e.includes(':config')) return 'Gemini rejected the request (bad key or model name). Check GEMINI_API_KEY and GEMINI_MODEL. A 400 can mean the model does not accept GEMINI_THINKING_LEVEL: set it to off. A 403 usually means the key is not allowed to use the Generative Language API: use a key from aistudio.google.com/apikey, not the Maps key (GOOGLE_MAPS_API_KEY is separate), with no website/IP restriction, then redeploy. Until then customers are served by the keyword parser.';
    if (e.includes(':invalid_output')) return 'Gemini answered with output that failed validation, so the keyword parser was used. If this repeats, try another GEMINI_MODEL.';
    if (e.includes(':timeout')) return 'Gemini did not answer within GEMINI_TIMEOUT_MS (default 8000), so the keyword parser was used. If this repeats: keep GEMINI_THINKING_LEVEL at low or minimal (higher levels are slower), or raise GEMINI_TIMEOUT_MS to 12000.';
    return 'Gemini was unavailable or rate-limited, so the keyword parser was used. If this repeats, check the Gemini quota in Google AI Studio.';
  }
  if (step === 'smtp.send') {
    if (/EAUTH|:535\b/.test(e)) return 'Gmail rejected the login. Check GMAIL_USER and GMAIL_APP_PASSWORD (an app password, which needs 2-Step Verification). Unsent confirmations are re-sent by the reconcile job every 15 minutes once this works.';
    return 'The email could not be sent (Gmail unreachable, timed out, or a sending limit reached). Unsent confirmations are re-sent by the reconcile job every 15 minutes.';
  }
  return 'Open the Vercel logs for the request id below.';
}

export interface AlertContext {
  tried: string;
  /** Short, non-secret detail such as a booking id or our own error message. */
  detail?: string;
  at: Date;
}

export function buildAlertEmail(to: string, incident: Incident, ctx: AlertContext): EmailMessage {
  const what = STEP_NAMES[incident.step] ?? incident.step;
  const lines = [
    `What broke: ${incident.workflow} failed while ${what}.`,
    `Error: ${incident.error_class}${ctx.detail ? ` (${ctx.detail})` : ''}`,
    '',
    `What was tried: ${ctx.tried}`,
    '',
    `What you need to do: ${adviceFor(incident)}`,
    '',
    `When: ${ctx.at.toISOString()}`,
    `Request id: ${incident.request_id ?? 'n/a'}`,
    `Incident hash: ${incident.payload_hash}`,
    '',
    'Similar failures in the next hour are recorded in workflow_incidents but do not send another email.',
  ];
  const text = maskEmails(lines.join('\n'));
  const subject = maskEmails(`[GharFix alert] ${incident.workflow}: ${what} failed`).replace(/[\r\n]+/g, ' ');
  const html = `<pre style="font-family: Menlo, Consolas, monospace; white-space: pre-wrap;">${text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`;
  return { to, subject, text, html };
}
