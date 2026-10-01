/**
 * Core data model. The site is a stack of floors; each floor is a grid of
 * equally sized square tiles. Index order is floors[floor][y][x]. The ground
 * floor includes the outside: yard, sidewalk, road and hydrants.
 */

/** The structural role of a tile. */
export type TileKind =
  | 'ground' // outside at street level: grass, sidewalk, road, driveway
  | 'air' // outside above street level (open sky)
  | 'floor'
  | 'wall'
  | 'door'
  | 'window'
  | 'stairs'
  | 'hole' // a floor that has collapsed
  | 'rubble' // a wall/door that has collapsed or been breached
  | 'roof' // walkable roof surface over the top floor
  | 'vent'; // a hole cut or burned through the roof, open to the sky

/** What the tile itself is made of. */
export type Material =
  | 'air'
  | 'grass'
  | 'asphalt'
  | 'concrete'
  | 'brick'
  | 'drywall'
  | 'wood'
  | 'carpet'
  | 'ceramic'
  | 'glass'
  | 'shingle'
  | 'debris';

/** What is on the tile. */
export type Contents =
  | 'none'
  | 'sofa'
  | 'bed'
  | 'table'
  | 'cabinet'
  | 'stove'
  | 'bookshelf'
  | 'plant'
  | 'tree'
  | 'hydrant';

export interface Tile {
  kind: TileKind;
  material: Material;
  contents: Contents;
  /** Temperature in °C. Ambient is 20. */
  temperature: number;

  // ---- condition
  /** Fire intensity: 0 none, 1 smouldering, 2 burning, 3 fully involved. */
  fire: number;
  /** Smoke density, 0..100. */
  smoke: number;
  /** Turns of remaining wetness. Wet tiles resist heat and cannot ignite. */
  wet: number;
  /** Structural integrity, 0..100. Reaching 0 collapses the tile. */
  integrity: number;
  /** True once a tile has burned out. */
  burnt: boolean;
  /** Remaining combustible mass (structure + contents). */
  fuel: number;

  // ---- fixtures
  /** Doors and windows: open or closed. */
  open: boolean;
  /** Windows that shattered (or were broken) cannot be closed again. */
  broken: boolean;
  /** Locked doors must be forced open by a ladder crew. */
  locked: boolean;
  /** A firefighter has looked here for victims. */
  searched: boolean;
  /** Trucks can park here (road, driveway). */
  drivable: boolean;
  /** A ground ladder stands here, linking this tile to the same tile on the floor above/below. */
  ladder: boolean;
}

export interface Pos {
  floor: number;
  x: number;
  y: number;
}

export type UnitKind = 'firefighter' | 'civilian';
export type UnitStatus = 'active' | 'down' | 'rescued' | 'dead';
/** Engine crews fight fire with hoses; ladder crews search, rescue and raise ladders. */
export type CrewRole = 'engine' | 'ladder';
/** Position on the crew: lieutenant (officer, front right seat), engineer (driver) or firefighter. */
export type Rank = 'LT' | 'ENG' | 'FF';

export interface Unit {
  id: string;
  name: string;
  kind: UnitKind;
  role?: CrewRole;
  /** Firefighter: position on the crew. */
  rank?: Rank;
  pos: Pos;
  hp: number;
  maxHp: number;
  ap: number;
  maxAp: number;
  status: UnitStatus;
  /** Firefighter: id of the hose line whose nozzle (or open end) they are holding. */
  line?: string;
  /** Firefighter: hydrant they are hooking up; work carries on automatically next turn. */
  task?: Pos;
  /** Firefighter: the truck they came on. */
  truck?: string;
  /** Firefighter still riding their truck. Same id as `truck` while aboard. */
  aboard?: string;
  /** Firefighter: id of the civilian being carried. */
  carrying?: string;
  /** Civilian: id of the firefighter carrying them. */
  carriedBy?: string;
  /** Civilian: located by the crew. Victims are hidden until found. */
  found?: boolean;
}

export type TruckType = 'engine' | 'ladder';
export type TruckStatus = 'enroute' | 'staged' | 'placed';
export type Orientation = 'h' | 'v';

export interface Truck {
  id: string;
  name: string;
  type: TruckType;
  /** Turn on which the truck reaches the scene. */
  arrivalTurn: number;
  status: TruckStatus;
  /** Top-left tile of the truck, on the ground floor. Set once placed. */
  pos?: Pos;
  orientation: Orientation;
  /**
   * Which end is the front (cab). Normally the left (horizontal) or top
   * (vertical) end; reversed puts it at the right or bottom.
   */
  reversed: boolean;
  /** Water in the tank. Arrives full; only refills from a flowing hydrant. */
  water: number;
  maxWater: number;
  /** Tiles of hose carried. Lines stretched from this truck use it up. */
  hose: number;
  /** Ventilation fans still on the truck. */
  fans: number;
}

/** A positive-pressure fan blowing through an opening (door or window) into the building. */
export interface Fan {
  id: string;
  truckId: string;
  /** Where the fan stands. */
  pos: Pos;
  /** The door or window it blows through. */
  target: Pos;
}

export type HoseKind = 'attack' | 'supply';
/** Hose diameter in inches: 1¾″ and 2½″ attack lines, 5″ large-diameter supply hose. */
export type HoseSize = '1.75' | '2.5' | '5';

/** A hose stretched from a truck. `tiles` runs from the truck outwards; the last tile is the open end. */
export interface HoseLine {
  id: string;
  truckId: string;
  kind: HoseKind;
  size: HoseSize;
  /** Attack lines: which long side of the engine they connect to (0 = top/left row, 1 = the other). */
  side?: 0 | 1;
  /** The truck tile the hose is coupled to. */
  origin: Pos;
  tiles: Pos[];
  /** Firefighter holding the open end, if any. */
  holder?: string;
  /** Supply line coupled to this hydrant. */
  hydrant?: Pos;
}

/** capped → (remove cap) → uncapped → (couple hose) → connected → (open) → opening → flowing */
export type HydrantState = 'capped' | 'uncapped' | 'connected' | 'opening' | 'flowing';

export interface Hydrant {
  pos: Pos;
  state: HydrantState;
  lineId?: string;
  /** AP of crew work put into hooking it up so far (see HYDRANT_WORK). */
  work: number;
}

export type GameStatus = 'playing' | 'won' | 'lost';

export interface LogEntry {
  turn: number;
  text: string;
  tone: 'info' | 'good' | 'bad';
}

export interface GameState {
  scenarioName: string;
  width: number;
  height: number;
  floors: Tile[][][];
  units: Unit[];
  trucks: Truck[];
  hoses: HoseLine[];
  hydrants: Hydrant[];
  fans: Fan[];
  /** Counter for hose line and fan ids. */
  nextLineId: number;
  turn: number;
  status: GameStatus;
  /** Seeded RNG state, so a game is fully reproducible from its seed and actions. */
  rngState: number;
  log: LogEntry[];
}
