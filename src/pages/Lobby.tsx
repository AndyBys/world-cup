import { useEffect, useMemo, useState, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase, friendlyError, Player } from '../lib/supabase';
import { STAKE, TOURNAMENT_NAME } from '../lib/config';
import { getTeams, Team } from '../lib/worldcup';
import { CURRENCIES, convert, getRates } from '../lib/currency';
import { poolByOdds } from '../lib/pool';
import { ULTRA_TEAMS } from '../lib/ultra';
import { TeamPill } from '../components/TeamPill';
import { TodayMatches } from '../components/TodayMatches';

const MY_ID_KEY = 'wc26_player_id';

interface GameState {
  players: Player[];
  assignments: Map<string, string>; // player_id -> team
  drawn: boolean; // has the main draw run? (ultra players are assigned before it)
}

async function loadState(): Promise<GameState> {
  const [{ data: players }, { data: assignments }, { data: drawn }] = await Promise.all([
    supabase.from('players').select('id,name,created_at,is_ultra,predicts_only').order('created_at'),
    supabase.from('assignments').select('player_id,team'),
    supabase.rpc('is_drawn'),
  ]);
  const map = new Map<string, string>();
  for (const a of assignments ?? []) map.set(a.player_id, a.team);
  // Predict-only sign-ups (joined via /predict, no lottery team) must not show up
  // in the lottery roster/results — they'd appear teamless. Keep only real entrants.
  const roster = ((players as (Player & { predicts_only?: boolean })[]) ?? []).filter(
    (p) => !p.predicts_only,
  );
  return { players: roster, assignments: map, drawn: !!drawn };
}

