import { extractIntent, i18nResponses, isPlaceholder } from '../../src/lib/intent.js';
import type { Language, ParsedIntent } from './types.js';

// The keyword parser used when Gemini is not configured or fails. Services,
// city, area and language come from extractIntent() in src/lib/intent.ts
// (the same parser the chat UI runs). Urgency and budget use the keyword
// rules from the WF1 prompt, and confidence uses the n8n keyword node's
// formula (service 50, city 20, area 20), so a complete request scores 90
// and clears the 70 threshold.

const URGENT = ['abhi', 'jaldi', 'urgent', 'asap', 'emergency', 'فوری'];
const BUDGET = ['sasta', 'kam budget', 'cheap', 'affordable', 'budget nahi'];

type I18nLanguage = keyof typeof i18nResponses;

export function i18nFor(language: Language): (typeof i18nResponses)[I18nLanguage] {
  return i18nResponses[language === 'mixed' ? 'roman_urdu' : language];
}

export interface Missing {
  services: string[];
  city: string | null;
  area: string | null;
}

/** The question to ask when the intent is not complete enough to match: service first, then city, then area. */
export function clarificationFor({ services, city, area }: Missing, language: Language): string {
  const t = i18nFor(language);
  if (services.length === 0) return t.askService;
  if (city && !area) return t.askArea(city);
  return t.askCity;
}

export function keywordIntent(message: string): ParsedIntent {
  const ex = extractIntent(message);
  const services = ex.serviceTypes.filter((s) => !isPlaceholder(s));
  const city = isPlaceholder(ex.city) ? null : ex.city;
  const area = isPlaceholder(ex.area) ? null : ex.area;
  const location = area && city ? `${area}, ${city}` : city ?? area ?? null;
  const lower = message.toLowerCase();
  const language = ex.detectedLanguage as Language;

  const confidence = (services.length ? 50 : 0) + (city ? 20 : 0) + (area ? 20 : 0);
  const needed = confidence < 70;

  return {
    services,
    primary_service: services[0] ?? null,
    location,
    urgency: URGENT.some((w) => lower.includes(w)) ? 'high' : 'medium',
    preferred_time: 'asap',
    budget_sensitivity: BUDGET.some((w) => lower.includes(w)) ? 'high' : 'medium',
    job_complexity: 'basic',
    confidence_score: confidence,
    clarification_needed: needed,
    clarification_question: needed ? clarificationFor({ services, city, area }, language) : null,
    detected_language: language,
  };
}
