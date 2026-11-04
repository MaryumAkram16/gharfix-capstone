import { ok, validationError, type HttpResult } from '../http/errors.js';
import type { Logger } from '../log.js';
import { clarificationFor, keywordIntent } from './fallback.js';
import { IntentParserError, type IntentParser, type ParsedIntent } from './types.js';

// khadmat-intent (WF1) without n8n:
//   parse (Gemini, else the keyword parser) -> confidence >= 70 ?
//     yes: orchestrate services -> provider match (in-process) -> success
//     no:  clarification question
// Response shapes are n8n's "Respond — Success + Matches1" and
// "Respond — Ask Clarification1"; `intent_source` is added to both.

export interface IntentDeps {
  /** null when GEMINI_API_KEY is not set: the keyword parser is used directly. */
  parser: IntentParser | null;
  matchProviders: (input: Record<string, unknown>) => Promise<HttpResult<unknown>>;
  now: () => Date;
  log: Logger;
}

export const CONFIDENCE_THRESHOLD = 70;
export const MAX_MESSAGE_CHARS = 4000;

type IntentSource = 'gemini' | 'keyword_fallback';

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

function clarification(intent: ParsedIntent, message: string, source: IntentSource, now: Date, question?: string) {
  return ok({
    status: 'clarification_needed',
    stage: 'intent_extraction',
    confidence_score: intent.confidence_score,
    detected_language: intent.detected_language,
    clarification_question:
      question ?? intent.clarification_question ?? clarificationFor({ services: intent.services, city: null, area: intent.location }, intent.detected_language),
    original_input: message,
    timestamp: now.toISOString(),
    intent_source: source,
  });
}

/** n8n "Multi-Service Orchestrator". */
export function orchestrate(intent: ParsedIntent): Record<string, unknown> {
  const services = intent.services;
  const primaryService = intent.primary_service || services[0];
  if (services.length === 1) return { ...intent, service_type: primaryService, is_multi_service: false };
  return {
    ...intent,
    service_type: 'Multi-Service Package',
    primary_service: primaryService,
    services,
    is_multi_service: true,
    service_count: services.length,
  };
}

export async function handleIntentRequest(body: unknown, deps: IntentDeps): Promise<HttpResult<unknown>> {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  // The chat UI sends every user message joined with " | " as raw_message.
  const message = str(b.raw_message) ?? str(b.message) ?? str(b.last_message);
  if (!message) return validationError('Missing fields: raw_message', ['raw_message']);
  if (message.length > MAX_MESSAGE_CHARS) return validationError(`Invalid fields: raw_message (at most ${MAX_MESSAGE_CHARS} characters)`, ['raw_message']);

  const now = deps.now();
  let intent: ParsedIntent;
  let source: IntentSource = 'gemini';
  if (deps.parser) {
    try {
      intent = await deps.parser.parse(message);
    } catch (err) {
      // The request text is not logged: it can hold names and addresses.
      deps.log.warn('intent.parser_failed', {
        parser: deps.parser.name,
        reason: err instanceof IntentParserError ? err.reason : 'unexpected',
        http_status: err instanceof IntentParserError ? err.httpStatus : null,
        error: err,
      });
      intent = keywordIntent(message);
      source = 'keyword_fallback';
    }
  } else {
    intent = keywordIntent(message);
    source = 'keyword_fallback';
  }
  const log = deps.log.child({ intent_source: source, confidence: intent.confidence_score, services: intent.services });

  if (intent.confidence_score < CONFIDENCE_THRESHOLD) {
    log.info('intent.clarification');
    return clarification(intent, message, source, now);
  }
  // Confident but no service named: n8n would have sent an empty list on to matching.
  if (intent.services.length === 0) {
    log.info('intent.clarification', { reason: 'no_service' });
    return clarification(intent, message, source, now, clarificationFor({ services: [], city: null, area: null }, intent.detected_language));
  }

  const match = await deps.matchProviders(orchestrate(intent));
  if (match.status === 400) {
    // Matching needs a location the parser did not find.
    log.info('intent.clarification', { reason: 'match_rejected' });
    return clarification(intent, message, source, now, clarificationFor({ services: intent.services, city: null, area: null }, intent.detected_language));
  }
  if (match.status >= 400) return match;

  log.info('intent.matched', { match_status: match.status });
  return ok({
    status: 'success',
    stage: 'booking_ready',
    // n8n's HTTP node wrapped a plain-text reply as { data: "..." }; the UI unwraps both.
    matching_result: match.body !== null && typeof match.body === 'object' ? match.body : { data: match.body },
    intent_source: source,
  });
}
