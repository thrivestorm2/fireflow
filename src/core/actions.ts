import { floorName } from './fire';
import { evaluate } from './game';
import { DIRS, isAdjacent, isOpenAir, isOutside, isWalkable, neighbors, posKey, samePos, tileAt } from './grid';
import { CONTENTS } from './materials';
import { enginesNear, hydrantNear, placementError, truckOccupancy, truckTiles } from './trucks';
import type { GameState, LogEntry, Orientation, Pos, Truck, Unit } from './types';

export type Action =
  | { type: 'move'; unitId: string; path: Pos[] } // walk a path; may start from the unit's truck
  | { type: 'spray'; unitId: string; target: Pos }
  | { type: 'toggle'; unitId: string; target: Pos } // open/close a door or window
  | { type: 'breach'; unitId: string; target: Pos } // axe through a drywall wall, door or window
  | { type: 'pickup'; unitId: string; target: Pos }
  | { type: 'drop'; unitId: string }
  | { type: 'refill'; unitId: string }
  | { type: 'ladder'; unitId: string } // raise a ground ladder to the window above
  | { type: 'placeTruck'; truckId: string; pos: Pos; orientation: Orientation };

export const COST = {
  move: 1,
  /** Extra cost for climbing through a window, carrying someone, or moving blind in thick smoke. */
  windowExtra: 1,
  carryExtra: 1,
  smokeExtra: 1,
  spray: 1,
  toggle: 1,
  breachWall: 2,
  breachDoor: 1,
  breachWindow: 1,
  pickup: 1,
  drop: 0,
  refill: 1,
  ladder: 2,
} as const;

export const SPRAY = { range: 3, knockdown: 2, cooling: 320, splashCooling: 80, wetTurns: 2 } as const;
export const THICK_SMOKE = 60;

/** Precomputed blockers, so pathfinding doesn't rebuild them per step. */
export interface Blockers {
  trucks: Map<string, Truck>;
  units: Map<string, Unit>;
}

export function blockers(state: GameState): Blockers {
  const units = new Map<string, Unit>();
  for (const u of state.units) {
    if (u.status === 'active' && !u.aboard && !u.carriedBy) units.set(posKey(u.pos), u);
  }
  return { trucks: truckOccupancy(state), units };
}

/** Tiles connected vertically: matching stairs, or a ground ladder. */
function verticalLink(a: { kind: string; ladder: boolean }, b: { kind: string; ladder: boolean }): boolean {
  return (a.kind === 'stairs' && b.kind === 'stairs') || (a.ladder && b.ladder);
}

/** Cost of stepping from one tile to another, or a reason the step is impossible. */
export function stepCost(state: GameState, from: Pos, to: Pos, carrying: boolean, block: Blockers): number | string {
  const t = tileAt(state, to);
  const src = tileAt(state, from);
  if (!t || !src) return 'Out of bounds';
  if (to.floor === from.floor) {
    if (!isAdjacent(from, to)) return 'Not adjacent';
  } else if (Math.abs(to.floor - from.floor) !== 1 || to.x !== from.x || to.y !== from.y || !verticalLink(src, t)) {
    return 'Floors are only connected by stairs or ladders';
  }
  if (block.trucks.has(posKey(to))) return 'A truck is parked there';
  const other = block.units.get(posKey(to));
  if (other && other.kind === 'civilian') return 'Someone is lying there — pick them up';
  if (!isWalkable(t)) {
    if (t.kind === 'door' || t.kind === 'window') return `The ${t.kind} is closed`;
    if (CONTENTS[t.contents].blocks) return `${CONTENTS[t.contents].label} in the way`;
    return 'Blocked';
  }
  if (t.fire >= 2) return 'Too hot — knock the fire down first';
  let cost = COST.move + CONTENTS[t.contents].moveExtra;
  if (t.kind === 'window') cost += COST.windowExtra;
  if (carrying) cost += COST.carryExtra;
  if (t.smoke >= THICK_SMOKE) cost += COST.smokeExtra;
  return cost;
}

