import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { HttpError } from '../app';
import { calculateScore } from '../scoring/calculateScore';
import { loadSignals } from '../scoring/loadSignals';
import type { ResidentSignals, RiskTier } from '../scoring/types';

// POST/GET handlers for /properties/:propertyId/renewal-risk[/calculate].
// Idempotency anchor: unique(property_id, as_of_date) on risk_calculation_runs.
// Concurrent POSTs with the same as-of-date converge on a single run row;
// subsequent calls short-circuit to the existing run.

const CalculateBody = z.object({
  propertyId: z.string().min(1),
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'asOfDate must be ISO YYYY-MM-DD'),
});

interface SerializedSignals {
  daysToExpiryDays: number;
  paymentHistoryDelinquent: boolean;
  noRenewalOfferYet: boolean;
  rentGrowthAboveMarket: boolean;
}

interface FlagEntry {
  residentId: string;
  name: string;
  unitId: string;
  riskScore: number;
  riskTier: RiskTier;
  daysToExpiry: number;
  signals: SerializedSignals;
}

interface RiskResponse {
  propertyId: string;
  calculatedAt: string;
  totalResidents: number;
  flaggedCount: number;
  riskTiers: { high: number; medium: number; low: number };
  flags: FlagEntry[];
}

const serializeSignals = (s: ResidentSignals): SerializedSignals => ({
  daysToExpiryDays: s.daysToExpiry,
  paymentHistoryDelinquent: s.isDelinquent,
  noRenewalOfferYet: !s.hasPendingOffer,
  rentGrowthAboveMarket: s.marketRent !== null && s.marketRent > s.monthlyRent,
});

const propertyExists = async (propertyId: string): Promise<boolean> => {
  // UUID format check first — Postgres throws on malformed uuid input.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(propertyId)) {
    return false;
  }
  const row = await db('properties').where({ id: propertyId }).first('id');
  return Boolean(row);
};

interface RunRow {
  id: string;
  calculated_at: Date;
  total_residents: number;
  flagged_count: number;
}

interface ScoreRow {
  resident_id: string;
  score: number;
  tier: RiskTier;
  days_to_expiry: number | null;
  signals: SerializedSignals;
  first_name: string;
  last_name: string;
  unit_id: string;
}

const buildResponse = (
  propertyId: string,
  run: RunRow,
  scores: ScoreRow[],
): RiskResponse => {
  const tierCounts = { high: 0, medium: 0, low: 0 };
  for (const s of scores) tierCounts[s.tier]++;

  const flags: FlagEntry[] = scores
    .filter((s) => s.tier === 'high' || s.tier === 'medium')
    .map((s) => ({
      residentId: s.resident_id,
      name: `${s.first_name} ${s.last_name}`,
      unitId: s.unit_id,
      riskScore: s.score,
      riskTier: s.tier,
      daysToExpiry: s.days_to_expiry ?? 0,
      signals: s.signals,
    }));

  return {
    propertyId,
    calculatedAt: run.calculated_at.toISOString(),
    totalResidents: run.total_residents,
    flaggedCount: run.flagged_count,
    riskTiers: tierCounts,
    flags,
  };
};

const loadScoresForRun = async (runId: string): Promise<ScoreRow[]> =>
  db<ScoreRow>('risk_scores as rs')
    .join('residents as r', 'r.id', 'rs.resident_id')
    .join('leases as l', function joinLeases() {
      this.on('l.resident_id', '=', 'rs.resident_id').andOn('l.status', '=', db.raw("'active'"));
    })
    .join('units as u', 'u.id', 'l.unit_id')
    .where('rs.run_id', runId)
    .select(
      'rs.resident_id',
      'rs.score',
      'rs.tier',
      'rs.days_to_expiry',
      'rs.signals',
      'r.first_name',
      'r.last_name',
      // unitId is the human-readable unit number (e.g. "101"), not the UUID —
      // matches the spec example shape and is what a property manager recognizes.
      'u.unit_number as unit_id',
    );

export const renewalRiskRouter = Router();

renewalRiskRouter.post(
  '/properties/:propertyId/renewal-risk/calculate',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { propertyId } = req.params;
      const body = CalculateBody.parse(req.body);
      if (body.propertyId !== propertyId) {
        throw new HttpError(400, 'propertyId_mismatch', 'body.propertyId must match URL param');
      }
      if (!(await propertyExists(propertyId))) {
        throw new HttpError(404, 'property_not_found', `property ${propertyId} not found`);
      }

      const signals = await loadSignals(propertyId, body.asOfDate);
      const computed = signals.map((s) => {
        const { score, tier } = calculateScore(s);
        return { signals: s, score, tier };
      });
      const totalResidents = computed.length;
      const flaggedCount = computed.filter((c) => c.tier === 'high' || c.tier === 'medium').length;

      const run = await db.transaction(async (trx): Promise<RunRow> => {
        // Try to insert; on conflict, fetch existing run.
        const inserted = await trx('risk_calculation_runs')
          .insert({
            property_id: propertyId,
            as_of_date: body.asOfDate,
            total_residents: totalResidents,
            flagged_count: flaggedCount,
          })
          .onConflict(['property_id', 'as_of_date'])
          .ignore()
          .returning<RunRow[]>(['id', 'calculated_at', 'total_residents', 'flagged_count']);

        if (inserted.length > 0) {
          const newRun = inserted[0]!;
          if (computed.length > 0) {
            await trx('risk_scores').insert(
              computed.map((c) => ({
                run_id: newRun.id,
                resident_id: c.signals.residentId,
                score: c.score,
                tier: c.tier,
                days_to_expiry: c.signals.daysToExpiry,
                signals: JSON.stringify(serializeSignals(c.signals)),
              })),
            );
          }
          return newRun;
        }

        // Conflict path: another caller (or earlier call) won the race.
        const existing = await trx<RunRow>('risk_calculation_runs')
          .where({ property_id: propertyId, as_of_date: body.asOfDate })
          .first('id', 'calculated_at', 'total_residents', 'flagged_count');
        if (!existing) {
          throw new Error('runs row missing after conflict — should not happen');
        }
        return existing;
      });

      const scores = await loadScoresForRun(run.id);
      res.json(buildResponse(propertyId, run, scores));
    } catch (err) {
      next(err);
    }
  },
);

renewalRiskRouter.get(
  '/properties/:propertyId/renewal-risk',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { propertyId } = req.params;
      if (!(await propertyExists(propertyId))) {
        throw new HttpError(404, 'property_not_found', `property ${propertyId} not found`);
      }

      const run = await db<RunRow>('risk_calculation_runs')
        .where({ property_id: propertyId })
        .orderBy('calculated_at', 'desc')
        .first('id', 'calculated_at', 'total_residents', 'flagged_count');
      if (!run) {
        throw new HttpError(404, 'no_run', `no risk calculation runs for property ${propertyId}`);
      }

      const scores = await loadScoresForRun(run.id);
      res.json(buildResponse(propertyId, run, scores));
    } catch (err) {
      next(err);
    }
  },
);
