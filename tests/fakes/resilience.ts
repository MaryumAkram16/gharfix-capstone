import type { EmailMessage, EmailSender } from '../../lib/email/types';
import { memoryLogger } from '../../lib/log';
import type { Incident, IncidentStore } from '../../lib/resilience/incidents';
import { createIncidentRecorder } from '../../lib/resilience/recorder';

/** workflow_incidents in memory, with created_at from the injected clock. */
export class FakeIncidentStore implements IncidentStore {
  rows: Array<Incident & { created_at: Date }> = [];
  down = false;
  constructor(private now: () => Date) {}
  async insert(incident: Incident) {
    if (this.down) throw new Error('Supabase POST network error');
    this.rows.push({ ...incident, created_at: this.now() });
  }
  async hasRecentUnfixed(hash: string, since: Date) {
    if (this.down) throw new Error('Supabase GET network error');
    return this.rows.some((r) => r.payload_hash === hash && !r.auto_fixed && r.created_at >= since);
  }
}

export class FakeAlertSender implements EmailSender {
  sent: EmailMessage[] = [];
  behaviour: 'ok' | 'fail' | 'hang' = 'ok';
  async send(message: EmailMessage) {
    if (this.behaviour === 'fail') throw Object.assign(new Error('535 Authentication failed for alerts@example.test'), { code: 'EAUTH', responseCode: 535 });
    if (this.behaviour === 'hang') return new Promise<void>(() => {});
    this.sent.push(message);
  }
}

export function recorderKit(start = new Date('2026-11-04T09:00:00Z')) {
  let now = start;
  const clock = { now: () => now, advance: (ms: number) => { now = new Date(now.getTime() + ms); } };
  const store = new FakeIncidentStore(clock.now);
  const alerts = new FakeAlertSender();
  const log = memoryLogger();
  const recorder = createIncidentRecorder({ store, alertSender: alerts, alertTo: 'owner@example.test', log, now: clock.now, timeoutMs: 200 });
  return { clock, store, alerts, log, recorder };
}
