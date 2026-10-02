import { DIRS, isOpenAir, isOutside, posKey, tileAt } from './grid';
import { visibleFrom } from './search';
import type { GameState, Pos, Tile } from './types';

/**
 * What the crew knows about conditions inside the building (fog of war). The
 * layout is always known; fire, smoke and heat inside are only known where the
 * crew can perceive them right now:
 *  - sight: through clear air (see SEARCH.sightRange); smoke blinds,
 *  - touch: a firefighter feels the tiles right around them, even in thick smoke,
 *  - glow: flames show through smoke a couple of tiles away,
 *  - thermal imaging: an officer's camera reads heat through smoke (not walls).
 * Everything outside, and the building's outer walls, windows and doors, can be
 * seen from the street: smoke and fire showing at an opening hint at what's inside.
 */
export const KNOWLEDGE = {
  glowRange: 2,
  thermalRange: 5,
} as const;

export interface Knowledge {
  /** Interior tiles whose fire, smoke and heat the crew can see or feel. */
  seen: Set<string>;
  /** Interior tiles whose temperature a thermal imaging camera is reading. */
  thermal: Set<string>;
}

/** Game states are immutable once handed out (see performAction / endTurn), so results are cached per state. */
const cache = new WeakMap<GameState, Knowledge>();

/** Outside, or the building's outer skin (a wall, window or door with the outside next to it). */
export function isExterior(state: GameState, p: Pos): boolean {
  const t = tileAt(state, p);
  if (!t) return false;
  if (isOutside(t)) return true;
  if (t.kind !== 'wall' && t.kind !== 'window' && t.kind !== 'door') return false;
  return DIRS.some(([dx, dy]) => {
    const n = tileAt(state, { ...p, x: p.x + dx, y: p.y + dy });
    return !!n && isOutside(n);
  });
}

/** Open-air tiles within `range` steps of `from` (walls and closed openings stop it), plus the surfaces bounding them. */
function reach(state: GameState, from: Pos, range: number, pass: (t: Tile) => boolean): Pos[] {
  const seen = new Set([posKey(from)]);
  const out: Pos[] = [from];
  let frontier = [from];
  for (let d = 0; d < range; d++) {
    const next: Pos[] = [];
    for (const p of frontier) {
      for (const [dx, dy] of DIRS) {
        const n = { ...p, x: p.x + dx, y: p.y + dy };
        const t = tileAt(state, n);
        if (!t || seen.has(posKey(n))) continue;
        seen.add(posKey(n));
        out.push(n); // walls and doors at the edge are seen/felt too
        if (pass(t)) next.push(n);
      }
    }
    frontier = next;
  }
  return out;
}

export function knowledge(state: GameState): Knowledge {
  const hit = cache.get(state);
  if (hit) return hit;
  const seen = new Set<string>();
  const thermal = new Set<string>();
  for (const u of state.units) {
    if (u.kind !== 'firefighter' || u.status !== 'active' || u.aboard) continue;
    for (const p of visibleFrom(state, u)) seen.add(posKey(p));
    for (const p of reach(state, u.pos, 1, () => false)) seen.add(posKey(p));
    for (const p of reach(state, u.pos, KNOWLEDGE.glowRange, isOpenAir)) {
      if (tileAt(state, p)!.fire > 0) seen.add(posKey(p));
    }
    if (u.rank === 'LT') for (const p of reach(state, u.pos, KNOWLEDGE.thermalRange, isOpenAir)) thermal.add(posKey(p));
  }
  for (const k of seen) thermal.add(k);
  const k = { seen, thermal };
  cache.set(state, k);
  return k;
}

/** Whether the fire, smoke and heat on this tile are known: outside, the outer skin, or perceived by the crew. */
export function isKnown(state: GameState, p: Pos): boolean {
  return isExterior(state, p) || knowledge(state).seen.has(posKey(p));
}

/**
 * Smoke and fire showing at an outside opening (window or door on the outer
 * skin): the worst conditions in the interior tiles right behind it. A closed
 * opening shows less: smoke seeps from the frame and fire glows through glass.
 */
export function showing(state: GameState, p: Pos): { smoke: number; fire: number; heat: number } | undefined {
  const t = tileAt(state, p);
  if (!t || (t.kind !== 'window' && t.kind !== 'door') || !isExterior(state, p)) return undefined;
  let smoke = 0;
  let fire = 0;
  let heat = 0;
  for (const [dx, dy] of DIRS) {
    const n = tileAt(state, { ...p, x: p.x + dx, y: p.y + dy });
    if (!n || isOutside(n)) continue;
    smoke = Math.max(smoke, n.smoke);
    fire = Math.max(fire, n.fire);
    heat = Math.max(heat, n.temperature);
  }
  if (!t.open) smoke *= 0.35;
  return { smoke, fire: Math.max(fire, t.fire), heat };
}
