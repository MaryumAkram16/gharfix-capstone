// The structured intent WF1 extracted (n8n "Structured Output Parser1").

export type Level = 'low' | 'medium' | 'high';
export type Complexity = 'basic' | 'intermediate' | 'complex';
export type Language = 'urdu' | 'roman_urdu' | 'english' | 'mixed';

export interface ParsedIntent {
  services: string[];
  primary_service: string | null;
  location: string | null;
  urgency: Level;
  preferred_time: string;
  budget_sensitivity: Level;
  job_complexity: Complexity;
  /** 0-100. 70 or more goes straight to matching (n8n "Confidence ≥ 70?"). */
  confidence_score: number;
  clarification_needed: boolean;
  clarification_question: string | null;
  detected_language: Language;
}

export interface IntentParser {
  readonly name: string;
  /** Resolves with a validated intent, or rejects with IntentParserError. */
  parse(message: string): Promise<ParsedIntent>;
}

export type ParserFailure = 'unavailable' | 'config' | 'blocked' | 'invalid_output';

export class IntentParserError extends Error {
  readonly name = 'IntentParserError';
  constructor(readonly reason: ParserFailure, message: string, readonly httpStatus: number | null = null, readonly timedOut = false) {
    super(message);
  }
}
