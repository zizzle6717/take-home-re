import { db } from '../db';
import { config } from '../config';

// One delivery attempt. Loads the payload, POSTs it with an Idempotency-Key
// header so the receiver can dedupe, and reports the outcome. The 5s timeout
// keeps a hung RMS endpoint from stalling the worker.

export type DeliveryOutcome =
  | { outcome: 'delivered'; statusCode: number }
  | { outcome: 'failed'; statusCode: number | null; errorMessage: string };

export interface DeliveryStateRow {
  id: string;
  webhook_event_id: string;
  attempt_count: number;
  max_attempts: number;
}

export interface AttemptDeliveryOptions {
  url?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const REQUEST_TIMEOUT_MS = 5_000;

const logStructured = (fields: Record<string, unknown>): void => {
  const parts = Object.entries(fields).map(([k, v]) => `${k}=${JSON.stringify(v)}`);
  console.log(parts.join(' '));
};

export const attemptDelivery = async (
  state: DeliveryStateRow,
  opts: AttemptDeliveryOptions = {},
): Promise<DeliveryOutcome> => {
  const event = await db('webhook_events')
    .where({ id: state.webhook_event_id })
    .first<{ event_id: string; payload: unknown }>('event_id', 'payload');
  if (!event) {
    return { outcome: 'failed', statusCode: null, errorMessage: 'webhook_events row not found' };
  }

  const url = opts.url ?? config.RMS_WEBHOOK_URL;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const attempt = state.attempt_count + 1;
  const startedAt = Date.now();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': event.event_id,
      },
      body: JSON.stringify(event.payload),
      signal: controller.signal,
    });
    const latencyMs = Date.now() - startedAt;

    if (res.status >= 200 && res.status < 300) {
      logStructured({
        eventId: event.event_id,
        attempt,
        statusCode: res.status,
        latencyMs,
        outcome: 'delivered',
      });
      return { outcome: 'delivered', statusCode: res.status };
    }

    const bodyText = await res.text().catch(() => '');
    const errorMessage = `non-2xx status: ${bodyText.slice(0, 200) || res.statusText}`;
    logStructured({
      eventId: event.event_id,
      attempt,
      statusCode: res.status,
      latencyMs,
      outcome: 'failed',
      error: errorMessage,
    });
    return { outcome: 'failed', statusCode: res.status, errorMessage };
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    const errorMessage = err instanceof Error ? err.message : String(err);
    logStructured({
      eventId: event.event_id,
      attempt,
      statusCode: null,
      latencyMs,
      outcome: 'failed',
      error: errorMessage,
    });
    return { outcome: 'failed', statusCode: null, errorMessage };
  } finally {
    clearTimeout(timer);
  }
};
