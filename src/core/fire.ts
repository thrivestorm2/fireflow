import { DIRS, isOpenAir, isOutside } from './grid';
import { AMBIENT, ignitionOf } from './materials';
import type { SimSystem } from './systems';
import type { Tile } from './types';

/** Tuning constants for fire behaviour. Temperatures are in °C. */
export const FIRE = {
  /** Temperature a burning tile holds itself at, by intensity. */
  flameTemp: [AMBIENT, 400, 600, 800],
  /** Radiant heat pushed into each side neighbour per intensity level. */
  emitSide: 96,
  /** Heat pushed upward per level: through an opening (stairs, hole) or through the ceiling. */
  emitUpOpen: 96,
  emitUpCeiling: 24,
  emitDown: 16,
  /** Hot-gas mixing rate between adjacent open tiles, and the extra rise through openings. */
  convection: 0.12,
  rise: 0.15,
  /** Multiplier on heat gained by wet tiles. */
  wetHeatFactor: 0.4,
  /** Fraction of excess heat (above ambient) kept each turn. */
  coolingInside: 0.88,
  coolingOutside: 0.4,
  maxTemp: 1100,
  /** Ignition chance: base + (temperature above ignition point) / scale. */
  ignitionBase: 0.25,
  ignitionScale: 320,
  /** Fuel consumed per turn per level of intensity. */
  burnRate: 0.6,
  growChance: 0.4,
  ventGrowBonus: 1.5,
  windowBreakTemp: 450,
} as const;

function hasVent(floor: Tile[][], x: number, y: number): boolean {
  return DIRS.some(([dx, dy]) => {
    const n = floor[y + dy]?.[x + dx];
    return !!n && (isOutside(n) || n.kind === 'hole' || (n.kind === 'window' && n.open));
  });
}

/**
 * Heat transfer, ignition, growth and burn-out. This is the only place new
 * fires start, and it only runs during the fire phase of a turn.
 * Heat is computed from a snapshot so the result does not depend on scan order.
 */
export const fireSystem: SimSystem = {
  name: 'fire',
  step({ state, rng, log }) {
    const { floors, width: W, height: H } = state;
    const F = floors.length;
    const dHeat = floors.map(() => Array.from({ length: H }, () => new Array<number>(W).fill(0)));

    // 1. Burning tiles radiate heat to neighbours, above and below.
    for (let f = 0; f < F; f++) {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const t = floors[f][y][x];
          if (t.fire <= 0) continue;
          t.temperature = Math.max(t.temperature, FIRE.flameTemp[t.fire]);
          for (const [dx, dy] of DIRS) {
            if (floors[f][y + dy]?.[x + dx]) dHeat[f][y + dy][x + dx] += t.fire * FIRE.emitSide;
          }
          if (f + 1 < F) {
            const above = floors[f + 1][y][x];
            const openUp = above.kind === 'hole' || (above.kind === 'stairs' && t.kind === 'stairs');
            dHeat[f + 1][y][x] += t.fire * (openUp ? FIRE.emitUpOpen : FIRE.emitUpCeiling);
          }
          if (f > 0) dHeat[f - 1][y][x] += t.fire * FIRE.emitDown;
        }
      }
    }

    // 2. Hot gas mixes between open interior tiles and rises through openings.
    for (let f = 0; f < F; f++) {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const a = floors[f][y][x];
          if (!isOpenAir(a)) continue;
          for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
            const b = floors[f][y + dy]?.[x + dx];
            if (!b || !isOpenAir(b)) continue;
            const flow = (a.temperature - b.temperature) * FIRE.convection;
            dHeat[f][y][x] -= flow;
            dHeat[f][y + dy][x + dx] += flow;
          }
          if (f + 1 < F) {
            const above = floors[f + 1][y][x];
            const shaft = above.kind === 'hole' || (above.kind === 'stairs' && a.kind === 'stairs');
            if (shaft && a.temperature > above.temperature) {
              const flow = (a.temperature - above.temperature) * FIRE.rise;
              dHeat[f][y][x] -= flow;
              dHeat[f + 1][y][x] += flow;
            }
          }
        }
      }
    }

    // 3. Apply heat, then ignite / grow / burn.
    for (let f = 0; f < F; f++) {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const t = floors[f][y][x];
          let gain = dHeat[f][y][x];
          if (gain > 0 && t.wet > 0) gain *= FIRE.wetHeatFactor;
          t.temperature = clamp(t.temperature + gain, AMBIENT, FIRE.maxTemp);

          if (t.kind === 'window' && !t.open && t.temperature >= FIRE.windowBreakTemp) {
            t.open = true;
            t.broken = true;
            log(`A window shatters from the heat on ${floorName(f)}.`, 'bad');
          }

          if (t.fire === 0) {
            const ignition = ignitionOf(t.material, t.contents);
            if (t.fuel > 0 && t.wet === 0 && t.temperature >= ignition) {
              const p = clamp(FIRE.ignitionBase + (t.temperature - ignition) / FIRE.ignitionScale, 0, 0.9);
              if (rng.chance(p)) t.fire = 1;
            }
            continue;
          }

          t.fuel = Math.max(0, t.fuel - t.fire * FIRE.burnRate);
          if (t.fuel <= 0) {
            t.fire = 0;
            t.burnt = true;
            if (t.contents !== 'hydrant') t.contents = 'none';
          } else if (t.fire > 1 && t.fuel < t.fire * 1.5) {
            t.fire -= 1; // running out of fuel
          } else if (t.fire < 3 && t.wet === 0) {
            const vent = hasVent(floors[f], x, y) ? FIRE.ventGrowBonus : 1;
            if (rng.chance(FIRE.growChance * vent)) t.fire += 1;
          }
        }
      }
    }

    // 4. Cooling and drying.
    for (const floor of floors) {
      for (const row of floor) {
        for (const t of row) {
          if (t.fire === 0) {
            const keep = isOutside(t) ? FIRE.coolingOutside : FIRE.coolingInside;
            t.temperature = AMBIENT + (t.temperature - AMBIENT) * keep;
            if (t.temperature < AMBIENT + 0.5) t.temperature = AMBIENT;
          }
          if (t.wet > 0) t.wet -= 1;
        }
      }
    }
  },
};

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function floorName(f: number): string {
  return f === 0 ? 'the ground floor' : `floor ${f + 1}`;
}
