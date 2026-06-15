// Compact win-probability bar for a single match, from bookmaker odds (see the
// sync-odds Edge Function). Renders a stacked team1 / draw / team2 bar plus a
// legend. Returns null when any probability is missing, so callers can drop it
// in unconditionally and it simply vanishes for matches without a posted line.

const pct = (x: number) => Math.round(x * 100);

export function WinChances({
  team1,
  team2,
  p1,
  px,
  p2,
  flags,
  className,
}: {
  team1: string;
  team2: string;
  p1: number | null;
  px: number | null;
  p2: number | null;
  flags?: Map<string, string>;
  className?: string;
}) {
  if (p1 == null || px == null || p2 == null) return null;

  const f1 = flags?.get(team1) ?? '';
  const f2 = flags?.get(team2) ?? '';
  const label = `Шансы по букмекерам: ${team1} ${pct(p1)}%, ничья ${pct(px)}%, ${team2} ${pct(p2)}%`;

  return (
    <div className={`win-chances ${className ?? ''}`} title={label}>
      <div className="wc-bar" role="img" aria-label={label}>
        <span className="wc-seg wc-1" style={{ width: `${p1 * 100}%` }} />
        <span className="wc-seg wc-x" style={{ width: `${px * 100}%` }} />
        <span className="wc-seg wc-2" style={{ width: `${p2 * 100}%` }} />
      </div>
      <div className="wc-legend">
        <span className="wc-end">
          <span className="wc-swatch wc-1" />
          {f1} {pct(p1)}%
        </span>
        <span className="wc-mid">ничья {pct(px)}%</span>
        <span className="wc-end wc-right">
          {pct(p2)}% {f2}
          <span className="wc-swatch wc-2" />
        </span>
      </div>
    </div>
  );
}
