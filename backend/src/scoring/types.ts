// Domain types for the renewal-risk scoring pipeline.
//
// `Signals` is the input contract for the pure scoring function: everything
// it needs to produce a (score, tier) pair, with no I/O. `ResidentSignals`
// is what the SQL loader returns — `Signals` plus the identifying fields
// the API surfaces back to the dashboard.

export type RiskTier = 'high' | 'medium' | 'low';

export interface Signals {
  daysToExpiry: number;
  isDelinquent: boolean;
  hasPendingOffer: boolean;
  monthlyRent: number;
  marketRent: number | null;
}

export interface ScoreResult {
  score: number;
  tier: RiskTier;
}

export interface ResidentSignals extends Signals {
  residentId: string;
  firstName: string;
  lastName: string;
  unitId: string;
  unitNumber: string;
  leaseId: string;
  leaseType: string;
  paymentCount: number;
}
