import { describe, expect, it, vi } from 'vitest';
import { keywordIntent } from '../../lib/intent/fallback';
import { createGeminiParser, DEFAULT_GEMINI_MODEL } from '../../lib/intent/gemini';
import { handleIntentRequest, orchestrate, type IntentDeps } from '../../lib/intent/handler';
import { INTENT_PROMPT } from '../../lib/intent/prompt';
import { IntentParserError, type ParsedIntent } from '../../lib/intent/types';
import { validateParsedIntent } from '../../lib/intent/validate';
import { memoryLogger } from '../../lib/log';

const FAKE_KEY = 'test-gemini-key-not-real';
const NOW = new Date('2026-11-04T09:00:00Z');

const good: ParsedIntent = {
  services: ['AC repair', 'electrician'],
  primary_service: 'AC repair',
  location: 'G-13, Islamabad',
  urgency: 'high',
  preferred_time: 'kal subah',
  budget_sensitivity: 'medium',
  job_complexity: 'basic',
  confidence_score: 85,
  clarification_needed: false,
  clarification_question: null,
  detected_language: 'mixed',
};

describe('validateParsedIntent', () => {
  it('accepts the n8n example shape and tidies it', () => {
    const { value } = validateParsedIntent({ ...good, services: [' AC repair ', 'electrician', 'AC repair'], primary_service: null, location: '  ', confidence_score: 84.6 });
    expect(value).toEqual({ ...good, primary_service: 'AC repair', location: null, confidence_score: 85 });
  });

  it.each([
    ['urgency', { urgency: 'urgent' }],
    ['budget_sensitivity', { budget_sensitivity: 'cheap' }],
    ['job_complexity', { job_complexity: 'hard' }],
    ['detected_language', { detected_language: 'punjabi' }],
    ['confidence_score', { confidence_score: 140 }],
    ['confidence_score', { confidence_score: '85' }],
    ['clarification_needed', { clarification_needed: 'no' }],
    ['services', { services: 'plumber' }],
    ['services', { services: [42] }],
    ['services', { services: Array(11).fill('plumber') }],
    ['location', { location: 'x'.repeat(301) }],
  ])('rejects bad %s', (field, patch) => {
    expect(validateParsedIntent({ ...good, ...patch })).toEqual({ value: null, problems: [field] });
  });

  it('rejects non-objects', () => {
    expect(validateParsedIntent('{"services":[]}').value).toBeNull();
    expect(validateParsedIntent([good]).value).toBeNull();
  });
});

function geminiReply(payload: unknown, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: typeof payload === 'string' ? payload : JSON.stringify(payload) }] }, finishReason: 'STOP' }], ...extra }), { status: 200 });
}

