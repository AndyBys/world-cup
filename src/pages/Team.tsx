import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  getTeam,
  getMatches,
  getFlagMap,
  refreshMatches,
  computeStandings,
  stageLabel,
  isPlayed,
  matchStatus,
  kickoffMs,
  resultFor,
  Match,
  Team as TeamInfo,
} from '../lib/worldcup';
import { liveFor, overlayFinished, LiveIndex, LivePhase } from '../lib/live';
import { useClock, useLiveScores } from '../lib/useLive';
import { useOwners } from '../lib/owners';
import { formatKickoff, useTimezone } from '../lib/timezone';
import { Standings } from '../components/Standings';
import { TimezonePicker } from '../components/TimezonePicker';

export function Team() {
  const { team: raw } = useParams();
  const team = decodeURIComponent(raw ?? '');

  const [info, setInfo] = useState<TeamInfo | undefined>();
  const [allMatches, setAllMatches] = useState<Match[] | null>(null);
  const [flags, setFlags] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState('');
  const now = useClock();
  const liveIdx = useLiveScores();
  const owners = useOwners();
  const [tz] = useTimezone();

  useEffect(() => {
    let alive = true;
    setAllMatches(null);
    setError('');
    getFlagMap().then((f) => alive && setFlags(f)).catch(() => {});

    const load = async (refresh = false) => {
      try {
        const [teamInfo, ms] = await Promise.all([
          getTeam(team),
          refresh ? refreshMatches() : getMatches(),
        ]);
        if (!alive) return;
        setInfo(teamInfo);
        setAllMatches(ms);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Failed to load team data.');
      }
    };

    load();
    // Refetch openfootball periodically (live feed refreshes on its own, faster).
    const id = setInterval(() => load(true), 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [team]);

  // Merge live finished scores in, then derive everything for the current tick.
  const overlaid = useMemo(
    () => (allMatches ? overlayFinished(allMatches, liveIdx) : null),
    [allMatches, liveIdx],
  );

  const teamMatches = useMemo(
    () => overlaid?.filter((m) => m.team1 === team || m.team2 === team) ?? null,
    [overlaid, team],
  );

  const groupLabel = info?.group
    ? `Group ${info.group}`
    : teamMatches?.find((m) => m.group)?.group;
  const standings = useMemo(
    () => (overlaid && groupLabel ? computeStandings(overlaid, groupLabel) : []),
    [overlaid, groupLabel],
  );

  const phaseOf = (m: Match): LivePhase => liveFor(m, liveIdx)?.phase ?? matchStatus(m, now);

  const live = teamMatches?.filter((m) => phaseOf(m) === 'live') ?? [];
  const results = teamMatches?.filter((m) => isPlayed(m) && phaseOf(m) !== 'live') ?? [];
  const upcoming = teamMatches?.filter((m) => phaseOf(m) === 'upcoming' && !isPlayed(m)) ?? [];

  // Cosmetic pot status: out only once they've actually lost a knockout match.
  const eliminated = results.some((m) => !m.group && resultFor(m, team) === 'L');

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
          {owners.get(team) && <span className="chip owner">🎟️ {owners.get(team)}'s team</span>}
          {info?.group && <span className="chip">Group {info.group}</span>}
          {info?.confed && <span className="chip">{info.confed}</span>}
          {teamMatches &&
            (eliminated ? (
              <span className="chip out">eliminated</span>
            ) : (
              <span className="chip alive">still in for the pot 🏆</span>
            ))}
          <TimezonePicker />
        </div>
      </header>

      {error && <p className="error">{error}</p>}
      {!teamMatches && !error && <p className="muted">Loading fixtures…</p>}

      {live.length > 0 && (
        <section className="card live-card">
          <h2>
            <span className="live-dot" /> Live now
          </h2>
          <ul className="matches">
            {live.map((m, i) => (
              <MatchRow key={i} m={m} team={team} now={now} idx={liveIdx}  owners={owners} tz={tz} />
            ))}
          </ul>
        </section>
      )}

      {standings.length > 0 && (
        <section className="card">
          <h2>Group standings</h2>
          <Standings rows={standings} flags={flags} highlight={team} linkTeams owners={owners} />
          <p className="muted small qual-key">● top two advance to the knockout stage</p>
        </section>
      )}

      {results.length > 0 && (
        <section className="card">
          <h2>Results</h2>
          <ul className="matches">
            {results.map((m, i) => (
              <MatchRow key={i} m={m} team={team} now={now} idx={liveIdx}  owners={owners} tz={tz} />
            ))}
          </ul>
        </section>
      )}

      {upcoming.length > 0 && (
        <section className="card">
          <h2>Upcoming</h2>
          <ul className="matches">
            {upcoming.map((m, i) => (
              <MatchRow key={i} m={m} team={team} now={now} idx={liveIdx}  owners={owners} tz={tz} />
            ))}
          </ul>
        </section>
      )}

      {teamMatches && teamMatches.length === 0 && (
        <p className="muted">No fixtures found for {team} yet.</p>
      )}
    </div>
  );
}

function MatchRow({
  m,
  team,
  now,
  idx,
  owners,
  tz,
}: {
  m: Match;
  team: string;
  now: number;
  idx: LiveIndex;
  owners: Map<string, string>;
  tz: string;
}) {
  const info = liveFor(m, idx);
  const isLive = (info?.phase ?? matchStatus(m, now)) === 'live';
  const ft = isLive ? info?.ft : m.score?.ft;
  const outcome = resultFor(m, team);
  const scorers = info && (info.scorers1.length || info.scorers2.length);
  const opponent = m.team1 === team ? m.team2 : m.team1;
  const oppOwner = owners.get(opponent);

  return (
    <li className={`match ${isLive ? 'live' : ''} ${oppOwner ? 'clash' : ''}`}>
      <span className="match-round">
        {stageLabel(m)}
        {oppOwner && <span className="clash-tag">⚔️ vs {oppOwner}</span>}
      </span>
      <span className="match-teams">
        <strong className={m.team1 === team ? 'me-team' : ''}>{m.team1}</strong>
        {ft ? (
          <span className="score">
            {ft[0]}–{ft[1]}
          </span>
        ) : (
          <span className="vs">v</span>
        )}
        <strong className={m.team2 === team ? 'me-team' : ''}>{m.team2}</strong>
      </span>
      <span className="match-when">
        {isLive ? (
          <span className="badge live">
            <span className="live-dot" /> {info?.minute && /^\d+$/.test(info.minute) ? `${info.minute}'` : 'LIVE'}
          </span>
        ) : outcome ? (
          <span className={`badge ${outcome}`}>{outcome}</span>
        ) : (
          (() => {
            const k = kickoffMs(m);
            const day =
              k == null
                ? m.date
                : new Date(k).toLocaleDateString('en-GB', {
                    month: 'short',
                    day: 'numeric',
                    timeZone: tz,
                  });
            return (
              <>
                {day} · {formatKickoff(k, tz, m.time)}
              </>
            );
          })()
        )}
      </span>
      <span className="match-ground muted">{m.ground}</span>
      {isLive && scorers ? (
        <span className="match-scorers muted small">
          ⚽ {[...info!.scorers1, ...info!.scorers2].join(' · ')}
        </span>
      ) : null}
    </li>
  );
}
