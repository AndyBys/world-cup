import { useEffect, useMemo, useState, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase, friendlyError, Player } from '../lib/supabase';
import { STAKE, TOURNAMENT_NAME } from '../lib/config';
import { getTeams, Team } from '../lib/worldcup';
import { CURRENCIES, convert, getRates } from '../lib/currency';
import { poolByOdds } from '../lib/pool';
import { ULTRA_POOL, ultraInfo } from '../lib/ultra';
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
    supabase.from('players').select('id,name,created_at,is_ultra').order('created_at'),
    supabase.from('assignments').select('player_id,team'),
    supabase.rpc('is_drawn'),
  ]);
  const map = new Map<string, string>();
  for (const a of assignments ?? []) map.set(a.player_id, a.team);
  return { players: (players as Player[]) ?? [], assignments: map, drawn: !!drawn };
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
  // The current user's locked-in underdog, shown the moment they ultra-gamble
  // (before the main draw) and forever after.
  const myUltraTeam = me?.is_ultra ? state?.assignments.get(me.id) ?? null : null;

  return (
    <div className="container">
      <header className="hero">
        <h1>🏆 {TOURNAMENT_NAME} — Friends Lottery</h1>
        <p className="tagline">Sign up, get drawn a national team, follow them to glory.</p>
      </header>

      <PotBanner pot={pot} drawn={drawn} count={playerCount} />

      {myUltraTeam && <UltraReveal team={myUltraTeam} flags={flags} />}

      <nav className="nav-row">
        <Link className="nav-btn" to="/tournament">
          🌍 All groups &amp; knockout bracket
        </Link>
      </nav>

      {!state ? (
        <p className="muted">Loading…</p>
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

      <PoolTable flags={flags} />

      <UltraPool flags={flags} />

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
        title="Tap to see other currencies"
      >
        💰 ${pot}
      </button>
      <span className="pot-label">
        community pot — winner takes all
        {!drawn && count > 0 && <em> (grows ${STAKE} per player)</em>}
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

/** The teams up for grabs in the draw, with each team's win probability. */
function PoolTable({ flags }: { flags: Map<string, string> }) {
  const rows = poolByOdds();
  const max = rows[0]?.prob ?? 1;
  return (
    <section className="card pool-card">
      <h2>🎟️ The draw pool — top {rows.length} teams</h2>
      <p className="muted small">
        Odds to win the World Cup. The draw deals out the strongest teams first —
        one per player — so the more friends join, the further down the list it goes.
      </p>
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
    </section>
  );
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
          placeholder="Your name"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
        />
        <button type="submit" disabled={busy || !name.trim()}>
          {busy ? 'Joining…' : cta}
        </button>
      </form>
      {offerUltra && (
        <button
          type="button"
          className="ultra-btn"
          disabled={busy || !name.trim()}
          onClick={() => join('ultra')}
          title="Forfeit your shot at a top team. Get a random underdog. No takebacks."
        >
          🎰 ULTRA-GAMBLE 🎲
          <span className="ultra-btn-sub">skip the draw · roll for a longshot · 💸</span>
        </button>
      )}
      {error && <p className="error">{error}</p>}
    </>
  );
}

/** The dramatic "your fate is sealed" banner for a player who ultra-gambled. */
function UltraReveal({ team, flags }: { team: string; flags: Map<string, string> }) {
  const info = ultraInfo(team);
  return (
    <div className="ultra-reveal">
      <span className="ultra-reveal-top">🎰 The dice are loaded… your fate is sealed</span>
      <Link className="ultra-reveal-team" to={`/team/${encodeURIComponent(team)}`}>
        <span className="ultra-reveal-flag">{flags.get(team) ?? '⚽'}</span>
        <span className="ultra-reveal-name">{team}</span>
        {info && <span className="ultra-reveal-odds">{info.odds}</span>}
      </Link>
      <span className="ultra-reveal-sub">
        {info
          ? `win $${info.payout} on a $10 bet · no takebacks`
          : 'no takebacks'}
      </span>
    </div>
  );
}

/** "For the degenerates" — the ultra-gamble underdog pool with its big odds. */
function UltraPool({ flags }: { flags: Map<string, string> }) {
  return (
    <section className="card ultra-card">
      <h2>🎰 Ultra-gamble pool — for the degenerates</h2>
      <p className="muted small">
        Skip the draw and roll for one of these {ULTRA_POOL.length} underdogs.
        Tiny odds, juicy payouts, zero regrets. One per gambler — first come,
        first served.
      </p>
      <ul className="ultra-list">
        {ULTRA_POOL.map((u) => (
          <li key={u.team} className="ultra-row">
            <Link className="ultra-team" to={`/team/${encodeURIComponent(u.team)}`}>
              <span className="ultra-flag">{flags.get(u.team) ?? '⚽'}</span>
              <span className="ultra-name">{u.team}</span>
            </Link>
            <span className="ultra-odds">{u.odds}</span>
            <span className="ultra-payout">$10 → ${u.payout}</span>
          </li>
        ))}
      </ul>
    </section>
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
      <h2>The lobby is open</h2>
      <p className="muted">
        {state.players.length === 0
          ? 'Be the first to sign up!'
          : `${state.players.length} signed up so far — waiting for the draw.`}
      </p>

      {!alreadyJoined ? (
        <JoinForm onJoined={onJoined} cta="Join the lottery" />
      ) : (
        <p className="joined-note">✅ You're in! Sit tight for the draw.</p>
      )}

      {state.players.length > 0 && (
        <table className="roster-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Player</th>
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
                    {p.id === myId && <span className="you-tag"> (you)</span>}
                    {ultraTeam && (
                      <span className="ultra-badge" title="Ultra-gambled into a longshot">
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
      <h2>🎲 The draw is in!</h2>
      <table className="results">
        <thead>
          <tr>
            <th>Friend</th>
            <th>Team</th>
            <th>Stake</th>
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
                {player.id === myId && <span className="you-tag"> · you</span>}
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
      <p className="muted small">Tap a team to see their group, fixtures and results.</p>

      {!alreadyJoined && (
        <div className="late-join">
          <p>Late to the party? Join now and you'll be assigned one of the remaining teams.</p>
          <JoinForm onJoined={onJoined} cta="Join late" offerUltra={false} />
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
          organiser? run the draw
        </button>
      ) : (
        <div className="admin-box">
          <input
            type="password"
            placeholder="Admin passcode"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            disabled={busy}
          />
          <button onClick={draw} disabled={busy || !passcode}>
            {busy ? 'Drawing…' : '🎲 Run draw'}
          </button>
          <button className="link" onClick={() => setOpen(false)}>
            cancel
          </button>
          {error && <p className="error">{error}</p>}
        </div>
      )}
    </section>
  );
}
