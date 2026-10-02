import { DIRS, isOutside, isWalkable, posKey, samePos, tileAt } from './grid';
import type { Rng } from './rng';
import type { SimSystem } from './systems';
import { truckOccupancy } from './trucks';
import type { GameState, Log, Occupant, Pos, Tile, Unit } from './types';

/**
 * How people and animals the crew doesn't control behave each fire phase.
 *
 * - Residents try to get out by the safest route, opening doors (and unlocking
 *   them from inside) as they go, as long as the way isn't thick with smoke.
 *   Smoke slows and disorients them. With no clear way out they do what fire
 *   safety advice says: stay in the room, get to a window and call for help
 *   (which the crew outside can see). Worn down by smoke and heat they
 *   collapse, unconscious, and stop moving, but can still be carried out alive. Getting outside on their own counts as safe. Residents with limited
 *   mobility manage a tile a turn at best and can't climb out of a window.
 * - Dogs bolt for a way out but can't open doors.
 * - Cats hide: under beds and sofas, away from the commotion.
 * - Bystanders mill about outside, keep off roads and driveways (trucks need
 *   them) and away from the building's walls, and back off from heat.
 */
export const OCCUPANTS = {
  resident: { steps: 2, smokeSteps: 1, lostChance: 0.35, opensDoors: true },
  dog: { steps: 3, smokeSteps: 2, lostChance: 0.4, opensDoors: false },
  cat: { steps: 2, smokeSteps: 1, lostChance: 0.6, opensDoors: false },
  bystander: { stayChance: 0.5, hotAir: 45 },
  /** Burning tiles, and tiles hotter than this, are avoided. */
  safeTemp: 150,
  /** Smoke at or above this disorients. */
  disorientSmoke: 30,
  /** Nobody heads out through smoke this thick; residents go to a window instead. */
  routeSmoke: 30,
} as const;

/** Where a cat would hide. */
const HIDING: ReadonlySet<string> = new Set(['bed', 'sofa', 'table']);

export function occupantOf(u: Unit): Occupant {
  return u.occupant ?? 'resident';
}

/** "Maria", "Biscuit the dog", "Mochi the cat". */
export function describe(u: Unit): string {
  const kind = occupantOf(u);
  return kind === 'dog' || kind === 'cat' ? `${u.name} the ${kind}` : u.name;
}

export const isPet = (u: Unit): boolean => u.kind === 'civilian' && (u.occupant === 'dog' || u.occupant === 'cat');
export const isBystander = (u: Unit): boolean => u.kind === 'civilian' && u.occupant === 'bystander';
/** Residents and pets: who the crew is there to get out. */
export const isOccupant = (u: Unit): boolean => u.kind === 'civilian' && !isBystander(u);

function danger(t: Tile): number {
  return t.fire * 1000 + Math.max(0, t.temperature - 20) + t.smoke;
}

/** Same-floor neighbours, plus up or down a staircase. */
function steps(state: GameState, p: Pos): Pos[] {
  const out: Pos[] = DIRS.map(([dx, dy]) => ({ ...p, x: p.x + dx, y: p.y + dy }));
  const here = tileAt(state, p);
  for (const df of [1, -1]) {
    const v = { ...p, floor: p.floor + df };
    if (here?.kind === 'stairs' && tileAt(state, v)?.kind === 'stairs') out.push(v);
  }
  return out.filter((q) => !!tileAt(state, q));
}

export const occupantSystem: SimSystem = {
  name: 'occupants',
  step({ state, rng, log }) {
    for (const u of state.units) {
      if (u.kind !== 'civilian' || u.status !== 'active' || u.carriedBy) continue;
      const kind = occupantOf(u);
      if (kind === 'bystander') moveBystander(state, u, rng);
      else moveInside(state, u, kind, rng, log);
    }
  },
};

function blocked(state: GameState, self: Unit): Set<string> {
  const out = new Set(truckOccupancy(state).keys());
  for (const o of state.units) {
    if (o.id !== self.id && o.status === 'active' && !o.aboard && !o.carriedBy) out.add(posKey(o.pos));
  }
  return out;
}

function moveInside(state: GameState, u: Unit, kind: Exclude<Occupant, 'bystander'>, rng: Rng, log: Log): void {
  const spec = OCCUPANTS[kind];
  if (u.unconscious) return; // collapsed (see exposure.ts)
  const taken = blocked(state, u);
  const passable = (p: Pos) => {
    const t = tileAt(state, p);
    if (!t || taken.has(posKey(p)) || t.fire > 0 || t.temperature >= OCCUPANTS.safeTemp) return false;
    if (isWalkable(t)) return true;
    // Residents open doors, and (unless their mobility is limited) climb out of ground-floor windows.
    return spec.opensDoors && ((t.kind === 'door' && !t.reinforced) || (t.kind === 'window' && p.floor === 0 && !u.limited));
  };
  const here = () => tileAt(state, u.pos)!;
  const moves = u.limited ? 1 : here().smoke >= OCCUPANTS.disorientSmoke ? spec.smokeSteps : spec.steps;
  for (let i = 0; i < moves; i++) {
    const options = steps(state, u.pos).filter(passable);
    const clear = (p: Pos) => passable(p) && tileAt(state, p)!.smoke < OCCUPANTS.routeSmoke;
    const route = kind === 'cat' ? undefined : pathOut(state, u.pos, clear);
    // No clear way out: stay at a window in the room and call for help (holding on there, smoke or not).
    if (!route && kind === 'resident' && atWindow(state, u.pos)) {
      if (!u.found) {
        u.found = true;
        log(`${u.name} is waving from a window, calling for help!`, 'bad');
      }
      return;
    }
    let next: Pos | undefined;
    if (here().smoke >= OCCUPANTS.disorientSmoke && rng.chance(spec.lostChance)) {
      next = options.length ? options[Math.floor(rng.next() * options.length)] : undefined; // lost in the smoke
    } else if (kind === 'cat') {
      next = catStep(state, u, options);
    } else {
      next = route?.[0];
      if (!next && kind === 'resident') next = pathTo(state, u.pos, passable, (p) => atWindow(state, p))?.[0];
      next ??= saferStep(state, u.pos, options);
    }
    if (!next) return;
    const t = tileAt(state, next)!;
    if (t.kind === 'door' && !t.open) {
      if (t.locked) log(`${describe(u)} unlocks a door from inside.`);
      Object.assign(t, { open: true, locked: false });
    }
    if (t.kind === 'window' && !t.open) t.open = true; // climbing out
    u.pos = { ...next };
    if (isOutside(t) && u.pos.floor === 0) {
      u.status = 'rescued';
      u.found = true;
      log(`${describe(u)} gets out of the building on ${kind === 'resident' ? 'their' : 'its'} own!`, 'good');
      return;
    }
  }
}

