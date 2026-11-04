import type { ServiceMatch } from './scoring.js';

// Port of "WF3 — Pricing Agent (inline)": base rate, complexity multiplier,
// surge window, distance charge, 10% multi-service discount. Same numbers
// and rounding as n8n (checked in tests/matching/golden.test.ts).
//
// One deliberate difference: n8n read the server clock's hour, and Vercel
// runs in UTC. The surge windows (09-11, 17-19) are Pakistan rush hours, so
// the hour passed in here is Pakistan time (pakistanHour()).

const COMPLEXITY_MULTIPLIER: Record<string, number> = { basic: 1.0, intermediate: 1.3, complex: 1.6 };

export interface PricingIntent {
  job_complexity: string | null;
  location: string | null;
}

/** 0-23 in Asia/Karachi. */
export function pakistanHour(now: Date): number {
  const hour = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', hour: '2-digit', hourCycle: 'h23' }).format(now);
  return Number(hour);
}

export function isSurgeHour(hour: number): boolean {
  return (hour >= 9 && hour <= 11) || (hour >= 17 && hour <= 19);
}

export function priceServices(matches: ServiceMatch[], intent: PricingIntent, hour: number) {
  if (matches.length === 0) {
    return { status: 'error', message: 'No services found in match result', received: { services: matches } };
  }

  const pricedServices = matches.map((serviceResult) => {
    const provider = serviceResult.top_match;
    if (!provider) {
      return { service: serviceResult.service, status: 'no_provider', message: 'No provider found for this service' };
    }

    const baseRate = provider.base_rate_pkr;

    // 1. Complexity
    const complexityMultiplier = COMPLEXITY_MULTIPLIER[intent.job_complexity ?? ''] || 1.0;
    const complexityAddition = Math.round(baseRate * (complexityMultiplier - 1));

    // 2. Surge
    const surgeMultiplier = isSurgeHour(hour) ? 1.2 : 1.0;
    const surgeAddition = Math.round((baseRate + complexityAddition) * (surgeMultiplier - 1));

    // 3. Distance
    const distanceCost = Math.round(provider.distance_km * 50);

    const totalPrice = baseRate + complexityAddition + surgeAddition + distanceCost;

    return {
      service: serviceResult.service,
      provider,
      alternatives: serviceResult.alternatives || [],
      pricing: {
        total_pkr: totalPrice,
        breakdown: {
          base_rate: baseRate,
          complexity_extra: complexityAddition,
          surge_extra: surgeAddition,
          distance_extra: distanceCost,
        },
        display: `${serviceResult.service}: PKR ${totalPrice} (Base: ${baseRate} + Complexity: ${complexityAddition} + Surge: ${surgeAddition} + Distance: ${distanceCost})`,
      },
    };
  });

  const isMultiService = pricedServices.length > 1;
  const totalBeforeDiscount = pricedServices.reduce((sum, s) => sum + (('pricing' in s && s.pricing?.total_pkr) || 0), 0);
  const multiServiceDiscount = isMultiService ? Math.round(totalBeforeDiscount * 0.1) : 0;
  const grandTotal = totalBeforeDiscount - multiServiceDiscount;

  return {
    status: 'success',
    workflow: 'WF3-Pricing',
    is_multi_service: isMultiService,
    services: pricedServices,
    summary: {
      total_services: pricedServices.length,
      subtotal_pkr: totalBeforeDiscount,
      multi_service_discount_pkr: multiServiceDiscount,
      grand_total_pkr: grandTotal,
      location: intent.location,
      job_complexity: intent.job_complexity,
    },
  };
}
