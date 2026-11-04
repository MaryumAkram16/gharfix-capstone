import type { Complexity, Language, Level, ParsedIntent } from './types.js';

// Model output is untrusted input. Everything the intent flow uses is checked
// here; anything off-schema is rejected (and the keyword parser takes over)
// rather than repaired by guessing.

const LEVELS: Level[] = ['low', 'medium', 'high'];
const COMPLEXITIES: Complexity[] = ['basic', 'intermediate', 'complex'];
const LANGUAGES: Language[] = ['urdu', 'roman_urdu', 'english', 'mixed'];

const MAX_SERVICE = 80;
const MAX_SERVICES = 10;
const MAX_TEXT = 300;

export interface IntentValidation {
  value: ParsedIntent | null;
  problems: string[];
}

function text(v: unknown, max: number): string | null | undefined {
  if (v === null) return null;
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  if (t === '') return null;
  return t.length <= max ? t : undefined;
}

export function validateParsedIntent(input: unknown): IntentValidation {
  const problems: string[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { value: null, problems: ['not an object'] };
  const o = input as Record<string, unknown>;

  let services: string[] = [];
  if (!Array.isArray(o.services) || o.services.length > MAX_SERVICES) {
    problems.push('services');
  } else {
    const cleaned = o.services.map((s) => text(s, MAX_SERVICE));
    if (cleaned.some((s) => s === undefined)) problems.push('services');
    services = [...new Set(cleaned.filter((s): s is string => typeof s === 'string'))];
  }

  const primary = text(o.primary_service, MAX_SERVICE);
  if (primary === undefined) problems.push('primary_service');
  const location = text(o.location, MAX_TEXT);
  if (location === undefined) problems.push('location');
  const preferred = text(o.preferred_time, MAX_TEXT);
  if (preferred === undefined) problems.push('preferred_time');
  const question = text(o.clarification_question, MAX_TEXT);
  if (question === undefined) problems.push('clarification_question');

  const oneOf = <T extends string>(field: string, allowed: T[]): T => {
    if (!allowed.includes(o[field] as T)) problems.push(field);
    return o[field] as T;
  };
  const urgency = oneOf('urgency', LEVELS);
  const budget = oneOf('budget_sensitivity', LEVELS);
  const complexity = oneOf('job_complexity', COMPLEXITIES);
  const language = oneOf('detected_language', LANGUAGES);

  const confidence = o.confidence_score;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 100) problems.push('confidence_score');
  if (typeof o.clarification_needed !== 'boolean') problems.push('clarification_needed');

  if (problems.length) return { value: null, problems };
  return {
    value: {
      services,
      primary_service: primary ?? services[0] ?? null,
      location: location ?? null,
      urgency,
      preferred_time: preferred ?? 'asap',
      budget_sensitivity: budget,
      job_complexity: complexity,
      confidence_score: Math.round(confidence as number),
      clarification_needed: o.clarification_needed as boolean,
      clarification_question: question ?? null,
      detected_language: language,
    },
    problems: [],
  };
}
