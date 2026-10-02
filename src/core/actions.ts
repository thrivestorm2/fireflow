import { ALARM, nextAlarm, ordinal, strikeAlarm } from './alarms';
import { ACCELERANT, floorName } from './fire';
import { evaluate } from './game';
import { DIRS, isAdjacent, isOpenAir, isOutside, isWalkable, neighbors, posKey, samePos, tileAt } from './grid';
import { extendLine, HOSE, HOSE_SIZES, hoseLeft, hydrantAt, hydrantWorkAvailable, HYDRANT_TOTAL, isSupplied, linesThrough, workHydrant } from './hoses';
import { CONTENTS } from './materials';
import { searchAround, searchCost, spotVictims } from './search';
import {
  AERIAL,
  aerialLink,
  aerialStation,
  aerialTipAt,
  aerialTipError,
  besideTruck,
  dischargeTiles,
  inletTiles,
  placementError,
  pumpOperator,
  supplyTiles,
  truckOccupancy,
  truckTiles,
  turntableAt,
  turntableTiles,
} from './trucks';
import type { GameState, HoseKind, HoseLine, HoseSize, LogEntry, Orientation, Pos, Truck, Unit } from './types';

export type Action =
  | { type: 'move'; unitId: string; path: Pos[] } // walk a path; may start from the unit's truck
  | { type: 'spray'; unitId: string; target: Pos } // needs the nozzle of a charged attack line
  | { type: 'toggle'; unitId: string; target: Pos } // open/close a door or window
  | { type: 'breach'; unitId: string; target: Pos } // axe through a drywall wall, door or window
  | { type: 'pickup'; unitId: string; target: Pos }
  | { type: 'drop'; unitId: string }
  /** Pull a hose off an engine. Attack lines come from the coupling beside you (size defaults to 1¾″). */
  | { type: 'takeLine'; unitId: string; kind: HoseKind; size?: HoseSize; side?: 0 | 1 }
  | { type: 'dropLine'; unitId: string } // put the nozzle/hose end down where you stand
  | { type: 'pickupLine'; unitId: string } // pick up a hose end lying on your tile
  | { type: 'returnLine'; unitId: string } // pack the line you hold back onto its engine
  | { type: 'hydrant'; unitId: string; target: Pos } // hook up a hydrant; continues on later turns
  | { type: 'inlet'; unitId: string; truckId: string } // couple the supply line you hold to another truck's side inlet
  | { type: 'ladder'; unitId: string } // raise a ground ladder against the building
  | { type: 'force'; unitId: string; target: Pos } // force a locked door (reinforced ones: ladder crew only)
  | { type: 'aerial'; unitId: string; tip: Pos } // from the turntable or the tip: raise or swing the aerial
  | { type: 'masterStream'; unitId: string; target: Pos } // from the turntable or the tip: flow the tip nozzle
  | { type: 'cutRoof'; unitId: string; target: Pos } // ladder crew on the roof: cut a vent hole
  | { type: 'placeFan'; unitId: string; target: Pos } // ladder crew: set a fan blowing through an open door/window
  | { type: 'removeFan'; unitId: string; target: Pos } // take a fan away (target = where it stands)
  | { type: 'search'; unitId: string } // search your tile and the eight around it for victims
  | { type: 'placeTruck'; truckId: string; pos: Pos; orientation: Orientation; reversed?: boolean }
  | { type: 'alarm' }; // strike the next alarm: more companies are dispatched

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
  takeLine: 1,
  dropLine: 0,
  pickupLine: 1,
  returnLine: 1,
  inlet: 1,
  ladder: 2,
  force: 2,
  forceReinforced: 3,
  /** Raising or swinging the aerial, and flowing its master stream. */
  aerial: 2,
  masterStream: 1,
  /** Climbing the aerial between the turntable and the tip; stepping up onto the turntable costs this much extra. */
  climbAerial: 2,
  mountTurntable: 1,
  cutRoof: 3,
  placeFan: 2,
  removeFan: 1,
  /** Laying out a new tile of heavy (2½″) hose costs this much extra. */
  heavyHose: HOSE_SIZES['2.5'].advanceExtra,
} as const;

