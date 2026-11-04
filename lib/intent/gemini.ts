import { INTENT_PROMPT, INTENT_RESPONSE_SCHEMA } from './prompt.js';
import { IntentParserError, type IntentParser, type ParsedIntent } from './types.js';
import { validateParsedIntent } from './validate.js';

// Gemini replaces WF1's OpenAI gpt-4o-mini step: same prompt, JSON-only
// output constrained by a response schema, and validated again here. Plain
// fetch against the REST API, with the key in a header, never in the URL.
//   https://ai.google.dev/api/generate-content
//   https://ai.google.dev/gemini-api/docs/structured-output

/** Per https://ai.google.dev/gemini-api/docs/deprecations (Nov 2026): 2.0 Flash is shut down, 3.8 Flash has no announced shutdown. */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
export const DEFAULT_GEMINI_URL = 'https://generativelanguage.googleapis.com';

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface GeminiOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

interface GenerateResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
}

export function createGeminiParser({
  apiKey,
  model = DEFAULT_GEMINI_MODEL,
  baseUrl = DEFAULT_GEMINI_URL,
  fetch: fetchImpl = fetch,
  timeoutMs = 8000,
}: GeminiOptions): IntentParser {
  const url = `${baseUrl.replace(/\/+$/, '')}/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  return {
    name: 'gemini',
    async parse(message: string): Promise<ParsedIntent> {
      let res: Response;
      try {
        res = await fetchImpl(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: INTENT_PROMPT }] },
            contents: [{ role: 'user', parts: [{ text: `User request: ${message}` }] }],
            generationConfig: { responseMimeType: 'application/json', responseSchema: INTENT_RESPONSE_SCHEMA, temperature: 0 },
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        const reason = err instanceof Error && err.name === 'TimeoutError' ? 'timed out' : 'network error';
        throw new IntentParserError('unavailable', `Gemini ${reason}`);
      }

      if (!res.ok) {
        // 400/401/403/404: bad key, model or request; retrying will not help.
        const kind = res.status === 429 || res.status >= 500 ? 'unavailable' : 'config';
        throw new IntentParserError(kind, `Gemini answered HTTP ${res.status}`, res.status);
      }

      let body: GenerateResponse;
      try {
        body = (await res.json()) as GenerateResponse;
      } catch {
        throw new IntentParserError('invalid_output', 'Gemini returned a non-JSON body');
      }
      if (body.promptFeedback?.blockReason) {
        throw new IntentParserError('blocked', `Gemini blocked the prompt (${body.promptFeedback.blockReason})`);
      }
      const candidate = body.candidates?.[0];
      if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
        throw new IntentParserError(candidate.finishReason === 'SAFETY' ? 'blocked' : 'invalid_output', `Gemini finished with ${candidate.finishReason}`);
      }
      const text = candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new IntentParserError('invalid_output', 'Gemini output is not JSON');
      }
      const { value, problems } = validateParsedIntent(parsed);
      if (!value) throw new IntentParserError('invalid_output', `Gemini output failed validation: ${problems.join(', ')}`);
      return value;
    },
  };
}
