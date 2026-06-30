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
  displayScore,
  Match,
} from '../lib/worldcup';
import { liveFor, scorerLines, LiveIndex } from '../lib/live';
import { useClock, useLiveScores } from '../lib/useLive';
import { useOwners, OwnerIndex } from '../lib/owners';
import { formatKickoff, useTimezone, ymdInZone } from '../lib/timezone';
import { getFixtures, matchKey, Fixture as FixtureRow } from '../lib/predictions';
import { TimezonePicker } from './TimezonePicker';
import { WinChances } from './WinChances';

/** "Today & tomorrow" fixtures board so friends know when their team is on. */
export function TodayMatches() {
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [flags, setFlags] = useState<Map<string, string>>(new Map());
  const [fixtures, setFixtures] = useState<Map<string, FixtureRow>>(new Map());
  const now = useClock(60_000);
  const liveIdx = useLiveScores();
  const owners = useOwners();
  const [tz] = useTimezone();

  useEffect(() => {
    let alive = true;
    getFlagMap().then((f) => alive && setFlags(f)).catch(() => {});
    getFixtures().then((f) => alive && setFixtures(f)).catch(() => {});
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
    const todayStr = ymdInZone(now, tz);
    const tomorrowStr = ymdInZone(now + 86_400_000, tz);
    const fmt = (date: Date) =>
      date.toLocaleDateString('ru-RU', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        timeZone: tz,
      });
    // Bucket by each match's kick-off date *in the viewer's zone*, so a late
    // game lands on whatever calendar day it falls on for them (matching the
    // local time we display next to it).
    const dateOf = (m: Match) => {
      const k = kickoffMs(m);
      return k == null ? m.date : ymdInZone(k, tz);
    };
    const inDay = (ymd: string) =>
      (matches ?? [])
        .filter((m) => dateOf(m) === ymd)
        .sort((a, b) => (kickoffMs(a) ?? 0) - (kickoffMs(b) ?? 0));
    return {
      today: inDay(todayStr),
      tomorrow: inDay(tomorrowStr),
      todayLabel: fmt(new Date(now)),
      tomorrowLabel: fmt(new Date(now + 86_400_000)),
    };
  }, [matches, now, tz]);

  if (!matches) return null;
  if (today.length === 0 && tomorrow.length === 0) return null;

  return (
    <section className="card today-card">
      <div className="today-head">
        <h2>📅 Кто играет дальше</h2>
        <TimezonePicker />
      </div>
      {today.length > 0 && (
        <DayBlock title="Сегодня" sub={todayLabel} matches={today} now={now} flags={flags} fixtures={fixtures} liveIdx={liveIdx} owners={owners} tz={tz} />
      )}
      {tomorrow.length > 0 && (
        <DayBlock title="Завтра" sub={tomorrowLabel} matches={tomorrow} now={now} flags={flags} fixtures={fixtures} liveIdx={liveIdx} owners={owners} tz={tz} />
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
  fixtures,
  liveIdx,
  owners,
  tz,
}: {
  title: string;
  sub: string;
  matches: Match[];
  now: number;
  flags: Map<string, string>;
  fixtures: Map<string, FixtureRow>;
  liveIdx: LiveIndex;
  owners: OwnerIndex;
  tz: string;
}) {
  return (
    <div className="day-block">
      <div className="day-head">
        <span className="day-title">{title}</span>
        <span className="day-sub">{sub}</span>
      </div>
      <ul className="fixtures">
        {matches.map((m, i) => (
          <Fixture key={i} m={m} now={now} flags={flags} fixtures={fixtures} liveIdx={liveIdx} owners={owners} tz={tz} />
        ))}
      </ul>
    </div>
  );
}

function Fixture({
  m,
  now,
  flags,
  fixtures,
  liveIdx,
  owners,
  tz,
}: {
  m: Match;
  now: number;
  flags: Map<string, string>;
  fixtures: Map<string, FixtureRow>;
  liveIdx: LiveIndex;
  owners: OwnerIndex;
  tz: string;
}) {
  const info = liveFor(m, liveIdx);
  const status = info?.phase ?? matchStatus(m, now);
  const isLive = status === 'live';
  const ds = !isLive && m.score?.ft ? displayScore(m) : null;
  const ft = isLive ? info?.ft : ds?.ft ?? info?.ft;
  const fx = fixtures.get(matchKey(m));
  const o1 = owners.get(m.team1);
  const o2 = owners.get(m.team2);
  const clash = !!o1 && !!o2;
  const goals = scorerLines(m, info, flags);

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
          formatKickoff(kickoffMs(m), tz, m.time)
        )}
      </span>
      <span className="fx-match">
        {side(m.team1, o1)}
        <span className="fx-score">
          {ft ? `${ft[0]}–${ft[1]}` : 'v'}
          {ds?.pens ? (
            <span className="score-extra"> ({ds.pens[0]}–{ds.pens[1]} pen)</span>
          ) : ds?.aet ? (
            <span className="score-extra"> a.e.t.</span>
          ) : null}
        </span>
        {side(m.team2, o2)}
      </span>
      <span className="fx-meta">
        <span className="fx-stage">{stageLabel(m)}</span>
        <span className="fx-where">{hostFlag(m.ground)} {shortGround(m.ground)}</span>
      </span>
      {goals.length > 0 && (
        <span className="fx-scorers match-scorers muted small">
          {goals.map((l) => (
            <span key={l.team} className="scorer-line">
              <span className="scorer-flag">{l.flag || '⚽'}</span> {l.scorers.join(', ')}
            </span>
          ))}
        </span>
      )}
      {clash && <span className="fx-clash-tag">⚔️ {o1} vs {o2}</span>}
      {status === 'upcoming' && fx && (
        <WinChances
          className="fx-odds"
          team1={m.team1}
          team2={m.team2}
          p1={fx.p1}
          px={fx.px}
          p2={fx.p2}
          flags={flags}
        />
      )}
    </li>
  );
}
