import { useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  calculateRenewalRisk,
  getRenewalRisk,
  type RiskResponse,
} from '../api/client';

// Resolves the renewal-risk view for a property:
//   1. GET the most recent run.
//   2. If no run exists yet (404 / no_run), kick off a calculation for today
//      so the dashboard isn't stuck on "no data" the first time it loads.
// Anything else surfaces as an error for the page to render.

interface State {
  data: RiskResponse | null;
  loading: boolean;
  error: string | null;
}

const today = (): string => new Date().toISOString().slice(0, 10);

export const useRenewalRisk = (propertyId: string) => {
  const [state, setState] = useState<State>({ data: null, loading: true, error: null });

  const load = useCallback(async () => {
    setState({ data: null, loading: true, error: null });
    try {
      const data = await getRenewalRisk(propertyId);
      setState({ data, loading: false, error: null });
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        try {
          const data = await calculateRenewalRisk(propertyId, today());
          setState({ data, loading: false, error: null });
          return;
        } catch (calcErr) {
          const message =
            calcErr instanceof Error ? calcErr.message : 'failed to calculate renewal risk';
          setState({ data: null, loading: false, error: message });
          return;
        }
      }
      const message = err instanceof Error ? err.message : 'failed to load renewal risk';
      setState({ data: null, loading: false, error: message });
    }
  }, [propertyId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { ...state, refetch: load };
};
