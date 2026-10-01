import { inBounds, posKey, tileAt } from './grid';
import type { GameState, Orientation, Pos, Truck } from './types';

export const TRUCK_LENGTH = 3;
/** Distance (Chebyshev, tiles) from a hydrant within which an engine can hook up. */
export const HYDRANT_REACH = 2;

/** Tiles covered by a truck whose front is at `pos`. */
export function footprint(pos: Pos, orientation: Orientation): Pos[] {
  return Array.from({ length: TRUCK_LENGTH }, (_, i) =>
    orientation === 'h' ? { floor: 0, x: pos.x + i, y: pos.y } : { floor: 0, x: pos.x, y: pos.y + i },
  );
}

export function truckTiles(truck: Truck): Pos[] {
  return truck.status === 'placed' && truck.pos ? footprint(truck.pos, truck.orientation) : [];
}

/** Map of tile key → truck occupying it. */
export function truckOccupancy(state: GameState): Map<string, Truck> {
  const m = new Map<string, Truck>();
  for (const t of state.trucks) for (const p of truckTiles(t)) m.set(posKey(p), t);
  return m;
}

/** Why a truck cannot park here, or null if it can. */
export function placementError(state: GameState, pos: Pos, orientation: Orientation): string | null {
  const occupied = truckOccupancy(state);
  for (const p of footprint(pos, orientation)) {
    if (!inBounds(state, p)) return 'Off the map';
    if (!tileAt(state, p)!.drivable) return 'Trucks must park on a road or driveway';
    if (occupied.has(posKey(p))) return 'Another truck is parked there';
    if (state.units.some((u) => u.status === 'active' && !u.aboard && posKey(u.pos) === posKey(p))) return 'Someone is standing there';
  }
  return null;
}

export function hydrantNear(state: GameState, tiles: Pos[]): Pos | undefined {
  for (const p of tiles) {
    for (let dy = -HYDRANT_REACH; dy <= HYDRANT_REACH; dy++) {
      for (let dx = -HYDRANT_REACH; dx <= HYDRANT_REACH; dx++) {
        const h = { floor: 0, x: p.x + dx, y: p.y + dy };
        if (tileAt(state, h)?.contents === 'hydrant') return h;
      }
    }
  }
  return undefined;
}

/** Placed engines within one tile (including diagonally) of `p`. */
export function enginesNear(state: GameState, p: Pos): Truck[] {
  if (p.floor !== 0) return [];
  return state.trucks.filter(
    (t) => t.type === 'engine' && truckTiles(t).some((q) => Math.abs(q.x - p.x) <= 1 && Math.abs(q.y - p.y) <= 1),
  );
}
