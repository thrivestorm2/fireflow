import { AMBIENT } from './materials';
import { DIRS, forEachClosedDoor, isOpenAir, isOutside, isShaft, posKey, spaceMap } from './grid';
import { clamp, ventedTiles } from './fire';
import type { Tile } from './types';
import type { SimSystem } from './systems';

export const SMOKE = {
  perFireLevel: 60,
  /** A fire starved of air burns dirty: more smoke per level. */
  ventLimitedFactor: 1.5,
  /** Hot fuel that isn't burning yet still gives off smoke (pyrolysis). */
  pyrolysisTemp: 250,
  pyrolysis: 10,
  /** Share of the smoke difference across a closed door that leaks around it each turn. */
  doorLeak: 0.25,
  /** Smoke spreads across a room's ceiling in seconds: each turn every tile moves this far toward its room's average. */
  roomMix: 0.6,
  /**
   * Smoke rising through a stairwell into the space above, per turn, as a share of the
   * lower space's smoke. Buoyant smoke keeps rising until the upper space holds
   * `stairBias` times the concentration below: upstairs fills first.
   */
  stairMix: 0.5,
  stairBias: 2,
  /** Smoke flowing out through an open doorway into the next room, per turn, as a share of the difference. */
  doorwayMix: 0.3,
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
  /** Share kept each turn indoors: a closed-up house holds its smoke. */
  decay: 0.99,
} as const;

/** Smoke is produced by fire, spreads through open space, rises up shafts and vents outside. */
export const smokeSystem: SimSystem = {
  name: 'smoke',
  step({ state }) {
    const { floors, width: W, height: H } = state;
    const F = floors.length;
    const d = floors.map(() => Array.from({ length: H }, () => new Array<number>(W).fill(0)));
    const map = spaceMap(floors);
    const vented = ventedTiles(floors, map);

    for (let f = 0; f < F; f++) {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const t = floors[f][y][x];
          if (t.fire > 0) {
            const made = t.fire * SMOKE.perFireLevel * (vented[f][y][x] ? 1 : SMOKE.ventLimitedFactor);
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
          } else if (t.fuel > 0 && t.temperature >= SMOKE.pyrolysisTemp && isOpenAir(t)) {
            d[f][y][x] += SMOKE.pyrolysis;
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

    forEachClosedDoor(floors, (f, [ax, ay], [bx, by]) => {
      const flow = (floors[f][ay][ax].smoke - floors[f][by][bx].smoke) * SMOKE.doorLeak;
      d[f][ay][ax] -= flow;
      d[f][by][bx] += flow;
    });

    // Mix within each room before capping, so smoke made at the fire fills the room instead of being lost.
    const level = (i: number) => {
      const { floor: f, tiles } = map.spaces[i];
      return tiles.reduce((n, [x, y]) => n + floors[f][y][x].smoke + d[f][y][x], 0) / tiles.length;
    };
    map.spaces.forEach(({ floor: f, tiles }, i) => {
      const avg = level(i);
      for (const [x, y] of tiles) d[f][y][x] += (avg - floors[f][y][x].smoke - d[f][y][x]) * SMOKE.roomMix;
    });
    // ...then out through open doorways and up the stairs.
    const move = (from: number, to: number, push: number) => {
      if (push <= 0) return;
      const a = map.spaces[from];
      const b = map.spaces[to];
      const amount = push * Math.min(a.tiles.length, b.tiles.length);
      for (const [x, y] of a.tiles) d[a.floor][y][x] -= amount / a.tiles.length;
      for (const [x, y] of b.tiles) d[b.floor][y][x] += amount / b.tiles.length;
    };
    const levels = map.spaces.map((_, i) => level(i));
    for (const [a, b] of map.doorways) {
      move(a, b, SMOKE.doorwayMix * (levels[a] - levels[b]));
      move(b, a, SMOKE.doorwayMix * (levels[b] - levels[a]));
    }
    for (const [lo, hi] of map.shafts) move(lo, hi, SMOKE.stairMix * (levels[lo] - levels[hi] / SMOKE.stairBias));

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
