import { DIRS, isOpenAir, isOutside, posKey, samePos, tileAt } from './grid';
import { describe } from './occupants';
import type { GameState, Log, Pos, Unit } from './types';

export const SEARCH = {
  /** How far a firefighter can see through clear air. */
  sightRange: 3,
  /** Smoke at or above this blocks sight. */
  sightSmoke: 30,
  /** Smoke at or above this makes a hands-and-knees search slower. */
  thickSmoke: 60,
  cost: 1,
  thickExtra: 1,
} as const;

function reveal(state: GameState, p: Pos, log: Log, truckId?: string): void {
  const t = tileAt(state, p);
  if (!t) return;
  if (!isOutside(t)) t.searched = true;
  for (const c of state.units) {
    if (c.kind === 'civilian' && c.status === 'active' && !c.found && !c.carriedBy && samePos(c.pos, p)) {
      c.found = true;
      log(`Found ${describe(c)}!`, 'good', truckId);
    }
  }
}

/** Tiles a firefighter can see: through open, clear air within sight range. Smoke blinds. */
export function visibleFrom(state: GameState, u: Unit): Pos[] {
  const here = tileAt(state, u.pos);
  if (!here) return [];
  if (here.smoke >= SEARCH.sightSmoke) return [u.pos];
  const seen = new Set([posKey(u.pos)]);
  const out: Pos[] = [u.pos];
  let frontier: Pos[] = [u.pos];
  for (let d = 0; d < SEARCH.sightRange; d++) {
    const next: Pos[] = [];
    for (const p of frontier) {
      for (const [dx, dy] of DIRS) {
        const n = { ...p, x: p.x + dx, y: p.y + dy };
        const t = tileAt(state, n);
        if (!t || seen.has(posKey(n)) || !isOpenAir(t) || t.smoke >= SEARCH.sightSmoke) continue;
        seen.add(posKey(n));
        out.push(n);
        next.push(n);
      }
    }
    frontier = next;
  }
  return out;
}

/** Every firefighter looks around: victims in clear sight are found. */
export function spotVictims(state: GameState, log: Log): void {
  for (const u of state.units) {
    if (u.kind !== 'firefighter' || u.status !== 'active' || u.aboard) continue;
    for (const p of visibleFrom(state, u)) reveal(state, p, log, u.truck);
  }
}

/** A hands-on search of the firefighter's tile and the eight around it, whatever the smoke. */
export function searchAround(state: GameState, u: Unit, log: Log): void {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) reveal(state, { ...u.pos, x: u.pos.x + dx, y: u.pos.y + dy }, log, u.truck);
  }
}

export function searchCost(state: GameState, u: Unit): number {
  const smoke = tileAt(state, u.pos)?.smoke ?? 0;
  return SEARCH.cost + (smoke >= SEARCH.thickSmoke ? SEARCH.thickExtra : 0);
}
