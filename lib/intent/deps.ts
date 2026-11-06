import type { Env, FetchLike } from '../booking/deps.js';
import type { LocalHandler } from '../http/proxy.js';
import type { Logger } from '../log.js';
import { createGeminiParser, DEFAULT_GEMINI_MODEL, DEFAULT_GEMINI_THINKING_LEVEL, GEMINI_THINKING_LEVELS, type GeminiThinkingLevel } from './gemini.js';
import { resilientParser, type IncidentRecorder } from '../resilience/index.js';
import { handleIntentRequest } from './handler.js';
import type { IntentParser } from './types.js';

export interface IntentDepsOptions {
  env: Env;
  log: Logger;
  fetch?: FetchLike;
  recorder?: IncidentRecorder;
}

/** Gemini when GEMINI_API_KEY is set, otherwise null (keyword parser only). */
export function intentParserFromEnv({ env, log, fetch }: IntentDepsOptions): IntentParser | null {
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    log.warn('intent.gemini_not_configured', { fallback: 'keyword_parser' });
    return null;
  }
  const timeout = Number(env.GEMINI_TIMEOUT_MS);
  const model = env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  const rawLevel = env.GEMINI_THINKING_LEVEL?.trim().toLowerCase();
  let thinkingLevel = DEFAULT_GEMINI_THINKING_LEVEL;
  if (rawLevel) {
    if ((GEMINI_THINKING_LEVELS as readonly string[]).includes(rawLevel)) thinkingLevel = rawLevel as GeminiThinkingLevel;
    else log.warn('intent.config_invalid', { variable: 'GEMINI_THINKING_LEVEL', using: thinkingLevel, allowed: GEMINI_THINKING_LEVELS });
  }
  const timeoutMs = timeout > 0 ? timeout : undefined;
  log.info('intent.parser', { kind: 'gemini', model, thinking_level: thinkingLevel, timeout_ms: timeoutMs ?? 8000 });
  return createGeminiParser({ apiKey, model, fetch, timeoutMs, thinkingLevel });
}

/** khadmat-intent. Matching runs in-process through `matchRoute`, not over HTTP as in n8n. */
export function createIntentRoute(opts: IntentDepsOptions, matchRoute: LocalHandler): LocalHandler {
  let parser: IntentParser | null | undefined;
  return async (body, meta) => {
    if (parser === undefined) parser = intentParserFromEnv(opts);
    const ctx = opts.recorder ? { workflow: 'khadmat-intent', requestId: meta.requestId, recorder: opts.recorder } : null;
    return handleIntentRequest(body, {
      parser: parser && ctx ? resilientParser(parser, ctx) : parser,
      matchProviders: (input) => matchRoute(input, meta),
      now: () => new Date(),
      log: opts.log.child({ request_id: meta.requestId }),
    });
  };
}
