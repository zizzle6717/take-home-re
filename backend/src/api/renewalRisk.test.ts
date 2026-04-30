import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { db } from '../db';
import { createApp } from '../app';

// Integration tests for the POST/GET renewal-risk endpoints. We boot the
// Express app in-process and exercise it via supertest, hitting the real
// dev Postgres. Re-seeded in beforeAll; risk-run state truncated between
// tests so idempotency assertions stay deterministic.

describe('renewal risk API (integration)', () => {
  let app: Express;
  let propertyId: string;
  let asOfDate: string;

  beforeAll(async () => {
    await db.migrate.latest();
    await db.raw(
      'TRUNCATE TABLE renewal_offers, resident_ledger, leases, residents, unit_pricing, units, unit_types, properties RESTART IDENTITY CASCADE',
    );
    await db.seed.run();
    const prop = await db('properties').first<{ id: string }>('id');
    if (!prop) throw new Error('seed produced no property');
    propertyId = prop.id;
    asOfDate = new Date().toISOString().slice(0, 10);
    app = createApp();
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(async () => {
    await db.raw('TRUNCATE TABLE risk_scores, risk_calculation_runs RESTART IDENTITY CASCADE');
  });

  describe('POST /api/v1/properties/:propertyId/renewal-risk/calculate', () => {
    it('returns 200 with spec-shaped response and counts that add up', async () => {
      const res = await request(app)
        .post(`/api/v1/properties/${propertyId}/renewal-risk/calculate`)
        .send({ propertyId, asOfDate })
        .expect(200);

      expect(res.body.propertyId).toBe(propertyId);
      expect(typeof res.body.calculatedAt).toBe('string');
      expect(res.body.totalResidents).toBe(4);

      const tiers = res.body.riskTiers;
      expect(tiers).toMatchObject({ high: expect.any(Number), medium: expect.any(Number), low: expect.any(Number) });
      expect(tiers.high + tiers.medium + tiers.low).toBe(res.body.totalResidents);
      expect(res.body.flaggedCount).toBe(tiers.high + tiers.medium);
      expect(res.body.flags).toHaveLength(res.body.flaggedCount);

      // Under PLAN's literal formula: Jane=51 medium, John=63 medium, Bob=54 medium, Alice=0 low.
      const jane = res.body.flags.find((f: { name: string }) => f.name === 'Jane Doe');
      expect(jane).toBeDefined();
      expect(jane.riskTier).toBe('medium');
      expect(jane.riskScore).toBe(51);
      expect(jane.daysToExpiry).toBe(45);
      expect(jane.signals).toMatchObject({
        daysToExpiryDays: 45,
        paymentHistoryDelinquent: false,
        noRenewalOfferYet: true,
        rentGrowthAboveMarket: true, // 14% gap > 0
      });

      // Alice (low) is excluded from flags.
      const alice = res.body.flags.find((f: { name: string }) => f.name === 'Alice Johnson');
      expect(alice).toBeUndefined();
    });

    it('is idempotent: second call with same asOfDate reuses the run row', async () => {
      const first = await request(app)
        .post(`/api/v1/properties/${propertyId}/renewal-risk/calculate`)
        .send({ propertyId, asOfDate })
        .expect(200);

      const second = await request(app)
        .post(`/api/v1/properties/${propertyId}/renewal-risk/calculate`)
        .send({ propertyId, asOfDate })
        .expect(200);

      expect(second.body.calculatedAt).toBe(first.body.calculatedAt);

      const [{ count }] = await db('risk_calculation_runs').count<{ count: string }[]>('* as count');
      expect(Number(count)).toBe(1);
    });

    it('400 when asOfDate is missing', async () => {
      const res = await request(app)
        .post(`/api/v1/properties/${propertyId}/renewal-risk/calculate`)
        .send({ propertyId })
        .expect(400);

      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBeDefined();
    });

    it('400 when body propertyId disagrees with URL param', async () => {
      const res = await request(app)
        .post(`/api/v1/properties/${propertyId}/renewal-risk/calculate`)
        .send({ propertyId: '00000000-0000-0000-0000-000000000000', asOfDate })
        .expect(400);

      expect(res.body.error).toBeDefined();
    });
  });

  describe('GET /api/v1/properties/:propertyId/renewal-risk', () => {
    it('returns the most recent run with the same shape as POST', async () => {
      const post = await request(app)
        .post(`/api/v1/properties/${propertyId}/renewal-risk/calculate`)
        .send({ propertyId, asOfDate })
        .expect(200);

      const get = await request(app)
        .get(`/api/v1/properties/${propertyId}/renewal-risk`)
        .expect(200);

      expect(get.body.propertyId).toBe(post.body.propertyId);
      expect(get.body.calculatedAt).toBe(post.body.calculatedAt);
      expect(get.body.totalResidents).toBe(post.body.totalResidents);
      expect(get.body.flaggedCount).toBe(post.body.flaggedCount);
      expect(get.body.flags).toHaveLength(post.body.flags.length);
    });

    it('404 when no run exists for the property', async () => {
      // Truncated risk runs in beforeEach above, so any GET should 404.
      const res = await request(app)
        .get(`/api/v1/properties/${propertyId}/renewal-risk`)
        .expect(404);

      expect(res.body.error).toBeDefined();
    });

    it('404 for an unknown property id', async () => {
      const res = await request(app)
        .get('/api/v1/properties/00000000-0000-0000-0000-000000000000/renewal-risk')
        .expect(404);

      expect(res.body.error).toBeDefined();
    });
  });
});
