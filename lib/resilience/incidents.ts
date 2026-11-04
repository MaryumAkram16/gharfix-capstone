import { createHash } from 'node:crypto';
import { RepositoryError, type SupabaseRest } from '../booking/repository.js';
import { IntentParserError } from '../intent/types.js';

// Rows for public.workflow_incidents (db/002). Every field is a
// classification produced here, never free text, so a row cannot carry a
// secret, an email body or a customer address.

export interface Incident {
  workflow: string;
  step: string;
  error_class: string;
  retryable: boolean;
  auto_fixed: boolean;
  request_id: string | null;
  payload_hash: string;
}

export interface IncidentStore {
  insert(incident: Incident): Promise<void>;
  /** Any unfixed incident with this hash created at or after `since`? */
  hasRecentUnfixed(payloadHash: string, since: Date): Promise<boolean>;
}

/** e.g. "RepositoryError:unavailable:503", "IntentParserError:config:403", "TimeoutError". */
export function errorClass(err: unknown): string {
  if (err instanceof RepositoryError) return ['RepositoryError', err.kind, err.httpStatus ?? err.pgCode].filter((p) => p !== null && p !== undefined).join(':');
  if (err instanceof IntentParserError) return ['IntentParserError', err.reason, err.httpStatus ?? (err.timedOut ? 'timeout' : null)].filter((p) => p !== null).join(':');
  if (err instanceof Error) {
    // Nodemailer errors carry an SMTP code ("EAUTH") and response code (535).
    const e = err as Error & { code?: unknown; responseCode?: unknown };
    const extra = [typeof e.code === 'string' ? e.code : null, typeof e.responseCode === 'number' ? e.responseCode : null].filter((p) => p !== null);
    return [err.name || 'Error', ...extra].join(':').slice(0, 120);
  }
  return 'Unknown';
}

/**
 * The identity of a failure, not of a request: the same outage hashes the
 * same everywhere, so it produces one alert per window, not one per request.
 */
export function payloadHash(workflow: string, step: string, errClass: string): string {
  return createHash('sha256').update(JSON.stringify([workflow, step, errClass])).digest('hex');
}

export function createSupabaseIncidentStore(rest: SupabaseRest): IncidentStore {
  return {
    async insert(incident) {
      await rest.request('workflow_incidents', 'POST', null, incident, { Prefer: 'return=minimal' });
    },
    async hasRecentUnfixed(hash, since) {
      const params = new URLSearchParams({
        select: 'id',
        payload_hash: `eq.${hash}`,
        auto_fixed: 'is.false',
        created_at: `gte.${since.toISOString()}`,
        limit: '1',
      });
      const rows = await rest.request('workflow_incidents', 'GET', params);
      return Array.isArray(rows) && rows.length > 0;
    },
  };
}
