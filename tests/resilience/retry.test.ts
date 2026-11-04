import { describe, expect, it, vi } from 'vitest';
import { exponentialBackoff, withRetry, withTimeout, type RetryReport } from '../../lib/resilience/retry';

const transient = Object.assign(new Error('503'), { transient: true });
const permanent = new Error('401');
const isRetryable = (e: unknown) => (e as { transient?: boolean }).transient === true;

function sleeper() {
  const waits: number[] = [];
  return { waits, sleep: async (ms: number) => { waits.push(ms); } };
}

describe('withRetry', () => {
  it('succeeds on the second attempt after one backoff', async () => {
    const s = sleeper();
    let report: RetryReport | undefined;
    const fn = vi.fn().mockRejectedValueOnce(transient).mockResolvedValueOnce('ok');
    await expect(withRetry(fn, { attempts: 3, backoff: exponentialBackoff(250), isRetryable, sleep: s.sleep, onFinish: (r) => { report = r; } })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(s.waits).toEqual([250]);
    expect(report).toEqual({ ok: true, attempts: 2, errors: [transient], waits: [250] });
  });

  it('does not retry a non-retryable error and rethrows the original', async () => {
    const s = sleeper();
    const fn = vi.fn().mockRejectedValue(permanent);
    await expect(withRetry(fn, { attempts: 5, backoff: () => 100, isRetryable, sleep: s.sleep })).rejects.toBe(permanent);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(s.waits).toEqual([]);
  });

  it('stops after `attempts` and rethrows the last error', async () => {
    const s = sleeper();
    const last = Object.assign(new Error('503 again'), { transient: true });
    const fn = vi.fn().mockRejectedValueOnce(transient).mockRejectedValueOnce(transient).mockRejectedValueOnce(last);
    let report: RetryReport | undefined;
    await expect(withRetry(fn, { attempts: 3, backoff: exponentialBackoff(250), isRetryable, sleep: s.sleep, onFinish: (r) => { report = r; } })).rejects.toBe(last);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(s.waits).toEqual([250, 750]);
    expect(report).toMatchObject({ ok: false, attempts: 3 });
  });

  it('attempts: 1 means exactly one call, even for a retryable error', async () => {
    const fn = vi.fn().mockRejectedValue(transient);
    await expect(withRetry(fn, { attempts: 1, backoff: () => 0, isRetryable })).rejects.toBe(transient);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('passes the attempt number', async () => {
    const seen: number[] = [];
    await withRetry(async (n) => { seen.push(n); if (n < 3) throw transient; return n; }, { attempts: 3, backoff: () => 0, isRetryable, sleep: async () => {} });
    expect(seen).toEqual([1, 2, 3]);
  });
});

describe('exponentialBackoff / withTimeout', () => {
  it('grows by the factor', () => {
    const b = exponentialBackoff(250);
    expect([1, 2, 3].map(b)).toEqual([250, 750, 2250]);
  });

  it('times out with a TimeoutError', async () => {
    await expect(withTimeout(new Promise(() => {}), 20, 'email send')).rejects.toMatchObject({ name: 'TimeoutError', message: 'email send timed out after 20ms' });
    await expect(withTimeout(Promise.resolve(7), 20, 'x')).resolves.toBe(7);
  });
});