describe('createGeminiParser', () => {
  it('sends the n8n prompt with a JSON response schema, key in a header only', async () => {
    const fetchImpl = vi.fn(async () => geminiReply(good));
    const parser = createGeminiParser({ apiKey: FAKE_KEY, fetch: fetchImpl });

    expect(await parser.parse('AC aur electrician chahiye G-13 mein, jaldi')).toEqual(good);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_MODEL}:generateContent`);
    expect(url).not.toContain(FAKE_KEY);
    expect(init.headers).toMatchObject({ 'x-goog-api-key': FAKE_KEY, 'Content-Type': 'application/json' });
    const body = JSON.parse(init.body as string);
    expect(body.systemInstruction.parts[0].text).toBe(INTENT_PROMPT);
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'User request: AC aur electrician chahiye G-13 mein, jaldi' }] }]);
    expect(body.generationConfig).toMatchObject({ responseMimeType: 'application/json', temperature: 0 });
    expect(body.generationConfig.responseSchema.required).toContain('confidence_score');
  });

  it('honours a configured model and base URL', async () => {
    const fetchImpl = vi.fn(async () => geminiReply(good));
    await createGeminiParser({ apiKey: FAKE_KEY, model: 'gemini-x', baseUrl: 'https://gemini.test/', fetch: fetchImpl }).parse('plumber');
    expect((fetchImpl.mock.calls[0] as unknown[])[0]).toBe('https://gemini.test/v1beta/models/gemini-x:generateContent');
  });

  it.each([
    ['unavailable', 'HTTP 429', new Response('{}', { status: 429 })],
    ['unavailable', 'HTTP 503', new Response('{}', { status: 503 })],
    ['config', 'HTTP 400 (bad request/model)', new Response('{}', { status: 400 })],
    ['config', 'HTTP 403 (bad key)', new Response('{}', { status: 403 })],
    ['unavailable', 'a network error', new TypeError('fetch failed')],
    ['unavailable', 'a timeout', Object.assign(new Error('t'), { name: 'TimeoutError' })],
    ['blocked', 'a blocked prompt', new Response(JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } }), { status: 200 })],
    ['blocked', 'a safety stop', new Response(JSON.stringify({ candidates: [{ finishReason: 'SAFETY' }] }), { status: 200 })],
    ['invalid_output', 'a truncated answer', new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"serv' }] }, finishReason: 'MAX_TOKENS' }] }), { status: 200 })],
    ['invalid_output', 'non-JSON text', geminiReply('Sure! Here is the JSON')],
    ['invalid_output', 'off-schema JSON', geminiReply({ ...good, urgency: 'urgent' })],
  ])('rejects with %s on %s', async (reason, _label, response) => {
    const fetchImpl = vi.fn(async () => { if (response instanceof Error) throw response; return response; });
    const err = await createGeminiParser({ apiKey: FAKE_KEY, fetch: fetchImpl }).parse('plumber').catch((e) => e);
    expect(err).toBeInstanceOf(IntentParserError);
    expect(err.reason).toBe(reason);
    expect(err.message).not.toContain(FAKE_KEY);
  });
});

describe('keywordIntent (fallback via src/lib/intent.ts)', () => {
  it.each([
    ['plumber | Lahore | Johar Town', { services: ['plumber'], location: 'Johar Town, Lahore', confidence_score: 90, detected_language: 'english', clarification_needed: false }],
    ['sasta electrician chahiye Karachi Clifton', { services: ['electrician'], location: 'Clifton, Karachi', budget_sensitivity: 'high', detected_language: 'roman_urdu' }],
    ['لاہور جوہر ٹاؤن میں پلمبر چاہیے', { services: ['plumber'], location: 'Johar Town, Lahore', detected_language: 'urdu', confidence_score: 90 }],
    ['Johar Town Lahore plumber urgent', { services: ['plumber'], urgency: 'high' }],
  ])('%s', (message, expected) => {
    expect(keywordIntent(message)).toMatchObject({ preferred_time: 'asap', job_complexity: 'basic', ...expected });
  });

  it('asks for the city when only the service is known (confidence 50)', () => {
    expect(keywordIntent('mujhe plumber chahiye')).toMatchObject({
      confidence_score: 50, clarification_needed: true, location: null,
      clarification_question: 'Aap kis shehar mein hain? (e.g., Lahore, Karachi, Islamabad, Rawalpindi, Faisalabad...)',
    });
  });

  it('asks for the service when nothing is recognised', () => {
    expect(keywordIntent('hello')).toMatchObject({ services: [], confidence_score: 0, clarification_question: 'What service do you need? (e.g., Plumber, AC Repair, Electrician)' });
  });
});

describe('orchestrate (n8n Multi-Service Orchestrator)', () => {
  it('passes a single service straight through', () => {
    expect(orchestrate({ ...good, services: ['plumber'], primary_service: 'plumber' })).toMatchObject({ service_type: 'plumber', is_multi_service: false });
  });
  it('packages several services', () => {
    expect(orchestrate(good)).toMatchObject({ service_type: 'Multi-Service Package', primary_service: 'AC repair', services: ['AC repair', 'electrician'], is_multi_service: true, service_count: 2 });
  });
});

function deps(over: Partial<IntentDeps> = {}) {
  const matchCalls: Array<Record<string, unknown>> = [];
  const log = memoryLogger();
  const d: IntentDeps = {
    parser: { name: 'gemini', parse: async () => good },
    matchProviders: async (input) => { matchCalls.push(input); return { status: 200, body: { status: 'success', workflow: 'WF3-Pricing', services: [] } }; },
    now: () => NOW,
    log,
    ...over,
  };
  return { d, matchCalls, log };
}

describe('handleIntentRequest', () => {
  const body = { raw_message: 'AC aur electrician chahiye G-13 Islamabad, jaldi', service_type: 'AC repair', city: 'Islamabad', area: 'G-13', source: 'home' };

  it('confident intent: matches in-process and wraps the result like n8n', async () => {
    const { d, matchCalls } = deps();
    const res = await handleIntentRequest(body, d);
    expect(res).toEqual({
      status: 200,
      body: { status: 'success', stage: 'booking_ready', matching_result: { status: 'success', workflow: 'WF3-Pricing', services: [] }, intent_source: 'gemini' },
    });
    expect(matchCalls).toEqual([orchestrate(good)]);
  });

  it('low confidence: the n8n clarification shape, with the model\'s question', async () => {
    const { d, matchCalls } = deps({ parser: { name: 'gemini', parse: async () => ({ ...good, confidence_score: 40, clarification_needed: true, clarification_question: 'Aap kis area mein hain?' }) } });
    expect((await handleIntentRequest(body, d)).body).toEqual({
      status: 'clarification_needed', stage: 'intent_extraction', confidence_score: 40, detected_language: 'mixed',
      clarification_question: 'Aap kis area mein hain?', original_input: body.raw_message, timestamp: NOW.toISOString(), intent_source: 'gemini',
    });
    expect(matchCalls).toEqual([]);
  });

  it('fills in a question when the model gives none', async () => {
    const { d } = deps({ parser: { name: 'gemini', parse: async () => ({ ...good, services: [], confidence_score: 30, clarification_question: null, detected_language: 'english' }) } });
    expect((await handleIntentRequest(body, d)).body).toMatchObject({ clarification_question: 'What service do you need? (e.g., Plumber, AC Repair, Electrician)' });
  });

  it('falls back to the keyword parser when Gemini fails, and logs why without the message', async () => {
    const { d, matchCalls, log } = deps({ parser: { name: 'gemini', parse: async () => { throw new IntentParserError('unavailable', 'Gemini answered HTTP 503', 503); } } });
    const res = await handleIntentRequest({ raw_message: 'plumber | Lahore | Johar Town' }, d);
    expect(res.body).toMatchObject({ status: 'success', intent_source: 'keyword_fallback' });
    expect(matchCalls[0]).toMatchObject({ services: ['plumber'], service_type: 'plumber', location: 'Johar Town, Lahore', is_multi_service: false });
    expect(log.records[0]).toMatchObject({ event: 'intent.parser_failed', parser: 'gemini', reason: 'unavailable', http_status: 503 });
    expect(JSON.stringify(log.records)).not.toContain('Johar Town');
  });

  it('uses the keyword parser directly when no Gemini key is configured', async () => {
    const { d } = deps({ parser: null });
    expect((await handleIntentRequest({ raw_message: 'mujhe plumber chahiye' }, d)).body).toMatchObject({
      status: 'clarification_needed', confidence_score: 50, detected_language: 'roman_urdu', intent_source: 'keyword_fallback',
    });
  });

  it('wraps a plain-text match reply as { data } (n8n HTTP node behaviour)', async () => {
    const { d } = deps({ matchProviders: async () => ({ status: 200, body: 'Sorry, no providers found in your area for this service' }) });
    expect((await handleIntentRequest(body, d)).body).toMatchObject({ matching_result: { data: 'Sorry, no providers found in your area for this service' } });
  });

  it('passes a 503 from matching through', async () => {
    const unavailable = { status: 503, body: { status: 'service_unavailable', message: 'Provider search is temporarily unavailable. Please try again in a minute.', retryable: true } };
    const { d } = deps({ matchProviders: async () => unavailable });
    expect(await handleIntentRequest(body, d)).toEqual(unavailable);
  });

  it('asks for the city when matching rejects a missing location', async () => {
    const { d } = deps({
      parser: { name: 'gemini', parse: async () => ({ ...good, location: null, detected_language: 'english' }) },
      matchProviders: async () => ({ status: 400, body: { status: 'validation_error', message: 'Missing fields: location', fields: ['location'] } }),
    });
    expect((await handleIntentRequest(body, d)).body).toMatchObject({ status: 'clarification_needed', clarification_question: expect.stringMatching(/^Which city/) });
  });

  it('asks for a service when confident but none was named', async () => {
    const { d, matchCalls } = deps({ parser: { name: 'gemini', parse: async () => ({ ...good, services: [], primary_service: null, detected_language: 'english' }) } });
    expect((await handleIntentRequest(body, d)).body).toMatchObject({ status: 'clarification_needed', clarification_question: expect.stringMatching(/^What service/) });
    expect(matchCalls).toEqual([]);
  });

  it.each([
    [{}, 'Missing fields: raw_message'],
    [{ raw_message: '   ' }, 'Missing fields: raw_message'],
    [{ raw_message: 'x'.repeat(4001) }, 'Invalid fields: raw_message (at most 4000 characters)'],
  ])('400 for %j', async (b, message) => {
    expect(await handleIntentRequest(b, deps().d)).toEqual({ status: 400, body: { status: 'validation_error', message, fields: ['raw_message'] } });
  });

  it('falls back to message / last_message like the UI sends them', async () => {
    const { d } = deps({ parser: null });
    expect((await handleIntentRequest({ message: 'plumber | Lahore | Johar Town' }, d)).body).toMatchObject({ status: 'success' });
  });
});
