import { db } from '../db';
import type { ResidentSignals } from './types';

// Single-CTE loader returning one row per active lease at a property,
// joined to its latest pricing, pending offer status, and 6-month payment
// count. We treat any resident with fewer than 6 paid-rent ledger entries
// in the trailing 6 months as delinquent — same threshold the seed uses
// to encode "John missed one payment".
//
// Index access pattern relies on:
//   - leases (property_id, lease_end_date) WHERE status='active'
//   - resident_ledger (resident_id, transaction_date DESC)
// Both are created in 004_indexes.ts.

const SIGNALS_SQL = `
  WITH active_leases AS (
    SELECT
      l.id AS lease_id,
      l.resident_id,
      l.unit_id,
      l.monthly_rent,
      l.lease_type,
      l.lease_end_date,
      CASE
        WHEN l.lease_type = 'month_to_month' THEN 30
        ELSE (l.lease_end_date - :asOfDate ::date)
      END AS days_to_expiry
    FROM leases l
    WHERE l.property_id = :propertyId
      AND l.status = 'active'
      AND (l.lease_type = 'month_to_month' OR l.lease_end_date >= :asOfDate ::date)
  ),
  latest_pricing AS (
    SELECT DISTINCT ON (unit_id) unit_id, market_rent
    FROM unit_pricing
    ORDER BY unit_id, effective_date DESC
  ),
  pending_offers AS (
    SELECT DISTINCT lease_id
    FROM renewal_offers
    WHERE status IN ('pending', 'accepted')
  ),
  payment_counts AS (
    SELECT resident_id, COUNT(*)::int AS payment_count
    FROM resident_ledger
    WHERE transaction_type = 'payment'
      AND charge_code = 'rent'
      AND transaction_date >= :asOfDate ::date - INTERVAL '6 months'
      AND transaction_date <= :asOfDate ::date
    GROUP BY resident_id
  )
  SELECT
    r.id AS resident_id,
    r.first_name,
    r.last_name,
    u.id AS unit_id,
    u.unit_number,
    al.lease_id,
    al.monthly_rent,
    al.lease_type,
    al.days_to_expiry,
    lp.market_rent,
    (po.lease_id IS NOT NULL) AS has_pending_offer,
    COALESCE(pc.payment_count, 0) AS payment_count
  FROM active_leases al
  JOIN residents r ON r.id = al.resident_id
  JOIN units u ON u.id = al.unit_id
  LEFT JOIN latest_pricing lp ON lp.unit_id = al.unit_id
  LEFT JOIN pending_offers po ON po.lease_id = al.lease_id
  LEFT JOIN payment_counts pc ON pc.resident_id = al.resident_id
`;

interface SignalRow {
  resident_id: string;
  first_name: string;
  last_name: string;
  unit_id: string;
  unit_number: string;
  lease_id: string;
  monthly_rent: string | number;
  lease_type: string;
  days_to_expiry: number;
  market_rent: string | number | null;
  has_pending_offer: boolean;
  payment_count: number;
}

const PAYMENTS_PER_6_MONTHS = 6;

export const loadSignals = async (
  propertyId: string,
  asOfDate: string,
): Promise<ResidentSignals[]> => {
  const result = await db.raw<{ rows: SignalRow[] }>(SIGNALS_SQL, {
    propertyId,
    asOfDate,
  });
  return result.rows.map((r) => ({
    residentId: r.resident_id,
    firstName: r.first_name,
    lastName: r.last_name,
    unitId: r.unit_id,
    unitNumber: r.unit_number,
    leaseId: r.lease_id,
    leaseType: r.lease_type,
    daysToExpiry: Number(r.days_to_expiry),
    monthlyRent: Number(r.monthly_rent),
    marketRent: r.market_rent === null ? null : Number(r.market_rent),
    hasPendingOffer: r.has_pending_offer,
    paymentCount: r.payment_count,
    isDelinquent: r.payment_count < PAYMENTS_PER_6_MONTHS,
  }));
};
