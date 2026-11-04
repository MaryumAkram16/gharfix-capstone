import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { BookingRow } from '../../lib/booking/repository';
import { memoryLogger } from '../../lib/log';
import {
  bearerMatches, handleReconcileRequest, isDeliverableAddress, reconcileConfirmations, type ReconcileDeps,
} from '../../lib/reconcile/handler';
import { FakeBookingDb, FakeEmail } from '../fakes/bookingDb';

const NOW = new Date('2026-11-04T09:00:00Z');
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

function booking(id: string, over: Partial<BookingRow> = {}): Partial<BookingRow> & { booking_id: string } {
  return {
    booking_id: id, status: 'confirmed', user_name: 'Test User', user_email: `${id.toLowerCase()}@example.test`,
    service_type: 'plumber', provider_id: 'osm:node/1', provider_name: 'Ali Plumbing', location: 'G-13, Islamabad',
    slot: '16:00', booking_date: '2026-11-10', price_pkr: 900, created_at: ago(30), ...over,
  };
}

let db: FakeBookingDb;
let email: FakeEmail;
let log: ReturnType<typeof memoryLogger>;
let deps: ReconcileDeps;

beforeEach(() => {
  db = new FakeBookingDb();
  email = new FakeEmail();
  log = memoryLogger();
  // Fakes send nothing real; the reserved-domain filter has its own tests below.
  deps = { db, email, log, now: () => NOW, deliverable: () => true, emailTimeoutMs: 50 };
});

describe('reconcileConfirmations', () => {
  it('re-sends only confirmed, unsent bookings with an address, created 5 minutes to 24 hours ago', async () => {
    db.seed(
      booking('BK-TEST-DUE'),
      booking('BK-TEST-TOO-NEW', { created_at: ago(2) }),
      booking('BK-TEST-TOO-OLD', { created_at: ago(25 * 60) }),
      booking('BK-TEST-SENT', { confirmation_sent_at: ago(29) }),
      booking('BK-TEST-CANCELLED', { status: 'cancelled' }),
      booking('BK-TEST-NO-EMAIL', { user_email: null }),
    );

    expect(await reconcileConfirmations(deps)).toEqual({ found: 1, fixed: 1, failed: 0, skipped: 0, deferred: 0 });
    expect(email.sent.map((m) => [m.to, m.subject])).toEqual([
      ['bk-test-due@example.test', 'Your GharFix Booking is Confirmed! (Booking ID: BK-TEST-DUE)'],
    ]);
    expect(db.rows.find((r) => r.booking_id === 'BK-TEST-DUE')!.confirmation_sent_at).toBe(NOW.toISOString());
  });

  it('is idempotent: a second run finds nothing and sends nothing', async () => {
    db.seed(booking('BK-TEST-A'), booking('BK-TEST-B'));
    expect(await reconcileConfirmations(deps)).toMatchObject({ found: 2, fixed: 2 });
    expect(await reconcileConfirmations(deps)).toEqual({ found: 0, fixed: 0, failed: 0, skipped: 0, deferred: 0 });
    expect(await reconcileConfirmations(deps)).toMatchObject({ found: 0 });
    expect(email.sent).toHaveLength(2);
  });

  it('leaves a failed send for the next run, which fixes it once SMTP works', async () => {
    db.seed(booking('BK-TEST-RETRY'));
    email.behaviour = 'fail';
    expect(await reconcileConfirmations(deps)).toMatchObject({ found: 1, fixed: 0, failed: 1 });
    expect(db.rows[0].confirmation_sent_at).toBeUndefined();

    email.behaviour = 'ok';
    expect(await reconcileConfirmations(deps)).toMatchObject({ found: 1, fixed: 1, failed: 0 });
    expect(await reconcileConfirmations(deps)).toMatchObject({ found: 0 });
    expect(email.sent).toHaveLength(1);
  });

  it('does not count a console-only "send" as fixed (nothing reached the customer)', async () => {
    db.seed(booking('BK-TEST-CONSOLE'));
    deps.email = { logsOnly: true, send: async () => {} };
    expect(await reconcileConfirmations(deps)).toMatchObject({ found: 1, fixed: 0, failed: 1 });
    expect(db.rows[0].confirmation_sent_at).toBeUndefined();
  });

  it('a send that succeeds but cannot be recorded still counts as sent (and may be re-sent once)', async () => {
    db.seed(booking('BK-TEST-MARK'));
    db.failWhen = (op) => op === 'markConfirmationSent';
    expect(await reconcileConfirmations(deps)).toMatchObject({ fixed: 1 });
    expect(log.records.map((r) => r.event)).toContain('booking.confirmation_mark_failed');
  });

  it('never mails reserved test domains with the default filter', async () => {
    delete deps.deliverable;
    db.seed(booking('BK-TEST-RESERVED'));
    expect(await reconcileConfirmations(deps)).toEqual({ found: 0, fixed: 0, failed: 0, skipped: 1, deferred: 0 });
    expect(email.sent).toEqual([]);
  });

  it('stops at the time budget and reports the rest as deferred', async () => {
    db.seed(booking('BK-TEST-1', { created_at: ago(40) }), booking('BK-TEST-2', { created_at: ago(30) }), booking('BK-TEST-3', { created_at: ago(20) }));
    let t = NOW.getTime();
    deps.now = () => new Date((t += 30_000)); // every clock read is 30 s later
    expect(await reconcileConfirmations(deps, { budgetMs: 40_000 })).toMatchObject({ found: 3, fixed: 1, deferred: 2 });
  });

  it('handles at most `limit` bookings per run, oldest first', async () => {
    db.seed(booking('BK-TEST-NEWER', { created_at: ago(10) }), booking('BK-TEST-OLDER', { created_at: ago(60) }));
    expect(await reconcileConfirmations(deps, { limit: 1 })).toMatchObject({ found: 1, fixed: 1 });
    expect(email.sent[0].subject).toContain('BK-TEST-OLDER');
  });
});

