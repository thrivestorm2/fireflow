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

/** Tiles where people can stand. */
export function isWalkable(t: Tile): boolean {
  switch (t.kind) {
    case 'ground':
    case 'floor':
    case 'stairs':
    case 'rubble':
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

/** Outside tiles: heat and smoke dissipate here. */
export function isOutside(t: Tile): boolean {
  return t.kind === 'ground' || t.kind === 'air';
}

export function forEachTile(state: GameState, fn: (t: Tile, p: Pos) => void): void {
  state.floors.forEach((rows, floor) =>
    rows.forEach((row, y) => row.forEach((t, x) => fn(t, { floor, x, y }))),
  );
}
