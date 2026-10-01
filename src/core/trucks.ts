import { TRUCK_SPECS } from './building';
import { inBounds, posKey, tileAt } from './grid';
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

/** Where a crew member still aboard is sitting: one seat each, in crew order. */
export function seatOf(state: GameState, u: Unit): Pos | undefined {
  const truck = state.trucks.find((t) => t.id === u.aboard);
  if (!truck) return undefined;
  const crew = state.units.filter((c) => c.aboard === truck.id && c.status === 'active');
  return seatTiles(truck)[crew.findIndex((c) => c.id === u.id)];
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