/** Positions reachable in one step (including stairs and ladders up/down). */
export function stepNeighbors(state: GameState, p: Pos): Pos[] {
  const out = neighbors(state, p);
  for (const df of [1, -1]) {
    const v = { ...p, floor: p.floor + df };
    if (tileAt(state, v)) out.push(v);
  }
  return out;
}

/** Where a unit's movement starts: its tile, or every tile of the truck it is riding. */
export function moveOrigins(state: GameState, u: Unit): Pos[] {
  if (!u.aboard) return [u.pos];
  const truck = state.trucks.find((t) => t.id === u.aboard);
  return truck ? truckTiles(truck) : [];
}

export function canSprayFrom(state: GameState, from: Pos, target: Pos): string | null {
  if (from.floor !== target.floor) return 'Target must be on the same floor';
  const dx = Math.sign(target.x - from.x);
  const dy = Math.sign(target.y - from.y);
  if (dx !== 0 && dy !== 0) return 'Spray only in straight lines';
  const dist = Math.abs(target.x - from.x) + Math.abs(target.y - from.y);
  if (dist === 0) return 'Cannot spray your own tile';
  if (dist > SPRAY.range) return `Out of range (max ${SPRAY.range})`;
  for (let i = 1; i < dist; i++) {
    const t = tileAt(state, { floor: from.floor, x: from.x + dx * i, y: from.y + dy * i });
    if (!t || !isOpenAir(t)) return 'Line of fire is blocked';
  }
  return null;
}

/** Whether a ladder could be raised from this ground tile to a window on the floor above. */
export function ladderSpotError(state: GameState, p: Pos): string | null {
  const here = tileAt(state, p);
  const above = tileAt(state, { ...p, floor: p.floor + 1 });
  if (!here || here.kind !== 'ground' || p.floor !== 0) return 'Ladders are raised from the ground outside';
  if (!above || above.kind !== 'air') return 'No open space above for a ladder';
  if (here.ladder) return 'A ladder is already here';
  const window = DIRS.some(([dx, dy]) => tileAt(state, { floor: 1, x: p.x + dx, y: p.y + dy })?.kind === 'window');
  return window ? null : 'Must be right below an upper-floor window';
}

function findUnit(state: GameState, id: string): Unit | undefined {
  return state.units.find((u) => u.id === id);
}

function civilianAt(state: GameState, p: Pos): Unit | undefined {
  return state.units.find((u) => u.kind === 'civilian' && u.status === 'active' && !u.carriedBy && samePos(u.pos, p));
}

/** Total AP cost of walking a path, or the reason it can't be walked. */
export function pathCost(state: GameState, u: Unit, path: Pos[]): number | string {
  if (!path.length) return 'Nowhere to go';
  const block = blockers(state);
  const origins = moveOrigins(state, u);
  if (!origins.length) return 'The truck has not parked yet';
  const first = origins
    .map((o) => stepCost(state, o, path[0], !!u.carrying, block))
    .reduce((best, c) => (typeof c === 'number' && (typeof best !== 'number' || c < best) ? c : best));
  if (typeof first === 'string') return first;
  let total = first;
  for (let i = 1; i < path.length; i++) {
    const c = stepCost(state, path[i - 1], path[i], !!u.carrying, block);
    if (typeof c === 'string') return c;
    total += c;
  }
  if (block.units.has(posKey(path[path.length - 1]))) return 'That spot is taken';
  return total;
}