/** Jobs only a ladder (truck) company does. */
const LADDER_JOBS = new Set<Action['type']>(['breach', 'cutRoof', 'placeFan', 'ladder']);

/** Spray strength, water use and reach depend on the hose size (HOSE_SIZES); thick smoke cuts the reach by one. */
export const SPRAY = { wetTurns: 2, thickSmokeRangeLoss: 1 } as const;
export const THICK_SMOKE = 60;

/** Precomputed blockers, so pathfinding doesn't rebuild them per step. */
export interface Blockers {
  trucks: Map<string, Truck>;
  units: Map<string, Unit>;
}

export function blockers(state: GameState): Blockers {
  const units = new Map<string, Unit>();
  for (const u of state.units) {
    // Victims nobody has found yet don't block: the crew would stumble over them.
    if (u.status === 'active' && !u.aboard && !u.carriedBy && (u.kind === 'firefighter' || u.found)) units.set(posKey(u.pos), u);
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
  // A raised aerial links its turntable and its tip, however far apart.
  const climb = !!aerialLink(state, from, to);
  if (!climb) {
    if (to.floor === from.floor) {
      if (!isAdjacent(from, to)) return 'Not adjacent';
    } else if (Math.abs(to.floor - from.floor) !== 1 || to.x !== from.x || to.y !== from.y || !verticalLink(src, t)) {
      return 'Floors are only connected by stairs or ladders';
    }
  }
  // The turntable is the one spot on a truck you can stand on; the aerial tip can be stood in, even in mid-air.
  const turntable = !!turntableAt(state, to);
  if (block.trucks.has(posKey(to)) && !turntable) return 'A truck is parked there';
  const other = block.units.get(posKey(to));
  if (other && other.kind === 'civilian') return other.occupant === 'bystander' ? 'A bystander is in the way' : 'Someone is there — pick them up';
  if (!turntable && !aerialTipAt(state, to) && !isWalkable(t)) {
    if (t.kind === 'door' || t.kind === 'window') return `The ${t.kind} is closed`;
    if (CONTENTS[t.contents].blocks) return `${CONTENTS[t.contents].label} in the way`;
    return 'Blocked';
  }
  if (t.fire >= 2) return 'Too hot — knock the fire down first';
  let cost = climb ? COST.climbAerial : COST.move + CONTENTS[t.contents].moveExtra;
  if (turntable && !climb) cost += COST.mountTurntable;
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
  // Up or down a raised aerial.
  const base = turntableAt(state, p);
  if (base?.aerialTip) out.push({ ...base.aerialTip });
  const tipOf = aerialTipAt(state, p);
  if (tipOf) out.push(...turntableTiles(tipOf).map((q) => ({ ...q })));
  return out;
}

/** Where a unit's movement starts: its tile, or every tile of the truck it is riding. */
export function moveOrigins(state: GameState, u: Unit): Pos[] {
  if (!u.aboard) return [u.pos];
  const truck = state.trucks.find((t) => t.id === u.aboard);
  return truck ? truckTiles(truck) : [];
}

/** Reach of a hose; thick smoke at the nozzle means the crew can't see far enough to hit distant fire. */
export function sprayRange(state: GameState, from: Pos, size: HoseSize = '1.75'): number {
  const base = HOSE_SIZES[size].range;
  return (tileAt(state, from)?.smoke ?? 0) >= THICK_SMOKE ? base - SPRAY.thickSmokeRangeLoss : base;
}

/** Reach of the nozzle a firefighter is holding. */
export function nozzleRange(state: GameState, u: Unit): number {
  return sprayRange(state, u.pos, lineOf(state, u)?.size);
}

export function canSprayFrom(state: GameState, from: Pos, target: Pos, range = sprayRange(state, from)): string | null {
  if (from.floor !== target.floor) return 'Target must be on the same floor';
  const dx = Math.sign(target.x - from.x);
  const dy = Math.sign(target.y - from.y);
  if (dx !== 0 && dy !== 0) return 'Spray only in straight lines';
  const dist = Math.abs(target.x - from.x) + Math.abs(target.y - from.y);
  if (dist === 0) return 'Cannot spray your own tile';
  if (dist > range) return `Out of range (max ${range})`;
  for (let i = 1; i < dist; i++) {
    const t = tileAt(state, { floor: from.floor, x: from.x + dx * i, y: from.y + dy * i });
    if (!t || !isOpenAir(t)) return 'Line of fire is blocked';
  }
  return null;
}

/** Open-air tiles above `p` that a ground ladder leaning on the building would reach, floor by floor. */
export function ladderReach(state: GameState, p: Pos): Pos[] {
  const out: Pos[] = [];
  for (let f = p.floor + 1; f < state.floors.length; f++) {
    const q = { ...p, floor: f };
    const t = tileAt(state, q);
    const leansOnBuilding = DIRS.some(([dx, dy]) => {
      const n = tileAt(state, { ...q, x: q.x + dx, y: q.y + dy });
      return !!n && n.kind !== 'air' && n.kind !== 'ground';
    });
    if (!t || t.kind !== 'air' || !leansOnBuilding) break;
    out.push(q);
  }
  return out;
}

/** Whether a ground ladder could be raised here: outside, against the building. */
export function ladderSpotError(state: GameState, p: Pos): string | null {
  const here = tileAt(state, p);
  if (!here || here.kind !== 'ground' || p.floor !== 0) return 'Ladders are raised from the ground outside';
  if (here.ladder) return 'A ladder is already here';
  return ladderReach(state, p).length ? null : 'Must stand right against the building';
}

function findUnit(state: GameState, id: string): Unit | undefined {
  return state.units.find((u) => u.id === id);
}

export function lineOf(state: GameState, u: Unit): HoseLine | undefined {
  return u.line ? state.hoses.find((l) => l.id === u.line) : undefined;
}

function civilianAt(state: GameState, p: Pos): Unit | undefined {
  return state.units.find((u) => u.kind === 'civilian' && u.occupant !== 'bystander' && u.status === 'active' && u.found && !u.carriedBy && samePos(u.pos, p));
}

export function fanAt(state: GameState, p: Pos) {
  return state.fans.find((f) => samePos(f.pos, p));
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
  total += heavyHoseExtra(state, u, path);
  if (block.units.has(posKey(path[path.length - 1]))) return 'That spot is taken';
  const line = lineOf(state, u);
  if (line) {
    const truck = state.trucks.find((t) => t.id === line.truckId)!;
    const extra = extendLine(line.tiles, path).length - line.tiles.length;
    if (extra > hoseLeft(state, truck)) return `Not enough hose — ${hoseLeft(state, truck)} tiles left on ${truck.name}`;
  }
  return total;
}

/** Extra AP for advancing a heavy (2½″) line: every tile of new hose laid costs more; walking back along it doesn't. */
export function heavyHoseExtra(state: GameState, u: Unit, path: Pos[]): number {
  const line = lineOf(state, u);
  const extra = line ? HOSE_SIZES[line.size].advanceExtra : 0;
  if (!extra) return 0;
  const laid = new Set(line!.tiles.map(posKey));
  return path.filter((p) => !laid.has(posKey(p))).length * extra;
}

/** The engine coupling a firefighter would take an attack line from, or why they can't. */
export function attackSource(state: GameState, u: Unit, size: HoseSize, side?: 0 | 1): { engine: Truck; side: 0 | 1; origin: Pos } | string {
  let busy = false;
  for (const engine of state.trucks) {
    for (const d of dischargeTiles(engine)) {
      if (side !== undefined && d.side !== side) continue;
      if (!isAdjacent(u.pos, d.pos)) continue;
      if (state.hoses.some((l) => l.truckId === engine.id && l.kind === 'attack' && l.side === d.side && l.size === size)) {
        busy = true;
        continue;
      }
      if (hoseLeft(state, engine) <= 0) return `${engine.name} is out of hose`;
      return { engine, side: d.side, origin: d.pos };
    }
  }
  return busy
    ? `The ${HOSE_SIZES[size].label} line on this side is already in use`
    : "Stand beside an engine's hose connections, halfway down a long side";
}

/** The rear coupling (engine or ladder truck) a firefighter would pull the 5″ supply line from, or why they can't. */
export function supplySource(state: GameState, u: Unit): { engine: Truck; origin: Pos } | string {
  let busy = false;
  for (const engine of state.trucks) {
    const origin = supplyTiles(engine).find((p) => isAdjacent(u.pos, p));
    if (!origin) continue;
    if (state.hoses.filter((l) => l.truckId === engine.id && l.kind === 'supply').length >= HOSE.maxSupplyLines) {
      busy = true;
      continue;
    }
    if (hoseLeft(state, engine) <= 0) return `${engine.name} is out of hose`;
    return { engine, origin };
  }
  return busy ? 'The supply line is already in use' : 'Stand at the back of an engine or ladder truck to take the 5″ supply line';
}

/** AP cost of an action (0 for truck placement), or the reason it cannot be performed. */
export function actionCost(state: GameState, action: Action): number | string {
  if (state.status !== 'playing') return 'The incident is over';

  if (action.type === 'alarm') return state.alarm >= ALARM.maxLevel ? `Already at a ${ordinal(ALARM.maxLevel)} alarm` : 0;

  if (action.type === 'placeTruck') {
    const truck = state.trucks.find((t) => t.id === action.truckId);
    if (!truck) return 'No such truck';
    if (truck.status === 'enroute') return `${truck.name} arrives on turn ${truck.arrivalTurn}`;
    if (truck.status === 'placed') return `${truck.name} is already parked`;
    return placementError(state, truck, action.pos, action.orientation) ?? 0;
  }

  const u = findUnit(state, action.unitId);
  if (!u || u.kind !== 'firefighter') return 'No such firefighter';
  if (u.status !== 'active') return `${u.name} is out of action`;
  if (u.aboard) {
    const truck = state.trucks.find((t) => t.id === u.aboard);
    if (truck?.status !== 'placed') return `${u.name} is still on ${truck?.name ?? 'the truck'} — park it first`;
    if (action.type !== 'move') return `${u.name} must get off the truck first`;
  }
  const line = lineOf(state, u);
  if (LADDER_JOBS.has(action.type) && u.role !== 'ladder') return 'Only ladder crews do that';

  let cost: number | string;
  switch (action.type) {
    case 'move':
      cost = pathCost(state, u, action.path);
      break;
    case 'spray': {
      if (!line || line.kind !== 'attack') return 'Needs an attack line — take one from an engine';
      const truck = state.trucks.find((t) => t.id === line.truckId)!;
      if (truck.water < HOSE_SIZES[line.size].water) return `${truck.name} is out of water — supply it from a hydrant`;
      if (!pumpOperator(state, truck)) return `Nobody is on ${truck.name}'s pump — someone has to stand at the pump panel, midship`;
      cost = canSprayFrom(state, u.pos, action.target, nozzleRange(state, u)) ?? COST.spray;
      break;
    }
    case 'toggle': {
      const t = tileAt(state, action.target);
      if (!t || !isAdjacent(u.pos, action.target)) return 'Must be adjacent';
      if (t.kind !== 'door' && t.kind !== 'window') return 'Not a door or window';
      if (t.broken) return 'It is broken and cannot be closed';
      if (t.locked) return t.reinforced ? 'Locked and reinforced — a ladder crew has to force it' : 'Locked — force it open (Tools)';
      if (t.open && blockers(state).units.has(posKey(action.target))) return 'Someone is in the way';
      if (t.open && linesThrough(state, action.target).length) return 'A hose runs through it';
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
      if (line) return 'Put the hose down first';
      if (!samePos(u.pos, action.target) && !isAdjacent(u.pos, action.target)) return 'Must be adjacent';
      if (!civilianAt(state, action.target)) return 'Nobody to pick up';
      cost = COST.pickup;
      break;
    case 'drop':
      cost = u.carrying ? COST.drop : 'Not carrying anyone';
      break;
    case 'takeLine': {
      if (line) return 'Already holding a hose';
      if (u.carrying) return 'Hands full — put the person down first';
      if (action.kind === 'attack') {
        const src = attackSource(state, u, action.size ?? '1.75', action.side);
        if (typeof src === 'string') return src;
      } else {
        const src = supplySource(state, u);
        if (typeof src === 'string') return src;
      }
      cost = COST.takeLine;
      break;
    }
    case 'dropLine':
      cost = line ? COST.dropLine : 'Not holding a hose';
      break;
    case 'pickupLine': {
      if (line) return 'Already holding a hose';
      if (u.carrying) return 'Hands full — put the person down first';
      const end = state.hoses.find((l) => !l.holder && !l.hydrant && !l.toTruck && samePos(l.tiles[l.tiles.length - 1], u.pos));
      cost = end ? COST.pickupLine : 'No loose hose end here';
      break;
    }
    case 'returnLine': {
      if (!line) return 'Not holding a hose';
      const truck = state.trucks.find((t) => t.id === line.truckId)!;
      cost = besideTruck(truck, u.pos) ? COST.returnLine : `Walk back to ${truck.name} to pack the line`;
      break;
    }
    case 'hydrant': {
      const h = hydrantAt(state, action.target);
      if (!h) return 'Not a hydrant';
      if (!isAdjacent(u.pos, action.target)) return 'Must be next to the hydrant';
      const work = hydrantWorkAvailable(state, u, h);
      if (typeof work === 'string') return work;
      if (u.ap === 0) return `${u.name} has no AP left this turn`;
      cost = Math.min(u.ap, work);
      break;
    }
    case 'inlet': {
      if (!line || line.kind !== 'supply') return 'Bring a 5″ supply line from another truck';
      const truck = state.trucks.find((t) => t.id === action.truckId);
      if (!truck || truck.status !== 'placed') return 'No such truck';
      if (truck.id === line.truckId) return "Can't couple a truck's supply line to itself";
      if (!inletTiles(truck).some((d) => isAdjacent(u.pos, d.pos))) return `Stand next to an inlet on ${truck.name}'s side`;
      if (state.hoses.some((l) => l.toTruck === truck.id)) return `${truck.name}'s inlet is already in use`;
      if (hoseLeft(state, state.trucks.find((t) => t.id === line.truckId)!) < 1) return 'Not enough hose to reach the inlet';
      cost = COST.inlet;
      break;
    }
    case 'ladder':
      cost = ladderSpotError(state, u.pos) ?? COST.ladder;
      break;
    case 'force': {
      const t = tileAt(state, action.target);
      if (!t || !isAdjacent(u.pos, action.target)) return 'Must be adjacent';
      if (t.kind !== 'door' || !t.locked) return 'Not a locked door';
      if (t.reinforced && u.role !== 'ladder') return 'Reinforced door — only a ladder crew can force it';
      cost = t.reinforced ? COST.forceReinforced : COST.force;
      break;
    }
    case 'aerial': {
      const truck = aerialStation(state, u);
      if (!truck) return "Stand on a ladder truck's turntable or at the aerial tip to work it";
      if (truck.aerialTip && samePos(truck.aerialTip, action.tip)) return 'The aerial is already there';
      const err = aerialTipError(state, truck, action.tip);
      if (err) return err;
      const there = blockers(state).units.get(posKey(action.tip));
      if (there && there.id !== u.id) return 'Someone is in the way';
      cost = COST.aerial;
      break;
    }
    case 'masterStream': {
      const truck = aerialStation(state, u);
      if (!truck) return "Stand on a ladder truck's turntable or at the aerial tip to work it";
      if (!truck.aerialTip) return 'Raise the aerial first';
      if (!isSupplied(state, truck) && truck.water < AERIAL.water) return `${truck.name}'s tank is dry — supply it from a hydrant or an engine`;
      cost = canSprayFrom(state, truck.aerialTip, action.target, AERIAL.streamRange) ?? COST.masterStream;
      break;
    }
    case 'cutRoof': {
      if (tileAt(state, u.pos)?.kind !== 'roof') return 'Get onto the roof first';
      const t = tileAt(state, action.target);
      if (!t || !isAdjacent(u.pos, action.target) || t.kind !== 'roof') return 'Cut an adjacent roof tile';
      if (blockers(state).units.has(posKey(action.target))) return 'Someone is standing there';
      cost = COST.cutRoof;
      break;
    }
    case 'placeFan': {
      const t = tileAt(state, action.target);
      if (!t || !isAdjacent(u.pos, action.target)) return 'Stand next to the door or window the fan should blow through';
      const opening = t.kind === 'rubble' || ((t.kind === 'door' || t.kind === 'window') && t.open);
      if (!opening) return 'The fan needs an open door or window to blow through';
      if (fanAt(state, u.pos)) return 'A fan is already here';
      const truck = state.trucks.find((tr) => tr.id === u.truck);
      cost = truck && truck.fans > 0 ? COST.placeFan : 'No fan left on your truck';
      break;
    }
    case 'removeFan': {
      if (!fanAt(state, action.target)) return 'No fan there';
      cost = samePos(u.pos, action.target) || isAdjacent(u.pos, action.target) ? COST.removeFan : 'Must be next to the fan';
      break;
    }
    case 'search':
      cost = searchCost(state, u);
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
  /** Whose truck gets the credit in the radio log: the acting firefighter's (or the truck being parked). */
  let actor: string | undefined;
  const log = (text: string, tone: LogEntry['tone'] = 'info', truckId = actor) => state.log.push({ turn: state.turn, text, tone, truckId });

  if (action.type === 'alarm') {
    const turns = nextAlarm(state).trucks.map((t) => t.arrivalTurn);
    const trucks = strikeAlarm(state);
    const names = trucks.map((t) => t.name);
    const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
    log(`${ordinal(state.alarm)} alarm struck: ${list} responding, due in ${Math.min(...turns) - state.turn}–${Math.max(...turns) - state.turn} turns.`, 'good');
    return { state };
  }

  if (action.type === 'placeTruck') {
    const truck = state.trucks.find((t) => t.id === action.truckId)!;
    actor = truck.id;
    truck.pos = { ...action.pos, floor: 0 };
    truck.orientation = action.orientation;
    truck.reversed = !!action.reversed;
    truck.status = 'placed';
    for (const crew of state.units) if (crew.aboard === truck.id) crew.pos = { ...truck.pos };
    log(`${truck.name} parks${truck.water ? ` with ${truck.water} units of water` : ''}.`, 'good');
    return { state };
  }

  const u = findUnit(state, action.unitId)!;
  actor = u.truck;
  const line = lineOf(state, u);
  u.ap -= cost;

  switch (action.type) {
    case 'move': {
      const to = action.path[action.path.length - 1];
      const carried = u.carrying ? findUnit(state, u.carrying) : undefined;
      u.task = undefined; // walking away abandons a hydrant hookup
      if (u.aboard) {
        log(`${u.name} gets off ${state.trucks.find((t) => t.id === u.aboard)?.name}.`);
        u.aboard = undefined;
      }
      if (to.floor !== u.pos.floor) log(`${u.name} climbs to ${floorName(to.floor)}.`);
      if (line) line.tiles = extendLine(line.tiles, action.path);
      // Walking over a victim nobody had found yet finds them.
      for (const p of action.path) {
        for (const c of state.units) {
          if (c.kind === 'civilian' && c.status === 'active' && !c.found && samePos(c.pos, p)) {
            c.found = true;
            log(`${u.name} stumbles onto ${c.name}!`, 'good');
          }
        }
      }
      u.pos = { ...to };
      if (carried) carried.pos = { ...to };
      if (carried && isOutside(tileAt(state, to)!) && to.floor === 0) {
        carried.status = 'rescued';
        carried.unconscious = false; // into the paramedics' care
        carried.carriedBy = undefined;
        u.carrying = undefined;
        log(`${u.name} carries ${carried.name} to safety!`, 'good');
      }
      break;
    }
    case 'spray': {
      const hose = HOSE_SIZES[line!.size];
      state.trucks.find((t) => t.id === line!.truckId)!.water -= hose.water;
      if (applyWater(state, action.target, hose)) log(`${u.name} knocks down a fire.`, 'good');
      break;
    }
    case 'masterStream': {
      const truck = aerialStation(state, u)!;
      if (!isSupplied(state, truck)) truck.water -= AERIAL.water;
      let knocked = 0;
      for (const p of streamArea(state, action.target)) if (applyWater(state, p, AERIAL)) knocked++;
      const result = knocked ? ` and knocks down ${knocked === 1 ? 'a fire' : `${knocked} fires`}` : '';
      log(`${u.name} opens up the master stream from ${truck.name}'s aerial${result}.`, knocked ? 'good' : 'info');
      break;
    }
    case 'aerial': {
      const truck = aerialStation(state, u)!;
      const old = truck.aerialTip;
      truck.aerialTip = { ...action.tip };
      // Whoever is in the tip (and anyone they carry) rides along.
      if (old) for (const r of state.units) if (r.status === 'active' && !r.aboard && samePos(r.pos, old)) r.pos = { ...action.tip };
      const where = action.tip.floor === state.floors.length - 1 ? 'the roof' : floorName(action.tip.floor);
      log(`${u.name} ${old ? 'swings' : 'raises'} ${truck.name}'s aerial to ${where}.`, 'good');
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
    case 'takeLine': {
      const id = `line${state.nextLineId++}`;
      if (action.kind === 'attack') {
        const size = action.size ?? '1.75';
        const src = attackSource(state, u, size, action.side) as Exclude<ReturnType<typeof attackSource>, string>;
        state.hoses.push({ id, truckId: src.engine.id, kind: 'attack', size, side: src.side, origin: src.origin, tiles: [{ ...u.pos }], holder: u.id });
        log(`${u.name} pulls a ${HOSE_SIZES[size].label} attack line off ${src.engine.name}.`);
      } else {
        const { engine, origin } = supplySource(state, u) as Exclude<ReturnType<typeof supplySource>, string>;
        state.hoses.push({ id, truckId: engine.id, kind: 'supply', size: '5', origin, tiles: [{ ...u.pos }], holder: u.id });
        log(`${u.name} pulls the 5″ supply line off ${engine.name}.`);
      }
      u.line = id;
      break;
    }
    case 'dropLine':
      line!.holder = undefined;
      u.line = undefined;
      log(`${u.name} puts the hose down.`);
      break;
    case 'pickupLine': {
      const l = state.hoses.find((l) => !l.holder && !l.hydrant && !l.toTruck && samePos(l.tiles[l.tiles.length - 1], u.pos))!;
      l.holder = u.id;
      u.line = l.id;
      log(`${u.name} picks up the hose.`);
      break;
    }
    case 'returnLine': {
      state.hoses = state.hoses.filter((l) => l.id !== line!.id);
      u.line = undefined;
      log(`${u.name} packs the hose back onto ${state.trucks.find((t) => t.id === line!.truckId)?.name}.`);
      break;
    }
    case 'hydrant': {
      const h = hydrantAt(state, action.target)!;
      workHydrant(state, u, h, cost, log);
      const more = hydrantWorkAvailable(state, u, h);
      if (typeof more === 'number' && more > 0) {
        u.task = { ...h.pos };
        log(`${u.name} keeps working the hydrant next turn (${HYDRANT_TOTAL - h.work} AP of work left).`);
      } else {
        u.task = undefined;
        if (h.state === 'uncapped') log('Cap is off — bring a supply line to couple.');
      }
      break;
    }
    case 'inlet': {
      const truck = state.trucks.find((t) => t.id === action.truckId)!;
      const inlet = inletTiles(truck).find((d) => isAdjacent(u.pos, d.pos))!;
      line!.tiles = extendLine(line!.tiles, [{ ...inlet.pos }]);
      line!.toTruck = truck.id;
      line!.holder = undefined;
      u.line = undefined;
      const from = state.trucks.find((t) => t.id === line!.truckId)!;
      log(`${u.name} couples ${from.name}'s 5″ supply line to ${truck.name}'s inlet.`, 'good');
      break;
    }
    case 'ladder': {
      const reach = ladderReach(state, u.pos);
      tileAt(state, u.pos)!.ladder = true;
      for (const q of reach) tileAt(state, q)!.ladder = true;
      const top = reach[reach.length - 1].floor;
      log(`${u.name} raises a ladder to ${top === state.floors.length - 1 ? 'the roof' : floorName(top)}.`, 'good');
      break;
    }
    case 'force': {
      const t = tileAt(state, action.target)!;
      const reinforced = t.reinforced;
      Object.assign(t, { locked: false, reinforced: false, open: true });
      log(`${u.name} forces the ${reinforced ? 'reinforced' : 'locked'} door.`, 'good');
      break;
    }
    case 'cutRoof': {
      const t = tileAt(state, action.target)!;
      Object.assign(t, { kind: 'vent', material: 'air', fuel: 0, fire: 0 });
      log(`${u.name} cuts a ventilation hole in the roof.`, 'good');
      break;
    }
    case 'placeFan': {
      const truck = state.trucks.find((tr) => tr.id === u.truck)!;
      truck.fans -= 1;
      state.fans.push({ id: `fan${state.nextLineId++}`, truckId: truck.id, pos: { ...u.pos }, target: { ...action.target } });
      log(`${u.name} sets up a fan blowing into the building.`);
      break;
    }
    case 'removeFan': {
      const fan = fanAt(state, action.target)!;
      state.fans = state.fans.filter((f) => f.id !== fan.id);
      const truck = state.trucks.find((tr) => tr.id === fan.truckId);
      if (truck) truck.fans += 1;
      log(`${u.name} shuts down the fan.`);
      break;
    }
    case 'search':
      searchAround(state, u, log);
      break;
  }
  spotVictims(state, log);
  evaluate(state);
  return { state };
}

/**
 * Where a master stream lands: the target and the tiles around it (diagonals
 * included, up to AERIAL.area away) that the water can actually reach from the
 * target. Walls, closed doors and closed windows stop it; open doors, open or
 * broken windows and holes let it through.
 */
export function streamArea(state: GameState, target: Pos): Pos[] {
  const within = (p: Pos) => Math.abs(p.x - target.x) <= AERIAL.area && Math.abs(p.y - target.y) <= AERIAL.area;
  const out = [target];
  if (!isOpenAir(tileAt(state, target)!)) return out; // a wall takes the water itself
  const seen = new Set([posKey(target)]);
  for (let i = 0; i < out.length; i++) {
    for (const n of neighbors(state, out[i])) {
      if (seen.has(posKey(n)) || !within(n)) continue;
      seen.add(posKey(n));
      if (isOpenAir(tileAt(state, n)!)) out.push(n);
    }
  }
  return out;
}

/** Puts water on a tile: knocks the fire down, cools it and wets it, and cools the tiles around. Returns whether a fire went out. */
function applyWater(state: GameState, target: Pos, w: { knockdown: number; cooling: number; splashCooling: number }): boolean {
  const t = tileAt(state, target)!;
  const wasBurning = t.fire > 0;
  // Water does little against burning flammable liquid (it takes foam).
  const knockdown = CONTENTS[t.contents].accelerant === 'liquid' ? Math.ceil(w.knockdown * ACCELERANT.waterFactor) : w.knockdown;
  t.fire = Math.max(0, t.fire - knockdown);
  t.temperature = Math.max(20, t.temperature - w.cooling);
  t.wet = SPRAY.wetTurns;
  for (const n of neighbors(state, target)) {
    const nt = tileAt(state, n)!;
    nt.temperature = Math.max(20, nt.temperature - w.splashCooling);
  }
  return wasBurning && t.fire === 0;
}
