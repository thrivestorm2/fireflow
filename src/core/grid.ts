import { AMBIENT, CONTENTS } from './materials';
import type { GameState, Pos, Tile } from './types';

export const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function inBounds(state: GameState, p: Pos): boolean {
  return (
    p.floor >= 0 &&
    p.floor < state.floors.length &&
    p.x >= 0 &&
    p.x < state.width &&
    p.y >= 0 &&
    p.y < state.height
  );
}

export function tileAt(state: GameState, p: Pos): Tile | undefined {
  return inBounds(state, p) ? state.floors[p.floor][p.y][p.x] : undefined;
}

export function samePos(a: Pos, b: Pos): boolean {
  return a.floor === b.floor && a.x === b.x && a.y === b.y;
}

export function posKey(p: Pos): string {
  return `${p.floor},${p.x},${p.y}`;
}

export function neighbors(state: GameState, p: Pos): Pos[] {
  const out: Pos[] = [];
  for (const [dx, dy] of DIRS) {
    const n = { floor: p.floor, x: p.x + dx, y: p.y + dy };
    if (inBounds(state, n)) out.push(n);
  }
  return out;
}

export function manhattan(a: Pos, b: Pos): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function isAdjacent(a: Pos, b: Pos): boolean {
  return a.floor === b.floor && manhattan(a, b) === 1;
}

/** Tiles where people can stand (ignoring other units and trucks). */
export function isWalkable(t: Tile): boolean {
  if (CONTENTS[t.contents].blocks) return false;
  switch (t.kind) {
    case 'air':
      return t.ladder;
    case 'ground':
    case 'floor':
    case 'stairs':
    case 'rubble':
    case 'roof':
      return true;
    case 'door':
    case 'window':
      return t.open;
    default:
      return false;
  }
}

/** Tiles that hot gas and smoke can flow through. */
export function isOpenAir(t: Tile): boolean {
  switch (t.kind) {
    case 'wall':
      return false;
    case 'door':
    case 'window':
      return t.open;
    default:
      return true;
  }
}

/** Outside tiles (including the roof and roof vents): heat and smoke dissipate here. */
export function isOutside(t: Tile): boolean {
  return t.kind === 'ground' || t.kind === 'air' || t.kind === 'roof' || t.kind === 'vent';
}

/** Hot gas and smoke can rise straight from `below` into `above`: a stairwell, a collapsed floor or a roof vent. */
export function isShaft(below: Tile, above: Tile): boolean {
  return above.kind === 'hole' || above.kind === 'vent' || (above.kind === 'stairs' && below.kind === 'stairs');
}

/**
 * The rooms on one floor: interior open space split at doorways (door tiles
 * belong to no room). Broken-through walls and holes join rooms into one.
 * Outside tiles are left out. Each room is a list of [x, y].
 */
export function interiorSpaces(floors: Tile[][][], f: number): [number, number][][] {
  const inRoom = (t: Tile) => isOpenAir(t) && !isOutside(t) && t.kind !== 'door';
  const rows = floors[f];
  const seen = rows.map((r) => r.map(() => false));
  const out: [number, number][][] = [];
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      if (seen[y][x] || !inRoom(rows[y][x])) continue;
      const space: [number, number][] = [];
      const queue: [number, number][] = [[x, y]];
      seen[y][x] = true;
      while (queue.length) {
        const [cx, cy] = queue.pop()!;
        space.push([cx, cy]);
        for (const [dx, dy] of DIRS) {
          const n = rows[cy + dy]?.[cx + dx];
          if (!n || seen[cy + dy][cx + dx] || !inRoom(n)) continue;
          seen[cy + dy][cx + dx] = true;
          queue.push([cx + dx, cy + dy]);
        }
      }
      out.push(space);
    }
  }
  return out;
}

