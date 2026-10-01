import { floorName } from './fire';
import { isWalkable, neighbors, samePos, tileAt } from './grid';
import { MATERIALS } from './materials';
import type { SimContext, SimSystem } from './systems';
import type { GameState, Pos, Tile } from './types';

export const STRUCTURE = {
  /** Integrity lost by the floor above a burning tile, per intensity level. */
  ceilingDamage: 2,
  /** Integrity lost by the tile above a collapsed wall (loss of support). */
  supportLoss: 30,
  fallDamage: 25,
  debrisHeat: 25,
} as const;

/** Whether fire on this tile eats into its structural integrity. */
export function isLoadBearing(t: Tile, floor: number): boolean {
  if (t.kind === 'wall' || t.kind === 'door') return true;
  return (t.kind === 'floor' || t.kind === 'stairs') && floor > 0; // the ground floor sits on a slab
}

function canCollapse(t: Tile, floor: number): boolean {
  return t.integrity <= 0 && (t.kind === 'wall' || t.kind === 'door' || t.kind === 'window' || ((t.kind === 'floor' || t.kind === 'stairs') && floor > 0));
}

/** Fire damages walls and floors; anything reduced to 0 integrity collapses. */
export const structureSystem: SimSystem = {
  name: 'structure',
  step(ctx) {
    const { floors } = ctx.state;
    floors.forEach((rows, f) =>
      rows.forEach((row, y) =>
        row.forEach((t, x) => {
          if (t.fire <= 0) return;
          if (isLoadBearing(t, f)) t.integrity -= t.fire * MATERIALS[t.material].burnDamage;
          const above = floors[f + 1]?.[y][x];
          if (above && (above.kind === 'floor' || above.kind === 'stairs')) {
            above.integrity -= t.fire * STRUCTURE.ceilingDamage;
          }
        }),
      ),
    );

    // Collapses can cascade (a wall falls, the floor above loses support...).
    for (let changed = true; changed; ) {
      changed = false;
      floors.forEach((rows, floor) =>
        rows.forEach((row, y) =>
          row.forEach((t, x) => {
            if (canCollapse(t, floor)) {
              collapse(ctx, { floor, x, y });
              changed = true;
            }
          }),
        ),
      );
    }
  },
};

export function collapse(ctx: SimContext, p: Pos): void {
  const { state, log } = ctx;
  const t = tileAt(state, p)!;
  const above = tileAt(state, { ...p, floor: p.floor + 1 });

  if (t.kind === 'floor' || t.kind === 'stairs') {
    const below = tileAt(state, { ...p, floor: p.floor - 1 });
    if (below) {
      below.heat = Math.min(100, below.heat + STRUCTURE.debrisHeat);
      below.fuel += t.fuel / 2;
      if (t.fire > 0 && below.fuel > 0 && below.kind !== 'wall') below.fire = Math.max(below.fire, 1);
    }
    Object.assign(t, { kind: 'hole', material: 'none', fuel: 0, fire: 0, integrity: 0 });
    log(`The floor gives way on ${floorName(p.floor)}!`, 'bad');
    dropUnits(state, p, log);
  } else {
    const what = t.kind;
    Object.assign(t, { kind: 'rubble', material: 'none', fuel: 0, fire: 0, integrity: 0, open: true });
    log(`A ${what} collapses on ${floorName(p.floor)}.`, 'bad');
  }

  if (above && above.kind !== 'hole' && above.kind !== 'air') above.integrity -= STRUCTURE.supportLoss;
}

function dropUnits(state: GameState, p: Pos, log: SimContext['log']): void {
  for (const u of state.units) {
    if (u.status !== 'active' || u.carriedBy || !samePos(u.pos, p)) continue;
    let landing: Pos = { ...p, floor: p.floor - 1 };
    if (!isWalkable(tileAt(state, landing)!)) {
      landing = neighbors(state, landing).find((n) => isWalkable(tileAt(state, n)!)) ?? landing;
    }
    u.pos = landing;
    u.hp -= STRUCTURE.fallDamage;
    const carried = u.carrying && state.units.find((c) => c.id === u.carrying);
    if (carried) {
      carried.pos = { ...landing };
      carried.hp -= STRUCTURE.fallDamage;
    }
    log(`${u.name} falls through to the floor below!`, 'bad');
  }
}
