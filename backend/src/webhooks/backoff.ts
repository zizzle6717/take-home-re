// Exponential backoff for webhook delivery retries.
// `attemptCount` is the count of attempts already made (1-based after the
// failed attempt). Schedule: 1s, 2s, 4s, 8s, 16s, ...
export const computeNextRetryDelaySeconds = (attemptCount: number): number =>
  2 ** (attemptCount - 1);
