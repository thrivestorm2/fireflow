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
