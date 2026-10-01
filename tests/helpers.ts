import { performAction, type Action } from '../src/core/actions';
import type { FloorPlan, Scenario } from '../src/core/building';
import type { GameState } from '../src/core/types';

/** A tiny scenario for focused rule tests. Each floor is [plan] or [plan, contents]. */
export function miniScenario(floors: (string[] | FloorPlan)[], extra: Partial<Scenario> = {}): Scenario {
  return {
    name: 'test',
    description: 'test',
    seed: 1,
    preburn: 0,
    floors: floors.map((f) => (Array.isArray(f) ? { plan: f } : f)),
    fires: [],
    civilians: [],
    dispatch: [],
    ...extra,
  };
}

/** Applies actions in order, failing the test on the first rejected one. */
export function run(s: GameState, ...actions: Action[]): GameState {
  for (const a of actions) {
    const r = performAction(s, a);
    if (r.error) throw new Error(`${a.type}: ${r.error}`);
    s = r.state;
  }
  return s;
}

/** Puts a crew member directly on a tile (off the truck). */
export function standAt(s: GameState, id: string, x: number, y: number, floor = 0): GameState {
  const u = s.units.find((u) => u.id === id)!;
  u.aboard = undefined;
  u.pos = { floor, x, y };
  return s;
}