export function Lobby() {
  const [state, setState] = useState<GameState | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [myId, setMyId] = useState<string | null>(() => localStorage.getItem(MY_ID_KEY));

  // Initial load + light polling so the lobby updates as friends join / draw runs.
  useEffect(() => {
    let alive = true;
    const refresh = () => loadState().then((s) => alive && setState(s)).catch(() => {});
    refresh();
    const t = setInterval(refresh, 4000);
    getTeams().then((t) => alive && setTeams(t)).catch(() => {});
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const flags = useMemo(
    () => new Map(teams.map((t) => [t.name, t.flag_icon ?? '⚽'])),
    [teams],
  );

  const handleJoined = (id: string) => {
    localStorage.setItem(MY_ID_KEY, id);
    setMyId(id);
    loadState().then(setState).catch(() => {});
  };

  const drawn = !!state?.drawn;
  const playerCount = state?.players.length ?? 0;
  const pot = playerCount * STAKE;
  const me = state?.players.find((p) => p.id === myId);
  const alreadyJoined = !!me;
  // The normal draw deals top-N pool teams to the N non-ultra players (ultra
  // players take underdogs instead), so that's how many teams are "in play".
  const inPlay = state?.players.filter((p) => !p.is_ultra).length ?? 0;
  // The current user's locked-in underdog, shown the moment they ultra-gamble
  // (before the main draw) and forever after.
  const myUltraTeam = me?.is_ultra ? state?.assignments.get(me.id) ?? null : null;

  return (
    <div className="container">
      <header className="hero">
        <h1>🏆 {TOURNAMENT_NAME} — лотерея для своих</h1>
        <p className="tagline">
          Заходи в лотерею, получи случайную сборную в жеребьёвке и болей за неё до финала.
        </p>
      </header>

      <PotBanner pot={pot} drawn={drawn} count={playerCount} />

      {myUltraTeam && <UltraReveal team={myUltraTeam} flags={flags} />}

      <nav className="nav-row">
        <Link className="nav-btn" to="/tournament">
          🌍 Все группы и сетка плей-офф
        </Link>
        <Link className="nav-btn" to="/predict">
          🔮 Прогнозы матчей
        </Link>
      </nav>

      {!state ? (
        <p className="muted">Загрузка…</p>
      ) : drawn ? (
        <Results
          state={state}
          myId={myId}
          flags={flags}
          alreadyJoined={alreadyJoined}
          onJoined={handleJoined}
        />
      ) : (
        <Lobbying
          state={state}
          myId={myId}
          flags={flags}
          alreadyJoined={alreadyJoined}
          onJoined={handleJoined}
        />
      )}

      <TodayMatches />

      <PoolTable flags={flags} inPlay={inPlay} />

      {!drawn && <AdminStrip onDrew={() => loadState().then(setState).catch(() => {})} />}
    </div>
  );
}

function PotBanner({ pot, drawn, count }: { pot: number; drawn: boolean; count: number }) {
  const [open, setOpen] = useState(false);
  const [rates, setRates] = useState<Record<string, number>>({});

  useEffect(() => {
    getRates().then(setRates).catch(() => {});
  }, []);

  return (
    <div className="pot">
      <button
        className="pot-amount"
        onClick={() => setOpen((o) => !o)}
        title="Нажми, чтобы увидеть в других валютах"
      >
        💰 ${pot}
      </button>
      <span className="pot-label">
        <strong className="pot-buyin">${STAKE} с человека</strong> · общий банк, победитель забирает всё
        {!drawn && count > 0 && <em> (+${STAKE} за каждого нового игрока)</em>}
      </span>
      {open && (
        <div className="pot-conversions">
          {CURRENCIES.map((c) => (
            <span key={c.code} className="fx">
              <strong>{convert(pot, c, rates)}</strong> {c.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The teams actually in the draw right now: the top-N pool teams, where N =
 * how many (non-ultra) friends have registered. As more join, more teams enter
 * — so the list grows with the lobby. Percentages are the current bookmaker
 * odds to win the World Cup.
 */
function PoolTable({ flags, inPlay }: { flags: Map<string, string>; inPlay: number }) {
  const all = poolByOdds();
  const n = Math.min(inPlay, all.length);
  const rows = all.slice(0, n);
  const max = all[0]?.prob ?? 1; // scale bars against the strongest team overall

  return (
    <section className="card pool-card">
      <h2>🎟️ В розыгрыше сейчас — {n} {plural(n, 'команда', 'команды', 'команд')}</h2>
      <p className="muted small">
        Случайно раздаём именно из этих команд — по одной на человека. Сейчас
        зарегано {inPlay}, поэтому в игре топ-{n}. Зайдёт больше друзей —
        добавятся следующие по силе. Проценты — текущие шансы букмекеров выиграть
        ЧМ.
      </p>
      {n === 0 ? (
        <p className="muted small pool-empty">
          Пока никто не зашёл. Добавляйся — и первой в розыгрыш войдёт{' '}
          {all[0]?.team}.
        </p>
      ) : (
        <ul className="pool-list">
          {rows.map((r) => (
            <li key={r.team} className="pool-row">
              <Link className="pool-team" to={`/team/${encodeURIComponent(r.team)}`}>
                <span className="pool-flag">{flags.get(r.team) ?? '⚽'}</span>
                <span className="pool-name">{r.team}</span>
              </Link>
              <span className="pool-bar-wrap">
                <span className="pool-bar" style={{ width: `${(r.prob / max) * 100}%` }} />
              </span>
              <span className="pool-prob">{Math.round(r.prob)}%</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Russian plural picker: plural(n, "команда", "команды", "команд"). */
function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

/**
 * Name input → join_lobby (normal) or join_ultra (forfeit the top-team draw for
 * a random underdog). Reused for the pre-draw lobby and late joiners. The ultra
 * button is hidden once the main draw has run (offerUltra=false) since the
 * underdog pool is no longer part of the live draw.
 */
function JoinForm({
  onJoined,
  cta,
  offerUltra = true,
}: {
  onJoined: (id: string) => void;
  cta: string;
  offerUltra?: boolean;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function join(mode: 'normal' | 'ultra') {
    if (!name.trim()) return;
    setError('');
    setBusy(true);
    const fn = mode === 'ultra' ? 'join_ultra' : 'join_lobby';
    const { data, error } = await supabase.rpc(fn, { p_name: name });
    setBusy(false);
    if (error) {
      setError(friendlyError(error.message));
      return;
    }
    setName('');
    onJoined(data as string);
  }

  const [showInfo, setShowInfo] = useState(false);

  return (
    <>
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          join('normal');
        }}
        className="signup"
      >
        <input
          type="text"
          placeholder="Твоё имя"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
        />
        <button type="submit" disabled={busy || !name.trim()}>
          {busy ? 'Заходим…' : cta}
        </button>
        {offerUltra && (
          <button
            type="button"
            className="ultra-btn"
            disabled={busy || !name.trim()}
            onClick={() => join('ultra')}
            title="Откажись от шанса на топ-команду. Получи случайного аутсайдера. Назад дороги нет."
          >
            🎰 Ultra-gamble
          </button>
        )}
      </form>
      {offerUltra && (
        <>
          <button
            type="button"
            className="link ultra-info-link"
            onClick={() => setShowInfo((s) => !s)}
          >
            🎰 что такое Ultra-gamble?
          </button>
          {showInfo && (
            <p className="ultra-hint muted small">
              Вместо обычной жеребьёвки (где можно вытащить фаворита вроде Испании
              или Франции) ты <strong>сразу</strong> получаешь одного случайного{' '}
              <strong>аутсайдера</strong> — шанс на сенсацию крошечный, но если
              выстрелит… Одна команда на человека, <strong>назад дороги нет</strong>.
              Можешь получить: {ULTRA_TEAMS.join(' · ')}.
            </p>
          )}
        </>
      )}
      {error && <p className="error">{error}</p>}
    </>
  );
}

/** The dramatic "your fate is sealed" banner for a player who ultra-gambled. */
function UltraReveal({ team, flags }: { team: string; flags: Map<string, string> }) {
  return (
    <div className="ultra-reveal">
      <span className="ultra-reveal-top">🎰 Кости брошены… твоя судьба решена</span>
      <Link className="ultra-reveal-team" to={`/team/${encodeURIComponent(team)}`}>
        <span className="ultra-reveal-flag">{flags.get(team) ?? '⚽'}</span>
        <span className="ultra-reveal-name">{team}</span>
      </Link>
      <span className="ultra-reveal-sub">назад дороги нет 🎲</span>
    </div>
  );
}

function Lobbying({
  state,
  myId,
  flags,
  alreadyJoined,
  onJoined,
}: {
  state: GameState;
  myId: string | null;
  flags: Map<string, string>;
  alreadyJoined: boolean;
  onJoined: (id: string) => void;
}) {
  return (
    <section className="card">
      <h2>Лобби открыто</h2>

      {!alreadyJoined && (
        <ol className="how-it-works">
          <li>
            <span className="hiw-emoji">✍️</span>
            <span className="hiw-text">
              Впиши имя и заходи — взнос <strong>${STAKE}</strong> идёт в общий банк
            </span>
          </li>
          <li>
            <span className="hiw-emoji">🎲</span>
            <span className="hiw-text">В день жеребьёвки тебе достаётся случайная сборная</span>
          </li>
          <li>
            <span className="hiw-emoji">🏆</span>
            <span className="hiw-text">Чья команда выиграет ЧМ — забирает весь банк</span>
          </li>
        </ol>
      )}

      <p className="muted">
        {state.players.length === 0
          ? 'Будь первым — впиши имя ниже!'
          : `Уже записалось: ${state.players.length}. Ждём жеребьёвку.`}
      </p>

      {!alreadyJoined ? (
        <JoinForm onJoined={onJoined} cta="В лотерею!" />
      ) : (
        <p className="joined-note">✅ Ты в игре! Жди жеребьёвку.</p>
      )}

      {state.players.length > 0 && (
        <table className="roster-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Игрок</th>
            </tr>
          </thead>
          <tbody>
            {state.players.map((p, i) => {
              const ultraTeam = p.is_ultra ? state.assignments.get(p.id) : undefined;
              return (
                <tr key={p.id} className={p.id === myId ? 'me' : ''}>
                  <td className="muted">{i + 1}</td>
                  <td>
                    👤 {p.name}
                    {p.id === myId && <span className="you-tag"> (ты)</span>}
                    {ultraTeam && (
                      <span className="ultra-badge" title="Ультра-гэмбл на аутсайдера">
                        🎰 {flags.get(ultraTeam) ?? ''} {ultraTeam}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Results({
  state,
  myId,
  flags,
  alreadyJoined,
  onJoined,
}: {
  state: GameState;
  myId: string | null;
  flags: Map<string, string>;
  alreadyJoined: boolean;
  onJoined: (id: string) => void;
}) {
  const rows = state.players
    .map((p) => ({ player: p, team: state.assignments.get(p.id) ?? null }))
    .sort((a, b) => (a.team ?? '').localeCompare(b.team ?? ''));

  return (
    <section className="card">
      <h2>🎲 Жеребьёвка состоялась!</h2>
      <table className="results">
        <thead>
          <tr>
            <th>Друг</th>
            <th>Команда</th>
            <th>Взнос</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ player, team }) => (
            <tr key={player.id} className={player.id === myId ? 'me' : ''}>
              <td>
                <span className="player-name">{player.name}</span>
                {player.is_ultra && (
                  <span className="ultra-tag" title="Ultra-gambled">🎰</span>
                )}
                {player.id === myId && <span className="you-tag"> · ты</span>}
              </td>
              <td>
                {team ? (
                  <TeamPill name={team} flags={flags} />
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
              <td className="stake">${STAKE}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">Нажми на команду — увидишь её группу, расписание и результаты.</p>

      {!alreadyJoined && (
        <div className="late-join">
          <p>Опоздал? Заходи сейчас — получишь одну из оставшихся команд.</p>
          <JoinForm onJoined={onJoined} cta="Зайти сейчас" offerUltra={false} />
        </div>
      )}
    </section>
  );
}

function AdminStrip({ onDrew }: { onDrew: () => void }) {
  const [open, setOpen] = useState(false);
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function draw() {
    setError('');
    setBusy(true);
    const { error } = await supabase.rpc('run_draw', { p_passcode: passcode });
    setBusy(false);
    if (error) {
      setError(friendlyError(error.message));
      return;
    }
    setPasscode('');
    setOpen(false);
    onDrew();
  }

  return (
    <section className="admin">
      {!open ? (
        <button className="link" onClick={() => setOpen(true)}>
          организатор? запустить жеребьёвку
        </button>
      ) : (
        <div className="admin-box">
          <input
            type="password"
            placeholder="Пароль организатора"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            disabled={busy}
          />
          <button onClick={draw} disabled={busy || !passcode}>
            {busy ? 'Разыгрываем…' : '🎲 Запустить'}
          </button>
          <button className="link" onClick={() => setOpen(false)}>
            отмена
          </button>
          {error && <p className="error">{error}</p>}
        </div>
      )}
    </section>
  );
}
