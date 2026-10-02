import { TRUCK_SPECS } from './building';
import { inBounds, posKey, samePos, tileAt } from './grid';
import type { GameState, Orientation, Pos, Truck, TruckType, Unit } from './types';

/**
 * Tiles covered by a truck whose top-left tile is `pos`. Horizontal trucks are
 * `length` wide and `width` tall; vertical ones the other way round.
 */
export function footprint(pos: Pos, orientation: Orientation, type: TruckType): Pos[] {
  const { length, width } = TRUCK_SPECS[type];
  const [w, h] = orientation === 'h' ? [length, width] : [width, length];
  const out: Pos[] = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) out.push({ floor: 0, x: pos.x + dx, y: pos.y + dy });
  return out;
}

export function truckTiles(truck: Truck): Pos[] {
  return truck.status === 'placed' && truck.pos ? footprint(truck.pos, truck.orientation, truck.type) : [];
}

/** A truck's tiles ordered from the front (cab) to the back: where crew sit, front seats first. */
export function seatTiles(truck: Truck): Pos[] {
  const along = (p: Pos) => (truck.orientation === 'h' ? p.x : p.y) * (truck.reversed ? -1 : 1);
  const across = (p: Pos) => (truck.orientation === 'h' ? p.y : p.x);
  return truckTiles(truck).sort((a, b) => along(a) - along(b) || across(a) - across(b));
}

/**
 * Where a crew member still aboard is sitting. The engineer drives (front left,
 * as seen facing the way the truck points), the lieutenant rides front right,
 * and firefighters fill the seats behind in crew order.
 */
export function seatOf(state: GameState, u: Unit): Pos | undefined {
  const truck = state.trucks.find((t) => t.id === u.aboard);
  if (!truck) return undefined;
  const tiles = seatTiles(truck);
  // seatTiles orders each row by smaller x / y first; which of those is the driver's
  // left depends on the facing (west → south side, east → north, north → west, south → east).
  const driver = (truck.orientation === 'h') !== truck.reversed ? 1 : 0;
  if (u.rank === 'ENG') return tiles[driver];
  if (u.rank === 'LT') return tiles[1 - driver];
  const riders = state.units.filter((c) => c.aboard === truck.id && c.status === 'active' && c.rank !== 'ENG' && c.rank !== 'LT');
  return tiles.slice(2)[riders.findIndex((c) => c.id === u.id)];
}

/**
 * An engine's hose connections: the middle tile of each long side. Each has a
 * 1¾″ and a 2½″ attack line coupling.
 */
export function dischargeTiles(truck: Truck): { side: 0 | 1; pos: Pos }[] {
  if (truck.type !== 'engine') return [];
  const tiles = seatTiles(truck); // front to back, two per row across
  const mid = Math.floor(tiles.length / 4) * 2;
  return [
    { side: 0, pos: tiles[mid] },
    { side: 1, pos: tiles[mid + 1] },
  ].filter((d): d is { side: 0 | 1; pos: Pos } => !!d.pos);
}

/**
 * The firefighter running an engine's pump: standing next to its pump panel
 * (the midship crosslays, either side), off the truck, hands free. Attack lines
 * only flow, and the engine only pumps water on to other trucks, while someone
 * is on the pump. Hydrant pressure fills the engine's own tank without one.
 */
export function pumpOperator(state: GameState, truck: Truck): Unit | undefined {
  if (truck.type !== 'engine' || truck.status !== 'placed') return undefined;
  const panel = dischargeTiles(truck).map((d) => d.pos);
  return state.units.find(
    (u) =>
      u.kind === 'firefighter' &&
      u.status === 'active' &&
      !u.aboard &&
      !u.line &&
      !u.carrying &&
      panel.some((p) => p.floor === u.pos.floor && Math.abs(p.x - u.pos.x) + Math.abs(p.y - u.pos.y) === 1),
  );
}

/**
 * The 5″ inlets where a supply line from another truck couples on: one on each
 * long side, the row just behind an engine's crosslays, and halfway along a
 * ladder truck (ahead of the turntable).
 */
export function inletTiles(truck: Truck): { side: 0 | 1; pos: Pos }[] {
  const tiles = seatTiles(truck); // front to back, two per row across
  const rows = tiles.length / 2;
  const row = truck.type === 'engine' ? Math.floor(tiles.length / 4) + 1 : Math.floor(rows / 2);
  return [
    { side: 0, pos: tiles[row * 2] },
    { side: 1, pos: tiles[row * 2 + 1] },
  ].filter((d): d is { side: 0 | 1; pos: Pos } => !!d.pos);
}

/** The 5″ supply line coupling (engines and ladder trucks): the rear tiles of the truck. */
export function supplyTiles(truck: Truck): Pos[] {
  const tiles = seatTiles(truck);
  return tiles.slice(-2);
}

