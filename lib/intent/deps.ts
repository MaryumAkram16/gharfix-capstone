import type { Env, FetchLike } from '../booking/deps.js';
import type { LocalHandler } from '../http/proxy.js';
import type { Logger } from '../log.js';
import { createGeminiParser, DEFAULT_GEMINI_MODEL } from './gemini.js';
import { handleIntentRequest } from './handler.js';
import type { IntentParser } from './types.js';

export interface IntentDepsOptions {
  env: Env;
  log: Logger;
  fetch?: FetchLike;
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
  log.info('intent.parser', { kind: 'gemini', model });
  return createGeminiParser({ apiKey, model, fetch, timeoutMs: timeout > 0 ? timeout : undefined });
}

/** khadmat-intent. Matching runs in-process through `matchRoute`, not over HTTP as in n8n. */
export function createIntentRoute(opts: IntentDepsOptions, matchRoute: LocalHandler): LocalHandler {
  let parser: IntentParser | null | undefined;
  return async (body, meta) => {
    if (parser === undefined) parser = intentParserFromEnv(opts);
    return handleIntentRequest(body, {
      parser,
      matchProviders: (input) => matchRoute(input, meta),
      now: () => new Date(),
      log: opts.log.child({ request_id: meta.requestId }),
    });
  };
}
