/**
 * Core data model. The building is a stack of floors; each floor is a grid of
 * equally sized square tiles. Index order is floors[floor][y][x].
 */

export type TileKind =
  | 'ground' // outside, at street level (walkable, safe zone)
  | 'air' // outside, above street level (not walkable, vents smoke/heat)
  | 'floor'
  | 'wall'
  | 'door'
  | 'window'
  | 'stairs'
  | 'hole' // a floor that has collapsed
  | 'rubble'; // a wall/door that has collapsed or been breached

export type Material =
  | 'none'
  | 'earth'
  | 'brick'
  | 'drywall'
  | 'wood'
  | 'carpet'
  | 'tile'
  | 'furniture'
  | 'glass';

export interface Tile {
  kind: TileKind;
  material: Material;
  /** Remaining combustible mass. 0 means nothing left to burn. */
  fuel: number;
  /** Temperature, 0..100. Ignition happens when heat passes the material's threshold. */
  heat: number;
  /** Fire intensity: 0 none, 1 smouldering, 2 burning, 3 fully involved. */
  fire: number;
  /** Smoke density, 0..100. */
  smoke: number;
  /** Structural integrity, 0..100. Reaching 0 collapses the tile. */
  integrity: number;
  /** Turns of remaining wetness. Wet tiles resist heat and cannot ignite. */
  wet: number;
  /** Doors and windows: open or closed. */
  open: boolean;
  /** Windows that shattered (or were broken) cannot be closed again. */
  broken: boolean;
  /** True once a tile has burned out. */
  burnt: boolean;
  /** Fire engine: firefighters adjacent to it can refill water. */
  engine: boolean;
}

export interface Pos {
  floor: number;
  x: number;
  y: number;
}

export type UnitKind = 'firefighter' | 'civilian';
export type UnitStatus = 'active' | 'down' | 'rescued' | 'dead';

export interface Unit {
  id: string;
  name: string;
  kind: UnitKind;
  pos: Pos;
  hp: number;
  maxHp: number;
  ap: number;
  maxAp: number;
  water: number;
  maxWater: number;
  status: UnitStatus;
  /** Firefighter: id of the civilian being carried. */
  carrying?: string;
  /** Civilian: id of the firefighter carrying them. */
  carriedBy?: string;
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
  turn: number;
  status: GameStatus;
  /** Seeded RNG state, so a game is fully reproducible from its seed and actions. */
  rngState: number;
  log: LogEntry[];
}