describe('isDeliverableAddress', () => {
  it.each([
    ['customer@gmail.com', true],
    ['a.b+tag@company.pk', true],
    ['booking-test@example.test', false],
    ['x@example.com', false],
    ['x@mail.example.org', false],
    ['x@foo.invalid', false],
    ['x@localhost', false],
    ['not-an-email', false],
    ['x@nodot', false],
  ])('%s -> %s', (email, expected) => {
    expect(isDeliverableAddress(email)).toBe(expected);
  });
});

describe('api/reconcile auth', () => {
  const SECRET = 'test-cron-secret-not-real';
  const run = async () => ({ found: 1, fixed: 1, failed: 0, skipped: 0, deferred: 0 });

  it('runs with the right bearer token and returns the counts', async () => {
    expect(await handleReconcileRequest(`Bearer ${SECRET}`, SECRET, run, 'req-1', memoryLogger())).toEqual({
      status: 200, body: { status: 'ok', found: 1, fixed: 1, failed: 0, skipped: 0, deferred: 0 },
    });
  });

  it.each([[null], [''], ['Bearer'], ['Bearer wrong'], [`bearer ${SECRET}`], [`Basic ${SECRET}`], [`Bearer ${SECRET}x`]])('401 for %j', async (header) => {
    let ran = false;
    const res = await handleReconcileRequest(header, SECRET, async () => { ran = true; return run(); }, null, memoryLogger());
    expect(res).toEqual({ status: 401, body: { status: 'unauthorized', message: 'Missing or wrong bearer token.' } });
    expect(ran).toBe(false);
  });

  it('refuses to run at all when CRON_SECRET is not set', async () => {
    const res = await handleReconcileRequest('Bearer anything', undefined, run, null, memoryLogger());
    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Reconcile is not configured (CRON_SECRET is not set).');
  });

  it('503 when bookings cannot be read', async () => {
    const res = await handleReconcileRequest(`Bearer ${SECRET}`, SECRET, async () => { throw new Error('Supabase GET network error'); }, null, memoryLogger());
    expect(res.status).toBe(503);
  });

  it('bearerMatches compares the whole token', () => {
    expect(bearerMatches(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(bearerMatches(`Bearer ${SECRET.slice(0, -1)}`, SECRET)).toBe(false);
    expect(bearerMatches(null, SECRET)).toBe(false);
  });
});

describe('.github/workflows/reconcile.yml', () => {
  const yml = readFileSync(resolve(__dirname, '../../.github/workflows/reconcile.yml'), 'utf8');

  it('calls the endpoint every 15 minutes with secrets referenced by name only', () => {
    expect(yml).toContain("- cron: '*/15 * * * *'");
    expect(yml).toContain('RECONCILE_URL: ${{ secrets.RECONCILE_URL }}');
    expect(yml).toContain('CRON_SECRET: ${{ secrets.CRON_SECRET }}');
    expect(yml).toContain('--header "Authorization: Bearer ${CRON_SECRET}"');
    // No literal URL or token values.
    expect(yml).not.toMatch(/https:\/\/[a-z0-9-]+\.vercel\.app\/api\/reconcile(?!\s*$)/m);
    expect(yml).not.toMatch(/Bearer [A-Za-z0-9]{12,}/);
  });

  it('has no repository permissions and never overlaps runs', () => {
    expect(yml).toMatch(/^permissions: \{\}$/m);
    expect(yml).toMatch(/concurrency:\n {2}group: reconcile-confirmations\n {2}cancel-in-progress: false/);
  });
});
