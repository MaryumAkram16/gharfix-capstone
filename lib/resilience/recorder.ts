import type { EmailSender } from '../email/types.js';
import type { Logger } from '../log.js';
import { buildAlertEmail, type AlertContext } from './alerts.js';
import type { Incident, IncidentStore } from './incidents.js';
import { withTimeout } from './retry.js';

// Records incidents and sends de-duplicated alert emails. record() never
// throws and is time-boxed: a broken database, a broken mailbox or a missing
// ALERT_EMAIL can never break the request that hit the failure.
//
// De-duplication by payload_hash within `dedupeWindowMs`:
//   1. per instance, in memory (works even when Supabase itself is down);
//   2. across instances, by asking workflow_incidents for a recent unfixed
//      row with the same hash (checked before this row is written).

export interface IncidentRecorder {
  record(incident: Incident, ctx: Omit<AlertContext, 'at'>): Promise<void>;
}

export interface RecorderOptions {
  store: IncidentStore | null;
  alertSender: EmailSender | null;
  alertTo: string | null;
  log: Logger;
  now?: () => Date;
  dedupeWindowMs?: number;
  /** Upper bound for the store calls and the alert email together. */
  timeoutMs?: number;
}

export const DEFAULT_DEDUPE_WINDOW_MS = 60 * 60 * 1000;

export function createIncidentRecorder({
  store,
  alertSender,
  alertTo,
  log,
  now = () => new Date(),
  dedupeWindowMs = DEFAULT_DEDUPE_WINDOW_MS,
  timeoutMs = 4000,
}: RecorderOptions): IncidentRecorder {
  const lastAlert = new Map<string, number>();

  async function record(incident: Incident, ctx: Omit<AlertContext, 'at'>) {
    const at = now();
    log[incident.auto_fixed ? 'info' : 'error']('incident.recorded', { ...incident });

    if (incident.auto_fixed) {
      await store?.insert(incident).catch((err) => log.warn('incident.store_failed', { error: err }));
      return;
    }

    const since = at.getTime() - dedupeWindowMs;
    let duplicate = (lastAlert.get(incident.payload_hash) ?? -Infinity) >= since;
    if (!duplicate && store) {
      duplicate = await store.hasRecentUnfixed(incident.payload_hash, new Date(since)).catch((err) => {
        log.warn('incident.dedupe_check_failed', { error: err });
        return false; // when in doubt, alert: the database being down is exactly when you want to know
      });
    }
    await store?.insert(incident).catch((err) => log.warn('incident.store_failed', { error: err }));

    if (duplicate) {
      log.info('incident.alert_suppressed', { payload_hash: incident.payload_hash });
      return;
    }
    if (!alertTo || !alertSender) {
      log.warn('incident.alert_not_configured', { payload_hash: incident.payload_hash });
      return;
    }
    lastAlert.set(incident.payload_hash, at.getTime());
    try {
      await alertSender.send(buildAlertEmail(alertTo, incident, { ...ctx, at }));
      log.info('incident.alert_sent', { payload_hash: incident.payload_hash, logs_only: alertSender.logsOnly === true });
    } catch (err) {
      // Not retried, never rethrown.
      log.error('incident.alert_failed', { payload_hash: incident.payload_hash, error: err });
    }
  }

  return {
    async record(incident, ctx) {
      try {
        await withTimeout(record(incident, ctx), timeoutMs, 'incident recording');
      } catch (err) {
        log.error('incident.record_failed', { error: err });
      }
    },
  };
}
