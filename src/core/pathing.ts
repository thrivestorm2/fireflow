import { blockers, moveOrigins, stepCost, stepNeighbors } from './actions';
import { posKey } from './grid';
import type { GameState, Pos, Unit } from './types';

export interface Reach {
  /** AP needed to reach each tile the unit could pass through. */
  cost: Map<string, number>;
  prev: Map<string, Pos>;
  /** Tiles the unit could finish its move on (passable and not taken). */
  stops: Set<string>;
}

/**
 * Dijkstra over walkable tiles, stairwells and ladders, limited to the unit's
 * remaining AP. Crew still on a truck start from any tile of the truck.
 * Units can pass through teammates but not stop on them.
 */
export function reachable(state: GameState, unit: Unit, budget = unit.ap): Reach {
  const block = blockers(state);
  const origins = moveOrigins(state, unit);
  const cost = new Map<string, number>(origins.map((o) => [posKey(o), 0]));
  const prev = new Map<string, Pos>();
  const open = origins.map((p) => ({ p, c: 0 }));
  const carrying = !!unit.carrying;

  while (open.length) {
    open.sort((a, b) => a.c - b.c);
    const { p, c } = open.shift()!;
    if (c > (cost.get(posKey(p)) ?? Infinity)) continue;
    for (const n of stepNeighbors(state, p)) {
      const step = stepCost(state, p, n, carrying, block);
      if (typeof step === 'string') continue;
      const nc = c + step;
      if (nc > budget || nc >= (cost.get(posKey(n)) ?? Infinity)) continue;
      cost.set(posKey(n), nc);
      prev.set(posKey(n), p);
      open.push({ p: n, c: nc });
    }
  }

  const stops = new Set<string>();
  for (const [k, c] of cost) if (c > 0 && !block.units.has(k)) stops.add(k);
  return { cost, prev, stops };
}

/** Path from the unit to `to` (excluding the start), or null if it can't finish there this turn. */
export function pathTo(state: GameState, unit: Unit, to: Pos): Pos[] | null {
  const { prev, stops } = reachable(state, unit);
  if (!stops.has(posKey(to))) return null;
  const path: Pos[] = [];
  for (let p: Pos | undefined = to; p && prev.has(posKey(p)); p = prev.get(posKey(p))) path.unshift(p);
  return path;
}
