import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  getMatches,
  getFlagMap,
  refreshMatches,
  stageLabel,
  shortGround,
  hostFlag,
  kickoffMs,
  matchStatus,
  Match,
} from '../lib/worldcup';
import { liveFor, LiveIndex } from '../lib/live';
import { useClock, useLiveScores } from '../lib/useLive';
import { useOwners, OwnerIndex } from '../lib/owners';

/** YYYY-MM-DD in UTC (so "today/tomorrow" is the same for every friend). */
function utcYMD(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Kick-off time in UTC, e.g. "19:00 UTC"; falls back to the raw string. */
function utcTime(m: Match): string {
  const k = kickoffMs(m);
  if (k == null) return m.time;
  const t = new Date(k).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    hour12: false,
  });
  return `${t} UTC`;
}

/** "Today & tomorrow" fixtures board so friends know when their team is on. */
export function TodayMatches() {
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [flags, setFlags] = useState<Map<string, string>>(new Map());
  const now = useClock(60_000);
  const liveIdx = useLiveScores();
  const owners = useOwners();

  useEffect(() => {
    let alive = true;
    getFlagMap().then((f) => alive && setFlags(f)).catch(() => {});
    const load = (refresh = false) =>
      (refresh ? refreshMatches() : getMatches())
        .then((m) => alive && setMatches(m))
        .catch(() => {});
    load();
    const id = setInterval(() => load(true), 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const { today, tomorrow, todayLabel, tomorrowLabel } = useMemo(() => {
    const d = new Date(now);
    const todayStr = utcYMD(d);
    const tmr = new Date(d.getTime() + 86_400_000);
    const tomorrowStr = utcYMD(tmr);
    const fmt = (date: Date) =>
      date.toLocaleDateString('en-GB', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      });
    // Bucket by each match's UTC kick-off date, so a late game that rolls past
    // midnight UTC lands on the right day (matching the UTC time we display).
    const utcDateOf = (m: Match) => {
      const k = kickoffMs(m);
      return k == null ? m.date : utcYMD(new Date(k));
    };
    const inDay = (ymd: string) =>
      (matches ?? [])
        .filter((m) => utcDateOf(m) === ymd)
        .sort((a, b) => (kickoffMs(a) ?? 0) - (kickoffMs(b) ?? 0));
    return {
      today: inDay(todayStr),
      tomorrow: inDay(tomorrowStr),
      todayLabel: fmt(d),
      tomorrowLabel: fmt(tmr),
    };
  }, [matches, now]);

  if (!matches) return null;
  if (today.length === 0 && tomorrow.length === 0) return null;

  return (
    <section className="card today-card">
      <h2>📅 Who plays next</h2>
      {today.length > 0 && (
        <DayBlock title="Today" sub={todayLabel} matches={today} now={now} flags={flags} liveIdx={liveIdx} owners={owners} />
      )}
      {tomorrow.length > 0 && (
        <DayBlock title="Tomorrow" sub={tomorrowLabel} matches={tomorrow} now={now} flags={flags} liveIdx={liveIdx} owners={owners} />
      )}
    </section>
  );
}

function DayBlock({
  title,
  sub,
  matches,
  now,
  flags,
  liveIdx,
  owners,
}: {
  title: string;
  sub: string;
  matches: Match[];
  now: number;
  flags: Map<string, string>;
  liveIdx: LiveIndex;
  owners: OwnerIndex;
}) {
  return (
    <div className="day-block">
      <div className="day-head">
        <span className="day-title">{title}</span>
        <span className="day-sub">{sub}</span>
      </div>
      <ul className="fixtures">
        {matches.map((m, i) => (
          <Fixture key={i} m={m} now={now} flags={flags} liveIdx={liveIdx} owners={owners} />
        ))}
      </ul>
    </div>
  );
}

function Fixture({
  m,
  now,
  flags,
  liveIdx,
  owners,
}: {
  m: Match;
  now: number;
  flags: Map<string, string>;
  liveIdx: LiveIndex;
  owners: OwnerIndex;
}) {
  const info = liveFor(m, liveIdx);
  const isLive = (info?.phase ?? matchStatus(m, now)) === 'live';
  const ft = isLive ? info?.ft : m.score?.ft ?? info?.ft;
  const o1 = owners.get(m.team1);
  const o2 = owners.get(m.team2);
  const clash = !!o1 && !!o2;

  const side = (name: string, owner?: string) => {
    const flag = flags.get(name);
    const inner = (
      <>
        <span className="fx-flag">{flag ?? '·'}</span>
        <span className="fx-name">{name}</span>
        {owner && <span className="fx-owner">🎟️ {owner}</span>}
      </>
    );
    return flag ? (
      <Link className="fx-team" to={`/team/${encodeURIComponent(name)}`}>
        {inner}
      </Link>
    ) : (
      <span className="fx-team placeholder">{inner}</span>
    );
  };

  return (
    <li className={`fixture ${isLive ? 'live' : ''} ${clash ? 'clash' : ''}`}>
      <span className="fx-time">
        {isLive ? (
          <span className="badge live">
            <span className="live-dot" /> {info?.minute && /^\d+$/.test(info.minute) ? `${info.minute}'` : 'LIVE'}
          </span>
        ) : (
          utcTime(m)
        )}
      </span>
      <span className="fx-match">
        {side(m.team1, o1)}
        <span className="fx-score">{ft ? `${ft[0]}–${ft[1]}` : 'v'}</span>
        {side(m.team2, o2)}
      </span>
      <span className="fx-meta">
        <span className="fx-stage">{stageLabel(m)}</span>
        <span className="fx-where">{hostFlag(m.ground)} {shortGround(m.ground)}</span>
      </span>
      {clash && <span className="fx-clash-tag">⚔️ {o1} vs {o2}</span>}
    </li>
  );
}
