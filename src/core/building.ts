import { AMBIENT, CONTENTS, MATERIALS } from './materials';
import { Rng } from './rng';
import type { Contents, CrewRole, GameState, Material, Pos, Rank, Tile, TileKind, Truck, TruckType, Unit } from './types';

/**
 * Plan legend — what each tile is and what it is made of:
 *   ' ' open air (upper floors)   .  grass        -  sidewalk (concrete)
 *   =  road (asphalt, drivable)   :  driveway (concrete, drivable)
 *   #  brick wall                 w  drywall wall
 *   W  window (closed)            D  door (closed)   d  door (open)   L  door (locked)
 *   F  reinforced door (locked; only a ladder crew can force it)
 *   _  wood floor   ,  carpet   t  ceramic tile   c  concrete floor   S  stairs
 *   R  roof
 */
const PLAN: Record<string, { kind: TileKind; material: Material; open?: boolean; drivable?: boolean; locked?: boolean; reinforced?: boolean }> = {
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
  L: { kind: 'door', material: 'wood', locked: true },
  F: { kind: 'door', material: 'wood', locked: true, reinforced: true },
  R: { kind: 'roof', material: 'shingle' },
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
    locked: false,
    reinforced: false,
    searched: false,
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
      return makeTile(def.kind, def.material, contents, { open: !!def.open, drivable: !!def.drivable, locked: !!def.locked, reinforced: !!def.reinforced });
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
  /** Start the fire somewhere likely instead (see ORIGIN_WEIGHT), chosen from the seed. */
  randomOrigin?: boolean;
  civilians: { name: string; pos: Pos }[];
  /** Trucks responding, with their crews. They arrive over several turns. */
  dispatch: Dispatch[];
  /** Fire turns simulated before the first truck arrives. */
  preburn: number;
}

/** Engine crews work hoses and hydrants; ladder crews move faster and raise ladders. */
export const CREW_AP: Record<CrewRole, number> = { engine: 4, ladder: 5 };

/** What each truck type brings: size on the grid, water in the tank, tiles of hose. */
export const TRUCK_SPECS: Record<TruckType, { length: number; width: number; water: number; hose: number; fans: number }> = {
  engine: { length: 5, width: 2, water: 20, hose: 28, fans: 0 },
  ladder: { length: 7, width: 2, water: 4, hose: 16, fans: 1 },
};

/** Ranks by place in a dispatch's crew list: the officer first, then the engineer (driver), then firefighters. */
export const crewRank = (i: number): Rank => (i === 0 ? 'LT' : i === 1 ? 'ENG' : 'FF');

/**
 * Where a fire is likely to start: each kind of contents' share of origins,
 * after US home fire cause statistics. Cooking causes about half of all home
 * fires; upholstered furniture, bedding, and electrical and candle fires near
 * shelves and tables make up much of the rest. The share is split between all
 * the tiles of that kind, so ten bed tiles aren't ten times as likely as one.
 */
export const ORIGIN_WEIGHT: Partial<Record<Contents, number>> = { stove: 50, sofa: 15, bed: 12, bookshelf: 8, cabinet: 8, table: 7 };

/** Picks a likely place for the fire to start, away from where anyone is lying. */
function pickOrigin(state: GameState, rng: Rng): Pos | undefined {
  const taken = new Set(state.units.map((u) => `${u.pos.floor},${u.pos.x},${u.pos.y}`));
  const byKind = new Map<Contents, Pos[]>();
  state.floors.forEach((rows, floor) =>
    rows.forEach((row, y) =>
      row.forEach((t, x) => {
        if (!ORIGIN_WEIGHT[t.contents] || taken.has(`${floor},${x},${y}`)) return;
        byKind.set(t.contents, [...(byKind.get(t.contents) ?? []), { floor, x, y }]);
      }),
    ),
  );
  const kinds = [...byKind.keys()];
  let roll = rng.next() * kinds.reduce((n, k) => n + ORIGIN_WEIGHT[k]!, 0);
  const kind = kinds.find((k) => (roll -= ORIGIN_WEIGHT[k]!) < 0) ?? kinds.at(-1);
  const tiles = kind ? byKind.get(kind)! : [];
  return tiles[Math.floor(rng.next() * tiles.length)];
}

export function createFirefighter(
  id: string,
  name: string,
  role: CrewRole,
  truck?: string,
  pos: Pos = { floor: 0, x: 0, y: 0 },
  rank: Rank = 'FF',
): Unit {
  const ap = CREW_AP[role];
  return { id, name, kind: 'firefighter', role, rank, pos: { ...pos }, hp: 100, maxHp: 100, ap, maxAp: ap, status: 'active', truck, aboard: truck };
}

export function createCivilian(id: string, name: string, pos: Pos): Unit {
  return { id, name, kind: 'civilian', pos: { ...pos }, hp: 100, maxHp: 100, ap: 0, maxAp: 0, status: 'active', found: false };
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
    reversed: false,
    water: TRUCK_SPECS[d.type].water,
    maxWater: TRUCK_SPECS[d.type].water,
    hose: TRUCK_SPECS[d.type].hose,
    fans: TRUCK_SPECS[d.type].fans,
  }));

  let n = 0;
  const units: Unit[] = scenario.dispatch.flatMap((d, i) =>
    d.crew.map((name, j) => createFirefighter(`ff${++n}`, name, d.type, trucks[i].id, undefined, crewRank(j))),
  );
  units.push(...scenario.civilians.map((c, i) => createCivilian(`cv${i + 1}`, c.name, c.pos)));

  const state: GameState = {
    scenarioName: scenario.name,
    width,
    height,
    floors,
    units,
    trucks,
    hoses: [],
    hydrants: [],
    fans: [],
    nextLineId: 1,
    alarm: 1,
    turn: 1,
    status: 'playing',
    rngState: scenario.seed,
    log: [],
  };

  floors.forEach((rows, floor) =>
    rows.forEach((row, y) =>
      row.forEach((t, x) => {
        if (t.contents === 'hydrant') state.hydrants.push({ pos: { floor, x, y }, state: 'capped', work: 0 });
      }),
    ),
  );

  for (const { pos, intensity } of scenario.fires) {
    const t = floors[pos.floor][pos.y][pos.x];
    t.fire = intensity;
    t.temperature = 200 + intensity * 200;
  }
  if (scenario.randomOrigin) {
    const rng = new Rng(state.rngState);
    const origin = pickOrigin(state, rng);
    if (origin) {
      Object.assign(floors[origin.floor][origin.y][origin.x], { fire: 2, temperature: 600 });
      // It has usually spread to something next to it by the time anyone calls it in.
      const next = [[1, 0], [-1, 0], [0, 1], [0, -1]]
        .map(([dx, dy]) => floors[origin.floor][origin.y + dy]?.[origin.x + dx])
        .filter((t) => t && t.fuel > 0 && t.fire === 0 && t.kind === 'floor');
      if (next.length) Object.assign(next[Math.floor(rng.next() * next.length)]!, { fire: 1, temperature: 400 });
    }
    state.rngState = rng.state;
  }
  return state;
}
