import { describe, expect, it } from 'vitest';
import { createSupabaseRest } from '../../lib/booking/repository';
import { adviceFor, buildAlertEmail } from '../../lib/resilience/alerts';
import { createSupabaseIncidentStore, payloadHash, type Incident } from '../../lib/resilience/incidents';
import { createIncidentRecorder } from '../../lib/resilience/recorder';
import { memoryLogger } from '../../lib/log';
import { recorderKit } from '../fakes/resilience';

const incident = (over: Partial<Incident> = {}): Incident => ({
  workflow: 'khadmat-booking', step: 'supabase.insert', error_class: 'RepositoryError:unavailable:503',
  retryable: true, auto_fixed: false, request_id: 'req-1',
  payload_hash: payloadHash('khadmat-booking', 'supabase.insert', 'RepositoryError:unavailable:503'), ...over,
});
const ctx = { tried: 'Not retried: repeating this call could act twice (double booking or a duplicate email).', detail: 'booking BK-TEST-0001' };

describe('alert de-duplication by payload_hash', () => {
  it('sends one alert for repeats within the window, and every incident is still stored', async () => {
    const kit = recorderKit();
    await kit.recorder.record(incident({ request_id: 'a' }), ctx);
    kit.clock.advance(10 * 60_000);
    await kit.recorder.record(incident({ request_id: 'b' }), ctx);
    expect(kit.alerts.sent).toHaveLength(1);
    expect(kit.store.rows.map((r) => r.request_id)).toEqual(['a', 'b']);
    expect(kit.log.records.map((r) => r.event)).toContain('incident.alert_suppressed');
  });

  it('alerts again after the window, and separately for a different failure', async () => {
    const kit = recorderKit();
    await kit.recorder.record(incident(), ctx);
    await kit.recorder.record(incident({ step: 'smtp.send', error_class: 'Error:EAUTH:535', payload_hash: payloadHash('khadmat-booking', 'smtp.send', 'Error:EAUTH:535') }), ctx);
    kit.clock.advance(61 * 60_000);
    await kit.recorder.record(incident(), ctx);
    expect(kit.alerts.sent.map((m) => m.subject)).toEqual([
      '[GharFix alert] khadmat-booking: saving a new booking in Supabase failed',
      '[GharFix alert] khadmat-booking: sending an email through Gmail SMTP failed',
      '[GharFix alert] khadmat-booking: saving a new booking in Supabase failed',
    ]);
  });

  it('respects an alert another instance already sent (recent row in workflow_incidents)', async () => {
    const kit = recorderKit();
    kit.store.rows.push({ ...incident({ request_id: 'other-instance' }), created_at: kit.clock.now() });
    await kit.recorder.record(incident(), ctx);
    expect(kit.alerts.sent).toEqual([]);
    expect(kit.store.rows).toHaveLength(2);
  });

  it('auto-fixed incidents are stored but never alert, and do not suppress real alerts', async () => {
    const kit = recorderKit();
    await kit.recorder.record(incident({ auto_fixed: true }), ctx);
    await kit.recorder.record(incident(), ctx);
    expect(kit.alerts.sent).toHaveLength(1);
  });
});

describe('the recorder never breaks the caller', () => {
  it('alerts even when Supabase (the incident store) is down, and de-dupes in memory', async () => {
    const kit = recorderKit();
    kit.store.down = true;
    await kit.recorder.record(incident(), ctx);
    await kit.recorder.record(incident(), ctx);
    expect(kit.alerts.sent).toHaveLength(1);
    expect(kit.log.records.map((r) => r.event)).toEqual(expect.arrayContaining(['incident.dedupe_check_failed', 'incident.store_failed']));
  });

  it('a failing alert email resolves quietly', async () => {
    const kit = recorderKit();
    kit.alerts.behaviour = 'fail';
    await expect(kit.recorder.record(incident(), ctx)).resolves.toBeUndefined();
    expect(kit.log.records.find((r) => r.event === 'incident.alert_failed')).toMatchObject({ level: 'error' });
  });

  it('a hanging alert email is cut off by the recorder timeout', async () => {
    const kit = recorderKit();
    kit.alerts.behaviour = 'hang';
    const t = Date.now();
    await kit.recorder.record(incident(), ctx);
    expect(Date.now() - t).toBeLessThan(1000);
    expect(kit.log.records.map((r) => r.event)).toContain('incident.record_failed');
  });

  it('without ALERT_EMAIL it records and logs that no alert could go out', async () => {
    const log = memoryLogger();
    const recorder = createIncidentRecorder({ store: null, alertSender: null, alertTo: null, log });
    await recorder.record(incident(), ctx);
    expect(log.records.map((r) => r.event)).toEqual(['incident.recorded', 'incident.alert_not_configured']);
  });
});

