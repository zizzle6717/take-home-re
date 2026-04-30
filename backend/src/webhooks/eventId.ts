import { createHash } from 'crypto';

// Deterministic event id is the idempotency anchor at the create boundary:
// the same (property, resident, run) tuple always hashes to the same id, and
// the unique constraint on webhook_events.event_id absorbs duplicate triggers.
export const computeEventId = (
  propertyId: string,
  residentId: string,
  runId: string,
): string => {
  const digest = createHash('sha256')
    .update(`${propertyId}:${residentId}:${runId}`)
    .digest('hex');
  return `evt_${digest}`;
};
