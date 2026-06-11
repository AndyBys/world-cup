// Maps national teams to the friend who was assigned them in the draw, so the
// tournament views (groups, bracket, fixtures) can show "this is Andrey's team"
// and flag the social moment when two friends' teams face each other.

import { useEffect, useState } from 'react';
import { supabase } from './supabase';

/** team name → friend's name. */
export type OwnerIndex = Map<string, string>;

export async function getOwners(): Promise<OwnerIndex> {
  try {
    const [{ data: players }, { data: assignments }] = await Promise.all([
      supabase.from('players').select('id,name'),
      supabase.from('assignments').select('player_id,team'),
    ]);
    const nameById = new Map((players ?? []).map((p) => [p.id, p.name as string]));
    const idx: OwnerIndex = new Map();
    for (const a of assignments ?? []) {
      const name = nameById.get(a.player_id);
      if (name) idx.set(a.team, name);
    }
    return idx;
  } catch {
    return new Map();
  }
}

/** Loads the team→friend map once (refreshes only when the draw changes rarely). */
export function useOwners(): OwnerIndex {
  const [idx, setIdx] = useState<OwnerIndex>(() => new Map());
  useEffect(() => {
    let alive = true;
    getOwners().then((i) => alive && setIdx(i));
    return () => {
      alive = false;
    };
  }, []);
  return idx;
}
