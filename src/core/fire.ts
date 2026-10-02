import { DIRS, forEachClosedDoor, isOpenAir, isOutside, isShaft, spaceMap, type SpaceMap } from './grid';
import { AMBIENT, ignitionOf } from './materials';
import type { SimSystem } from './systems';
import type { Tile } from './types';

/**
 * Tuning constants for fire behaviour. Temperatures are in °C; a turn is about
 * a minute. Tuned against compartment-fire research on modern furnishings: the
 * room of origin fills with smoke in a minute or two, flashover follows a few
 * minutes after ignition once the hot gas reaches ~550 °C (if the fire can get
 * air), fully developed rooms burn at 900–1000 °C, and smoke works its way
 * through the house, around closed doors and up the stairs, within minutes.
 */
export const FIRE = {
  /** Temperature a burning tile holds itself at, by intensity. */
  flameTemp: [AMBIENT, 500, 750, 950],
  /** Radiant heat pushed into each side neighbour per intensity level. */
  emitSide: 96,
  /** Heat pushed upward per level: through an opening (stairs, hole) or through the ceiling. */
  emitUpOpen: 96,
  emitUpCeiling: 24,
  emitDown: 16,
  /** Hot-gas mixing rate between adjacent open tiles, and the extra rise through openings. */
  convection: 0.2,
  rise: 0.15,
  /** Share of the temperature difference across a closed door that leaks around it each turn. */
  doorLeak: 0.04,
  /** The hot gas layer spreads across a room: each turn every tile moves this far toward its room's average. */
  roomMix: 0.3,
  /** Hot gas rising through a stairwell into the space above, per turn, as a share of the temperature difference. */
  stairMix: 0.15,
  /** Hot gas flowing out through an open doorway into the next room, per turn, as a share of the difference. */
  doorwayMix: 0.15,
  /** A room whose air averages this hot flashes over: everything that can burn in it ignites. Needs air. */
  flashoverTemp: 550,
  flashoverIntensity: 2,
  /** Without any opening to the outside a fire runs short of air and can't grow past this. */
  ventLimitedMax: 2,
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

/** Fresh air reaches the tile: an opening beside it (an open window, or an open door to the outside), or a vent/hole right above it. */
function hasVent(floors: Tile[][][], f: number, x: number, y: number): boolean {
  const above = floors[f + 1]?.[y][x];
  if (above && (above.kind === 'vent' || above.kind === 'hole')) return true;
  return DIRS.some(([dx, dy]) => {
    const n = floors[f][y + dy]?.[x + dx];
    if (!n) return false;
    if (n.kind === 'door' && n.open) return DIRS.some(([ex, ey]) => {
      const o = floors[f][y + dy + ey]?.[x + dx + ex];
      return !!o && isOutside(o);
    });
    return isOutside(n) || n.kind === 'hole' || (n.kind === 'window' && n.open);
  });
}

/** Tiles a fire can draw air to: any tile in a space with an opening to the outside, or with its own opening. */
export function ventedTiles(floors: Tile[][][], map: SpaceMap): boolean[][][] {
  const vented = floors.map((rows, f) => rows.map((row, y) => row.map((_, x) => hasVent(floors, f, x, y))));
  // Air reaches a room through open doorways and stairs from any room that has an opening.
  const open = map.spaces.map(({ floor: f, tiles }) => tiles.some(([x, y]) => vented[f][y][x]));
  for (let grew = true; grew; ) {
    grew = false;
    for (const [a, b] of [...map.doorways, ...map.shafts]) {
      if (open[a] !== open[b]) {
        open[a] = open[b] = true;
        grew = true;
      }
    }
  }
  map.spaces.forEach(({ floor: f, tiles }, i) => {
    if (open[i]) for (const [x, y] of tiles) vented[f][y][x] = true;
  });
  return vented;
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
            dHeat[f + 1][y][x] += t.fire * (isShaft(t, floors[f + 1][y][x]) ? FIRE.emitUpOpen : FIRE.emitUpCeiling);
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
            if (isShaft(a, above) && a.temperature > above.temperature) {
              const flow = (a.temperature - above.temperature) * FIRE.rise;
              dHeat[f][y][x] -= flow;
              dHeat[f + 1][y][x] += flow;
            }
          }
        }
      }
    }
    forEachClosedDoor(floors, (f, [ax, ay], [bx, by]) => {
      const flow = (floors[f][ay][ax].temperature - floors[f][by][bx].temperature) * FIRE.doorLeak;
      dHeat[f][ay][ax] -= flow;
      dHeat[f][by][bx] += flow;
    });

    const map = spaceMap(floors);
    const vented = ventedTiles(floors, map);
    const avgTemp = (i: number) => {
      const { floor: f, tiles } = map.spaces[i];
      return tiles.reduce((n, [x, y]) => n + floors[f][y][x].temperature, 0) / tiles.length;
    };
    map.spaces.forEach(({ floor: f, tiles }, i) => {
      const avg = avgTemp(i);
      for (const [x, y] of tiles) dHeat[f][y][x] += (avg - floors[f][y][x].temperature) * FIRE.roomMix;
    });
    // Hot gas flows out through open doorways, and rises up the stairs (never down them).
    const exchange = (from: number, to: number, rate: number) => {
      const diff = avgTemp(from) - avgTemp(to);
      if (diff <= 0) return;
      const a = map.spaces[from];
      const b = map.spaces[to];
      const amount = rate * diff * Math.min(a.tiles.length, b.tiles.length);
      for (const [x, y] of a.tiles) dHeat[a.floor][y][x] -= amount / a.tiles.length;
      for (const [x, y] of b.tiles) dHeat[b.floor][y][x] += amount / b.tiles.length;
    };
    for (const [a, b] of map.doorways) {
      exchange(a, b, FIRE.doorwayMix);
      exchange(b, a, FIRE.doorwayMix);
    }
    for (const [lo, hi] of map.shafts) exchange(lo, hi, FIRE.stairMix);

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
          } else if (!vented[f][y][x] && t.fire > FIRE.ventLimitedMax) {
            t.fire -= 1; // starved of air
          } else if (t.fire < (vented[f][y][x] ? 3 : FIRE.ventLimitedMax) && t.wet === 0) {
            const vent = hasVent(floors, f, x, y) ? FIRE.ventGrowBonus : 1;
            if (rng.chance(FIRE.growChance * vent)) t.fire += 1;
          }
        }
      }
    }

    // Flashover: a burning room hot enough, with air to feed it, goes up all at once.
    for (const { floor: f, tiles: space } of map.spaces) {
      const tiles = space.map(([x, y]) => floors[f][y][x]);
      if (!tiles.some((t) => t.fire > 0) || !vented[f][space[0][1]][space[0][0]]) continue;
      if (tiles.reduce((n, t) => n + t.temperature, 0) / tiles.length < FIRE.flashoverTemp) continue;
      let lit = 0;
      for (const t of tiles) {
        if (t.fire === 0 && t.fuel > 0 && t.wet === 0) {
          t.fire = FIRE.flashoverIntensity;
          lit++;
        }
      }
      if (lit >= 2) log(`Flashover on ${floorName(f)}! The whole room is burning.`, 'bad');
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
