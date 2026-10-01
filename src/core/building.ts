import { AMBIENT, CONTENTS, MATERIALS } from './materials';
import type { Contents, CrewRole, GameState, Material, Pos, Tile, TileKind, Truck, TruckType, Unit } from './types';

/**
 * Plan legend — what each tile is and what it is made of:
 *   ' ' open air (upper floors)   .  grass        -  sidewalk (concrete)
 *   =  road (asphalt, drivable)   :  driveway (concrete, drivable)
 *   #  brick wall                 w  drywall wall
 *   W  window (closed)            D  door (closed)   d  door (open)
 *   _  wood floor   ,  carpet   t  ceramic tile   c  concrete floor   S  stairs
 */
const PLAN: Record<string, { kind: TileKind; material: Material; open?: boolean; drivable?: boolean }> = {
  ' ': { kind: 'air', material: 'air' },
  '.': { kind: 'ground', material: 'grass' },
  '-': { kind: 'ground', material: 'concrete' },
  '=': { kind: 'ground', material: 'asphalt', drivable: true },
  ':': { kind: 'ground', material: 'concrete', drivable: true },
  '#': { kind: 'wall', material: 'brick' },
  w: { kind: 'wall', material: 'drywall' },
  W: { kind: 'window', material: 'glass' },
  D: { kind: 'door', material: 'wood' },
  d: { kind: 'door', material: 'wood', open: true },
  _: { kind: 'floor', material: 'wood' },
  ',': { kind: 'floor', material: 'carpet' },
  t: { kind: 'floor', material: 'ceramic' },
  c: { kind: 'floor', material: 'concrete' },
  S: { kind: 'stairs', material: 'wood' },
};

/**
 * Contents legend — what sits on the tile (any other character means nothing):
 *   s sofa   b bed   k table   c cabinets   o stove   h bookshelf
 *   p plant  T tree  H fire hydrant
 */
const CONTENTS_KEY: Record<string, Contents> = {
  s: 'sofa',
  b: 'bed',
  k: 'table',
  c: 'cabinet',
  o: 'stove',
  h: 'bookshelf',
  p: 'plant',
  T: 'tree',
  H: 'hydrant',
};

export function makeTile(kind: TileKind, material: Material, contents: Contents = 'none', extra: Partial<Tile> = {}): Tile {
  return {
    kind,
    material,
    contents,
    temperature: AMBIENT,
    fire: 0,
    smoke: 0,
    wet: 0,
    integrity: 100,
    burnt: false,
    fuel: MATERIALS[material].fuel + CONTENTS[contents].fuel,
    open: false,
    broken: false,
    drivable: false,
    ladder: false,
    ...extra,
  };
}

export interface FloorPlan {
  plan: string[];
  /** Optional overlay of the same size; rows may be shorter than the plan. */
  contents?: string[];
}

export function parseFloor(floor: FloorPlan, width: number): Tile[][] {
  return floor.plan.map((row, y) => {
    if (row.length !== width) {
      throw new Error(`Floor row ${y} has length ${row.length}, expected ${width}: "${row}"`);
    }
    return [...row].map((ch, x) => {
      const def = PLAN[ch];
      if (!def) throw new Error(`Unknown plan symbol "${ch}" at ${x},${y}`);
      const contents = CONTENTS_KEY[floor.contents?.[y]?.[x] ?? ''] ?? 'none';
      return makeTile(def.kind, def.material, contents, { open: !!def.open, drivable: !!def.drivable });
    });
  });
}

export interface Dispatch {
  name: string;
  type: TruckType;
  arrivalTurn: number;
  crew: string[];
}

export interface Scenario {
  name: string;
  description: string;
  seed: number;
  /** Floor plans, ground floor first. All floors share the same dimensions. */
  floors: FloorPlan[];
  fires: { pos: Pos; intensity: number }[];
  civilians: { name: string; pos: Pos }[];
  /** Trucks responding, with their crews. They arrive over several turns. */
  dispatch: Dispatch[];
  /** Fire turns simulated before the first truck arrives. */
  preburn: number;
}

export const CREW_STATS: Record<CrewRole, { ap: number; water: number }> = {
  /** Hose crews carry water. */
  engine: { ap: 4, water: 6 },
  /** Search & rescue crews move faster and carry ladders, but no hose. */
  ladder: { ap: 5, water: 0 },
};

export const TRUCK_WATER: Record<TruckType, number> = { engine: 24, ladder: 0 };

export function createFirefighter(id: string, name: string, role: CrewRole, truck?: string, pos: Pos = { floor: 0, x: 0, y: 0 }): Unit {
  const { ap, water } = CREW_STATS[role];
  return { id, name, kind: 'firefighter', role, pos: { ...pos }, hp: 100, maxHp: 100, ap, maxAp: ap, water, maxWater: water, status: 'active', truck, aboard: truck };
}

export function createCivilian(id: string, name: string, pos: Pos): Unit {
  return { id, name, kind: 'civilian', pos: { ...pos }, hp: 100, maxHp: 100, ap: 0, maxAp: 0, water: 0, maxWater: 0, status: 'active' };
}

export function buildState(scenario: Scenario): GameState {
  const height = scenario.floors[0].plan.length;
  const width = scenario.floors[0].plan[0].length;
  const floors = scenario.floors.map((fp, f) => {
    if (fp.plan.length !== height) throw new Error(`Floor ${f} has ${fp.plan.length} rows, expected ${height}`);
    return parseFloor(fp, width);
  });

  const trucks: Truck[] = scenario.dispatch.map((d, i) => ({
    id: `truck${i + 1}`,
    name: d.name,
    type: d.type,
    arrivalTurn: d.arrivalTurn,
    status: 'enroute',
    orientation: 'h',
    water: TRUCK_WATER[d.type],
    maxWater: TRUCK_WATER[d.type],
    hydrant: false,
  }));

  let n = 0;
  const units: Unit[] = scenario.dispatch.flatMap((d, i) =>
    d.crew.map((name) => createFirefighter(`ff${++n}`, name, d.type, trucks[i].id)),
  );
  units.push(...scenario.civilians.map((c, i) => createCivilian(`cv${i + 1}`, c.name, c.pos)));

  const state: GameState = {
    scenarioName: scenario.name,
    width,
    height,
    floors,
    units,
    trucks,
    turn: 1,
    status: 'playing',
    rngState: scenario.seed,
    log: [],
  };

  for (const { pos, intensity } of scenario.fires) {
    const t = floors[pos.floor][pos.y][pos.x];
    t.fire = intensity;
    t.temperature = 200 + intensity * 200;
  }
  return state;
}
