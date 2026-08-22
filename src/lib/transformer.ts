export interface PricingBreakdown {
  label: string;
  value: number;
}

export interface PricingCardData {
  title: string;
  total: number;
  currency: string;
  breakdown: PricingBreakdown[];
  badges: string[];
}

export interface ProviderLocation {
  lat: number;
  lng: number;
  address: string;
}

export interface ProviderCardData {
  id: string;
  type: 'top_match' | 'alternative';
  name: string;
  rating: number;
  reviews: number;
  distance_km: number;
  price_from: number;
  computed_score: number;
  score_breakdown?: Record<string, number>;
  match_reason?: string;
  arrival_time: string;
  verified: boolean;
  location?: ProviderLocation;
  badges: string[];
  cta: string;
  availability_slots: string[];
}

export interface MatchViewData {
  status: string;
  stage: string;
  location: string;
  service_type: string;
  header: {
    service: string;
    location: string;
    providers_found: number;
  };
  pricing_card: PricingCardData;
  top_provider_card: ProviderCardData | null;
  alternative_cards: ProviderCardData[];
  nearby_areas?: string[]; // Nearby area suggestions for no-match fallback
  no_match_reason?: string; // Reason why no providers found
}

// ── NEARBY AREAS DATABASE ──
// Maps each area to nearby alternatives (for graceful no-match fallback)
const nearbyAreaMap: Record<string, string[]> = {
  // Lahore
  'Johar Town': ['Model Town', 'DHA Lahore', 'Bahria Town Lahore', 'Iqbal Town'],
  'Model Town': ['Johar Town', 'DHA Lahore', 'Gulshan-e-Ravi', 'Iqbal Town'],
  'DHA Lahore': ['Johar Town', 'Model Town', 'Bahria Town Lahore', 'Cantt Lahore'],
  'Bahria Town Lahore': ['DHA Lahore', 'Johar Town', 'Model Town', 'Faisal Town'],
  'Gulshan-e-Ravi': ['Model Town', 'Johar Town', 'Iqbal Town', 'Allama Iqbal Town'],
  'Iqbal Town': ['Johar Town', 'Gulshan-e-Ravi', 'Allama Iqbal Town', 'Model Town'],
  'Faisal Town': ['Bahria Town Lahore', 'Wapda Town', 'Johar Town', 'Township'],
  'Wapda Town': ['Faisal Town', 'Township', 'Johar Town', 'Iqbal Town'],
  'Township': ['Wapda Town', 'Faisal Town', 'Johar Town', 'Cantt Lahore'],
  'Cantt Lahore': ['DHA Lahore', 'Township', 'Askari Lahore', 'Mall Road Lahore'],
  'Allama Iqbal Town': ['Iqbal Town', 'Gulshan-e-Ravi', 'Johar Town', 'Thokar Niaz Baig'],
  'Askari Lahore': ['Cantt Lahore', 'DHA Lahore', 'Mall Road Lahore', 'Anarkali'],
  'Thokar Niaz Baig': ['Allama Iqbal Town', 'Iqbal Town', 'Gulshan-e-Ravi', 'Johar Town'],
  'Mall Road Lahore': ['Askari Lahore', 'Cantt Lahore', 'Saddar Lahore', 'Anarkali'],
  'Anarkali': ['Mall Road Lahore', 'Saddar Lahore', 'Askari Lahore', 'Cantt Lahore'],
  'Saddar Lahore': ['Anarkali', 'Mall Road Lahore', 'Cantt Lahore', 'Askari Lahore'],

  // Karachi
  'Clifton': ['DHA Karachi', 'Bahria Town Karachi', 'PECHS', 'Gulshan-e-Iqbal'],
  'DHA Karachi': ['Clifton', 'Bahria Town Karachi', 'PECHS', 'Gulshan-e-Iqbal'],
  'Bahria Town Karachi': ['DHA Karachi', 'Clifton', 'PECHS', 'Gulshan-e-Iqbal'],
  'PECHS': ['DHA Karachi', 'Clifton', 'Gulshan-e-Iqbal', 'North Nazimabad'],
  'Gulshan-e-Iqbal': ['PECHS', 'DHA Karachi', 'North Nazimabad', 'Nazimabad'],
  'North Nazimabad': ['Gulshan-e-Iqbal', 'Nazimabad', 'PECHS', 'Korangi'],
  'Nazimabad': ['North Nazimabad', 'Gulshan-e-Iqbal', 'Liaquatabad', 'Korangi'],
  'Korangi': ['Landhi', 'Malir', 'North Nazimabad', 'Nazimabad'],
  'Landhi': ['Korangi', 'Malir', 'Badin', 'Thatta'],
  'Malir': ['Landhi', 'Korangi', 'Saddar Karachi', 'Orangi Town'],
  'Saddar Karachi': ['Malir', 'Orangi Town', 'Liaquatabad', 'Federal B Area'],
  'Orangi Town': ['Saddar Karachi', 'Liaquatabad', 'Surjani Town', 'Federal B Area'],
  'Liaquatabad': ['Orangi Town', 'Nazimabad', 'Federal B Area', 'Surjani Town'],
  'Federal B Area': ['Liaquatabad', 'Orangi Town', 'Surjani Town', 'Scheme 33'],
  'Surjani Town': ['Federal B Area', 'Liaquatabad', 'Scheme 33', 'Orangi Town'],
  'Scheme 33': ['Surjani Town', 'Federal B Area', 'Gulistan-e-Jauhar', 'Gulshan-e-Iqbal'],
  'Gulistan-e-Jauhar': ['Scheme 33', 'Gulshan-e-Iqbal', 'PECHS', 'DHA Karachi'],

  // Islamabad
  'F-6': ['F-7', 'F-8', 'F-10', 'Blue Area'],
  'F-7': ['F-6', 'F-8', 'F-10', 'F-11'],
  'F-8': ['F-7', 'F-6', 'F-10', 'F-11'],
  'F-10': ['F-6', 'F-7', 'F-8', 'F-11'],
  'F-11': ['F-10', 'F-8', 'G-11', 'Blue Area'],
  'G-9': ['G-10', 'G-11', 'G-13', 'E-7'],
  'G-10': ['G-9', 'G-11', 'G-13', 'G-14'],
  'G-11': ['G-10', 'G-9', 'G-13', 'F-11'],
  'G-13': ['G-11', 'G-10', 'G-14', 'G-9'],
  'G-14': ['G-13', 'G-11', 'G-10', 'I-8'],
  'E-7': ['G-9', 'I-8', 'I-10', 'Blue Area'],
  'I-8': ['E-7', 'I-10', 'G-14', 'G-13'],
  'I-10': ['I-8', 'E-7', 'Blue Area', 'Bahria Town Islamabad'],
  'Blue Area': ['F-6', 'F-11', 'E-7', 'I-10'],
  'Bahria Town Islamabad': ['DHA Islamabad', 'I-10', 'Bani Gala', 'Soan Garden'],
  'DHA Islamabad': ['Bahria Town Islamabad', 'Bani Gala', 'PWD', 'Soan Garden'],
  'Bani Gala': ['DHA Islamabad', 'Bahria Town Islamabad', 'PWD', 'Soan Garden'],
  'PWD': ['DHA Islamabad', 'Bani Gala', 'Soan Garden', 'Bahria Town Islamabad'],
  'Soan Garden': ['PWD', 'DHA Islamabad', 'Bani Gala', 'Bahria Town Islamabad'],

  // Rawalpindi
  'Saddar Rawalpindi': ['Cantt Rawalpindi', 'Bahria Town Rawalpindi', 'DHA Rawalpindi', 'Satellite Town'],
  'Cantt Rawalpindi': ['Saddar Rawalpindi', 'DHA Rawalpindi', 'Bahria Town Rawalpindi', 'Satellite Town'],
  'Bahria Town Rawalpindi': ['DHA Rawalpindi', 'Cantt Rawalpindi', 'Saddar Rawalpindi', 'Satellite Town'],
  'DHA Rawalpindi': ['Bahria Town Rawalpindi', 'Cantt Rawalpindi', 'Saddar Rawalpindi', 'Chakri Road'],
  'Satellite Town': ['Saddar Rawalpindi', 'Cantt Rawalpindi', 'Chakri Road', 'Adiala Road'],
  'Chakri Road': ['DHA Rawalpindi', 'Satellite Town', 'Adiala Road', 'Cantt Rawalpindi'],
  'Adiala Road': ['Chakri Road', 'Satellite Town', 'DHA Rawalpindi', 'Bahria Town Rawalpindi'],

  // Faisalabad
  'Peoples Colony': ['Ghulam Muhammad Abad', 'Jinnah Colony', 'Susan Road', 'Satiana Road'],
  'Ghulam Muhammad Abad': ['Peoples Colony', 'Jinnah Colony', 'Susan Road', 'Satiana Road'],
  'Jinnah Colony': ['Peoples Colony', 'Ghulam Muhammad Abad', 'Susan Road', 'Satiana Road'],
  'Susan Road': ['Peoples Colony', 'Ghulam Muhammad Abad', 'Satiana Road', 'Jinnah Colony'],
  'Satiana Road': ['Susan Road', 'Peoples Colony', 'Ghulam Muhammad Abad', 'Jinnah Colony'],

  // Multan
  'Cantt Multan': ['Shah Rukn-e-Alam', 'Gulgasht Colony', 'DHA Multan', 'Saddar Multan'],
  'Shah Rukn-e-Alam': ['Cantt Multan', 'Gulgasht Colony', 'DHA Multan', 'Saddar Multan'],
  'Gulgasht Colony': ['Shah Rukn-e-Alam', 'Cantt Multan', 'DHA Multan', 'Saddar Multan'],
  'DHA Multan': ['Gulgasht Colony', 'Shah Rukn-e-Alam', 'Cantt Multan', 'Saddar Multan'],

  // Peshawar
  'Hayatabad': ['University Town', 'Cantt Peshawar', 'Saddar Peshawar', 'Nowshera'],
  'University Town': ['Hayatabad', 'Cantt Peshawar', 'Saddar Peshawar', 'Mardan'],
  'Cantt Peshawar': ['Saddar Peshawar', 'Hayatabad', 'University Town', 'Mardan'],
  'Saddar Peshawar': ['Cantt Peshawar', 'Hayatabad', 'University Town', 'Mardan'],
};