export interface SpaceMap {
  /** Rooms, floor by floor (see interiorSpaces). */
  spaces: { floor: number; tiles: [number, number][] }[];
  /** Rooms joined by a shaft (stairs, a collapsed floor): [lower, upper] indexes into `spaces`. */
  shafts: [number, number][];
  /** Rooms on the same floor joined by an open doorway: index pairs into `spaces`. */
  doorways: [number, number][];
}

/** Every room in the building, which open into the room above, and which open into each other. */
export function spaceMap(floors: Tile[][][]): SpaceMap {
  const spaces: SpaceMap['spaces'] = [];
  const index = floors.map((rows) => rows.map((row) => row.map(() => -1)));
  floors.forEach((_, f) =>
    interiorSpaces(floors, f).forEach((tiles) => {
      for (const [x, y] of tiles) index[f][y][x] = spaces.length;
      spaces.push({ floor: f, tiles });
    }),
  );
  const shafts = new Map<string, [number, number]>();
  for (let f = 0; f + 1 < floors.length; f++) {
    floors[f].forEach((row, y) =>
      row.forEach((t, x) => {
        const lo = index[f][y][x];
        const hi = index[f + 1][y][x];
        if (lo >= 0 && hi >= 0 && isShaft(t, floors[f + 1][y][x])) shafts.set(`${lo},${hi}`, [lo, hi]);
      }),
    );
  }
  const doorways = new Map<string, [number, number]>();
  floors.forEach((rows, f) =>
    rows.forEach((row, y) =>
      row.forEach((t, x) => {
        if (t.kind !== 'door' || !t.open) return;
        const rooms = new Set<number>();
        for (const [dx, dy] of DIRS) {
          const i = index[f][y + dy]?.[x + dx];
          if (i !== undefined && i >= 0) rooms.add(i);
        }
        const list = [...rooms].sort((a, b) => a - b);
        for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) doorways.set(`${list[i]},${list[j]}`, [list[i], list[j]]);
      }),
    ),
  );
  return { spaces, shafts: [...shafts.values()], doorways: [...doorways.values()] };
}

/**
 * Closed doors leak smoke and hot gas around their edges. Calls `fn` with the
 * open tiles on either side of each closed door.
 */
export function forEachClosedDoor(floors: Tile[][][], fn: (f: number, a: [number, number], b: [number, number]) => void): void {
  floors.forEach((rows, f) =>
    rows.forEach((row, y) =>
      row.forEach((t, x) => {
        if (t.kind !== 'door' || t.open) return;
        for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
          const a = rows[y - dy]?.[x - dx];
          const b = rows[y + dy]?.[x + dx];
          if (a && b && isOpenAir(a) && isOpenAir(b)) fn(f, [x - dx, y - dy], [x + dx, y + dy]);
        }
      }),
    ),
  );
}

export function forEachTile(state: GameState, fn: (t: Tile, p: Pos) => void): void {
  state.floors.forEach((rows, floor) =>
    rows.forEach((row, y) => row.forEach((t, x) => fn(t, { floor, x, y }))),
  );
}

/** Human-readable list of the tile's current conditions. */
export function conditions(t: Tile): string[] {
  const out: string[] = [];
  if (t.fire > 0) out.push(['', 'smouldering', 'burning', 'fully involved'][t.fire]);
  if (t.smoke >= 60) out.push('thick smoke');
  else if (t.smoke >= 15) out.push('smoky');
  if (t.temperature >= 100 && t.fire === 0) out.push('hot');
  if (t.wet > 0) out.push('wet');
  if (t.burnt) out.push('burnt out');
  if (t.integrity < 40 && t.kind !== 'hole' && t.kind !== 'rubble') out.push('near collapse');
  else if (t.integrity < 80 && t.kind !== 'hole' && t.kind !== 'rubble') out.push('damaged');
  if (t.kind === 'hole') out.push('collapsed');
  if (!out.length) out.push(t.temperature <= AMBIENT + 5 ? 'normal' : 'warm');
  return out;
}
