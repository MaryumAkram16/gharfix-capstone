import { describe, expect, it } from 'vitest';
import { transformMatchData } from '../../src/lib/transformer';

const wf3 = (provider: Record<string, unknown>) => ({
  status: 'success', stage: 'booking_ready',
  matching_result: {
    status: 'success', workflow: 'WF3-Pricing', is_multi_service: false,
    services: [{ service: 'plumber', provider, alternatives: [], pricing: { total_pkr: 910, breakdown: { base_rate: 900, distance_extra: 10 } } }],
    summary: { total_services: 1, grand_total_pkr: 910, location: 'G-13, Islamabad' },
  },
});

describe('transformMatchData ratings', () => {
  it('keeps a missing rating as null instead of turning it into 0 stars', () => {
    const ui = transformMatchData(wf3({ id: 'osm:node/1', name: 'Ali Plumbing', rating: null, review_count: null, distance_km: 0.7, distance_type: 'straight_line', source: 'openstreetmap', base_rate_pkr: 900 }));
    expect(ui.top_provider_card).toMatchObject({ rating: null, reviews: null, distance_type: 'straight_line', source: 'openstreetmap', price_from: 900 });
    expect(ui.top_provider_card!.badges).not.toContain('Highly Rated');
  });

  it('still shows real ratings and the Highly Rated badge (old n8n data)', () => {
    const ui = transformMatchData(wf3({ id: 'ChIJ-x', name: 'Rated', rating: 4.9, review_count: 120, distance_km: 2 }));
    expect(ui.top_provider_card).toMatchObject({ rating: 4.9, reviews: 120 });
    expect(ui.top_provider_card!.badges).toEqual(expect.arrayContaining(['Best Match', 'Highly Rated', 'Nearby']));
  });

  it('treats 0 as a real value, not as missing', () => {
    expect(transformMatchData(wf3({ id: 'p', name: 'P', rating: 0, review_count: 0 })).top_provider_card).toMatchObject({ rating: 0, reviews: 0 });
  });
});

describe('transformMatchData demo labelling', () => {
  const demoBody = () => {
    const body = wf3({ id: 'demo:isb-g13-home', name: '[DEMO] G-13 Home Repairs', rating: null, review_count: null, distance_km: 0.3, source: 'demo_seed', verified: false });
    (body.matching_result as Record<string, unknown>).data_source = 'demo_seed';
    return body;
  };

  it('flags the page and puts "Demo data" first on demo cards', () => {
    const ui = transformMatchData(demoBody());
    expect(ui.is_demo).toBe(true);
    expect(ui.top_provider_card!.badges).toEqual(['Demo data', 'Best Match', 'Nearby']);
  });

  it('passes on why demo data is shown (defaults to osm_empty)', () => {
    const unavailable = demoBody();
    (unavailable.matching_result as Record<string, unknown>).data_notes = { demo_reason: 'osm_unavailable' };
    expect(transformMatchData(unavailable).demo_reason).toBe('osm_unavailable');
    expect(transformMatchData(demoBody()).demo_reason).toBe('osm_empty');
  });

  it('is off for OpenStreetMap results and old responses without data_source', () => {
    const osm = wf3({ id: 'osm:node/1', name: 'Real', distance_km: 1, source: 'openstreetmap' });
    (osm.matching_result as Record<string, unknown>).data_source = 'openstreetmap';
    expect(transformMatchData(osm).is_demo).toBe(false);
    expect(transformMatchData(osm).demo_reason).toBeUndefined();
    expect(transformMatchData(wf3({ id: 'ChIJ-x', name: 'Old', rating: 4.2 })).is_demo).toBe(false);
    expect(transformMatchData(null).is_demo).toBe(false);
  });
});
