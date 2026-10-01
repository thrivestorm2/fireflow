import { floorName } from './fire';
import { evaluate } from './game';
import { isAdjacent, isOpenAir, isWalkable, neighbors, samePos, tileAt } from './grid';
import type { GameState, LogEntry, Pos, Unit } from './types';

export type Action =
  | { type: 'move'; unitId: string; to: Pos } // one step: adjacent tile, or up/down a stairwell
  | { type: 'spray'; unitId: string; target: Pos }
  | { type: 'toggle'; unitId: string; target: Pos } // open/close a door or window
  | { type: 'breach'; unitId: string; target: Pos } // axe through a drywall wall, door or window
  | { type: 'pickup'; unitId: string; target: Pos }
  | { type: 'drop'; unitId: string }
  | { type: 'refill'; unitId: string };

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
} as const;

export const SPRAY = { range: 3, knockdown: 2, cooling: 40, splashCooling: 10, wetTurns: 2 } as const;
export const THICK_SMOKE = 60;

/** Cost of stepping from one tile to another, or a reason the step is impossible. */
export function stepCost(state: GameState, from: Pos, to: Pos, carrying: boolean): number | string {
  const t = tileAt(state, to);
  const src = tileAt(state, from);
  if (!t || !src) return 'Out of bounds';
  if (to.floor === from.floor) {
    if (!isAdjacent(from, to)) return 'Not adjacent';
  } else if (Math.abs(to.floor - from.floor) !== 1 || to.x !== from.x || to.y !== from.y || src.kind !== 'stairs' || t.kind !== 'stairs') {
    return 'Floors are only connected by stairs';
  }
  if (!isWalkable(t)) return t.kind === 'door' || t.kind === 'window' ? `The ${t.kind} is closed` : 'Blocked';
  if (t.fire >= 2) return 'Too hot — knock the fire down first';
  let cost = COST.move;
  if (t.kind === 'window') cost += COST.windowExtra;
  if (carrying) cost += COST.carryExtra;
  if (t.smoke >= THICK_SMOKE) cost += COST.smokeExtra;
  return cost;
}

/** Positions reachable in one step (including stairs up/down). */
export function stepNeighbors(state: GameState, p: Pos): Pos[] {
  const out = neighbors(state, p);
  for (const df of [1, -1]) {
    const v = { ...p, floor: p.floor + df };
    if (tileAt(state, v)) out.push(v);
  }
  return out;
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

export function nearEngine(state: GameState, p: Pos): boolean {
  if (p.floor !== 0) return false;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (tileAt(state, { floor: 0, x: p.x + dx, y: p.y + dy })?.engine) return true;
    }
  }
  return false;
}

function findUnit(state: GameState, id: string): Unit | undefined {
  return state.units.find((u) => u.id === id);
}

function civilianAt(state: GameState, p: Pos): Unit | undefined {
  return state.units.find((u) => u.kind === 'civilian' && u.status === 'active' && !u.carriedBy && samePos(u.pos, p));
}

/** AP cost of an action, or the reason it cannot be performed. */
export function actionCost(state: GameState, action: Action): number | string {
  if (state.status !== 'playing') return 'The incident is over';
  const u = findUnit(state, action.unitId);
  if (!u || u.kind !== 'firefighter') return 'No such firefighter';
  if (u.status !== 'active') return `${u.name} is out of action`;

  let cost: number | string;
  switch (action.type) {
    case 'move':
      cost = stepCost(state, u.pos, action.to, !!u.carrying);
      break;
    case 'spray': {
      if (u.water <= 0) return 'Out of water — refill at the engine';
      cost = canSprayFrom(state, u.pos, action.target) ?? COST.spray;
      break;
    }
    case 'toggle': {
      const t = tileAt(state, action.target);
      if (!t || !isAdjacent(u.pos, action.target)) return 'Must be adjacent';
      if (t.kind !== 'door' && t.kind !== 'window') return 'Not a door or window';
      if (t.broken) return 'It is broken and cannot be closed';
      if (t.open && state.units.some((o) => o.status === 'active' && samePos(o.pos, action.target))) return 'Someone is in the way';
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
    case 'pickup': {
      if (u.carrying) return 'Already carrying someone';
      if (!samePos(u.pos, action.target) && !isAdjacent(u.pos, action.target)) return 'Must be adjacent';
      if (!civilianAt(state, action.target)) return 'Nobody to pick up';
      cost = COST.pickup;
      break;
    }
    case 'drop':
      cost = u.carrying ? COST.drop : 'Not carrying anyone';
      break;
    case 'refill':
      if (!nearEngine(state, u.pos)) return 'Must be next to the engine';
      cost = u.water >= u.maxWater ? 'Tank already full' : COST.refill;
      break;
  }
  if (typeof cost === 'number' && cost > u.ap) return `Needs ${cost} AP (${u.ap} left)`;
  return cost;
}

export interface ActionResult {
  state: GameState;
  error?: string;
}

/** Applies an action to a copy of the state. The input state is never modified. */
export function performAction(prev: GameState, action: Action): ActionResult {
  const cost = actionCost(prev, action);
  if (typeof cost === 'string') return { state: prev, error: cost };

  const state = structuredClone(prev);
  const log = (text: string, tone: LogEntry['tone'] = 'info') => state.log.push({ turn: state.turn, text, tone });
  const u = findUnit(state, action.unitId)!;
  u.ap -= cost;

  switch (action.type) {
    case 'move': {
      const carried = u.carrying ? findUnit(state, u.carrying) : undefined;
      if (action.to.floor !== u.pos.floor) log(`${u.name} takes the stairs to ${floorName(action.to.floor)}.`);
      u.pos = { ...action.to };
      if (carried) carried.pos = { ...action.to };
      if (carried && tileAt(state, u.pos)!.kind === 'ground') {
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
      t.heat = Math.max(0, t.heat - SPRAY.cooling);
      t.wet = SPRAY.wetTurns;
      for (const n of neighbors(state, action.target)) {
        const nt = tileAt(state, n)!;
        nt.heat = Math.max(0, nt.heat - SPRAY.splashCooling);
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
        log(`${u.name} breaks out a window to ventilate.`);
      } else {
        const what = t.kind;
        Object.assign(t, { kind: 'rubble', material: 'none', fuel: 0, fire: 0, open: true });
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
    case 'refill':
      u.water = u.maxWater;
      log(`${u.name} refills at the engine.`);
      break;
  }
  evaluate(state);
  return { state };
}
