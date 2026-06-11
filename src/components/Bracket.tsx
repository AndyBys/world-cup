import {
  BNode,
  Match,
  Bracket as BracketData,
  isPlayed,
  prettySlot,
  shortGround,
  shortDate,
  hostFlag,
} from '../lib/worldcup';
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
export function Bracket({ data, flags }: { data: BracketData; flags: Map<string, string> }) {
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
            <Node node={data.left} side="left" flags={flags} />
          </div>
        )}

        <div className="draw-centre">
          <div className="final-label">🏆 Final</div>
          <MatchBox m={data.final} flags={flags} variant="final" />
          {data.third && (
            <div className="third">
              <div className="third-label">3rd-place play-off</div>
              <MatchBox m={data.third} flags={flags} variant="third" />
            </div>
          )}
        </div>

        {data.right && (
          <div className="draw-half right">
            <Node node={data.right} side="right" flags={flags} />
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
}: {
  node: BNode;
  side: 'left' | 'right';
  flags: Map<string, string>;
}) {
  const cell = (
    <div className="bt-cell">
      <MatchBox m={node.match} flags={flags} />
    </div>
  );

  if (node.children.length === 0) return cell;

  const children = (
    <div className="bt-children">
      {node.children.map((c, i) => (
        <Node key={i} node={c} side={side} flags={flags} />
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
}: {
  m: Match;
  flags: Map<string, string>;
  variant?: 'final' | 'third';
}) {
  const ft = m.score?.ft;
  const played = isPlayed(m);
  const winner = played && ft ? (ft[0] > ft[1] ? 1 : ft[0] < ft[1] ? 2 : 0) : 0;
  return (
    <div className={`mbox ${variant ?? ''}`}>
      <Side name={m.team1} flags={flags} score={ft?.[0]} win={winner === 1} />
      <Side name={m.team2} flags={flags} score={ft?.[1]} win={winner === 2} />
      <div className="mbox-foot">
        <span>{shortDate(m.date)}</span>
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
  win,
}: {
  name: string;
  flags: Map<string, string>;
  score?: number;
  win: boolean;
}) {
  const flag = flags.get(name);
  const content = (
    <>
      <span className="mside-flag">{flag ?? '·'}</span>
      <span className="mside-name">{flag ? name : prettySlot(name)}</span>
      {score !== undefined && <span className="mside-score">{score}</span>}
    </>
  );
  const cls = `mside ${win ? 'win' : ''} ${flag ? 'real' : 'placeholder'}`;
  return flag ? (
    <Link className={cls} to={`/team/${encodeURIComponent(name)}`}>
      {content}
    </Link>
  ) : (
    <div className={cls}>{content}</div>
  );
}
