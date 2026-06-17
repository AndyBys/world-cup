import { ScorerRow } from '../lib/worldcup';
import { TeamPill } from './TeamPill';

/**
 * Golden-Boot leaderboard: players ranked by goals across played matches. Rows
 * tying on goals share a rank ("=2"). Penalties are shown as a parenthetical so
 * open-play scorers read first within a tie (see topScorers ordering).
 */
export function TopScorers({
  rows,
  flags,
}: {
  rows: ScorerRow[];
  flags: Map<string, string>;
}) {
  if (rows.length === 0) {
    return <p className="muted">No goals scored yet.</p>;
  }

  // Dense rank: same goal tally → same position number.
  let lastGoals = -1;
  let rank = 0;

  return (
    <table className="scorers-table">
      <thead>
        <tr>
          <th className="rank">#</th>
          <th>Player</th>
          <th>Team</th>
          <th className="num">Goals</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          if (r.goals !== lastGoals) {
            rank = i + 1;
            lastGoals = r.goals;
          }
          const tie = rows.filter((x) => x.goals === r.goals).length > 1;
          return (
            <tr key={`${r.name}|${r.team}`}>
              <td className="rank muted">{tie ? `=${rank}` : rank}</td>
              <td className="scorer-name">
                {r.name}
                {r.penalties > 0 && (
                  <span className="muted small"> ({r.penalties} pen)</span>
                )}
              </td>
              <td>
                <TeamPill name={r.team} flags={flags} size="sm" />
              </td>
              <td className="num">
                <strong>{r.goals}</strong>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
