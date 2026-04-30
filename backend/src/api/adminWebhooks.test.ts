import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { db } from '../db';
import { createApp } from '../app';

// Admin endpoints exposed for ops tooling:
//   GET  /api/v1/admin/webhooks/health        — counts + freshness signals
//   POST /api/v1/admin/webhooks/:id/retry     — requeue a DLQ row
//
// Both hit the dev Postgres directly. We bypass the enqueue/worker stack and
// insert webhook_events + webhook_delivery_state rows by hand so each case
// can pin status, attempt_count, and timestamps to a known shape.

interface SeededIds {
  propertyId: string;
  residentId: string;
}

const insertEvent = async (eventIdSuffix: string, propertyId: string, residentId: string): Promise<string> => {
  const [{ id }] = await db('webhook_events')
    .insert({
      event_id: `evt_test_${eventIdSuffix}`,
      property_id: propertyId,
      resident_id: residentId,
      event_type: 'renewal_risk_flagged',
      payload: JSON.stringify({ event: 'renewal_risk_flagged', eventId: `evt_test_${eventIdSuffix}` }),
    })
    .returning<{ id: string }[]>(['id']);
  return id;
};

describe('admin webhooks API (integration)', () => {
  let app: Express;
  let seeded: SeededIds;

  beforeAll(async () => {
    await db.migrate.latest();
    await db.raw(
      'TRUNCATE TABLE webhook_delivery_state, webhook_events, risk_scores, risk_calculation_runs, renewal_offers, resident_ledger, leases, residents, unit_pricing, units, unit_types, properties RESTART IDENTITY CASCADE',
    );
    await db.seed.run();
    const row = await db('residents').first<{ id: string; property_id: string }>('id', 'property_id');
    if (!row) throw new Error('seed produced no resident');
    seeded = { propertyId: row.property_id, residentId: row.id };
    app = createApp({ workerEnabled: false });
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(async () => {
    await db.raw('TRUNCATE TABLE webhook_delivery_state, webhook_events RESTART IDENTITY CASCADE');
  });

  describe('GET /api/v1/admin/webhooks/health', () => {
    it('returns zeros when no webhook rows exist', async () => {
      const res = await request(app).get('/api/v1/admin/webhooks/health').expect(200);
      expect(res.body.counts).toEqual({ pending: 0, in_flight: 0, delivered: 0, dlq: 0 });
      expect(res.body.oldestPendingAgeSeconds).toBeNull();
      expect(res.body.recentFailureRate).toBe(0);
    });

    it('counts rows by status', async () => {
      const eid1 = await insertEvent('h1', seeded.propertyId, seeded.residentId);
      const eid2 = await insertEvent('h2', seeded.propertyId, seeded.residentId);
      const eid3 = await insertEvent('h3', seeded.propertyId, seeded.residentId);

      await db('webhook_delivery_state').insert([
        {
          webhook_event_id: eid1,
          status: 'pending',
          attempt_count: 0,
          next_retry_at: db.fn.now(),
        },
        {
          webhook_event_id: eid2,
          status: 'delivered',
          attempt_count: 1,
          last_attempt_at: db.fn.now(),
          delivered_at: db.fn.now(),
          last_status_code: 200,
        },
        {
          webhook_event_id: eid3,
          status: 'dlq',
          attempt_count: 5,
          last_attempt_at: db.fn.now(),
          last_status_code: 503,
          last_error: 'service unavailable',
        },
      ]);

      const res = await request(app).get('/api/v1/admin/webhooks/health').expect(200);
      expect(res.body.counts).toEqual({ pending: 1, in_flight: 0, delivered: 1, dlq: 1 });
    });

    it('reports oldestPendingAgeSeconds for the oldest pending row', async () => {
      const eid = await insertEvent('age', seeded.propertyId, seeded.residentId);
      // Backdate created_at so age is reliably positive even on fast machines.
      await db('webhook_delivery_state').insert({
        webhook_event_id: eid,
        status: 'pending',
        attempt_count: 0,
        next_retry_at: db.fn.now(),
        created_at: db.raw("now() - INTERVAL '90 seconds'"),
      });

      const res = await request(app).get('/api/v1/admin/webhooks/health').expect(200);
      expect(res.body.oldestPendingAgeSeconds).toBeGreaterThanOrEqual(80);
    });

    it('computes recentFailureRate over rows attempted in the last hour', async () => {
      const eid1 = await insertEvent('f1', seeded.propertyId, seeded.residentId);
      const eid2 = await insertEvent('f2', seeded.propertyId, seeded.residentId);
      const eid3 = await insertEvent('f3', seeded.propertyId, seeded.residentId);
      const eid4 = await insertEvent('f4', seeded.propertyId, seeded.residentId);

      await db('webhook_delivery_state').insert([
        // recent success
        {
          webhook_event_id: eid1,
          status: 'delivered',
          attempt_count: 1,
          last_attempt_at: db.raw("now() - INTERVAL '5 minutes'"),
          last_status_code: 200,
          delivered_at: db.fn.now(),
        },
        // recent failures
        {
          webhook_event_id: eid2,
          status: 'pending',
          attempt_count: 1,
          last_attempt_at: db.raw("now() - INTERVAL '2 minutes'"),
          last_status_code: 503,
          next_retry_at: db.fn.now(),
        },
        {
          webhook_event_id: eid3,
          status: 'dlq',
          attempt_count: 5,
          last_attempt_at: db.raw("now() - INTERVAL '1 minute'"),
          last_status_code: 500,
        },
        // outside the recent window — must be excluded from the ratio
        {
          webhook_event_id: eid4,
          status: 'delivered',
          attempt_count: 1,
          last_attempt_at: db.raw("now() - INTERVAL '2 hours'"),
          last_status_code: 200,
          delivered_at: db.raw("now() - INTERVAL '2 hours'"),
        },
      ]);

      const res = await request(app).get('/api/v1/admin/webhooks/health').expect(200);
      // 2 failures of 3 recent attempts = 0.666...
      expect(res.body.recentFailureRate).toBeGreaterThan(0.6);
      expect(res.body.recentFailureRate).toBeLessThan(0.7);
    });
  });

  describe('POST /api/v1/admin/webhooks/:id/retry', () => {
    it('returns 404 for an unknown delivery state id', async () => {
      const res = await request(app)
        .post('/api/v1/admin/webhooks/00000000-0000-0000-0000-000000000000/retry')
        .expect(404);
      expect(res.body.error).toBeDefined();
    });

    it('returns 409 when the row is not in dlq status', async () => {
      const eid = await insertEvent('r409', seeded.propertyId, seeded.residentId);
      const [{ id }] = await db('webhook_delivery_state')
        .insert({
          webhook_event_id: eid,
          status: 'pending',
          attempt_count: 1,
          next_retry_at: db.fn.now(),
        })
        .returning<{ id: string }[]>(['id']);

      const res = await request(app).post(`/api/v1/admin/webhooks/${id}/retry`).expect(409);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBeDefined();
    });

    it('requeues a dlq row: status=pending, attempt_count=0, last_error cleared', async () => {
      const eid = await insertEvent('r200', seeded.propertyId, seeded.residentId);
      const [{ id }] = await db('webhook_delivery_state')
        .insert({
          webhook_event_id: eid,
          status: 'dlq',
          attempt_count: 5,
          last_error: 'all attempts failed',
          last_status_code: 503,
          last_attempt_at: db.fn.now(),
        })
        .returning<{ id: string }[]>(['id']);

      const res = await request(app).post(`/api/v1/admin/webhooks/${id}/retry`).expect(200);
      expect(res.body.id).toBe(id);
      expect(res.body.status).toBe('pending');
      expect(res.body.attemptCount).toBe(0);
      expect(res.body.lastError).toBeNull();

      const row = await db('webhook_delivery_state')
        .where({ id })
        .first<{ status: string; attempt_count: number; last_error: string | null; next_retry_at: Date | null }>(
          'status',
          'attempt_count',
          'last_error',
          'next_retry_at',
        );
      expect(row?.status).toBe('pending');
      expect(row?.attempt_count).toBe(0);
      expect(row?.last_error).toBeNull();
      expect(row?.next_retry_at).not.toBeNull();
    });
  });
});