/** The outside window someone at `p` can reach from inside a room (not the stairs): where they can be seen and reached by ladder. */
export function windowBeside(state: GameState, p: Pos): Pos | undefined {
  if (tileAt(state, p)?.kind !== 'floor') return undefined;
  for (const [dx, dy] of DIRS) {
    const w = { ...p, x: p.x + dx, y: p.y + dy };
    const outside = DIRS.some(([ex, ey]) => {
      const o = tileAt(state, { ...w, x: w.x + ex, y: w.y + ey });
      return !!o && isOutside(o);
    });
    if (tileAt(state, w)?.kind === 'window' && outside) return w;
  }
  return undefined;
}

const atWindow = (state: GameState, p: Pos) => !!windowBeside(state, p);

/** Residents waving for help from a window: found, still inside, at an outside window. */
export function waving(state: GameState): { unit: Unit; window: Pos }[] {
  const out: { unit: Unit; window: Pos }[] = [];
  for (const u of state.units) {
    if (u.kind !== 'civilian' || occupantOf(u) !== 'resident' || u.status !== 'active' || u.carriedBy || !u.found || u.unconscious) continue;
    const w = windowBeside(state, u.pos);
    if (w) out.push({ unit: u, window: w });
  }
  return out;
}

/** Shortest safe route to the outside at street level, if there is one. */
function pathOut(state: GameState, from: Pos, passable: (p: Pos) => boolean): Pos[] | undefined {
  return pathTo(state, from, passable, (p) => p.floor === 0 && isOutside(tileAt(state, p)!));
}

/** Shortest route over passable tiles to the nearest tile that meets `goal`. */
function pathTo(state: GameState, from: Pos, passable: (p: Pos) => boolean, goal: (p: Pos) => boolean): Pos[] | undefined {
  const prev = new Map<string, Pos | null>([[posKey(from), null]]);
  const queue: Pos[] = [from];
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i];
    if (i > 0 && goal(p)) {
      const path: Pos[] = [];
      for (let q: Pos | null = p; q && !samePos(q, from); q = prev.get(posKey(q)) ?? null) path.unshift(q);
      return path;
    }
    for (const n of steps(state, p)) {
      if (prev.has(posKey(n)) || !passable(n)) continue;
      prev.set(posKey(n), p);
      queue.push(n);
    }
  }
  return undefined;
}

/** Away from the worst of it: the neighbouring tile with the least heat and smoke, if it's better than here. */
function saferStep(state: GameState, from: Pos, options: Pos[]): Pos | undefined {
  const here = danger(tileAt(state, from)!);
  let best: Pos | undefined;
  let bestDanger = here;
  for (const p of options) {
    const d = danger(tileAt(state, p)!);
    if (d < bestDanger) {
      best = p;
      bestDanger = d;
    }
  }
  return best;
}

function catStep(state: GameState, u: Unit, options: Pos[]): Pos | undefined {
  const here = tileAt(state, u.pos)!;
  if (here.smoke >= 60 || here.temperature >= OCCUPANTS.safeTemp - 30) return saferStep(state, u.pos, options);
  if (HIDING.has(here.contents)) return undefined; // hiding, and staying put
  return options.find((p) => HIDING.has(tileAt(state, p)!.contents));
}

function moveBystander(state: GameState, u: Unit, rng: Rng): void {
  const taken = blocked(state, u);
  const nearWall = (p: Pos) =>
    [-1, 0, 1].some((dy) => [-1, 0, 1].some((dx) => {
      const t = tileAt(state, { ...p, x: p.x + dx, y: p.y + dy });
      return !!t && !isOutside(t);
    }));
  const ok = (p: Pos) => {
    const t = tileAt(state, p);
    return !!t && p.floor === 0 && t.kind === 'ground' && !t.drivable && isWalkable(t) && !taken.has(posKey(p)) && !nearWall(p) && t.fire === 0;
  };
  const options = steps(state, u.pos).filter(ok);
  const here = tileAt(state, u.pos)!;
  const hot = here.temperature >= OCCUPANTS.bystander.hotAir || DIRS.some(([dx, dy]) => (tileAt(state, { ...u.pos, x: u.pos.x + dx, y: u.pos.y + dy })?.fire ?? 0) > 0);
  if (hot) {
    const away = saferStep(state, u.pos, options);
    if (away) u.pos = { ...away };
    return;
  }
  if (!options.length || rng.chance(OCCUPANTS.bystander.stayChance)) return;
  u.pos = { ...options[Math.floor(rng.next() * options.length)] };
}
