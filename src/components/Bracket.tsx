import {
  BNode,
  Match,
  Bracket as BracketData,
  matchStatus,
  prettySlot,
  shortGround,
  shortDate,
  hostFlag,
  winningSide,
  displayScore,
} from '../lib/worldcup';
import { liveFor, LiveIndex } from '../lib/live';
import { OwnerIndex } from '../lib/owners';
import { Link } from 'react-router-dom';

// fraction label → underlying round name (for date-range lookup)
const FRACTIONS: [string, string][] = [
  ['1/16', 'Round of 32'],
  ['1/8', 'Round of 16'],
  ['1/4', 'Quarter-final'],
  ['1/2', 'Semi-final'],
];

/**
 * Two-sided knockout draw sheet (tennis style): the top half flows right toward
 * the centre, the bottom half flows left, meeting at the Final. Connector lines
 * are pure CSS, sized in percentages so they align at any depth.
 */
export function Bracket({
  data,
  flags,
  now = Date.now(),
  liveIdx = new Map(),
  owners = new Map(),
}: {
  data: BracketData;
  flags: Map<string, string>;
  now?: number;
  liveIdx?: LiveIndex;
  owners?: OwnerIndex;
}) {
  if (!data.final) return <p className="muted center">Bracket not available yet.</p>;
  return (
    <div className="draw-scroll">
      {/* Stage header band — column widths mirror the bracket below it. */}
      <div className="draw-heads">
        <div className="dh-half left">
          {FRACTIONS.map(([frac, round]) => (
            <span key={frac} className="dh-col">
              <span className="dh-frac">{frac}</span>
              <span className="dh-range">{data.ranges[round]}</span>
            </span>
          ))}
        </div>
        <div className="dh-centre">
          <span className="dh-frac">Final</span>
          <span className="dh-range">{data.ranges['Final']}</span>
        </div>
        <div className="dh-half right">
          {[...FRACTIONS].reverse().map(([frac, round]) => (
            <span key={frac} className="dh-col">
              <span className="dh-frac">{frac}</span>
              <span className="dh-range">{data.ranges[round]}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="draw">
        {data.left && (
          <div className="draw-half left">
            <Node node={data.left} side="left" flags={flags} now={now} liveIdx={liveIdx} owners={owners} />
          </div>
        )}

        <div className="draw-centre">
          <div className="final-label">🏆 Final</div>
          <MatchBox m={data.final} flags={flags} variant="final" now={now} liveIdx={liveIdx} owners={owners} />
          {data.third && (
            <div className="third">
              <div className="third-label">3rd-place play-off</div>
              <MatchBox m={data.third} flags={flags} variant="third" now={now} liveIdx={liveIdx} owners={owners} />
            </div>
          )}
        </div>

        {data.right && (
          <div className="draw-half right">
            <Node node={data.right} side="right" flags={flags} now={now} liveIdx={liveIdx} owners={owners} />
          </div>
        )}
      </div>
    </div>
  );
}

function Node({
  node,
  side,
  flags,
  now,
  liveIdx,
  owners,
}: {
  node: BNode;
  side: 'left' | 'right';
  flags: Map<string, string>;
  now: number;
  liveIdx: LiveIndex;
  owners: OwnerIndex;
}) {
  const cell = (
    <div className="bt-cell">
      <MatchBox m={node.match} flags={flags} now={now} liveIdx={liveIdx} owners={owners} />
    </div>
  );

  if (node.children.length === 0) return cell;

  const children = (
    <div className="bt-children">
      {node.children.map((c, i) => (
        <Node key={i} node={c} side={side} flags={flags} now={now} liveIdx={liveIdx} owners={owners} />
      ))}
    </div>
  );

  return (
    <div className={`bt-node ${side}`}>
      {side === 'left' ? (
        <>
          {children}
          {cell}
        </>
      ) : (
        <>
          {cell}
          {children}
        </>
      )}
    </div>
  );
}

function MatchBox({
  m,
  flags,
  variant,
  now,
  liveIdx,
  owners,
}: {
  m: Match;
  flags: Map<string, string>;
  variant?: 'final' | 'third';
  now: number;
  liveIdx: LiveIndex;
  owners: OwnerIndex;
}) {
  const info = liveFor(m, liveIdx);
  const isLive = (info?.phase ?? matchStatus(m, now)) === 'live';
  // Openfootball's resolved result (extra time / penalties applied) once it has a
  // final score; fall back to the live feed for a game finished but not yet in
  // openfootball.
  const ds = !isLive && m.score?.ft ? displayScore(m) : null;
  const ft = isLive ? info?.ft : ds?.ft ?? info?.ft;
  const pens = ds?.pens;
  // Winner respects ET/penalties when we have openfootball's score; for a
  // live-feed-only final, the level-90' score is the best signal available.
  const winner =
    isLive || !ft ? 0 : ds ? winningSide(m) : ft[0] > ft[1] ? 1 : ft[0] < ft[1] ? 2 : 0;
  const o1 = owners.get(m.team1);
  const o2 = owners.get(m.team2);
  const clash = !!o1 && !!o2; // two friends' teams meet — the moment we want
  return (
    <div className={`mbox ${variant ?? ''} ${isLive ? 'live' : ''} ${clash ? 'clash' : ''}`}>
      {clash && <div className="clash-ribbon">⚔️ {o1} vs {o2}</div>}
      <Side name={m.team1} flags={flags} score={ft?.[0]} pens={pens?.[0]} win={winner === 1} owner={o1} />
      <Side name={m.team2} flags={flags} score={ft?.[1]} pens={pens?.[1]} win={winner === 2} owner={o2} />
      <div className="mbox-foot">
        {isLive ? (
          <span className="mbox-live">
            <span className="live-dot" /> LIVE
          </span>
        ) : (
          <span>{shortDate(m.date)}</span>
        )}
        <span className="mbox-where">
          {hostFlag(m.ground)} {shortGround(m.ground)}
        </span>
      </div>
    </div>
  );
}

function Side({
  name,
  flags,
  score,
  pens,
  win,
  owner,
}: {
  name: string;
  flags: Map<string, string>;
  score?: number;
  pens?: number;
  win: boolean;
  owner?: string;
}) {
  const flag = flags.get(name);
  const content = (
    <>
      <span className="mside-flag">{flag ?? '·'}</span>
      <span className="mside-name">
        {flag ? name : prettySlot(name)}
        {owner && <span className="mside-owner">🎟️ {owner}</span>}
      </span>
      {score !== undefined && (
        <span className="mside-score">
          {score}
          {pens !== undefined && <span className="mside-pens"> ({pens})</span>}
        </span>
      )}
    </>
  );
  const cls = `mside ${win ? 'win' : ''} ${flag ? 'real' : 'placeholder'} ${owner ? 'owned' : ''}`;
  return flag ? (
    <Link className={cls} to={`/team/${encodeURIComponent(name)}`}>
      {content}
    </Link>
  ) : (
    <div className={cls}>{content}</div>
  );
}
