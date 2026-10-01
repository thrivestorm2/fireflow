import { MATERIALS } from './materials';
import type { GameState, Material, Pos, Tile, TileKind, Unit } from './types';

/**
 * Floor-plan legend used by scenarios:
 *   .  ground (outside, street level)     ' ' air (outside, upper floors)
 *   #  brick exterior wall                 w  drywall interior wall
 *   W  window (closed)                     D  door (closed)    d  door (open)
 *   _  wood floor   ,  carpet   t  tile    f  furniture        S  stairs
 *   E  fire engine (ground tile where firefighters refill water)
 */
const LEGEND: Record<string, { kind: TileKind; material: Material; open?: boolean; engine?: boolean }> = {
  '.': { kind: 'ground', material: 'earth' },
  ' ': { kind: 'air', material: 'none' },
  '#': { kind: 'wall', material: 'brick' },
  w: { kind: 'wall', material: 'drywall' },
  W: { kind: 'window', material: 'glass' },
  D: { kind: 'door', material: 'wood' },
  d: { kind: 'door', material: 'wood', open: true },
  _: { kind: 'floor', material: 'wood' },
  ',': { kind: 'floor', material: 'carpet' },
  t: { kind: 'floor', material: 'tile' },
  f: { kind: 'floor', material: 'furniture' },
  S: { kind: 'stairs', material: 'wood' },
  E: { kind: 'ground', material: 'earth', engine: true },
};

export function makeTile(kind: TileKind, material: Material, extra: Partial<Tile> = {}): Tile {
  return {
    kind,
    material,
    fuel: MATERIALS[material].fuel,
    heat: 0,
    fire: 0,
    smoke: 0,
    integrity: 100,
    wet: 0,
    open: false,
    broken: false,
    burnt: false,
    engine: false,
    ...extra,
  };
}

export function parseFloor(rows: string[], width: number): Tile[][] {
  return rows.map((row, y) => {
    if (row.length !== width) {
      throw new Error(`Floor row ${y} has length ${row.length}, expected ${width}: "${row}"`);
    }
    return [...row].map((ch) => {
      const def = LEGEND[ch];
      if (!def) throw new Error(`Unknown floor-plan symbol "${ch}" in row ${y}`);
      return makeTile(def.kind, def.material, { open: !!def.open, engine: !!def.engine });
    });
  });
}

export interface Scenario {
  name: string;
  description: string;
  seed: number;
  /** Floor plans, ground floor first. All floors share the same dimensions. */
  floors: string[][];
  fires: { pos: Pos; intensity: number }[];
  civilians: { name: string; pos: Pos }[];
  firefighters: { name: string; pos: Pos }[];
  /** Fire turns simulated before the crew arrives. */
  preburn: number;
}

export function createFirefighter(id: string, name: string, pos: Pos): Unit {
  return { id, name, kind: 'firefighter', pos: { ...pos }, hp: 100, maxHp: 100, ap: 4, maxAp: 4, water: 6, maxWater: 6, status: 'active' };
}

export function createCivilian(id: string, name: string, pos: Pos): Unit {
  return { id, name, kind: 'civilian', pos: { ...pos }, hp: 100, maxHp: 100, ap: 0, maxAp: 0, water: 0, maxWater: 0, status: 'active' };
}

export function buildState(scenario: Scenario): GameState {
  const height = scenario.floors[0].length;
  const width = scenario.floors[0][0].length;
  const floors = scenario.floors.map((rows, f) => {
    if (rows.length !== height) throw new Error(`Floor ${f} has ${rows.length} rows, expected ${height}`);
    return parseFloor(rows, width);
  });

  const state: GameState = {
    scenarioName: scenario.name,
    width,
    height,
    floors,
    units: [
      ...scenario.firefighters.map((u, i) => createFirefighter(`ff${i + 1}`, u.name, u.pos)),
      ...scenario.civilians.map((u, i) => createCivilian(`cv${i + 1}`, u.name, u.pos)),
    ],
    turn: 1,
    status: 'playing',
    rngState: scenario.seed,
    log: [],
  };

  for (const { pos, intensity } of scenario.fires) {
    const t = floors[pos.floor][pos.y][pos.x];
    t.fire = intensity;
    t.heat = 30 + intensity * 20;
  }
  return state;
}
