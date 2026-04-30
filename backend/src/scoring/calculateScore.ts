import type { Signals, ScoreResult, RiskTier } from './types';

// Pure renewal-risk scoring. Locked formula per PLAN.md "Phase 2 / Tasks / 3".
// Final score = round(0.4*daysScore + 0.25*delinqScore + 0.20*noOfferScore + 0.15*rentGapScore)
// where each subscore is on a 0-100 scale.
//
// When marketRent is null we drop the rent component and renormalize the
// remaining three weights proportionally (40/25/20 → 0.47/0.29/0.24).

const W_DAYS = 0.4;
const W_DELINQ = 0.25;
const W_NO_OFFER = 0.2;
const W_RENT = 0.15;

// Renormalized weights when marketRent is unavailable. Proportional to the
// original 40/25/20 budget summing to 85 → 0.47/0.29/0.24.
const W_DAYS_NO_RENT = 0.47;
const W_DELINQ_NO_RENT = 0.29;
const W_NO_OFFER_NO_RENT = 0.24;

const clamp = (n: number, lo = 0, hi = 100): number => Math.max(lo, Math.min(hi, n));

const daysScore = (daysToExpiry: number): number =>
  clamp(((90 - daysToExpiry) / 90) * 100);

const rentGapScore = (monthlyRent: number, marketRent: number): number =>
  clamp(((marketRent - monthlyRent) / monthlyRent) * 100 * 5);

export const tierFor = (score: number): RiskTier => {
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
};

export const calculateScore = (signals: Signals): ScoreResult => {
  const days = daysScore(signals.daysToExpiry);
  const delinq = signals.isDelinquent ? 100 : 0;
  const noOffer = signals.hasPendingOffer ? 0 : 100;

  let raw: number;
  if (signals.marketRent === null) {
    raw = W_DAYS_NO_RENT * days + W_DELINQ_NO_RENT * delinq + W_NO_OFFER_NO_RENT * noOffer;
  } else {
    const rent = rentGapScore(signals.monthlyRent, signals.marketRent);
    raw = W_DAYS * days + W_DELINQ * delinq + W_NO_OFFER * noOffer + W_RENT * rent;
  }

  const score = Math.round(raw);
  return { score, tier: tierFor(score) };
};
