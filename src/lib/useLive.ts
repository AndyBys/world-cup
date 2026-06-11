import { useEffect, useState } from 'react';
import { getLiveIndex, LiveIndex } from './live';

/**
 * Polls the live-score feed (via our Supabase proxy) every `periodMs`, starting
 * immediately. Returns an empty index until the first response (and if the feed
 * is unavailable), so callers can always fall back to openfootball/schedule.
 */
export function useLiveScores(periodMs = 30_000): LiveIndex {
  const [idx, setIdx] = useState<LiveIndex>(() => new Map());
  useEffect(() => {
    let alive = true;
    const load = () => getLiveIndex().then((i) => alive && setIdx(i));
    load();
    const id = setInterval(load, periodMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [periodMs]);
  return idx;
}

/**
 * Returns Date.now() and re-renders the component every `periodMs` so that
 * scheduled "live" highlighting flips on/off as match windows open and close,
 * even when no new data has arrived.
 */
export function useClock(periodMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), periodMs);
    return () => clearInterval(id);
  }, [periodMs]);
  return now;
}
