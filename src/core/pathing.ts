import { blockers, lineOf, moveOrigins, stepCost, stepNeighbors } from './actions';
import { HOSE_SIZES, hoseLeft } from './hoses';
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
 * Units can pass through teammates but not stop on them. Someone holding a
 * hose can only go as far as the hose left on its engine (walking back along
 * their own hose is free).
 */
export function reachable(state: GameState, unit: Unit, budget = unit.ap): Reach {
  const block = blockers(state);
  const origins = moveOrigins(state, unit);
  const cost = new Map<string, number>(origins.map((o) => [posKey(o), 0]));
  const prev = new Map<string, Pos>();
  const open = origins.map((p) => ({ p, c: 0, hose: 0 }));
  const carrying = !!unit.carrying;
  const line = lineOf(state, unit);
  const hoseBudget = line ? hoseLeft(state, state.trucks.find((t) => t.id === line.truckId)!) : Infinity;
  const onOwnHose = new Set(line?.tiles.map(posKey));
  const heavy = line ? HOSE_SIZES[line.size].advanceExtra : 0;

  while (open.length) {
    open.sort((a, b) => a.c - b.c);
    const { p, c, hose } = open.shift()!;
    if (c > (cost.get(posKey(p)) ?? Infinity)) continue;
    for (const n of stepNeighbors(state, p)) {
      const step = stepCost(state, p, n, carrying, block);
      if (typeof step === 'string') continue;
      const fresh = !onOwnHose.has(posKey(n));
      const nc = c + step + (fresh ? heavy : 0);
      const nh = hose + (fresh ? 1 : 0);
      if (nc > budget || nh > hoseBudget || nc >= (cost.get(posKey(n)) ?? Infinity)) continue;
      cost.set(posKey(n), nc);
      prev.set(posKey(n), p);
      open.push({ p: n, c: nc, hose: nh });
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
