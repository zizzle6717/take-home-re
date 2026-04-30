import { describe, it, expect } from 'vitest';
import { computeEventId } from './eventId';

describe('computeEventId', () => {
  const prop = '11111111-1111-1111-1111-111111111111';
  const res = '22222222-2222-2222-2222-222222222222';
  const run = '33333333-3333-3333-3333-333333333333';

  it('is deterministic for the same inputs', () => {
    expect(computeEventId(prop, res, run)).toBe(computeEventId(prop, res, run));
  });

  it('yields different ids when any input differs', () => {
    const base = computeEventId(prop, res, run);
    expect(computeEventId('00000000-0000-0000-0000-000000000000', res, run)).not.toBe(base);
    expect(computeEventId(prop, '00000000-0000-0000-0000-000000000000', run)).not.toBe(base);
    expect(computeEventId(prop, res, '00000000-0000-0000-0000-000000000000')).not.toBe(base);
  });

  it('starts with evt_ and the suffix is lowercase hex', () => {
    const id = computeEventId(prop, res, run);
    expect(id.startsWith('evt_')).toBe(true);
    expect(id.slice(4)).toMatch(/^[0-9a-f]+$/);
  });
});
