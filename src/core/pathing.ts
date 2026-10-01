import { stepCost, stepNeighbors } from './actions';
import { posKey } from './grid';
import type { GameState, Pos, Unit } from './types';

export interface Reach {
  cost: Map<string, number>;
  prev: Map<string, Pos>;
}

/** Dijkstra over walkable tiles (and stairwells) limited to the unit's remaining AP. */
export function reachable(state: GameState, unit: Unit, budget = unit.ap): Reach {
  const cost = new Map<string, number>([[posKey(unit.pos), 0]]);
  const prev = new Map<string, Pos>();
  const open: { p: Pos; c: number }[] = [{ p: unit.pos, c: 0 }];
  const carrying = !!unit.carrying;

  while (open.length) {
    open.sort((a, b) => a.c - b.c);
    const { p, c } = open.shift()!;
    if (c > (cost.get(posKey(p)) ?? Infinity)) continue;
    for (const n of stepNeighbors(state, p)) {
      const step = stepCost(state, p, n, carrying);
      if (typeof step === 'string') continue;
      const nc = c + step;
      if (nc > budget || nc >= (cost.get(posKey(n)) ?? Infinity)) continue;
      cost.set(posKey(n), nc);
      prev.set(posKey(n), p);
      open.push({ p: n, c: nc });
    }
  }
  return { cost, prev };
}

/** Path from the unit to `to` (excluding the start), or null if unreachable this turn. */
export function pathTo(state: GameState, unit: Unit, to: Pos): Pos[] | null {
  const { cost, prev } = reachable(state, unit);
  if (!cost.has(posKey(to))) return null;
  const path: Pos[] = [];
  for (let p: Pos | undefined = to; p && posKey(p) !== posKey(unit.pos); p = prev.get(posKey(p))) {
    path.unshift(p);
  }
  return path;
}
