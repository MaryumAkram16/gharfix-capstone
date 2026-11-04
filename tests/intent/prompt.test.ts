import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { INTENT_PROMPT, INTENT_RESPONSE_SCHEMA } from '../../lib/intent/prompt';

const workflow = JSON.parse(
  readFileSync(resolve(__dirname, '../../n8n-workflows/WF1-3_Intent_Provider_Matching_Pricing_Agent.json'), 'utf8'),
) as { nodes: Array<{ name: string; parameters: Record<string, string> }> };

describe('INTENT_PROMPT', () => {
  it('is the n8n WF1 prompt, unchanged apart from the template line', () => {
    const n8n = workflow.nodes.find((n) => n.name === 'Basic LLM Chain1')!.parameters.text;
    expect(`=${INTENT_PROMPT}\n\nUser request: {{ $json.raw_message }}`).toBe(n8n);
  });

  it('requires every field of the n8n structured-output example', () => {
    const example = JSON.parse(workflow.nodes.find((n) => n.name === 'Structured Output Parser1')!.parameters.jsonSchemaExample);
    expect([...INTENT_RESPONSE_SCHEMA.required].sort()).toEqual(Object.keys(example).sort());
    expect(Object.keys(INTENT_RESPONSE_SCHEMA.properties).sort()).toEqual(Object.keys(example).sort());
  });
});
