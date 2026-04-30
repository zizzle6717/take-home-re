import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { db } from '../db';
import { createApp } from '../app';

// Integration test for POST /properties/:propertyId/residents/:residentId/renewal-events.
// We mount the app with a no-op deliver — i.e., we let the worker stay idle
// (workerEnabled: false) so we can assert on the queue state directly without
// races against the deliver loop.

describe('renewal events API (integration)', () => {
  let app: Express;
  let propertyId: string;
  let flaggedResidentId: string;
  let lowResidentId: string;
  const asOfDate = new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
    await db.migrate.latest();
    await db.raw(
      'TRUNCATE TABLE webhook_delivery_state, webhook_events, risk_scores, risk_calculation_runs, renewal_offers, resident_ledger, leases, residents, unit_pricing, units, unit_types, properties RESTART IDENTITY CASCADE',
    );
    await db.seed.run();

    const prop = await db('properties').first<{ id: string }>('id');
    if (!prop) throw new Error('seed produced no property');
    propertyId = prop.id;

    app = createApp({ workerEnabled: false });
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(async () => {
    await db.raw(
      'TRUNCATE TABLE webhook_delivery_state, webhook_events, risk_scores, risk_calculation_runs RESTART IDENTITY CASCADE',
    );

    // Stand up a fresh run so renewal-events has something to look up.
    await request(app)
      .post(`/api/v1/properties/${propertyId}/renewal-risk/calculate`)
      .send({ propertyId, asOfDate })
      .expect(200);

    const flagged = await db('risk_scores').whereIn('tier', ['high', 'medium']).first<{ resident_id: string }>('resident_id');
    if (!flagged) throw new Error('expected at least one flagged resident from seed');
    flaggedResidentId = flagged.resident_id;

    const low = await db('risk_scores').where({ tier: 'low' }).first<{ resident_id: string }>('resident_id');
    if (!low) throw new Error('expected at least one low-tier resident from seed');
    lowResidentId = low.resident_id;
  });

  it('returns 202 and a queued eventId for a flagged resident', async () => {
    const res = await request(app)
      .post(`/api/v1/properties/${propertyId}/residents/${flaggedResidentId}/renewal-events`)
      .expect(202);

    expect(res.body.eventId).toMatch(/^evt_[0-9a-f]+$/);
    expect(res.body.status).toBe('queued');

    const [{ count }] = await db('webhook_events').count<{ count: string }[]>('* as count');
    expect(Number(count)).toBe(1);
  });

  it('idempotent: second call for the same resident returns already_exists', async () => {
    const first = await request(app)
      .post(`/api/v1/properties/${propertyId}/residents/${flaggedResidentId}/renewal-events`)
      .expect(202);
    const second = await request(app)
      .post(`/api/v1/properties/${propertyId}/residents/${flaggedResidentId}/renewal-events`)
      .expect(202);

    expect(second.body.eventId).toBe(first.body.eventId);
    expect(second.body.status).toBe('already_exists');

    const [{ count }] = await db('webhook_events').count<{ count: string }[]>('* as count');
    expect(Number(count)).toBe(1);
  });

  it('also enqueues for a low-tier resident if asked (the trigger is admin intent, not a flag check)', async () => {
    const res = await request(app)
      .post(`/api/v1/properties/${propertyId}/residents/${lowResidentId}/renewal-events`)
      .expect(202);

    expect(res.body.status).toBe('queued');
  });

  it('404 when the property has no risk runs', async () => {
    await db.raw('TRUNCATE TABLE risk_scores, risk_calculation_runs RESTART IDENTITY CASCADE');
    const res = await request(app)
      .post(`/api/v1/properties/${propertyId}/residents/${flaggedResidentId}/renewal-events`)
      .expect(404);
    expect(res.body.error).toBeDefined();
  });

  it('404 when the resident is not in the latest run', async () => {
    const unknownResident = '00000000-0000-0000-0000-000000000000';
    const res = await request(app)
      .post(`/api/v1/properties/${propertyId}/residents/${unknownResident}/renewal-events`)
      .expect(404);
    expect(res.body.error).toBeDefined();
  });
});
