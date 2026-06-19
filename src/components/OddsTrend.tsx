// Multi-line chart of how bookmaker title-win odds drift day by day, for the
// teams currently in the draw. Hand-rolled SVG (no chart dependency) so it fits
// the dark/gold theme and stays light. Data is team_odds_history via
// getOddsHistory(); the series starts the day the trend feature shipped and
// grows one point per day — so with a single day it shows dots + a hint.

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
  // Only plot teams we actually have history for.
  const series = teams
    .map((team, i) => ({ team, pts: history.get(team) ?? [], color: COLORS[i % COLORS.length] }))
    .filter((s) => s.pts.length > 0);

  if (series.length === 0) return null;

  // Unique sorted days across all plotted teams → the x axis.
  const dates = [...new Set(series.flatMap((s) => s.pts.map((p) => p.date)))].sort();
  const tMin = Date.parse(dates[0]);
  const tMax = Date.parse(dates[dates.length - 1]);
  const span = tMax - tMin;

  const maxProb = Math.max(...series.flatMap((s) => s.pts.map((p) => p.prob)));
  const yMax = Math.max(5, Math.ceil(maxProb / 5) * 5); // round up to a clean 5%

  const x = (iso: string) =>
    span === 0 ? PAD.left + innerW / 2 : PAD.left + ((Date.parse(iso) - tMin) / span) * innerW;
  const y = (prob: number) => PAD.top + innerH - (prob / yMax) * innerH;

  // y gridlines / ticks at 0, 5, 10, … up to yMax.
  const yTicks: number[] = [];
  for (let v = 0; v <= yMax; v += 5) yTicks.push(v);

  // x ticks: every day if few, otherwise ~6 evenly spaced.
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
  // Clamp the stack back inside the plot if it overflowed the bottom.
  const overflow = labels.length ? labels[labels.length - 1].y - (PAD.top + innerH) : 0;
  if (overflow > 0) for (const l of labels) l.y -= overflow;

  const singleDay = dates.length < 2;

  return (
    <div className="odds-trend">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Динамика котировок букмекеров по дням" className="odds-trend-svg">
        {/* y gridlines + labels */}
        {yTicks.map((v) => (
          <g key={`y${v}`}>
            <line x1={PAD.left} y1={y(v)} x2={PAD.left + innerW} y2={y(v)} className="ot-grid" />
            <text x={PAD.left - 6} y={y(v) + 3} className="ot-axis ot-axis-y">{v}%</text>
          </g>
        ))}
        {/* x labels */}
        {xTicks.map((d) => (
          <text key={`x${d}`} x={x(d)} y={H - 8} className="ot-axis ot-axis-x">{ddmm(d)}</text>
        ))}
        {/* one line + dots per team */}
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
        {/* end-of-line labels */}
        {labels.map((l) => (
          <text key={l.team} x={PAD.left + innerW + 8} y={l.y + 3} className="ot-endlabel" fill={l.color}>
            {l.flag} {Math.round(l.prob)}%
          </text>
        ))}
      </svg>
      {singleDay && (
        <p className="muted small odds-trend-hint">
          Пока только один замер — линии появятся, когда накопится история (по точке в день).
        </p>
      )}
    </div>
  );
}
