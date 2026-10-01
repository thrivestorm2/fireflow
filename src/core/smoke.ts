import { AMBIENT } from './materials';
import { DIRS, isOpenAir, isOutside, isShaft, posKey } from './grid';
import { clamp } from './fire';
import type { Tile } from './types';
import type { SimSystem } from './systems';

export const SMOKE = {
  perFireLevel: 20,
  diffusion: 0.2,
  rise: 0.35,
  /** Smoke escapes faster through a roof vent (vertical ventilation). */
  ventRise: 0.7,
  windowVent: 0.5,
  /** Each roof vent draws this share of smoke (and excess heat) out of the space below it per turn. */
  roofVentDraw: 0.3,
  roofVentHeatDraw: 0.1,
  /** At most this share of smoke is left in a space with several vents. */
  minVentKept: 0.4,
  decay: 0.95,
} as const;

/** Smoke is produced by fire, spreads through open space, rises up shafts and vents outside. */
export const smokeSystem: SimSystem = {
  name: 'smoke',
  step({ state }) {
    const { floors, width: W, height: H } = state;
    const F = floors.length;
    const d = floors.map(() => Array.from({ length: H }, () => new Array<number>(W).fill(0)));

    for (let f = 0; f < F; f++) {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const t = floors[f][y][x];
          if (t.fire > 0) {
            const made = t.fire * SMOKE.perFireLevel;
            if (isOpenAir(t)) {
              d[f][y][x] += made;
            } else {
              // A burning wall or door pushes its smoke into the open space around it.
              const outlets = DIRS.filter(([dx, dy]) => {
                const n = floors[f][y + dy]?.[x + dx];
                return !!n && isOpenAir(n);
              });
              for (const [dx, dy] of outlets) d[f][y + dy][x + dx] += made / outlets.length;
            }
          }
          if (!isOpenAir(t)) continue;
          for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
            const n = floors[f][y + dy]?.[x + dx];
            if (!n || !isOpenAir(n)) continue;
            const flow = (t.smoke - n.smoke) * SMOKE.diffusion;
            d[f][y][x] -= flow;
            d[f][y + dy][x + dx] += flow;
          }
          if (f + 1 < F) {
            const above = floors[f + 1][y][x];
            if (isShaft(t, above) && t.smoke > above.smoke) {
              const flow = (t.smoke - above.smoke) * (above.kind === 'vent' ? SMOKE.ventRise : SMOKE.rise);
              d[f][y][x] -= flow;
              d[f + 1][y][x] += flow;
            }
          }
        }
      }
    }

    for (let f = 0; f < F; f++) {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const t = floors[f][y][x];
          if (isOutside(t)) {
            t.smoke = 0;
            continue;
          }
          let s = (t.smoke + d[f][y][x]) * SMOKE.decay;
          if (t.kind === 'window' && t.open) s *= SMOKE.windowVent;
          t.smoke = isOpenAir(t) ? clamp(s, 0, 100) : 0;
        }
      }
    }

    // Vertical ventilation: a hole in the roof draws smoke and heat out of the whole space under it.
    const kept = new Map<string, number>();
    for (let f = 1; f < F; f++) {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const below = floors[f - 1][y][x];
          if (floors[f][y][x].kind !== 'vent' || !isOpenAir(below) || isOutside(below)) continue;
          for (const k of connectedSpace(floors, f - 1, x, y)) {
            kept.set(k, (kept.get(k) ?? 1) * (1 - SMOKE.roofVentDraw));
          }
        }
      }
    }
    for (const [k, factor] of kept) {
      const [f, x, y] = k.split(',').map(Number);
      const t = floors[f][y][x];
      t.smoke *= Math.max(SMOKE.minVentKept, factor);
      t.temperature = AMBIENT + (t.temperature - AMBIENT) * (1 - SMOKE.roofVentHeatDraw);
    }
  },
};

/** Interior open space connected to (x, y) on one floor. */
function connectedSpace(floors: Tile[][][], f: number, x: number, y: number): string[] {
  const seen = new Set([posKey({ floor: f, x, y })]);
  const queue = [[x, y]];
  while (queue.length) {
    const [cx, cy] = queue.pop()!;
    for (const [dx, dy] of DIRS) {
      const n = floors[f][cy + dy]?.[cx + dx];
      const k = posKey({ floor: f, x: cx + dx, y: cy + dy });
      if (!n || seen.has(k) || !isOpenAir(n) || isOutside(n)) continue;
      seen.add(k);
      queue.push([cx + dx, cy + dy]);
    }
  }
  return [...seen];
}
