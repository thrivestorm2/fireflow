import { DIRS, isOpenAir, isOutside } from './grid';
import { clamp } from './fire';
import type { SimSystem } from './systems';

export const SMOKE = {
  perFireLevel: 20,
  diffusion: 0.2,
  rise: 0.35,
  windowVent: 0.5,
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
            const shaft = above.kind === 'hole' || (above.kind === 'stairs' && t.kind === 'stairs');
            if (shaft && t.smoke > above.smoke) {
              const flow = (t.smoke - above.smoke) * SMOKE.rise;
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
  },
};
