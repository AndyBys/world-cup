import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  getGroupLabels,
  getGroupStandings,
  getBracket,
  getFlagMap,
  Bracket as BracketData,
  StandingRow,
} from '../lib/worldcup';
import { Standings } from '../components/Standings';
import { Bracket } from '../components/Bracket';

interface GroupData {
  label: string;
  rows: StandingRow[];
}

export function Tournament() {
  const [groups, setGroups] = useState<GroupData[] | null>(null);
  const [bracket, setBracket] = useState<BracketData | null>(null);
  const [flags, setFlags] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'groups' | 'bracket'>('bracket');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [labels, flagMap, br] = await Promise.all([
          getGroupLabels(),
          getFlagMap(),
          getBracket(),
        ]);
        if (!alive) return;
        setFlags(flagMap);
        setBracket(br);
        const data = await Promise.all(
          labels.map(async (label) => ({ label, rows: await getGroupStandings(label) })),
        );
        if (alive) setGroups(data);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Failed to load tournament data.');
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

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
        </div>

        {error && <p className="error">{error}</p>}
      </div>

      {tab === 'bracket' &&
        (!bracket ? (
          <p className="muted center">Loading bracket…</p>
        ) : (
          <Bracket data={bracket} flags={flags} />
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
                  <Standings rows={g.rows} flags={flags} linkTeams compact />
                </section>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