/**
 * Get nearby areas for fallback suggestions when no providers are found
 */
export function getNearbyAreas(area: string, count: number = 3): string[] {
  const nearby = nearbyAreaMap[area] || [];
  return nearby.slice(0, count);
}

export function transformMatchData(backendResponse: any): MatchViewData {
  if (!backendResponse) {
    return {
      status: 'error',
      stage: 'error',
      location: 'N/A',
      service_type: 'N/A',
      header: { service: 'N/A', location: 'N/A', providers_found: 0 },
      pricing_card: { title: 'N/A', total: 0, currency: 'PKR', breakdown: [], badges: [] },
      top_provider_card: null,
      alternative_cards: []
    };
  }

  // Handle common webhook unwrapping patterns
  let raw = backendResponse;
  
  // n8n often wraps in a single-element array
  if (Array.isArray(raw) && raw.length > 0) {
    // Use the first element, BUT if it looks like a flat list of providers, we should treat the whole array as matches later.
    // For now, let's peek at the first element.
    if (raw.length === 1 && !raw[0].matches && !raw[0].providers && raw[0].name) {
       // This is likely a single provider wrap, we'll handle flat arrays specifically below.
    } else if (raw.length > 1 && raw[0].name) {
       // Flat array of providers - we'll handle this in the matches logic.
    } else {
       raw = raw[0];
    }
  }

  // Unpack nested keys
  if (raw.matching_result) raw = raw.matching_result;
  if (raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data)) raw = raw.data;
  if (raw.body && typeof raw.body === 'object' && !Array.isArray(raw.body)) raw = raw.body;

  // ── WF3 multi-service shape ──────────────────────────────────────────────
  // WF3 returns: { status, workflow, services: [{ service, provider, alternatives, pricing }], summary }
  // Flatten it into the shape the rest of this function expects.
  if (
    raw.workflow === 'WF3-Pricing' ||
    (Array.isArray(raw.services) && raw.services.length > 0 && raw.services[0].provider !== undefined)
  ) {
    const wf3Services: any[] = raw.services || [];
    const summary = raw.summary || {};

    // Collect all providers across services, pick the first as top_match
    const allProviders: any[] = [];
    const breakdownItems: Record<string, number> = {};
    let grandTotal = summary.grand_total_pkr || summary.subtotal_pkr || 0;

    for (const svc of wf3Services) {
      if (svc.provider) allProviders.push(svc.provider);
      if (svc.alternatives) allProviders.push(...svc.alternatives);
      // Accumulate pricing breakdown across services
      const p = svc.pricing?.breakdown || {};
      for (const [k, v] of Object.entries(p)) {
        breakdownItems[k] = (breakdownItems[k] || 0) + Number(v);
      }
      // If grand total wasn't in summary, sum up service totals
      if (!grandTotal && svc.pricing?.total_pkr) grandTotal += svc.pricing.total_pkr;
    }

    // Build a flattened result that the code below can parse
    const primarySvc = wf3Services[0];
    raw = {
      status: raw.status,
      workflow: raw.workflow,
      location: summary.location || '',
      service_type: wf3Services.map((s: any) => s.service).join(' + '),
      top_match: primarySvc?.provider || allProviders[0] || null,
      alternatives: allProviders.slice(1),
      total_evaluated: summary.total_services || allProviders.length,
      pricing: {
        total_pkr: grandTotal,
        currency: 'PKR',
        breakdown: breakdownItems,
        labels: {},
      },
    };
  }
  // ────────────────────────────────────────────────────────────────────────

  const result = raw;

  // Mapping pricing breakdown from object to array
  const rawBreakdown = result.pricing?.breakdown || {};
  const breakdown: PricingBreakdown[] = Object.entries(rawBreakdown)
    .map(([key, value]) => ({
      label: key.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
      value: Number(value),
    }))
    .filter((item) => item.value > 0 || item.label === 'Base Rate');

  const pricingCard: PricingCardData = {
    title: 'Estimated Cost',
    total: result.pricing?.total_pkr || result.pricing?.total || 0,
    currency: result.pricing?.currency || 'PKR',
    breakdown,
    badges: result.pricing?.labels?.surge_active ? ['Surge Active'] : [],
  };

  const mapProvider = (p: any, type: 'top_match' | 'alternative'): ProviderCardData => ({
    id: p.id || p.place_id || 'N/A',
    type,
    name: p.name || 'Provider',
    rating: p.rating || 0,
    reviews: p.review_count || p.reviews || 0,
    distance_km: p.distance_km || 0,
    price_from: p.base_rate_pkr || p.price_from || 0,
    computed_score: p.computed_score || 0,
    score_breakdown: p.score_breakdown || null,
    match_reason: p.reasoning || p.match_reason || p.reason || '',
    arrival_time: p.estimated_arrival || p.arrival_time || 'N/A',
    verified: !!p.verified,
    location: p.coordinates
      ? { lat: p.coordinates.lat, lng: p.coordinates.lng, address: p.address || '' }
      : (p.location || { lat: 0, lng: 0, address: '' }),
    badges: Array.isArray(p.badges) ? p.badges : [],
    cta: 'Select Provider',
    availability_slots: Array.isArray(p.availability_slots) ? p.availability_slots : [],
  });

  // Mapping providers
  let topProvider: ProviderCardData | null = null;
  let alternatives: any[] = [];

  // Determine the match list
  if (result.top_match) {
    topProvider = mapProvider(result.top_match, 'top_match');
    alternatives = Array.isArray(result.alternatives) ? result.alternatives : [];
  } else if (result.name && (result.rating !== undefined || result.base_rate_pkr !== undefined)) {
    // If the object itself looks like a provider
    topProvider = mapProvider(result, 'top_match');
    alternatives = [];
  } else {
    // Look for a flat list of matches/providers
    let flatMatches = [];
    if (Array.isArray(backendResponse) && backendResponse.length > 0 && (backendResponse[0].name || backendResponse[0].provider_name)) {
      flatMatches = backendResponse;
    } else if (Array.isArray(result)) {
      flatMatches = result;
    } else if (Array.isArray(result.matches)) {
      flatMatches = result.matches;
    } else if (Array.isArray(result.providers)) {
      flatMatches = result.providers;
    }

    if (flatMatches.length > 0) {
      const sorted = [...flatMatches].sort((a, b) => (b.computed_score || 0) - (a.computed_score || 0));
      topProvider = mapProvider(sorted[0], 'top_match');
      alternatives = sorted.slice(1);
    }
  }

  const alternativeCards: ProviderCardData[] = alternatives.map((alt: any) => mapProvider(alt, 'alternative'));

  const decorateBadges = (p: ProviderCardData) => {
    if (p.verified && !p.badges.includes('Verified')) p.badges.push('Verified');
    if (p.rating >= 4.8 && !p.badges.includes('Highly Rated')) p.badges.push('Highly Rated');
    if (p.distance_km <= 5 && !p.badges.includes('Nearby')) p.badges.push('Nearby');
  };

  if (topProvider) {
    if (!topProvider.badges.includes('Best Match')) topProvider.badges.unshift('Best Match');
    decorateBadges(topProvider);
  }

  alternativeCards.forEach((alt) => decorateBadges(alt));

  const inferredLoc = result.location || (topProvider && topProvider.location?.address) || 'Unknown';
  const inferredSvc = result.service_type || (topProvider && topProvider.name ? 'Matched Service' : 'Service');

  // ── NEW: Compute nearby areas for no-match fallback ──
  const hasProviders = !!(topProvider || alternativeCards.length > 0);
  const nearbyAreas = !hasProviders ? getNearbyAreas(inferredLoc, 3) : undefined;
  const noMatchReason = !hasProviders ? `No ${inferredSvc} providers available in ${inferredLoc} right now` : undefined;

  return {
    status: hasProviders ? 'success' : 'no_matches',
    stage: hasProviders ? 'booking_ready' : 'no_matches',
    location: inferredLoc,
    service_type: inferredSvc,
    header: {
      service: inferredSvc,
      location: inferredLoc,
      providers_found:
        result.total_evaluated ||
        alternativeCards.length + (topProvider ? 1 : 0),
    },
    pricing_card: pricingCard,
    top_provider_card: topProvider,
    alternative_cards: alternativeCards.sort((a, b) => b.computed_score - a.computed_score),
    nearby_areas: nearbyAreas,
    no_match_reason: noMatchReason,
  };
}