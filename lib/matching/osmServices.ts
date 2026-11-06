// Service name -> how to find it in OpenStreetMap. Each rule lists OSM tags
// (https://wiki.openstreetmap.org/wiki/Map_features) and business-name
// patterns. Pakistani shops are often tagged only shop=yes with a name like
// "Ali AC Services", so names matter as much as tags.
//
// Name patterns are regular expressions valid in both Overpass (POSIX ERE)
// and JavaScript, matched case-insensitively. They come only from this
// table, never from user text.

export interface ServiceRule {
  keys: string[];
  tags: Array<[string, string]>;
  names: string[];
}

export const SERVICE_RULES: ServiceRule[] = [
  { keys: ['ac repair', 'ac installation', 'ac gas refill', 'ac', 'air conditioner', 'hvac'], tags: [['craft', 'hvac'], ['shop', 'air_conditioning']], names: ['(^| )a\\.?c\\.?( |$)', 'air ?condition', 'hvac'] },
  { keys: ['plumber', 'plumbing', 'geyser repair', 'geyser installation', 'water heater', 'water tank cleaning'], tags: [['craft', 'plumber']], names: ['plumb', 'sanitary'] },
  { keys: ['electrician', 'electrical', 'ups'], tags: [['craft', 'electrician'], ['shop', 'electrical']], names: ['electric'] },
  { keys: ['generator mechanic', 'generator'], tags: [['craft', 'electrician']], names: ['generator'] },
  { keys: ['solar installation', 'solar panel', 'solar system', 'solar'], tags: [], names: ['solar'] },
  { keys: ['carpenter', 'carpentry'], tags: [['craft', 'carpenter'], ['craft', 'joiner']], names: ['carpent', 'woodwork'] },
  { keys: ['painter', 'painting'], tags: [['craft', 'painter'], ['shop', 'paint']], names: ['paint'] },
  { keys: ['tutor', 'tuition', 'teacher'], tags: [['amenity', 'prep_school']], names: ['tuition', 'tutor', 'academy'] },
  { keys: ['beautician', 'beauty', 'salon', 'makeup'], tags: [['shop', 'beauty'], ['shop', 'hairdresser']], names: ['beauty', 'salon', 'parlou?r'] },
  {
    keys: ['fridge repair', 'refrigerator repair', 'washing machine repair', 'washing machine installation', 'microwave repair', 'oven repair',
      'dishwasher repair', 'dishwasher installation', 'water dispenser repair', 'water filter', 'iron repair'],
    tags: [['craft', 'electronics_repair'], ['shop', 'appliance']], names: ['appliance', 'electronic', 'refrigerat'],
  },
  { keys: ['tv repair'], tags: [['craft', 'electronics_repair'], ['shop', 'electronics']], names: ['electronic'] },
  { keys: ['phone repair', 'mobile repair'], tags: [['shop', 'mobile_phone'], ['craft', 'electronics_repair']], names: ['mobile', 'phone'] },
  { keys: ['computer repair', 'laptop repair'], tags: [['shop', 'computer']], names: ['computer', 'laptop'] },
  { keys: ['cctv installation', 'cctv'], tags: [['shop', 'electronics']], names: ['cctv', 'security system'] },
  { keys: ['networking & wifi', 'networking', 'wifi setup', 'router setup'], tags: [['shop', 'computer']], names: ['network', 'computer'] },
  { keys: ['car mechanic', 'car repair'], tags: [['shop', 'car_repair']], names: ['auto', 'motors', 'mechanic'] },
  { keys: ['bike mechanic', 'motorcycle mechanic'], tags: [['shop', 'motorcycle_repair'], ['shop', 'motorcycle']], names: ['motorcycle', 'bike'] },
  { keys: ['puncture repair', 'tyre repair'], tags: [['shop', 'tyres']], names: ['tyre', 'tire', 'puncture'] },
  { keys: ['car wash'], tags: [['amenity', 'car_wash']], names: ['car wash'] },
  { keys: ['pest control', 'fumigation', 'termite treatment'], tags: [['craft', 'pest_control']], names: ['pest', 'fumigat', 'termite'] },
  { keys: ['deep cleaning', 'cleaning', 'maid'], tags: [['craft', 'cleaning']], names: ['clean'] },
  { keys: ['laundry'], tags: [['shop', 'laundry'], ['shop', 'dry_cleaning']], names: ['laundry', 'dry ?clean'] },
  { keys: ['mason'], tags: [['craft', 'builder'], ['craft', 'stonemason']], names: ['construction', 'builder'] },
  { keys: ['tiler'], tags: [['craft', 'tiler'], ['shop', 'tiles']], names: ['tile'] },
  { keys: ['welder', 'welding'], tags: [['craft', 'welder'], ['craft', 'metal_construction']], names: ['weld'] },
  { keys: ['waterproofing'], tags: [['craft', 'roofer']], names: ['waterproof'] },
  { keys: ['false ceiling'], tags: [['craft', 'plasterer']], names: ['ceiling', 'gypsum'] },
  { keys: ['interior designer'], tags: [['shop', 'interior_decoration']], names: ['interior'] },
  { keys: ['gardener'], tags: [['craft', 'gardener'], ['shop', 'garden_centre']], names: ['nursery', 'garden'] },
  { keys: ['nurse', 'doctor home visit', 'doctor', 'caretaker'], tags: [['amenity', 'clinic'], ['amenity', 'doctors'], ['healthcare', 'nurse']], names: ['clinic', 'medical'] },
  { keys: ['physiotherapist', 'physiotherapy'], tags: [['healthcare', 'physiotherapist']], names: ['physio'] },
  { keys: ['lab test'], tags: [['healthcare', 'laboratory']], names: ['(^| )lab( |$)', 'laborator', 'diagnostic'] },
  { keys: ['car towing', 'towing'], tags: [], names: ['towing'] },
  { keys: ['security guard'], tags: [], names: ['security'] },
];

