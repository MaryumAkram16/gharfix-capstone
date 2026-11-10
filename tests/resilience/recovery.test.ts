import { describe, expect, it, vi } from 'vitest';
import { memoryLogger } from '../../lib/log';
import { MapsUnavailableError, type NearbySearch, type ProviderDirectory } from '../../lib/matching/directory';
import type { Place } from '../../lib/matching/types';
import { recoveringDirectory, resilientDirectory, type GuardContext } from '../../lib/resilience/guard';
import { payloadHash } from '../../lib/resilience/incidents';
import { recorderKit } from '../fakes/resilience';

// recoveringDirectory: one incident per primary failure, auto_fixed only when
// the fallback served the customer AND the cause clears by itself.

const search: NearbySearch = { services: ['plumber'], center: { lat: 33.6557, lng: 73.0138 }, radiusM: 5000, limit: 20 };
const place = (id: string): Place => ({ id, name: id, lat: 33.657, lng: 73.015, address: '', matchedServices: ['plumber'], sourceUrl: '', source: 'openstreetmap' });
const OSM_PLACES = [place('osm:node/1'), place('osm:node/2')];

const timeout = () => new MapsUnavailableError('directory', 'google places timed out', null, true);
const http = (status: number) => new MapsUnavailableError('directory', `google places answered HTTP ${status}`, status);

function dir(result: Place[] | Error): ProviderDirectory & { calls: number } {
  const d = { calls: 0, async searchNearby() { d.calls++; if (result instanceof Error) throw result; return result; } };
  return d;
}

function setup(primary: Place[] | Error, fallback: Place[] | Error) {
  const kit = recorderKit();
  const ctx: GuardContext = { workflow: 'khadmat-provider-match', requestId: 'req-1', recorder: kit.recorder };
  const log = memoryLogger();
  const p = dir(primary);
  const f = dir(fallback);
  return { kit, ctx, log, p, f, directory: recoveringDirectory(p, f, ctx, 'google.searchText', 'OpenStreetMap', log) };
}