describe('alert email', () => {
  it('says what broke, what was tried and what to do, with emails masked and no secrets', () => {
    const SECRET = 'test-service-role-key-not-real';
    const mail = buildAlertEmail('owner@example.test', incident(), { ...ctx, detail: 'booking BK-TEST-0001 for booking-test@example.test', at: new Date('2026-11-04T09:00:00Z') });
    expect(mail.to).toBe('owner@example.test');
    expect(mail.text).toContain('What broke: khadmat-booking failed while saving a new booking in Supabase.');
    expect(mail.text).toContain('What was tried: Not retried: repeating this call could act twice');
    expect(mail.text).toContain('What you need to do: Supabase did not answer. Check https://status.supabase.com');
    expect(mail.text).toContain('Request id: req-1');
    expect(mail.text).toContain('b***@example.test');
    expect(mail.text).not.toContain('booking-test@example.test');
    expect(mail.text + mail.html + mail.subject).not.toContain(SECRET);
  });

  it.each([
    [{ step: 'supabase.insert', error_class: 'RepositoryError:unexpected:401' }, /SUPABASE_SERVICE_ROLE_KEY/],
    [{ step: 'supabase.findUnconfirmed', error_class: 'RepositoryError:unexpected:400:42703' }, /Run the pending migration/],
    [{ step: 'gemini.parse', error_class: 'IntentParserError:config:403' }, /GEMINI_API_KEY and GEMINI_MODEL/],
    [{ step: 'gemini.parse', error_class: 'IntentParserError:unavailable:503' }, /keyword parser was used/],
    [{ step: 'smtp.send', error_class: 'Error:EAUTH:535' }, /GMAIL_APP_PASSWORD/],
    [{ step: 'smtp.send', error_class: 'TimeoutError' }, /reconcile job every 15 minutes/],
    [{ step: 'config', error_class: 'Error' }, /Environment Variables and redeploy/],
  ])('advice for %j', (i, expected) => {
    expect(adviceFor(i)).toMatch(expected);
  });
});

describe('Supabase incident store', () => {
  it('POSTs to workflow_incidents and checks for recent unfixed rows by hash', async () => {
    const calls: Array<{ url: URL; init: RequestInit }> = [];
    const responses = [new Response(null, { status: 201 }), Response.json([{ id: 1 }])];
    const fetchImpl = async (u: string, init: RequestInit) => { calls.push({ url: new URL(u), init }); return responses.shift()!; };
    const store = createSupabaseIncidentStore(createSupabaseRest({ url: 'https://p.supabase.test', serviceRoleKey: 'k', timeoutMs: 1000 }, { fetch: fetchImpl }));

    await store.insert(incident());
    expect(await store.hasRecentUnfixed('abc', new Date('2026-11-04T08:00:00Z'))).toBe(true);

    expect(calls[0].url.pathname).toBe('/rest/v1/workflow_incidents');
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(calls[0].init.body as string)).toEqual(incident());
    expect(Object.fromEntries(calls[1].url.searchParams)).toEqual({
      select: 'id', payload_hash: 'eq.abc', auto_fixed: 'is.false', created_at: 'gte.2026-11-04T08:00:00.000Z', limit: '1',
    });
  });
});
