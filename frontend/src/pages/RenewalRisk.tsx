import { useState } from 'react';
import { triggerRenewalEvent, type Flag, type RiskTier } from '../api/client';
import { RiskTable } from '../components/RiskTable';
import { useRenewalRisk } from '../hooks/useRenewalRisk';

interface Props {
  propertyId: string;
}

type TierFilter = 'all' | RiskTier;

const FILTER_LABEL: Record<TierFilter, string> = {
  all: 'All',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

const matchesFilter = (flag: Flag, filter: TierFilter): boolean =>
  filter === 'all' || flag.riskTier === filter;

export const RenewalRisk = ({ propertyId }: Props) => {
  const { data, loading, error, refetch, recalculate } = useRenewalRisk(propertyId);
  const [filter, setFilter] = useState<TierFilter>('all');

  if (loading) {
    return (
      <div className="state state--loading">
        <div className="spinner" aria-hidden="true" />
        <p>Loading renewal risk…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="state state--error" role="alert">
        <p className="state__message">{error}</p>
        <button type="button" className="btn" onClick={() => void refetch()}>
          Retry
        </button>
      </div>
    );
  }

  if (!data) {
    // shouldn't reach here — loading=false with no error implies data, but
    // narrow defensively for TypeScript
    return null;
  }

  const handleTrigger = async (residentId: string): Promise<void> => {
    await triggerRenewalEvent(propertyId, residentId);
  };

  const filtered = data.flags.filter((f) => matchesFilter(f, filter));
  // The "low" tier is not included in flags (only high/medium are flagged), so
  // hide its filter chip — selecting it would always be empty.
  const FILTERS: TierFilter[] = ['all', 'high', 'medium'];

  return (
    <section>
      <header className="page-header">
        <div className="page-header__row">
          <h1>Renewal Risk</h1>
          <button
            type="button"
            className="btn"
            onClick={() => void recalculate()}
            aria-label="Recalculate renewal risk for today"
          >
            Recalculate
          </button>
        </div>
        <p className="page-header__subtitle">
          {data.flaggedCount} flagged of {data.totalResidents} residents · calculated{' '}
          {new Date(data.calculatedAt).toLocaleString()}
        </p>
        <p className="tier-summary">
          <span className="tier-badge tier-badge--high">High {data.riskTiers.high}</span>
          <span className="tier-badge tier-badge--medium">Medium {data.riskTiers.medium}</span>
          <span className="tier-badge tier-badge--low">Low {data.riskTiers.low}</span>
        </p>
        <div className="filter-chips" role="group" aria-label="Filter by tier">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              className={`filter-chip${filter === f ? ' filter-chip--active' : ''}`}
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
            >
              {FILTER_LABEL[f]}
            </button>
          ))}
        </div>
      </header>

      {data.flags.length === 0 ? (
        <p className="state state--empty">No residents currently flagged.</p>
      ) : filtered.length === 0 ? (
        <p className="state state--empty">No residents match the {FILTER_LABEL[filter]} filter.</p>
      ) : (
        <RiskTable flags={filtered} onTrigger={handleTrigger} />
      )}
    </section>
  );
};
