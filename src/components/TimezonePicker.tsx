import { useMemo } from 'react';
import { detectTimezone, timezoneOptions, useTimezone } from '../lib/timezone';

/** Lets a friend pick which timezone kick-off times are shown in. */
export function TimezonePicker() {
  const [tz, setTz] = useTimezone();
  const detected = useMemo(detectTimezone, []);
  const options = useMemo(() => timezoneOptions(detected), [detected]);

  return (
    <label className="tz-picker" title="Show kick-off times in this timezone">
      <span className="tz-icon">🌍</span>
      <select value={tz} onChange={(e) => setTz(e.target.value)} aria-label="Timezone">
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
            {o.id === detected ? ' — yours' : ''}
          </option>
        ))}
      </select>
    </label>
  );
}