/** AP cost of an action (0 for truck placement), or the reason it cannot be performed. */
export function actionCost(state: GameState, action: Action): number | string {
  if (state.status !== 'playing') return 'The incident is over';

  if (action.type === 'placeTruck') {
    const truck = state.trucks.find((t) => t.id === action.truckId);
    if (!truck) return 'No such truck';
    if (truck.status === 'enroute') return `${truck.name} arrives on turn ${truck.arrivalTurn}`;
    if (truck.status === 'placed') return `${truck.name} is already parked`;
    return placementError(state, action.pos, action.orientation) ?? 0;
  }

  const u = findUnit(state, action.unitId);
  if (!u || u.kind !== 'firefighter') return 'No such firefighter';
  if (u.status !== 'active') return `${u.name} is out of action`;
  if (u.aboard) {
    const truck = state.trucks.find((t) => t.id === u.aboard);
    if (truck?.status !== 'placed') return `${u.name} is still on ${truck?.name ?? 'the truck'} — park it first`;
    if (action.type !== 'move') return `${u.name} must get off the truck first`;
  }

  let cost: number | string;
  switch (action.type) {
    case 'move':
      cost = pathCost(state, u, action.path);
      break;
    case 'spray':
      if (u.maxWater === 0) return `${u.name} has no hose (ladder crew)`;
      if (u.water <= 0) return 'Out of water — refill next to an engine';
      cost = canSprayFrom(state, u.pos, action.target) ?? COST.spray;
      break;
    case 'toggle': {
      const t = tileAt(state, action.target);
      if (!t || !isAdjacent(u.pos, action.target)) return 'Must be adjacent';
      if (t.kind !== 'door' && t.kind !== 'window') return 'Not a door or window';
      if (t.broken) return 'It is broken and cannot be closed';
      if (t.open && blockers(state).units.has(posKey(action.target))) return 'Someone is in the way';
      cost = COST.toggle;
      break;
    }
    case 'breach': {
      const t = tileAt(state, action.target);
      if (!t || !isAdjacent(u.pos, action.target)) return 'Must be adjacent';
      if (t.kind === 'wall') cost = t.material === 'drywall' ? COST.breachWall : 'Too solid to breach';
      else if (t.kind === 'door') cost = COST.breachDoor;
      else if (t.kind === 'window') cost = t.broken ? 'Already broken' : COST.breachWindow;
      else return 'Nothing to breach';
      break;
    }
    case 'pickup':
      if (u.carrying) return 'Already carrying someone';
      if (!samePos(u.pos, action.target) && !isAdjacent(u.pos, action.target)) return 'Must be adjacent';
      if (!civilianAt(state, action.target)) return 'Nobody to pick up';
      cost = COST.pickup;
      break;
    case 'drop':
      cost = u.carrying ? COST.drop : 'Not carrying anyone';
      break;
    case 'refill': {
      if (u.maxWater === 0) return `${u.name} has no hose (ladder crew)`;
      if (u.water >= u.maxWater) return 'Tank already full';
      const engines = enginesNear(state, u.pos);
      if (!engines.length) return 'Must be next to an engine';
      cost = engines.some((e) => e.hydrant || e.water > 0) ? COST.refill : 'The engine is out of water';
      break;
    }
    case 'ladder':
      if (u.role !== 'ladder') return 'Only ladder crews carry ground ladders';
      cost = ladderSpotError(state, u.pos) ?? COST.ladder;
      break;
  }
  if (typeof cost === 'number' && cost > u.ap) return `Needs ${cost} AP (${u.ap} left)`;
  return cost;
}

export interface ActionResult {
  state: GameState;
  error?: string;
}

/**
 * Applies an action to a copy of the state. The input state is never modified.
 * Player actions can put fires out but never start or spread one: fire only
 * moves during the fire phase.
 */
