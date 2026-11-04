// One JSON line per event, so Vercel's log search can filter on fields.
// Secrets are redacted by key name and email addresses are masked before
// anything is written, wherever they appear in the fields.

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogRecord {
  level: LogLevel;
  event: string;
  time: string;
  [field: string]: unknown;
}

export interface Logger {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

export type LogSink = (record: LogRecord) => void;

const SECRET_KEY = /(key|token|secret|password|authorization|cookie|apikey)/i;
// Field names that are about a key but never hold one.
const NOT_SECRET = new Set(['idempotency_key_present', 'constraint']);
const EMAIL = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
const MAX_DEPTH = 6;

export function maskEmails(text: string): string {
  return text.replace(EMAIL, '$1***@$2');
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[truncated]';
  if (typeof value === 'string') return maskEmails(value);
  if (value instanceof Error) {
    return { name: value.name, message: maskEmails(value.message) };
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEY.test(k) && !NOT_SECRET.has(k) ? '[redacted]' : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

const consoleSink: LogSink = (record) => {
  const line = JSON.stringify(record);
  if (record.level === 'error') console.error(line);
  else if (record.level === 'warn') console.warn(line);
  else console.log(line);
};

export function createLogger(
  base: Record<string, unknown> = {},
  sink: LogSink = consoleSink,
  now: () => Date = () => new Date(),
): Logger {
  const write = (level: LogLevel, event: string, fields: Record<string, unknown> = {}) => {
    const safe = redact({ ...base, ...fields }) as Record<string, unknown>;
    sink({ ...safe, level, event, time: now().toISOString() });
  };
  return {
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields),
    child: (fields) => createLogger({ ...base, ...fields }, sink, now),
  };
}

/** A logger that keeps records in memory, for tests. */
export function memoryLogger(): Logger & { records: LogRecord[] } {
  const records: LogRecord[] = [];
  const logger = createLogger({}, (r) => records.push(r), () => new Date('2026-11-04T09:00:00.000Z'));
  return Object.assign(logger, { records });
}
