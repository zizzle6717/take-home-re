import { describe, it, expect } from 'vitest';
import { computeNextRetryDelaySeconds } from './backoff';

describe('computeNextRetryDelaySeconds', () => {
  it('returns the documented exponential schedule 1, 2, 4, 8, 16', () => {
    expect(computeNextRetryDelaySeconds(1)).toBe(1);
    expect(computeNextRetryDelaySeconds(2)).toBe(2);
    expect(computeNextRetryDelaySeconds(3)).toBe(4);
    expect(computeNextRetryDelaySeconds(4)).toBe(8);
    expect(computeNextRetryDelaySeconds(5)).toBe(16);
  });
});
