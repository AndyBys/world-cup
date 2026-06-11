import { Link } from 'react-router-dom';

/**
 * Slick team reference: flag + name. Real teams link to their page and lift on
 * hover; placeholder slots ("2A", "W74") render as quiet, non-clickable text.
 */
export function TeamPill({
  name,
  flags,
  size = 'md',
}: {
  name: string;
  flags: Map<string, string>;
  size?: 'sm' | 'md';
}) {
  const flag = flags.get(name);
  const cls = `team-pill ${size}`;
  if (!flag) {
    return (
      <span className={`${cls} placeholder`}>
        <span className="tp-flag">⚪</span>
        <span className="tp-name">{name}</span>
      </span>
    );
  }
  return (
    <Link className={cls} to={`/team/${encodeURIComponent(name)}`}>
      <span className="tp-flag">{flag}</span>
      <span className="tp-name">{name}</span>
    </Link>
  );
}
