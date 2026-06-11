import { StandingRow } from '../lib/worldcup';
import { TeamPill } from './TeamPill';

/**
 * Group standings table. Optionally links team names to their page and
 * highlights one team. `flags` maps team name -> emoji.
 * `compact` drops the GF/GA columns so it fits in a narrow group card.
 */
export function Standings({
  rows,
  flags,
  highlight,
  linkTeams = false,
  compact = false,
}: {
  rows: StandingRow[];
  flags: Map<string, string>;
  highlight?: string;
  linkTeams?: boolean;
  compact?: boolean;
}) {
  return (
    <table className={`standings ${compact ? 'compact' : ''}`}>
      <thead>
        <tr>
          <th className="th-team">Team</th>
          <th>P</th>
          <th>W</th>
          <th>D</th>
          <th>L</th>
          {!compact && <th>GF</th>}
          {!compact && <th>GA</th>}
          <th>GD</th>
          <th>Pts</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          // Top two qualify directly at this format; mark them subtly.
          const qualifies = i < 2;
          return (
            <tr key={r.team} className={r.team === highlight ? 'me' : ''}>
              <td className="team-cell">
                <span className={qualifies ? 'qual-dot' : 'qual-dot dim'} />
                {linkTeams ? (
                  <TeamPill name={r.team} flags={flags} size="sm" />
                ) : (
                  <span className="team-pill sm static">
                    <span className="tp-flag">{flags.get(r.team) ?? '⚪'}</span>
                    <span className="tp-name">{r.team}</span>
                  </span>
                )}
              </td>
              <td>{r.played}</td>
              <td>{r.won}</td>
              <td>{r.drawn}</td>
              <td>{r.lost}</td>
              {!compact && <td>{r.gf}</td>}
              {!compact && <td>{r.ga}</td>}
              <td>{r.gd > 0 ? `+${r.gd}` : r.gd}</td>
              <td className="pts">{r.points}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
