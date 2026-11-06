import { describe, expect, it, vi } from 'vitest';
import { intentParserFromEnv } from '../../lib/intent/deps';
import { createGeminiParser, DEFAULT_GEMINI_THINKING_LEVEL } from '../../lib/intent/gemini';
import { memoryLogger } from '../../lib/log';
import { adviceFor } from '../../lib/resilience/alerts';

// Vercel logs 2026-11-06: with the key fixed, Gemini timed out at 8 s using
// the model's default (high) thinking. Requests now ask for low thinking.

const reply = () => Response.json({ candidates: [{ content: { parts: [{ text: '{}' }] }, finishReason: 'STOP' }] });
async function sentConfig(make: (fetch: any) => { parse(m: string): Promise<unknown> }) {
  const fetchImpl = vi.fn(async (_u: string, _i: RequestInit) => reply());
  await make(fetchImpl).parse('plumber').catch(() => {}); // '{}' fails validation; only the request matters
  return JSON.parse(fetchImpl.mock.calls[0][1].body as string).generationConfig;
}

describe('Gemini thinking level', () => {
  it('asks for low thinking by default, keeping the schema and temperature', async () => {
    expect(DEFAULT_GEMINI_THINKING_LEVEL).toBe('low');
    const cfg = await sentConfig((fetch) => createGeminiParser({ apiKey: 'k', fetch }));
    expect(cfg).toMatchObject({ thinkingConfig: { thinkingLevel: 'low' }, responseMimeType: 'application/json', temperature: 0 });
  });

  it('"off" sends no thinkingConfig', async () => {
    const cfg = await sentConfig((fetch) => createGeminiParser({ apiKey: 'k', fetch, thinkingLevel: 'off' }));
    expect(cfg).not.toHaveProperty('thinkingConfig');
  });

  it.each([['minimal', 'minimal'], [' HIGH ', 'high'], ['', 'low'], [undefined, 'low']])('GEMINI_THINKING_LEVEL=%j -> %s', async (raw, expected) => {
    const log = memoryLogger();
    const cfg = await sentConfig((fetch) => intentParserFromEnv({ env: { GEMINI_API_KEY: 'k', GEMINI_THINKING_LEVEL: raw }, log, fetch })!);
    expect(cfg.thinkingConfig.thinkingLevel).toBe(expected);
    expect(log.records.find((r) => r.event === 'intent.parser')).toMatchObject({ thinking_level: expected, timeout_ms: 8000 });
  });

  it('an unknown value falls back to low with a warning', async () => {
    const log = memoryLogger();
    const cfg = await sentConfig((fetch) => intentParserFromEnv({ env: { GEMINI_API_KEY: 'k', GEMINI_THINKING_LEVEL: 'turbo' }, log, fetch })!);
    expect(cfg.thinkingConfig.thinkingLevel).toBe('low');
    expect(log.records[0]).toMatchObject({ level: 'warn', event: 'intent.config_invalid', variable: 'GEMINI_THINKING_LEVEL' });
  });

  it('a Gemini timeout alert says what to change', () => {
    expect(adviceFor({ step: 'gemini.parse', error_class: 'IntentParserError:unavailable:timeout' })).toMatch(/GEMINI_THINKING_LEVEL.*GEMINI_TIMEOUT_MS/s);
  });
});
