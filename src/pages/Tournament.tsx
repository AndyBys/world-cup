import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  getMatches,
  getBracket,
  getFlagMap,
  refreshMatches,
  computeStandings,
  topScorers,
  Bracket as BracketData,
  Match,
} from '../lib/worldcup';
import { overlayFinished } from '../lib/live';
import { useClock, useLiveScores } from '../lib/useLive';
import { useOwners } from '../lib/owners';
import { Standings } from '../components/Standings';
import { Bracket } from '../components/Bracket';
import { TopScorers } from '../components/TopScorers';

export function Tournament() {
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [bracket, setBracket] = useState<BracketData | null>(null);
  const [flags, setFlags] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'groups' | 'bracket' | 'scorers'>('bracket');
  const now = useClock();
  const liveIdx = useLiveScores();
  const owners = useOwners();

  useEffect(() => {
    let alive = true;
    const load = async (refresh = false) => {
      try {
        const [ms, flagMap, br] = await Promise.all([
          refresh ? refreshMatches() : getMatches(),
          getFlagMap(),
          getBracket(),
        ]);
        if (!alive) return;
        setMatches(ms);
        setFlags(flagMap);
        setBracket(br);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Failed to load tournament data.');
      }
    };
    load();
    const id = setInterval(() => load(true), 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const groups = useMemo(() => {
    if (!matches) return null;
    const overlaid = overlayFinished(matches, liveIdx);
    const labels = [...new Set(overlaid.map((m) => m.group).filter(Boolean) as string[])].sort();
    return labels.map((label) => ({ label, rows: computeStandings(overlaid, label) }));
  }, [matches, liveIdx]);

  // Golden Boot: openfootball's permanent goal lists (independent of the live feed).
  const scorers = useMemo(() => (matches ? topScorers(matches) : null), [matches]);

  return (
    <div className="page">
      <div className="container">
        <Link className="back" to="/">
          ← results
        </Link>
        <header className="page-head">
          <h1>The Road to the Final</h1>
          <p className="tagline">World Cup 2026 · 12 groups · 32-team knockout</p>
        </header>

        <div className="tabs">
          <button className={tab === 'bracket' ? 'tab on' : 'tab'} onClick={() => setTab('bracket')}>
            Knockout bracket
          </button>
          <button className={tab === 'groups' ? 'tab on' : 'tab'} onClick={() => setTab('groups')}>
            Groups
          </button>
          <button className={tab === 'scorers' ? 'tab on' : 'tab'} onClick={() => setTab('scorers')}>
            Scorers
          </button>
        </div>

        {error && <p className="error">{error}</p>}
      </div>

      {tab === 'bracket' &&
        (!bracket ? (
          <p className="muted center">Loading bracket…</p>
        ) : (
          <Bracket data={bracket} flags={flags} now={now} liveIdx={liveIdx} owners={owners} />
        ))}

      {tab === 'groups' && (
        <div className="container wide">
          {!groups ? (
            <p className="muted">Loading groups…</p>
          ) : (
            <div className="groups-grid">
              {groups.map((g) => (
                <section key={g.label} className="card group-card">
                  <h2>{g.label}</h2>
                  <Standings rows={g.rows} flags={flags} linkTeams compact owners={owners} />
                </section>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'scorers' && (
        <div className="container">
          <section className="card">
            <h2>⚽ Top scorers</h2>
            {!scorers ? (
              <p className="muted">Loading scorers…</p>
            ) : (
              <TopScorers rows={scorers} flags={flags} />
            )}
          </section>
        </div>
      )}
    </div>
  );
}
