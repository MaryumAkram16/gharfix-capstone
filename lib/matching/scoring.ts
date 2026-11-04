import type { Complexity, Provider } from './types.js';

// Port of WF2 "Calculate Provider Scores": the 6-factor weighted score with
// multi-service and complexity matching. Weights, thresholds and rounding are
// unchanged; tests/matching/golden.test.ts runs the original n8n code next to
// this one and compares the results.
//
// The one addition: n8n always had a rating, on-time score and cancellation
// rate because it invented them. Real providers may have none. An unknown
// factor contributes 0 to the total and is reported as null in
// score_breakdown (the UI hides non-numbers), never as a made-up value.

const COMPLEXITY_ORDER: Record<string, number> = { basic: 0, intermediate: 1, complex: 2 };

export const WEIGHTS = {
  distance: 0.2,
  availability: 0.2,
  review: 0.15,
  reliability: 0.15,
  specialization: 0.15,
  price: 0.1,
  cancellation: 0.05,
} as const;

export interface ScoreIntent {
  job_complexity: string | null;
  budget_sensitivity: string | null;
}

export interface ScoreBreakdown {
  distance: number;
  availability: number;
  review: number | null;
  reliability: number | null;
  specialization: number;
  price: number;
  cancellation: number | null;
  total: number;
}

export type ScoredProvider = Provider & {
  service_match: boolean;
  complexity_match: boolean;
  complexity_gap: number;
  requested_complexity: string;
  provider_complexity_levels: Complexity[];
  computed_score: number;
  score_breakdown: ScoreBreakdown;
  unknown_factors: Array<'review' | 'reliability' | 'cancellation'>;
};

export interface ServiceMatch {
  service: string;
  requested_complexity: string;
  top_match: ScoredProvider | null;
  alternatives: ScoredProvider[];
  total_evaluated: number;
  status: 'providers_found' | 'no_providers_found';
}

export function scoreProvider(provider: Provider, serviceType: string, intent: ScoreIntent, now: Date): ScoredProvider {
  // ── Service name match ──
  const normalizedService = serviceType.toLowerCase();
  const providerServices = (provider.services || []).map((s) => s.toLowerCase());
  const serviceMatch = providerServices.some((s) => s.includes(normalizedService) || normalizedService.includes(s));

  // ── Complexity match ──
  const requestedComplexity = intent.job_complexity || 'basic';
  const providerComplexityLevels = provider.complexity_levels || ['basic'];
  const complexityMatch = (providerComplexityLevels as string[]).includes(requestedComplexity);
  const providerMaxComplexityRank = Math.max(...providerComplexityLevels.map((c) => COMPLEXITY_ORDER[c] ?? 0));
  const requestedComplexityRank = COMPLEXITY_ORDER[requestedComplexity] ?? 0;
  const complexityGap = requestedComplexityRank - providerMaxComplexityRank;

  // ── Specialization ──
  let specializationScore: number;
  if (!serviceMatch) specializationScore = 20;
  else if (complexityMatch) specializationScore = 100;
  else if (complexityGap === 1) specializationScore = 55;
  else specializationScore = 25;

  // ── Distance ──
  const distanceScore = Math.max(0, 100 - provider.distance_km * 10);

  // ── Availability ──
  const hasSlots = provider.availability_slots?.length > 0;
  const underCapacity = provider.active_bookings < provider.max_daily_bookings;
  const availabilityScore = hasSlots && underCapacity ? 100 : hasSlots ? 50 : 0;

  // ── Reviews (unknown without a rating) ──
  let reviewScore: number | null = null;
  if (provider.rating !== null) {
    const ratingScore = (provider.rating / 5) * 100;
    const daysSinceReview = Math.floor((now.getTime() - new Date(provider.last_review_date as string).getTime()) / 86400000);
    const recencyBonus = daysSinceReview <= 3 ? 15 : daysSinceReview <= 7 ? 10 : daysSinceReview <= 30 ? 5 : 0;
    reviewScore = Math.min(100, ratingScore + recencyBonus);
  }

  // ── Reliability (unknown without an on-time record) ──
  const reliabilityScore = provider.on_time_score === null ? null : provider.on_time_score * 100;

  // ── Price ──
  let priceScore = 70;
  if (intent.budget_sensitivity === 'high') {
    if (provider.base_rate_pkr <= 700) priceScore = 100;
    else if (provider.base_rate_pkr <= 1000) priceScore = 70;
    else if (provider.base_rate_pkr <= 1500) priceScore = 45;
    else priceScore = 20;
  } else if (intent.budget_sensitivity === 'low') {
    priceScore = 80;
  } else {
    priceScore = provider.base_rate_pkr <= 1000 ? 80 : 60;
  }

  // ── Cancellations (unknown without a history) ──
  const cancellationScore = provider.cancellation_rate === null ? null : Math.max(0, 100 - provider.cancellation_rate * 500);

  // ── Weighted total: unknown factors add nothing ──
  const totalScore =
    distanceScore * WEIGHTS.distance +
    availabilityScore * WEIGHTS.availability +
    (reviewScore ?? 0) * WEIGHTS.review +
    (reliabilityScore ?? 0) * WEIGHTS.reliability +
    specializationScore * WEIGHTS.specialization +
    priceScore * WEIGHTS.price +
    (cancellationScore ?? 0) * WEIGHTS.cancellation;

  const round = (v: number | null) => (v === null ? null : Math.round(v));
  const unknown: ScoredProvider['unknown_factors'] = [];
  if (reviewScore === null) unknown.push('review');
  if (reliabilityScore === null) unknown.push('reliability');
  if (cancellationScore === null) unknown.push('cancellation');

  return {
    ...provider,
    service_match: serviceMatch,
    complexity_match: complexityMatch,
    complexity_gap: complexityGap,
    requested_complexity: requestedComplexity,
    provider_complexity_levels: providerComplexityLevels,
    computed_score: Math.round(totalScore),
    score_breakdown: {
      distance: Math.round(distanceScore),
      availability: Math.round(availabilityScore),
      review: round(reviewScore),
      reliability: round(reliabilityScore),
      specialization: Math.round(specializationScore),
      price: Math.round(priceScore),
      cancellation: round(cancellationScore),
      total: Math.round(totalScore),
    },
    unknown_factors: unknown,
  };
}

/** One ranked list per requested service: best first, then up to six alternatives (as WF2). */
export function scoreServices(services: string[], providers: Provider[], intent: ScoreIntent, now: Date): ServiceMatch[] {
  return services.map((serviceType) => {
    const scored = providers.map((p) => scoreProvider(p, serviceType, intent, now));
    scored.sort((a, b) => b.computed_score - a.computed_score);
    return {
      service: serviceType,
      requested_complexity: intent.job_complexity || 'basic',
      top_match: scored[0] || null,
      alternatives: scored.slice(1, 7),
      total_evaluated: scored.length,
      status: scored.length > 0 ? 'providers_found' : 'no_providers_found',
    };
  });
}
