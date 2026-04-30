import { Fragment, useMemo, useState } from 'react';
import type { Flag, FlagSignals, RiskTier } from '../api/client';

// Per-row trigger state. The page passes a single async `onTrigger` and the
// table tracks each row's button independently so the user can fire multiple
// in flight without one row's state masking another's.
type TriggerStatus = 'idle' | 'pending' | 'success' | 'error';

interface Props {
  flags: Flag[];
  onTrigger: (residentId: string) => Promise<void>;
}

const TIER_LABEL: Record<RiskTier, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

const SIGNAL_LABELS: Record<keyof FlagSignals, string> = {
  daysToExpiryDays: 'Days to expiry',
  paymentHistoryDelinquent: 'Payment delinquent',
  noRenewalOfferYet: 'No renewal offer yet',
  rentGrowthAboveMarket: 'Market rent above lease rent',
};

const formatSignalValue = (key: keyof FlagSignals, value: number | boolean): string => {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (key === 'daysToExpiryDays') return `${value} days`;
  return String(value);
};

const buttonLabel = (status: TriggerStatus): string => {
  switch (status) {
    case 'pending':
      return 'Sending…';
    case 'success':
      return 'Sent ✓';
    case 'error':
      return 'Retry';
    default:
      return 'Trigger Renewal Event';
  }
};

type SortDir = 'desc' | 'asc';

export const RiskTable = ({ flags, onTrigger }: Props) => {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [statuses, setStatuses] = useState<Record<string, TriggerStatus>>({});
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const sortedFlags = useMemo(() => {
    const copy = [...flags];
    copy.sort((a, b) => (sortDir === 'desc' ? b.riskScore - a.riskScore : a.riskScore - b.riskScore));
    return copy;
  }, [flags, sortDir]);

  const toggle = (residentId: string) =>
    setExpanded((prev) => ({ ...prev, [residentId]: !prev[residentId] }));

  const toggleSort = () => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));

  const handleTrigger = async (residentId: string) => {
    setStatuses((prev) => ({ ...prev, [residentId]: 'pending' }));
    try {
      await onTrigger(residentId);
      setStatuses((prev) => ({ ...prev, [residentId]: 'success' }));
    } catch {
      setStatuses((prev) => ({ ...prev, [residentId]: 'error' }));
    }
  };

  return (
    <table className="risk-table">
      <thead>
        <tr>
          <th aria-label="Expand row" className="risk-table__chevron-col"></th>
          <th>Resident</th>
          <th>Unit</th>
          <th>Days to Expiry</th>
          <th>
            <button
              type="button"
              className="risk-table__sort"
              onClick={toggleSort}
              aria-label={`Sort by score ${sortDir === 'desc' ? 'ascending' : 'descending'}`}
            >
              Risk Score {sortDir === 'desc' ? '↓' : '↑'}
            </button>
          </th>
          <th>Tier</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        {sortedFlags.map((flag) => {
          const isOpen = Boolean(expanded[flag.residentId]);
          const status = statuses[flag.residentId] ?? 'idle';
          return (
            <Fragment key={flag.residentId}>
              <tr>
                <td>
                  <button
                    type="button"
                    className="risk-table__chevron"
                    aria-label={isOpen ? 'Collapse signals' : 'Expand signals'}
                    aria-expanded={isOpen}
                    onClick={() => toggle(flag.residentId)}
                  >
                    {isOpen ? '▼' : '▶'}
                  </button>
                </td>
                <td>{flag.name}</td>
                <td>
                  <code className="risk-table__unit">{flag.unitId}</code>
                </td>
                <td>{flag.daysToExpiry}</td>
                <td className="risk-table__score">{flag.riskScore}</td>
                <td>
                  <span className={`tier-badge tier-badge--${flag.riskTier}`}>
                    {TIER_LABEL[flag.riskTier]}
                  </span>
                </td>
                <td>
                  <button
                    type="button"
                    className={`btn btn--trigger btn--${status}`}
                    disabled={status === 'pending' || status === 'success'}
                    onClick={() => void handleTrigger(flag.residentId)}
                  >
                    {buttonLabel(status)}
                  </button>
                </td>
              </tr>
              {isOpen && (
                <tr className="risk-table__signals-row">
                  <td colSpan={7}>
                    <dl className="signals-list">
                      {(Object.keys(SIGNAL_LABELS) as Array<keyof FlagSignals>).map((key) => (
                        <div className="signals-list__item" key={key}>
                          <dt>{SIGNAL_LABELS[key]}</dt>
                          <dd>{formatSignalValue(key, flag.signals[key])}</dd>
                        </div>
                      ))}
                    </dl>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
};