/**
 * The aerial: a ladder truck's turntable is a deck across the truck one row ahead
 * of the rear coupling (two tiles, so it can be reached from either side).
 * Raised, its tip rests on an open-air or roof tile up to `reach` tiles away
 * (counting diagonals as one) on an upper floor: a route up to the roof or a
 * window beside it. A firefighter on the turntable or at the tip works it:
 * swings it, and flows the master stream from the tip nozzle. Fed by a hydrant
 * (directly or relayed through another truck) the stream runs off the supply;
 * otherwise each flow drains `water` from the ladder truck's small tank. The
 * stream floods an area: tiles within `area` of the target (diagonals too) that
 * the water can reach from it — walls, closed doors and closed windows stop it.
 */
export const AERIAL = { reach: 7, streamRange: 5, area: 1, knockdown: 3, cooling: 600, splashCooling: 250, water: 3 } as const;

export function turntableTiles(truck: Truck): Pos[] {
  if (truck.type !== 'ladder') return [];
  const tiles = seatTiles(truck);
  return tiles.slice(-4, -2);
}

/** The placed ladder truck whose turntable deck includes `p`. */
export function turntableAt(state: GameState, p: Pos): Truck | undefined {
  return state.trucks.find((t) => turntableTiles(t).some((q) => samePos(q, p)));
}

/** The ladder truck whose raised aerial tip is at `p`. */
export function aerialTipAt(state: GameState, p: Pos): Truck | undefined {
  return state.trucks.find((t) => t.aerialTip && samePos(t.aerialTip, p));
}

/** The ladder truck whose aerial `u` can work: standing on its turntable or at its tip. */
export function aerialStation(state: GameState, u: Unit): Truck | undefined {
  if (u.aboard) return undefined;
  return turntableAt(state, u.pos) ?? aerialTipAt(state, u.pos);
}

/** The truck whose raised aerial links `a` and `b` (turntable to tip, either way). */
export function aerialLink(state: GameState, a: Pos, b: Pos): Truck | undefined {
  return state.trucks.find((t) => {
    if (!t.aerialTip) return false;
    const onDeck = (p: Pos) => turntableTiles(t).some((q) => samePos(q, p));
    return (onDeck(a) && samePos(b, t.aerialTip)) || (onDeck(b) && samePos(a, t.aerialTip));
  });
}

/** Why the aerial can't be swung to `tip`, or null if it can. */
export function aerialTipError(state: GameState, truck: Truck, tip: Pos): string | null {
  const deck = turntableTiles(truck);
  if (!deck.length) return 'Only ladder trucks have an aerial';
  const t = tileAt(state, tip);
  if (!t || tip.floor < 1) return 'Raise the aerial to an upper floor or the roof';
  if (t.kind !== 'air' && t.kind !== 'roof') return 'The tip must rest in open air or on the roof';
  const reach = Math.min(...deck.map((b) => Math.max(Math.abs(tip.x - b.x), Math.abs(tip.y - b.y))));
  if (reach > AERIAL.reach) return `Out of reach (max ${AERIAL.reach} tiles from the turntable)`;
  return null;
}

/** Map of tile key → truck occupying it. */
export function truckOccupancy(state: GameState): Map<string, Truck> {
  const m = new Map<string, Truck>();
  for (const t of state.trucks) for (const p of truckTiles(t)) m.set(posKey(p), t);
  return m;
}

/** Why a truck cannot park here, or null if it can. */
export function placementError(state: GameState, truck: Truck, pos: Pos, orientation: Orientation): string | null {
  const occupied = truckOccupancy(state);
  const hosed = new Set(state.hoses.flatMap((l) => l.tiles.map(posKey)));
  for (const p of footprint(pos, orientation, truck.type)) {
    if (!inBounds(state, p)) return 'Off the map';
    if (!tileAt(state, p)!.drivable) return 'Trucks must park on a road or driveway';
    if (occupied.has(posKey(p))) return 'Another truck is parked there';
    if (state.units.some((u) => u.status === 'active' && !u.aboard && posKey(u.pos) === posKey(p))) return 'Someone is standing there';
    if (hosed.has(posKey(p))) return 'A hose is in the way';
  }
  return null;
}

/** Whether `p` touches the truck (including diagonally). */
export function besideTruck(truck: Truck, p: Pos): boolean {
  return p.floor === 0 && truckTiles(truck).some((q) => Math.abs(q.x - p.x) <= 1 && Math.abs(q.y - p.y) <= 1);
}

/** Placed engines that `p` is standing beside. */
export function enginesNear(state: GameState, p: Pos): Truck[] {
  return state.trucks.filter((t) => t.type === 'engine' && besideTruck(t, p));
}
