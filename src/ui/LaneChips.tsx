import { LANES, type Lane } from '../model/types';
import { LANE_LABEL, PIGMENT } from './util';

/**
 * The six lanes as chips, several allowed: the tray's picker and the editor's. Claude's suggested
 * lanes get a dashed umber ring and are never taken until Bob picks them.
 */
export function LaneChips({ value, onToggle, suggested = [], disabled, label = 'Lanes' }: {
  value: readonly Lane[] | undefined;
  onToggle: (lane: Lane) => void;
  suggested?: readonly Lane[];
  disabled?: boolean;
  label?: string;
}) {
  return (
    <div className="lanepick" role="group" aria-label={label}>
      {LANES.map((l) => {
        const sug = suggested.includes(l);
        return (
          <button
            type="button"
            key={l}
            className={sug ? 'sug' : undefined}
            style={{ '--d': `var(--pig-${PIGMENT[l]})` } as React.CSSProperties}
            title={sug ? `${LANE_LABEL[l]} (suggested by Claude)` : undefined}
            aria-pressed={!!value?.includes(l)}
            disabled={disabled}
            onClick={() => onToggle(l)}
          ><i />{LANE_LABEL[l]}</button>
        );
      })}
    </div>
  );
}
