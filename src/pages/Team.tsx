import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  getTeam,
  getTeamMatches,
  getGroupStandings,
  getFlagMap,
  stageLabel,
  isPlayed,
  Match,
  StandingRow,
  Team as TeamInfo,
} from '../lib/worldcup';
import { Standings } from '../components/Standings';

export function Team() {
  const { team: raw } = useParams();
  const team = decodeURIComponent(raw ?? '');

  const [info, setInfo] = useState<TeamInfo | undefined>();
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [standings, setStandings] = useState<StandingRow[]>([]);
  const [flags, setFlags] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setMatches(null);
    setError('');
    getFlagMap().then((f) => alive && setFlags(f)).catch(() => {});
    (async () => {
      try {
        const teamInfo = await getTeam(team);
        if (!alive) return;
        setInfo(teamInfo);
        const ms = await getTeamMatches(team);
        if (!alive) return;
        setMatches(ms);
        const groupLabel = teamInfo?.group ? `Group ${teamInfo.group}` : ms.find((m) => m.group)?.group;
        if (groupLabel) {
          const table = await getGroupStandings(groupLabel);
          if (alive) setStandings(table);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Failed to load team data.');
      }
    })();
    return () => {
      alive = false;
    };
  }, [team]);

  const upcoming = matches?.filter((m) => !isPlayed(m)) ?? [];
  const results = matches?.filter(isPlayed) ?? [];

  // Cosmetic pot status: still alive unless they've lost a knockout match.
  const eliminated = results.some(
    (m) => !m.group && resultFor(m, team) === 'L',
  );

  return (
    <div className="container">
      <p>
        <Link className="back" to="/">
          ← back to results
        </Link>
      </p>

      <header className="team-header">
        <h1>
          {info?.flag_icon ?? '⚽'} {team}
        </h1>
        <div className="team-meta">
          {info?.group && <span className="chip">Group {info.group}</span>}
          {info?.confed && <span className="chip">{info.confed}</span>}
          {matches &&
            (eliminated ? (
              <span className="chip out">eliminated</span>
            ) : (
              <span className="chip alive">still in for the pot 🏆</span>
            ))}
        </div>
      </header>

      {error && <p className="error">{error}</p>}
      {!matches && !error && <p className="muted">Loading fixtures…</p>}

      {standings.length > 0 && (
        <section className="card">
          <h2>Group standings</h2>
          <Standings rows={standings} flags={flags} highlight={team} linkTeams />
          <p className="muted small qual-key">● top two advance to the knockout stage</p>
        </section>
      )}

      {results.length > 0 && (
        <section className="card">
          <h2>Results</h2>
          <ul className="matches">
            {results.map((m, i) => (
              <MatchRow key={i} m={m} team={team} />
            ))}
          </ul>
        </section>
      )}

      {upcoming.length > 0 && (
        <section className="card">
          <h2>Upcoming</h2>
          <ul className="matches">
            {upcoming.map((m, i) => (
              <MatchRow key={i} m={m} team={team} />
            ))}
          </ul>
        </section>
      )}

      {matches && matches.length === 0 && (
        <p className="muted">No fixtures found for {team} yet.</p>
      )}
    </div>
  );
}

/** 'W' | 'D' | 'L' from the perspective of `team`, or null if not played. */
function resultFor(m: Match, team: string): 'W' | 'D' | 'L' | null {
  if (!m.score?.ft) return null;
  const [g1, g2] = m.score.ft;
  const isHome = m.team1 === team;
  const my = isHome ? g1 : g2;
  const opp = isHome ? g2 : g1;
  if (my > opp) return 'W';
  if (my < opp) return 'L';
  return 'D';
}

function MatchRow({ m, team }: { m: Match; team: string }) {
  const played = isPlayed(m);
  const outcome = resultFor(m, team);
  return (
    <li className="match">
      <span className="match-round">{stageLabel(m)}</span>
      <span className="match-teams">
        <strong className={m.team1 === team ? 'me-team' : ''}>{m.team1}</strong>
        {played && m.score?.ft ? (
          <span className="score">
            {m.score.ft[0]}–{m.score.ft[1]}
          </span>
        ) : (
          <span className="vs">v</span>
        )}
        <strong className={m.team2 === team ? 'me-team' : ''}>{m.team2}</strong>
      </span>
      <span className="match-when">
        {played && outcome ? (
          <span className={`badge ${outcome}`}>{outcome}</span>
        ) : (
          <>
            {m.date} · {m.time}
          </>
        )}
      </span>
      <span className="match-ground muted">{m.ground}</span>
    </li>
  );
}