export function performAction(prev: GameState, action: Action): ActionResult {
  const cost = actionCost(prev, action);
  if (typeof cost === 'string') return { state: prev, error: cost };

  const state = structuredClone(prev);
  const log = (text: string, tone: LogEntry['tone'] = 'info') => state.log.push({ turn: state.turn, text, tone });

  if (action.type === 'placeTruck') {
    const truck = state.trucks.find((t) => t.id === action.truckId)!;
    truck.pos = { ...action.pos, floor: 0 };
    truck.orientation = action.orientation;
    truck.status = 'placed';
    for (const crew of state.units) if (crew.aboard === truck.id) crew.pos = { ...truck.pos };
    truck.hydrant = truck.type === 'engine' && !!hydrantNear(state, truckTiles(truck));
    log(`${truck.name} parks${truck.hydrant ? ' and hooks up to the hydrant' : ''}.`, 'good');
    return { state };
  }

  const u = findUnit(state, action.unitId)!;
  u.ap -= cost;

  switch (action.type) {
    case 'move': {
      const to = action.path[action.path.length - 1];
      const carried = u.carrying ? findUnit(state, u.carrying) : undefined;
      if (u.aboard) {
        log(`${u.name} gets off ${state.trucks.find((t) => t.id === u.aboard)?.name}.`);
        u.aboard = undefined;
      }
      if (to.floor !== u.pos.floor) log(`${u.name} climbs to ${floorName(to.floor)}.`);
      u.pos = { ...to };
      if (carried) carried.pos = { ...to };
      if (carried && isOutside(tileAt(state, to)!) && to.floor === 0) {
        carried.status = 'rescued';
        carried.carriedBy = undefined;
        u.carrying = undefined;
        log(`${u.name} carries ${carried.name} to safety!`, 'good');
      }
      break;
    }
    case 'spray': {
      u.water -= 1;
      const t = tileAt(state, action.target)!;
      const wasBurning = t.fire > 0;
      t.fire = Math.max(0, t.fire - SPRAY.knockdown);
      t.temperature = Math.max(20, t.temperature - SPRAY.cooling);
      t.wet = SPRAY.wetTurns;
      for (const n of neighbors(state, action.target)) {
        const nt = tileAt(state, n)!;
        nt.temperature = Math.max(20, nt.temperature - SPRAY.splashCooling);
      }
      if (wasBurning && t.fire === 0) log(`${u.name} knocks down a fire.`, 'good');
      break;
    }
    case 'toggle': {
      const t = tileAt(state, action.target)!;
      t.open = !t.open;
      log(`${u.name} ${t.open ? 'opens' : 'closes'} a ${t.kind}.`);
      break;
    }
    case 'breach': {
      const t = tileAt(state, action.target)!;
      if (t.kind === 'window') {
        Object.assign(t, { open: true, broken: true });
        log(`${u.name} breaks out a window.`);
      } else {
        const what = t.kind;
        Object.assign(t, { kind: 'rubble', material: 'debris', fuel: 0, fire: 0, open: true });
        log(`${u.name} axes through the ${what}.`);
      }
      break;
    }
    case 'pickup': {
      const c = civilianAt(state, action.target)!;
      c.carriedBy = u.id;
      c.pos = { ...u.pos };
      u.carrying = c.id;
      log(`${u.name} picks up ${c.name}.`, 'good');
      break;
    }
    case 'drop': {
      const c = findUnit(state, u.carrying!)!;
      c.carriedBy = undefined;
      u.carrying = undefined;
      log(`${u.name} puts ${c.name} down.`);
      break;
    }
    case 'refill': {
      const engine = enginesNear(state, u.pos).sort((a, b) => Number(b.hydrant) - Number(a.hydrant) || b.water - a.water)[0];
      const need = u.maxWater - u.water;
      const got = engine.hydrant ? need : Math.min(need, engine.water);
      if (!engine.hydrant) engine.water -= got;
      u.water += got;
      log(`${u.name} refills from ${engine.name}${engine.hydrant ? '' : ` (${engine.water} left in the tank)`}.`);
      break;
    }
    case 'ladder': {
      tileAt(state, u.pos)!.ladder = true;
      tileAt(state, { ...u.pos, floor: u.pos.floor + 1 })!.ladder = true;
      log(`${u.name} raises a ladder to ${floorName(u.pos.floor + 1)}.`, 'good');
      break;
    }
  }
  evaluate(state);
  return { state };
}
