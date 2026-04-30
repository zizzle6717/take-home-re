import { describe, it, expect } from 'vitest';
import { calculateScore } from './calculateScore';
import type { Signals } from './types';

// All expected scores below were derived from PLAN.md's literal formula:
//   final = round(0.4*daysScore + 0.25*delinqScore + 0.20*noOfferScore + 0.15*rentGapScore)
//   daysScore = min(100, max(0, (90 - daysToExpiry) / 90 * 100))   (MTM treated as 30)
//   delinqScore = isDelinquent ? 100 : 0
//   noOfferScore = hasPendingOffer ? 0 : 100
//   rentGapScore = min(100, max(0, (market - actual) / actual * 100 * 5))
// The spec narrative's "Jane = 85" example uses unreconciled arithmetic; under
// the locked formula Jane lands at 51 (medium). We assert the actual math, not
// the narrative.

const baseSignals = (overrides: Partial<Signals> = {}): Signals => ({
  daysToExpiry: 45,
  isDelinquent: false,
  hasPendingOffer: false,
  monthlyRent: 1400,
  marketRent: 1600,
  ...overrides,
});

describe('calculateScore', () => {
  it('Jane scenario: 45d, not delinquent, no offer, $1400 vs $1600 → 51 medium', () => {
    const result = calculateScore(baseSignals());
    expect(result.score).toBe(51);
    expect(result.tier).toBe('medium');
  });

  it('Alice scenario: 180d, not delinquent, has offer, $1600 vs $1600 → 0 low', () => {
    const result = calculateScore(
      baseSignals({
        daysToExpiry: 180,
        hasPendingOffer: true,
        monthlyRent: 1600,
        marketRent: 1600,
      }),
    );
    expect(result.score).toBe(0);
    expect(result.tier).toBe('low');
  });

  it('Bob scenario: MTM treated as 30d, not delinquent, no offer, $1450 vs $1600 → 54 medium', () => {
    const result = calculateScore(
      baseSignals({
        daysToExpiry: 30, // caller is responsible for MTM → 30 mapping
        monthlyRent: 1450,
        marketRent: 1600,
      }),
    );
    expect(result.score).toBe(54);
    expect(result.tier).toBe('medium');
  });

  it('John scenario: 60d, delinquent, no offer, $1500 vs $1600 → 63 medium', () => {
    const result = calculateScore(
      baseSignals({
        daysToExpiry: 60,
        isDelinquent: true,
        monthlyRent: 1500,
        marketRent: 1600,
      }),
    );
    expect(result.score).toBe(63);
    expect(result.tier).toBe('medium');
  });

  it('boundary: 0 days to expiry → daysScore = 100 (full days component)', () => {
    const result = calculateScore(
      baseSignals({
        daysToExpiry: 0,
        hasPendingOffer: true, // strip out other contributors
        monthlyRent: 1600,
        marketRent: 1600,
      }),
    );
    // Only days component contributes: 0.4 * 100 = 40
    expect(result.score).toBe(40);
  });

  it('boundary: 90+ days to expiry → daysScore = 0', () => {
    const result = calculateScore(
      baseSignals({
        daysToExpiry: 90,
        hasPendingOffer: true,
        monthlyRent: 1600,
        marketRent: 1600,
      }),
    );
    expect(result.score).toBe(0);
  });

  it('boundary: 200 days clamps daysScore to 0 (does not go negative)', () => {
    const result = calculateScore(
      baseSignals({
        daysToExpiry: 200,
        hasPendingOffer: true,
        monthlyRent: 1600,
        marketRent: 1600,
      }),
    );
    expect(result.score).toBe(0);
  });

  it('rent gap: 20%+ above actual caps rentGapScore at 100', () => {
    // 30% gap → 30*5=150, cap 100. Days/delinq/offer all neutral.
    const result = calculateScore({
      daysToExpiry: 200, // days = 0
      isDelinquent: false,
      hasPendingOffer: true, // noOffer = 0
      monthlyRent: 1000,
      marketRent: 1300, // 30% over
    });
    expect(result.score).toBe(15); // 0.15 * 100
  });

  it('null market_rent: drops rent component, renormalizes remaining three', () => {
    // Renormalized weights: 0.47 / 0.29 / 0.24 (proportional to 40/25/20).
    // Inputs: 45 days (daysScore=50), not delinquent (0), no offer (100).
    // Score = 0.47*50 + 0.29*0 + 0.24*100 = 23.5 + 0 + 24 = 47.5 → round to 48.
    const result = calculateScore({
      daysToExpiry: 45,
      isDelinquent: false,
      hasPendingOffer: false,
      monthlyRent: 1400,
      marketRent: null,
    });
    expect(result.score).toBe(48);
    expect(result.tier).toBe('medium');
  });

  it('tier boundary: score 69 → medium', () => {
    // Days=88.89 (10 days), delinquent, no offer, no rent gap (rent>=market)
    // 0.4*88.89 + 0.25*100 + 0.20*100 + 0 = 35.556 + 25 + 20 = 80.556 → too high.
    // Pick: days=27 (daysScore=70), delinq=100, no offer, no gap.
    // 0.4*70 + 0.25*100 + 0.20*100 + 0 = 28 + 25 + 20 = 73. Still too high.
    // Easier: synthesize via direct test of tier function bounds at the
    // computed-score level: pick inputs that deliver score=69 exactly.
    // daysToExpiry=72 → daysScore=20. delinq=100, noOffer=100, no gap.
    // 0.4*20 + 25 + 20 + 0 = 8+25+20 = 53. medium.
    // daysToExpiry=18 → daysScore=80. delinq=100, noOffer=100, no gap.
    // 0.4*80 + 25 + 20 + 0 = 32+25+20 = 77. high.
    // Days=24 → daysScore=73.33. 0.4*73.33+45 = 29.33+45 = 74.33→74 high.
    // Days=33.75 → daysScore=62.5. 0.4*62.5+45 = 25+45 = 70 high.
    // Days=33 → daysScore=63.33. 0.4*63.33+45=25.33+45=70.33→70 high.
    // Days=34 → daysScore=62.22. 0.4*62.22+45=24.89+45=69.89→70 high.
    // Days=35 → daysScore=61.11. 0.4*61.11+45=24.44+45=69.44→69 medium.
    const result = calculateScore({
      daysToExpiry: 35,
      isDelinquent: true,
      hasPendingOffer: false,
      monthlyRent: 1600,
      marketRent: 1600,
    });
    expect(result.score).toBe(69);
    expect(result.tier).toBe('medium');
  });

  it('tier boundary: score 70 → high', () => {
    // From above: days=33 produces 70.
    const result = calculateScore({
      daysToExpiry: 33,
      isDelinquent: true,
      hasPendingOffer: false,
      monthlyRent: 1600,
      marketRent: 1600,
    });
    expect(result.score).toBe(70);
    expect(result.tier).toBe('high');
  });

  it('tier boundary: score 39 → low', () => {
    // Need 39: try days=72 (daysScore=20), delinq=100, has offer, no gap.
    // 0.4*20 + 25 + 0 + 0 = 8+25 = 33. low.
    // days=53 (daysScore=41.11), delinq=100, has offer, no gap.
    // 0.4*41.11 + 25 = 16.44 + 25 = 41.44 → 41 medium.
    // days=58 (daysScore=35.56), 0.4*35.56+25 = 14.22+25=39.22→39 low.
    const result = calculateScore({
      daysToExpiry: 58,
      isDelinquent: true,
      hasPendingOffer: true,
      monthlyRent: 1600,
      marketRent: 1600,
    });
    expect(result.score).toBe(39);
    expect(result.tier).toBe('low');
  });

  it('tier boundary: score 40 → medium', () => {
    // days=56 (daysScore=37.78), delinq=100, has offer, no gap.
    // 0.4*37.78+25 = 15.11+25 = 40.11→40 medium.
    const result = calculateScore({
      daysToExpiry: 56,
      isDelinquent: true,
      hasPendingOffer: true,
      monthlyRent: 1600,
      marketRent: 1600,
    });
    expect(result.score).toBe(40);
    expect(result.tier).toBe('medium');
  });
});
