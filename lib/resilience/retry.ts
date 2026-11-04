// withRetry: run an operation up to `attempts` times, waiting backoff(n)
// between tries, but only while isRetryable(error) says the failure is
// transient. The ORIGINAL error is rethrown, so callers' instanceof checks
// (RepositoryError -> 503, BookingConflictError -> replay) keep working.
//
// Which operations may use more than one attempt is decided in policies.ts.
// Retrying is only safe when a repeat cannot cause a second side effect.

export interface RetryPolicy {
  /** Total tries, including the first. 1 = no retry. */
  attempts: number;
  /** Milliseconds to wait after failed attempt n (1-based) before the next. */
  backoff: (attempt: number) => number;
  isRetryable: (err: unknown) => boolean;
}

export interface RetryReport {
  ok: boolean;
  attempts: number;
  /** Every error seen, in order (empty when the first attempt succeeded). */
  errors: unknown[];
  /** Waits actually slept, in ms. */
  waits: number[];
}

export interface RetryOptions extends RetryPolicy {
  sleep?: (ms: number) => Promise<void>;
  onFinish?: (report: RetryReport) => void;
}

export const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** base, base*factor, base*factor^2, ... */
export function exponentialBackoff(baseMs: number, factor = 3): (attempt: number) => number {
  return (attempt) => Math.round(baseMs * factor ** (attempt - 1));
}

export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions): Promise<T> {
  const { attempts, backoff, isRetryable, sleep = realSleep, onFinish } = opts;
  const errors: unknown[] = [];
  const waits: number[] = [];
  for (let attempt = 1; ; attempt++) {
    try {
      const value = await fn(attempt);
      onFinish?.({ ok: true, attempts: attempt, errors, waits });
      return value;
    } catch (err) {
      errors.push(err);
      if (attempt >= Math.max(1, attempts) || !isRetryable(err)) {
        onFinish?.({ ok: false, attempts: attempt, errors, waits });
        throw err;
      }
      const wait = Math.max(0, backoff(attempt));
      waits.push(wait);
      await sleep(wait);
    }
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`${what} timed out after ${ms}ms`), { name: 'TimeoutError' })), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
