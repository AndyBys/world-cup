// Multi-line chart of how bookmaker title-win odds drift day by day, for the
// teams currently in the draw. Hand-rolled SVG (no chart dependency) so it fits
// the dark/gold theme and stays light. Data is team_odds_history via
// getOddsHistory(); the series starts the day the trend feature shipped and
// grows one point per day — so with a single day it shows dots + a hint.
//
// Interactive: click a team in the legend to hide/show its line; once enough
// days have accumulated a range toggle (7д / всё) appears.

import { useMemo, useState } from 'react';
import { OddsPoint } from '../lib/pool';

const COLORS = [
  '#e6b800', '#4ea1ff', '#38d39f', '#e0607a', '#b07cff', '#ff9f40',
  '#5cd6c0', '#f25c8a', '#8ad15c', '#6c9bff', '#d98cff', '#ffce54',
];

// viewBox geometry — the SVG scales to the container width.
const W = 720;
const H = 340;
const PAD = { top: 16, right: 70, bottom: 28, left: 34 };
const innerW = W - PAD.left - PAD.right;
const innerH = H - PAD.top - PAD.bottom;
const DAY = 86_400_000;

const ddmm = (iso: string) => {
  const [, m, d] = iso.split('-');
  return `${d}.${m}`;
};

export function OddsTrend({
  history,
  teams,
  flags,
}: {
  history: Map<string, OddsPoint[]>;
  teams: string[];
  flags: Map<string, string>;
}) {
  // Stable colour per team (by draw order, independent of what's visible).
  const colorOf = useMemo(() => {
    const m = new Map<string, string>();
    teams.forEach((t, i) => m.set(t, COLORS[i % COLORS.length]));
    return m;
  }, [teams]);

  // Teams we actually have any history for — the legend / chart universe.
  const available = useMemo(() => teams.filter((t) => (history.get(t)?.length ?? 0) > 0), [teams, history]);

  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [rangeDays, setRangeDays] = useState<number | null>(null); // null = all

  // Full date span (across all available teams) decides whether a range toggle
  // is worth showing, and the cutoff when one is active.
  const allDates = useMemo(
    () => [...new Set(available.flatMap((t) => (history.get(t) ?? []).map((p) => p.date)))].sort(),
    [available, history],
  );
  const spanDays = allDates.length > 1 ? (Date.parse(allDates[allDates.length - 1]) - Date.parse(allDates[0])) / DAY : 0;
  const showRange = spanDays > 7;
  const cutoff = rangeDays && allDates.length
    ? Date.parse(allDates[allDates.length - 1]) - rangeDays * DAY
    : -Infinity;

  if (available.length === 0) return null;

  // Visible series, with points clipped to the selected range.
  const series = available
    .filter((t) => !hidden.has(t))
    .map((team) => ({
      team,
      color: colorOf.get(team)!,
      pts: (history.get(team) ?? []).filter((p) => Date.parse(p.date) >= cutoff),
    }))
    .filter((s) => s.pts.length > 0);

  const dates = [...new Set(series.flatMap((s) => s.pts.map((p) => p.date)))].sort();
  const tMin = dates.length ? Date.parse(dates[0]) : 0;
  const tMax = dates.length ? Date.parse(dates[dates.length - 1]) : 0;
  const span = tMax - tMin;

  const maxProb = series.length ? Math.max(...series.flatMap((s) => s.pts.map((p) => p.prob))) : 5;
  const yMax = Math.max(5, Math.ceil(maxProb / 5) * 5);

  const x = (iso: string) =>
    span === 0 ? PAD.left + innerW / 2 : PAD.left + ((Date.parse(iso) - tMin) / span) * innerW;
  const y = (prob: number) => PAD.top + innerH - (prob / yMax) * innerH;

  const yTicks: number[] = [];
  for (let v = 0; v <= yMax; v += 5) yTicks.push(v);
  const step = dates.length <= 6 ? 1 : Math.ceil(dates.length / 6);
  const xTicks = dates.filter((_, i) => i % step === 0 || i === dates.length - 1);

  // End-of-line labels (flag + current %), pushed apart so they don't overlap.
  const labels = series
    .map((s) => {
      const last = s.pts[s.pts.length - 1];
      return { team: s.team, color: s.color, prob: last.prob, y: y(last.prob), flag: flags.get(s.team) ?? '' };
    })
    .sort((a, b) => a.y - b.y);
  const GAP = 15;
  for (let i = 1; i < labels.length; i++) {
    if (labels[i].y < labels[i - 1].y + GAP) labels[i].y = labels[i - 1].y + GAP;
  }
  const overflow = labels.length ? labels[labels.length - 1].y - (PAD.top + innerH) : 0;
  if (overflow > 0) for (const l of labels) l.y -= overflow;

  const singleDay = dates.length < 2;

  const toggle = (team: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      next.has(team) ? next.delete(team) : next.add(team);
      return next;
    });

  return (
    <div className="odds-trend">
      {showRange && (
        <div className="ot-range" role="group" aria-label="Диапазон">
          {([[7, '7 дней'], [null, 'всё']] as const).map(([d, label]) => (
            <button
              key={label}
              type="button"
              className={`ot-range-btn ${rangeDays === d ? 'active' : ''}`}
              onClick={() => setRangeDays(d)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Динамика котировок букмекеров по дням" className="odds-trend-svg">
        {yTicks.map((v) => (
          <g key={`y${v}`}>
            <line x1={PAD.left} y1={y(v)} x2={PAD.left + innerW} y2={y(v)} className="ot-grid" />
            <text x={PAD.left - 6} y={y(v) + 3} className="ot-axis ot-axis-y">{v}%</text>
          </g>
        ))}
        {xTicks.map((d) => (
          <text key={`x${d}`} x={x(d)} y={H - 8} className="ot-axis ot-axis-x">{ddmm(d)}</text>
        ))}
        {series.map((s) => (
          <g key={s.team}>
            {s.pts.length > 1 && (
              <polyline
                className="ot-line"
                stroke={s.color}
                points={s.pts.map((p) => `${x(p.date)},${y(p.prob)}`).join(' ')}
              />
            )}
            {s.pts.map((p) => (
              <circle key={p.date} cx={x(p.date)} cy={y(p.prob)} r={singleDay ? 4 : 3} fill={s.color} className="ot-dot">
                <title>{`${s.team} · ${ddmm(p.date)} · ${Math.round(p.prob)}%`}</title>
              </circle>
            ))}
          </g>
        ))}
        {labels.map((l) => (
          <text key={l.team} x={PAD.left + innerW + 8} y={l.y + 3} className="ot-endlabel" fill={l.color}>
            {l.flag} {Math.round(l.prob)}%
          </text>
        ))}
      </svg>

      {/* Legend — click a team to hide/show its line. */}
      <div className="ot-legend">
        {available.map((team) => {
          const off = hidden.has(team);
          return (
            <button
              key={team}
              type="button"
              className={`ot-legend-item ${off ? 'off' : ''}`}
              onClick={() => toggle(team)}
              aria-pressed={!off}
              title={off ? 'Показать на графике' : 'Скрыть с графика'}
            >
              <span className="ot-legend-swatch" style={{ background: off ? 'transparent' : colorOf.get(team) }} />
              {flags.get(team) ?? ''} {team}
            </button>
          );
        })}
      </div>

      {singleDay && (
        <p className="muted small odds-trend-hint">
          Пока только один замер — линии появятся, когда накопится история (по точке в день).
        </p>
      )}
    </div>
  );
}
