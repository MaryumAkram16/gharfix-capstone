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