describe('recoveringDirectory', () => {
  it('primary succeeds: its places, no incident, fallback never asked', async () => {
    const { kit, log, p, f, directory } = setup([place('google:a')], OSM_PLACES);
    expect(await directory.searchNearby(search)).toEqual([place('google:a')]);
    expect(p.calls).toBe(1);
    expect(f.calls).toBe(0);
    expect(kit.store.rows).toEqual([]);
    expect(kit.alerts.sent).toEqual([]);
    expect(log.records).toEqual([]);
  });

  it.each([
    ['a timeout', timeout(), 'MapsUnavailableError:directory:timeout'],
    ['a network error', new MapsUnavailableError('directory', 'google places network error'), 'MapsUnavailableError:directory'],
    ['HTTP 429', http(429), 'MapsUnavailableError:directory:429'],
    ['HTTP 503', http(503), 'MapsUnavailableError:directory:503'],
  ])('(b) %s covered by the fallback: auto_fixed, no alert, fallback places returned', async (_l, err, cls) => {
    const { kit, log, directory } = setup(err, OSM_PLACES);
    expect(await directory.searchNearby(search)).toEqual(OSM_PLACES);
    expect(kit.store.rows).toEqual([expect.objectContaining({
      workflow: 'khadmat-provider-match', step: 'google.searchText', error_class: cls, retryable: true, auto_fixed: true,
      request_id: 'req-1', payload_hash: payloadHash('khadmat-provider-match', 'google.searchText', cls),
    })]);
    expect(kit.alerts.sent).toEqual([]);
    expect(log.records).toEqual([expect.objectContaining({ level: 'warn', event: 'match.directory_fallback_used', services: ['plumber'] })]);
    // The text says what covered it, and does not claim a retry.
    const recorded = kit.log.records.find((r) => r.event === 'incident.recorded');
    expect(recorded).toMatchObject({ level: 'info', auto_fixed: true });
  });

  it.each([[400], [401], [403], [404]])('(c) HTTP %i covered by the fallback: customers served, but auto_fixed false and an alert', async (status) => {
    const { kit, directory } = setup(http(status), OSM_PLACES);
    expect(await directory.searchNearby(search)).toEqual(OSM_PLACES);
    expect(kit.store.rows).toEqual([expect.objectContaining({ step: 'google.searchText', error_class: `MapsUnavailableError:directory:${status}`, retryable: false, auto_fixed: false })]);
    expect(kit.alerts.sent).toHaveLength(1);
    const text = kit.alerts.sent[0].text;
    expect(text).toContain('OpenStreetMap was used instead and served the customer (2 provider(s))');
    expect(text).toContain('will not clear by itself');
    expect(text).not.toContain('A retry succeeded');
  });

  it('(c) an unexpected error that is not temporary is not "fixed" either', async () => {
    const { kit, directory } = setup(new TypeError('cannot read properties of undefined'), OSM_PLACES);
    expect(await directory.searchNearby(search)).toEqual(OSM_PLACES);
    expect(kit.store.rows).toEqual([expect.objectContaining({ retryable: false, auto_fixed: false })]);
    expect(kit.alerts.sent).toHaveLength(1);
  });

  it('(d) the fallback finds nothing: auto_fixed false, alert, empty result', async () => {
    const { kit, directory } = setup(http(503), []);
    expect(await directory.searchNearby(search)).toEqual([]);
    expect(kit.store.rows).toEqual([expect.objectContaining({ step: 'google.searchText', retryable: true, auto_fixed: false })]);
    expect(kit.alerts.sent).toHaveLength(1);
    expect(kit.alerts.sent[0].text).toContain('OpenStreetMap was tried instead but found no providers');
  });

  it('(a) the fallback throws too: the primary incident says so, and the fallback error is rethrown', async () => {
    const osmDown = new MapsUnavailableError('directory', 'directory timed out (2 Overpass instance(s) tried)', null, true);
    const { kit, directory } = setup(http(503), osmDown);
    await expect(directory.searchNearby(search)).rejects.toBe(osmDown);
    expect(kit.store.rows).toEqual([expect.objectContaining({ step: 'google.searchText', error_class: 'MapsUnavailableError:directory:503', auto_fixed: false })]);
    expect(kit.alerts.sent).toHaveLength(1);
    expect(kit.alerts.sent[0].text).toContain('OpenStreetMap was tried instead and failed too');
  });

  it('(a) with the real wiring, a resilient fallback records its own failure: one incident each, not two for Google', async () => {
    const kit = recorderKit();
    const ctx: GuardContext = { workflow: 'khadmat-provider-match', requestId: 'req-1', recorder: kit.recorder };
    const osm = resilientDirectory(dir(new MapsUnavailableError('directory', 'directory answered HTTP 504', 504)), ctx);
    const directory = recoveringDirectory(dir(timeout()), osm, ctx, 'google.searchText', 'OpenStreetMap');
    await expect(directory.searchNearby(search)).rejects.toBeInstanceOf(MapsUnavailableError);
    expect(kit.store.rows.map((r) => [r.step, r.auto_fixed])).toEqual([['osm.searchNearby', false], ['google.searchText', false]]);
  });

  it('a recording failure never breaks the search', async () => {
    const { kit, directory } = setup(http(503), OSM_PLACES);
    kit.store.down = true;
    expect(await directory.searchNearby(search)).toEqual(OSM_PLACES);
  });

  it('works without a logger', async () => {
    const kit = recorderKit();
    const ctx: GuardContext = { workflow: 'w', requestId: null, recorder: kit.recorder };
    const fallback = { searchNearby: vi.fn(async () => OSM_PLACES) };
    expect(await recoveringDirectory(dir(timeout()), fallback, ctx, 'google.searchText', 'OpenStreetMap').searchNearby(search)).toEqual(OSM_PLACES);
    expect(fallback.searchNearby).toHaveBeenCalledWith(search);
  });
});

describe('record() wording after the refactor', () => {
  it('a retry that succeeds still says "A retry succeeded." (guarded adds it now, not record)', async () => {
    const { guarded } = await import('../../lib/resilience/guard');
    const { SUPABASE_READ } = await import('../../lib/resilience/policies');
    const { RepositoryError } = await import('../../lib/booking/repository');
    const kit = recorderKit();
    const ctx: GuardContext = { workflow: 'khadmat-booking', requestId: null, recorder: kit.recorder, sleep: async () => {} };
    const fn = vi.fn().mockRejectedValueOnce(new RepositoryError('unavailable', 'down', 503)).mockResolvedValueOnce('ok');
    // Make the auto_fixed incident alert-visible: read what the recorder was given via a spy.
    const spy = vi.spyOn(kit.recorder, 'record');
    await guarded(ctx, 'supabase.bookedSlots', SUPABASE_READ, fn);
    expect(spy.mock.calls[0][1].tried).toMatch(/ A retry succeeded\.$/);
  });
});
