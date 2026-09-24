import { describe, expect, it } from 'vitest';
import { computeBackoffMs, httpRetryDelayMs, nextRetryDate } from './backoff';

describe('backoff', () => {
  it('sigue la tabla de reintentos', () => {
    expect(computeBackoffMs(1)).toBe(5_000);
    expect(computeBackoffMs(2)).toBe(15_000);
    expect(computeBackoffMs(3)).toBe(30_000);
    expect(computeBackoffMs(4)).toBe(60_000);
    expect(computeBackoffMs(5)).toBe(300_000);
    expect(computeBackoffMs(6)).toBe(900_000);
    expect(computeBackoffMs(7)).toBe(1_800_000);
  });

  it('mantiene el ultimo valor para intentos altos', () => {
    expect(computeBackoffMs(50)).toBe(1_800_000);
    expect(computeBackoffMs(0)).toBe(5_000);
  });

  it('calcula la proxima fecha de reintento', () => {
    const next = nextRetryDate(1, new Date('2024-01-01T00:00:00.000Z'));
    expect(next).toBe('2024-01-01T00:00:05.000Z');
  });

  it('genera delays HTTP acotados', () => {
    for (let attempt = 1; attempt <= 10; attempt++) {
      const delay = httpRetryDelayMs(attempt);
      expect(delay).toBeGreaterThanOrEqual(500);
      expect(delay).toBeLessThanOrEqual(10_250);
    }
  });
});