function wholeWord(key: string, text: string): boolean {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`).test(text);
}

/**
 * The rule for a requested service: an exact key, else the longest key that
 * appears as a whole phrase ("emergency plumber" -> plumber). Unknown
 * services fall back to searching business names for the service's own
 * words (letters only, 4+ characters), e.g. "cook" or "driver".
 */
export function ruleFor(service: string): ServiceRule | null {
  const s = service.toLowerCase().trim();
  const exact = SERVICE_RULES.find((r) => r.keys.includes(s));
  if (exact) return exact;

  let best: { rule: ServiceRule; len: number } | null = null;
  for (const rule of SERVICE_RULES) {
    for (const key of rule.keys) {
      if (wholeWord(key, s) && (!best || key.length > best.len)) best = { rule, len: key.length };
    }
  }
  if (best) return best.rule;

  const words = [...new Set(s.split(/[^a-z]+/).filter((w) => w.length >= 4))];
  return words.length ? { keys: [s], tags: [], names: words } : null;
}

export interface OsmElementLike {
  tags?: Record<string, string>;
}

/** Does this OSM element (by tag or by name) offer the service? */
export function elementMatches(rule: ServiceRule, el: OsmElementLike): boolean {
  const tags = el.tags ?? {};
  if (rule.tags.some(([k, v]) => tags[k] === v)) return true;
  const name = tags.name ?? tags['name:en'] ?? '';
  return name !== '' && rule.names.some((src) => new RegExp(src, 'i').test(name));
}

function quote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Keys a business carries in OSM. Name matching is limited to objects with
 * one of them, so Overpass narrows by its tag index before running the
 * case-insensitive name regex (a bare nwr["name"~...,i] scans every named
 * object in the area, which timed out on the public servers).
 */
export const BUSINESS_KEYS = ['shop', 'craft', 'office', 'amenity', 'healthcare'] as const;

/**
 * Overpass QL for tagged-or-named businesses within `radiusM` of a point.
 *   - nodes and ways only (businesses are not relations; relations are costly)
 *   - each tag selector once, e.g. nw["craft"="plumber"]
 *   - all name patterns as ONE regex, applied per business key
 * Coordinates are numbers; everything else comes from the rule table.
 */
export function overpassQuery(rules: ServiceRule[], lat: number, lng: number, radiusM: number, timeoutS: number): string {
  if (![lat, lng, radiusM, timeoutS].every(Number.isFinite)) throw new Error('overpassQuery: non-numeric coordinates');
  const around = `(around:${Math.round(radiusM)},${lat.toFixed(6)},${lng.toFixed(6)})`;
  const lines = new Set<string>();
  for (const rule of rules) {
    for (const [k, v] of rule.tags) lines.add(`  nw[${quote(k)}=${quote(v)}]${around};`);
  }
  const names = [...new Set(rules.flatMap((r) => r.names))];
  if (names.length) {
    // (a)|(b): valid alternation in both POSIX ERE (Overpass) and JavaScript.
    const combined = quote(names.map((n) => `(${n})`).join('|'));
    for (const key of BUSINESS_KEYS) lines.add(`  nw[${quote(key)}]["name"~${combined},i]${around};`);
  }
  return `[out:json][timeout:${Math.round(timeoutS)}];\n(\n${[...lines].join('\n')}\n);\nout center tags 200;`;
}
