import { describe, expect, it } from 'vitest';
import { extractIntent, FUZZY_STOPWORDS, latinAreaLeftover } from '../../src/lib/intent';

// src/lib/intent.ts runs in the browser and is the server's fallback parser
// (lib/intent/fallback.ts). Placeholders such as "[Specify Area]" mean
// "not found".

const parse = (text: string) => {
  const r = extractIntent(text);
  return { services: r.serviceTypes, city: r.city, area: r.area };
};

describe('false positives that used to slip through', () => {
  it.each([
    // "mein" was one edit from "mice" -> pest control
    ['Mujhe G-13 Islamabad mein plumber chahiye jaldi', { services: ['plumber'], city: 'Islamabad', area: 'G-13' }],
    // "aur" ~ "door" -> carpenter; "ac kharab" ~ "gaari kharab" -> car mechanic
    ['AC kharab hai aur bijli ka masla bhi | Islamabad | F-10', { services: ['AC repair', 'electrician'], city: 'Islamabad', area: 'F-10' }],
    // the service word became the area
    ['plumber chahiye Lahore', { services: ['plumber'], city: 'Lahore', area: '[Specify Area]' }],
    // "pani" ~ "paint" -> painter; "mein" -> pest control
    ['ghar mein pani ka masla hai, nalka leak kar raha hai', { services: ['plumber'], city: '[Specify City]', area: '[Specify Area]' }],
    // "kharab" ~ the city Karak, then the sentence became the area ("Mer Khrb Ho Gy...")
    ['mera fridge kharab ho gaya hai, kal subah aa jao', { services: ['fridge repair'], city: '[Specify City]', area: '[Specify Area]' }],
    // "ac repare" ~ "pc repair" -> computer repair
    ['ac repare', { services: ['AC repair'], city: '[Specify City]', area: '[Specify Area]' }],
    // "tawn" ~ "lawn" -> gardener
    ['plummer chahiye lahaur johar tawn', { services: ['plumber'], city: 'Lahore', area: 'Johar Town' }],
  ])('%s', (text, expected) => {
    expect(parse(text)).toEqual(expected);
  });
});

describe('fuzzy corrections that must keep working', () => {
  it('fixes misspelt services, cities and areas', () => {
    const r = extractIntent('plummer chahiye lahaur johar tawn');
    expect(r.serviceFuzzyHints).toEqual([{ heard: 'plummer', corrected: 'plumber' }]);
    expect([r.cityFuzzyMatched, r.cityHeard]).toEqual([true, 'lahaur']);
    expect([r.areaFuzzyMatched, r.areaHeard]).toEqual([true, 'johar tawn']);
  });

  it.each([
    ['carpanter chahiye', ['carpenter']],
    ['plummer and carpanter', ['plumber', 'carpenter']],
    ['need a plumbr in lahore', ['plumber']],
    ['electrishan chahiye', ['electrician']],
  ])('%s -> %j', (text, services) => {
    expect(extractIntent(text).serviceTypes).toEqual(services);
  });

  it('prefers the longer phrase: "johar tawn" is Johar Town, not Gulistan-e-Jauhar', () => {
    expect(parse('plumber lahore johar tawn').area).toBe('Johar Town');
    expect(parse('plumber karachi gulistan-e-jauhar').area).toBe('Gulistan-e-Jauhar');
  });
});

describe('exact matches are unchanged', () => {
  it.each([
    ['plumber | Lahore | Johar Town', { services: ['plumber'], city: 'Lahore', area: 'Johar Town' }],
    ['sasta electrician chahiye Karachi Clifton', { services: ['electrician'], city: 'Karachi', area: 'Clifton' }],
    ['need a plumber in lahore dha phase 5', { services: ['plumber'], city: 'Lahore', area: 'DHA Lahore' }],
    ['electrician chahiye pindi', { services: ['electrician'], city: 'Rawalpindi', area: '[Specify Area]' }],
    ['لاہور جوہر ٹاؤن میں پلمبر چاہیے', { services: ['plumber'], city: 'Lahore', area: 'Johar Town' }],
    ['bijli nahi aa rahi, jaldi electrician bhejo', { services: ['electrician'], city: '[Specify City]', area: '[Specify Area]' }],
  ])('%s', (text, expected) => {
    expect(parse(text)).toEqual(expected);
  });
});

describe('latinAreaLeftover', () => {
  it('keeps a short unknown area name after removing city, services and filler as whole words', () => {
    expect(latinAreaLeftover('plumber chahiye lahore model colony', 'Lahore')).toBe('model colony');
    expect(parse('plumber chahiye lahore model colony').area).toBe('Model Colony');
  });

  it('rejects sentences, single letters and numbers', () => {
    expect(latinAreaLeftover('plumber chahiye lahore abhi please ghar pe', 'Lahore')).toBeNull();
    expect(latinAreaLeftover('lahore mein kal subah koi achha sa banda bhej do jo kaam jaanta ho', 'Lahore')).toBeNull();
    expect(latinAreaLeftover('lahore 42', 'Lahore')).toBeNull();
  });

  it('does not cut letters out of words (the old /a|in|at/ regex did)', () => {
    expect(latinAreaLeftover('lahore samanabad', 'Lahore')).toBe('samanabad');
  });
});

describe('FUZZY_STOPWORDS', () => {
  it('holds the words that caused false matches', () => {
    for (const w of ['mein', 'aur', 'kharab', 'masla', 'jaldi', 'chahiye']) expect(FUZZY_STOPWORDS.has(w)).toBe(true);
  });
});
