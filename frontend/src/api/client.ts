// Thin fetch wrapper for the renewal-risk backend.
// Centralizes base URL, JSON encoding, and error normalization so React
// code can `await api.calculateRenewalRisk(...)` without thinking about
// transport concerns.

export type RiskTier = 'high' | 'medium' | 'low';

export interface FlagSignals {
  daysToExpiryDays: number;
  paymentHistoryDelinquent: boolean;
  noRenewalOfferYet: boolean;
  rentGrowthAboveMarket: boolean;
}

export interface Flag {
  residentId: string;
  name: string;
  unitId: string;
  riskScore: number;
  riskTier: RiskTier;
  daysToExpiry: number;
  signals: FlagSignals;
}

export interface RiskResponse {
  propertyId: string;
  calculatedAt: string;
  totalResidents: number;
  flaggedCount: number;
  riskTiers: { high: number; medium: number; low: number };
  flags: Flag[];
}

export interface TriggerResponse {
  eventId: string;
  status: 'queued' | 'already_exists';
}

export class ApiError extends Error {
  status: number;
  code: string | null;

  constructor(status: number, code: string | null, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');

interface ErrorBody {
  error?: { code?: string; message?: string };
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
  } catch (err) {
    throw new ApiError(0, 'network_error', err instanceof Error ? err.message : 'network error');
  }

  if (!res.ok) {
    let body: ErrorBody = {};
    try {
      body = (await res.json()) as ErrorBody;
    } catch {
      // body wasn't JSON; that's fine
    }
    throw new ApiError(
      res.status,
      body.error?.code ?? null,
      body.error?.message ?? `HTTP ${res.status}`,
    );
  }

  return (await res.json()) as T;
};

export const getRenewalRisk = (propertyId: string): Promise<RiskResponse> =>
  request<RiskResponse>(`/api/v1/properties/${encodeURIComponent(propertyId)}/renewal-risk`);

export const calculateRenewalRisk = (propertyId: string, asOfDate: string): Promise<RiskResponse> =>
  request<RiskResponse>(
    `/api/v1/properties/${encodeURIComponent(propertyId)}/renewal-risk/calculate`,
    {
      method: 'POST',
      body: JSON.stringify({ propertyId, asOfDate }),
    },
  );

export const triggerRenewalEvent = (
  propertyId: string,
  residentId: string,
): Promise<TriggerResponse> =>
  request<TriggerResponse>(
    `/api/v1/properties/${encodeURIComponent(propertyId)}/residents/${encodeURIComponent(
      residentId,
    )}/renewal-events`,
    { method: 'POST' },
  );
