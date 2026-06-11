import { useEffect, useMemo, useState, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase, friendlyError, Player } from '../lib/supabase';
import { STAKE, TOURNAMENT_NAME } from '../lib/config';
import { getTeams, Team } from '../lib/worldcup';
import { CURRENCIES, convert, getRates } from '../lib/currency';
import { poolByOdds } from '../lib/pool';
import { TeamPill } from '../components/TeamPill';

const MY_ID_KEY = 'wc26_player_id';

interface GameState {
  players: Player[];
  assignments: Map<string, string>; // player_id -> team
}

async function loadState(): Promise<GameState> {
  const [{ data: players }, { data: assignments }] = await Promise.all([
    supabase.from('players').select('id,name,created_at').order('created_at'),
    supabase.from('assignments').select('player_id,team'),
  ]);
  const map = new Map<string, string>();
  for (const a of assignments ?? []) map.set(a.player_id, a.team);
  return { players: (players as Player[]) ?? [], assignments: map };
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

  const drawn = !!state && state.assignments.size > 0;
  const playerCount = state?.players.length ?? 0;
  const pot = playerCount * STAKE;
  const alreadyJoined = !!myId && !!state?.players.some((p) => p.id === myId);

  return (
    <div className="container">
      <header className="hero">
        <h1>🏆 {TOURNAMENT_NAME} — Friends Lottery</h1>
        <p className="tagline">Sign up, get drawn a national team, follow them to glory.</p>
      </header>

      <PotBanner pot={pot} drawn={drawn} count={playerCount} />

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
          alreadyJoined={alreadyJoined}
          onJoined={handleJoined}
        />
      )}

      <PoolTable flags={flags} />

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
      <h2>🎟️ The draw pool — {rows.length} teams up for grabs</h2>
      <p className="muted small">Odds to win the World Cup for each team you could be drawn.</p>
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

/** Name input → join_lobby. Reused for the pre-draw lobby and late joiners. */
function JoinForm({ onJoined, cta }: { onJoined: (id: string) => void; cta: string }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    const { data, error } = await supabase.rpc('join_lobby', { p_name: name });
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
      <form onSubmit={submit} className="signup">
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
      {error && <p className="error">{error}</p>}
    </>
  );
}

function Lobbying({
  state,
  myId,
  alreadyJoined,
  onJoined,
}: {
  state: GameState;
  myId: string | null;
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
            {state.players.map((p, i) => (
              <tr key={p.id} className={p.id === myId ? 'me' : ''}>
                <td className="muted">{i + 1}</td>
                <td>
                  👤 {p.name}
                  {p.id === myId && <span className="you-tag"> (you)</span>}
                </td>
              </tr>
            ))}
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
          <JoinForm onJoined={onJoined} cta="Join late" />
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
