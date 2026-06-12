import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  getMatches,
  getFlagMap,
  refreshMatches,
  stageLabel,
  kickoffMs,
  Match,
} from '../lib/worldcup';
import { liveFor, LiveIndex } from '../lib/live';
import { useClock, useLiveScores } from '../lib/useLive';
import { formatKickoff, useTimezone, ymdInZone } from '../lib/timezone';
import { TimezonePicker } from '../components/TimezonePicker';
import {
  claimPlayer,
  clearIdentity,
  getFixtures,
  getLeaderboard,
  getPlayerNames,
  getPredictions,
  loadIdentity,
  matchKey,
  predictionError,
  submitPrediction,
  Fixture,
  Identity,
  LeaderboardRow,
  Pick,
  PredictionRow,
} from '../lib/predictions';

const PICKS: Pick[] = ['1', 'X', '2'];

/** Prediction game: guess 1 / X / 2 for each match, public picks + leaderboard. */
export function Predict() {
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [flags, setFlags] = useState<Map<string, string>>(new Map());
  const [fixtures, setFixtures] = useState<Map<string, Fixture>>(new Map());
  const [preds, setPreds] = useState<Map<string, PredictionRow[]>>(new Map());
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [board, setBoard] = useState<LeaderboardRow[]>([]);
  const [me, setMe] = useState<Identity | null>(() => loadIdentity());
  const now = useClock(60_000);
  const liveIdx = useLiveScores();
  const [tz] = useTimezone();

  // Reload the prediction data (fixtures/picks/leaderboard) after each pick.
  const reload = () => {
    Promise.all([getFixtures(), getPredictions(), getLeaderboard(), getPlayerNames()])
      .then(([f, p, b, n]) => {
        setFixtures(f);
        setPreds(p);
        setBoard(b);
        setNames(n);
      })
      .catch(() => {});
  };

  useEffect(() => {
    let alive = true;
    getFlagMap().then((f) => alive && setFlags(f)).catch(() => {});
    const load = (refresh = false) =>
      (refresh ? refreshMatches() : getMatches())
        .then((m) => alive && setMatches(m))
        .catch(() => {});
    load();
    reload();
    const id = setInterval(() => {
      load(true);
      reload();
    }, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Like the home board: only today & tomorrow (in the viewer's zone), and only
  // matches the server knows about (a fixture row = a kickoff lock).
  const days = useMemo(() => {
    const todayStr = ymdInZone(now, tz);
    const tomorrowStr = ymdInZone(now + 86_400_000, tz);
    const dayOf = (m: Match) => {
      const k = kickoffMs(m);
      return k == null ? m.date : ymdInZone(k, tz);
    };
    const inDay = (ymd: string) =>
      (matches ?? [])
        .filter((m) => fixtures.has(matchKey(m)) && dayOf(m) === ymd)
        .sort((a, b) => (kickoffMs(a) ?? 0) - (kickoffMs(b) ?? 0));
    return [
      ['Сегодня', todayStr, inDay(todayStr)] as const,
      ['Завтра', tomorrowStr, inDay(tomorrowStr)] as const,
    ].filter(([, , ms]) => ms.length > 0);
  }, [matches, fixtures, now, tz]);

  return (
    <div className="page">
      <div className="container wide">
        <header className="page-head">
          <Link className="back" to="/">← В лотерею</Link>
          <h1>🔮 Прогнозы матчей</h1>
          <p className="muted">
            Угадай исход каждого матча — 1 (победа хозяев), X (ничья) или 2 (победа
            гостей). 1 очко за угаданный исход. Ставки закрываются в момент стартового
            свистка.
          </p>
        </header>

        <IdentityBar me={me} onLogin={setMe} onLogout={() => { clearIdentity(); setMe(null); }} />

        <Leaderboard board={board} meId={me?.id} />

        <section className="card">
          <div className="today-head">
            <h2>📅 Матчи</h2>
            <TimezonePicker />
          </div>
          {!matches ? (
            <p className="muted">Загрузка…</p>
          ) : days.length === 0 ? (
            <p className="muted small">
              Сегодня и завтра матчей нет. Загляни позже — прогнозы открываются по
              мере приближения игр.
            </p>
          ) : (
            days.map(([title, ymd, ms]) => (
              <DayBlock
                key={ymd}
                title={title}
                ymd={ymd}
                matches={ms}
                fixtures={fixtures}
                preds={preds}
                names={names}
                flags={flags}
                liveIdx={liveIdx}
                now={now}
                tz={tz}
                me={me}
                onPicked={reload}
              />
            ))
          )}
        </section>
      </div>
    </div>
  );
}

// --- Identity bar -----------------------------------------------------------
function IdentityBar({
  me,
  onLogin,
  onLogout,
}: {
  me: Identity | null;
  onLogin: (idy: Identity) => void;
  onLogout: () => void;
}) {
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (me) {
    return (
      <div className="card pred-id">
        <span>Ты играешь как <strong>{me.name}</strong></span>
        <button className="link" onClick={onLogout}>сменить игрока</button>
      </div>
    );
  }

  const submit = async () => {
    setErr(null);
    setBusy(true);
    try {
      onLogin(await claimPlayer(name, pin));
    } catch (e) {
      setErr(predictionError((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card pred-login">
      <p className="muted small">
        Войди именем и 4-значным PIN. Первый раз — PIN задаётся, потом он же тебя
        пускает (и защищает твои прогнозы от чужих рук).
      </p>
      <div className="signup">
        <input
          placeholder="Имя"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={24}
        />
        <input
          placeholder="PIN (4 цифры)"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
          inputMode="numeric"
          maxLength={4}
        />
        <button onClick={submit} disabled={busy || !name.trim() || pin.length !== 4}>
          Войти
        </button>
      </div>
      {err && <p className="error">{err}</p>}
    </div>
  );
}

// --- Leaderboard ------------------------------------------------------------
function Leaderboard({ board, meId }: { board: LeaderboardRow[]; meId?: string }) {
  return (
    <section className="card">
      <h2>🏅 Таблица прогнозистов</h2>
      {board.length === 0 ? (
        <p className="muted small">
          Пока никто не сделал прогноз. Поставь на матчи ниже — и сюда подтянутся
          очки (по 1 за угаданный исход).
        </p>
      ) : (
      <table className="standings">
        <thead>
          <tr>
            <th>#</th>
            <th className="th-team">Игрок</th>
            <th title="Очки (угаданные исходы)">Очки</th>
            <th title="Матчей сыграно с твоим прогнозом">Сыграно</th>
            <th title="Всего прогнозов">Всего</th>
          </tr>
        </thead>
        <tbody>
          {board.map((r, i) => (
            <tr key={r.player_id} className={r.player_id === meId ? 'me' : ''}>
              <td>{i + 1}</td>
              <td className="team-cell">{r.name}</td>
              <td className="pts">{r.points}</td>
              <td>{r.settled}</td>
              <td>{r.picks}</td>
            </tr>
          ))}
        </tbody>
      </table>
      )}
    </section>
  );
}

// --- A day's matches --------------------------------------------------------
function DayBlock({
  title,
  ymd,
  matches,
  fixtures,
  preds,
  names,
  flags,
  liveIdx,
  now,
  tz,
  me,
  onPicked,
}: {
  title: string;
  ymd: string;
  matches: Match[];
  fixtures: Map<string, Fixture>;
  preds: Map<string, PredictionRow[]>;
  names: Map<string, string>;
  flags: Map<string, string>;
  liveIdx: LiveIndex;
  now: number;
  tz: string;
  me: Identity | null;
  onPicked: () => void;
}) {
  const label = new Date(ymd + 'T12:00:00Z').toLocaleDateString('ru-RU', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
  return (
    <div className="day-block">
      <div className="day-head">
        <span className="day-title">{title}</span>
        <span className="day-sub">{label}</span>
      </div>
      <ul className="fixtures">
        {matches.map((m) => (
          <PredictRow
            key={matchKey(m)}
            m={m}
            fixture={fixtures.get(matchKey(m))!}
            picks={preds.get(matchKey(m)) ?? []}
            names={names}
            flags={flags}
            liveIdx={liveIdx}
            now={now}
            tz={tz}
            me={me}
            onPicked={onPicked}
          />
        ))}
      </ul>
    </div>
  );
}

// --- One match row with the 1 / X / 2 controls ------------------------------
function PredictRow({
  m,
  fixture,
  picks,
  names,
  flags,
  liveIdx,
  now,
  tz,
  me,
  onPicked,
}: {
  m: Match;
  fixture: Fixture;
  picks: PredictionRow[];
  names: Map<string, string>;
  flags: Map<string, string>;
  liveIdx: LiveIndex;
  now: number;
  tz: string;
  me: Identity | null;
  onPicked: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const kickoff = Date.parse(fixture.kickoff_utc);
  const locked = now >= kickoff;
  const info = liveFor(m, liveIdx);
  const isLive = locked && !fixture.result && info?.phase === 'live';
  const ft = fixture.ft ?? (isLive ? info?.ft : undefined);

  const myPick = me ? picks.find((p) => p.player_id === me.id)?.pick : undefined;
  const tally = (p: Pick) => picks.filter((x) => x.pick === p);
  // A pick is final: once you've predicted this match you can't change it.
  const picked = myPick !== undefined;

  const choose = async (pick: Pick) => {
    if (!me || locked || busy || picked) return;
    if (!window.confirm(`Поставить «${pick}» на ${m.team1} – ${m.team2}? Изменить будет нельзя.`)) {
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      await submitPrediction(me, fixture.match_key, pick);
      onPicked();
    } catch (e) {
      setErr(predictionError((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  const side = (name: string) => (
    <span className="fx-team">
      <span className="fx-flag">{flags.get(name) ?? '·'}</span>
      <span className="fx-name">{name}</span>
    </span>
  );

  return (
    <li className={`fixture pred-fixture ${isLive ? 'live' : ''}`}>
      <span className="fx-time">
        {fixture.result ? 'FT' : isLive ? (
          <span className="badge live"><span className="live-dot" /> LIVE</span>
        ) : (
          formatKickoff(kickoff, tz, m.time)
        )}
      </span>
      <span className="fx-match">
        {side(m.team1)}
        <span className="fx-score">{ft ? `${ft[0]}–${ft[1]}` : 'v'}</span>
        {side(m.team2)}
      </span>
      <span className="fx-meta">
        <span className="fx-stage">{stageLabel(m)}</span>
      </span>

      <div className="pred-controls">
        {PICKS.map((p) => {
          const voters = tally(p);
          const isWin = fixture.result === p;
          const mine = myPick === p;
          return (
            <button
              key={p}
              className={`pred-btn ${mine ? 'mine' : ''} ${isWin ? 'win' : ''}`}
              onClick={() => choose(p)}
              disabled={!me || locked || busy || picked}
              title={voters.map((v) => names.get(v.player_id) ?? '?').join(', ')}
            >
              <span className="pred-label">{p}</span>
              <span className="pred-count">{voters.length}</span>
            </button>
          );
        })}
        {myPick && (
          <span className={`pred-mine-tag ${fixture.result ? (myPick === fixture.result ? 'ok' : 'no') : ''}`}>
            твой: {myPick}{fixture.result ? (myPick === fixture.result ? ' ✓' : ' ✗') : ''}
          </span>
        )}
      </div>
      {err && <span className="error small">{err}</span>}
    </li>
  );
}
