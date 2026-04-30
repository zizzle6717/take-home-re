import { triggerRenewalEvent } from '../api/client';
import { RiskTable } from '../components/RiskTable';
import { useRenewalRisk } from '../hooks/useRenewalRisk';

interface Props {
  propertyId: string;
}

export const RenewalRisk = ({ propertyId }: Props) => {
  const { data, loading, error, refetch } = useRenewalRisk(propertyId);

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

  return (
    <section>
      <header className="page-header">
        <h1>Renewal Risk</h1>
        <p className="page-header__subtitle">
          {data.flaggedCount} flagged of {data.totalResidents} residents · calculated{' '}
          {new Date(data.calculatedAt).toLocaleString()}
        </p>
        <p className="tier-summary">
          <span className="tier-badge tier-badge--high">High {data.riskTiers.high}</span>
          <span className="tier-badge tier-badge--medium">Medium {data.riskTiers.medium}</span>
          <span className="tier-badge tier-badge--low">Low {data.riskTiers.low}</span>
        </p>
      </header>

      {data.flags.length === 0 ? (
        <p className="state state--empty">No residents currently flagged.</p>
      ) : (
        <RiskTable flags={data.flags} onTrigger={handleTrigger} />
      )}
    </section>
  );
};
