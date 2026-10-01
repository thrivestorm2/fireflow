import type { Contents, Material } from './types';

export const AMBIENT = 20;

export interface MaterialProps {
  label: string;
  /** Temperature (°C) at which the material can ignite. Infinity = non-combustible. */
  ignition: number;
  /** Starting fuel. */
  fuel: number;
  /** Integrity lost per turn per point of fire intensity. */
  burnDamage: number;
}

export const MATERIALS: Record<Material, MaterialProps> = {
  air: { label: 'Air', ignition: Infinity, fuel: 0, burnDamage: 0 },
  grass: { label: 'Grass', ignition: Infinity, fuel: 0, burnDamage: 0 },
  asphalt: { label: 'Asphalt', ignition: Infinity, fuel: 0, burnDamage: 0 },
  concrete: { label: 'Concrete', ignition: Infinity, fuel: 0, burnDamage: 0 },
  brick: { label: 'Brick', ignition: Infinity, fuel: 0, burnDamage: 0 },
  glass: { label: 'Glass', ignition: Infinity, fuel: 0, burnDamage: 0 },
  ceramic: { label: 'Ceramic tile', ignition: Infinity, fuel: 0, burnDamage: 3 },
  debris: { label: 'Debris', ignition: Infinity, fuel: 0, burnDamage: 0 },
  shingle: { label: 'Shingles over wood decking', ignition: 400, fuel: 8, burnDamage: 6 },
  drywall: { label: 'Drywall', ignition: 580, fuel: 6, burnDamage: 9 },
  wood: { label: 'Wood', ignition: 420, fuel: 12, burnDamage: 5 },
  carpet: { label: 'Carpet over wood', ignition: 340, fuel: 8, burnDamage: 4 },
};

export interface ContentsProps {
  label: string;
  ignition: number;
  fuel: number;
  /** Cannot be walked through. */
  blocks: boolean;
  /** Extra AP to climb over. */
  moveExtra: number;
}

export const CONTENTS: Record<Contents, ContentsProps> = {
  none: { label: 'Empty', ignition: Infinity, fuel: 0, blocks: false, moveExtra: 0 },
  sofa: { label: 'Sofa', ignition: 300, fuel: 16, blocks: false, moveExtra: 1 },
  bed: { label: 'Bed', ignition: 320, fuel: 16, blocks: false, moveExtra: 1 },
  table: { label: 'Table', ignition: 380, fuel: 10, blocks: false, moveExtra: 1 },
  cabinet: { label: 'Cabinets', ignition: 360, fuel: 12, blocks: true, moveExtra: 0 },
  stove: { label: 'Stove (cooking oil)', ignition: 280, fuel: 8, blocks: true, moveExtra: 0 },
  bookshelf: { label: 'Bookshelf', ignition: 320, fuel: 14, blocks: true, moveExtra: 0 },
  plant: { label: 'Plant', ignition: 420, fuel: 3, blocks: false, moveExtra: 0 },
  tree: { label: 'Tree', ignition: 500, fuel: 20, blocks: true, moveExtra: 0 },
  hydrant: { label: 'Fire hydrant', ignition: Infinity, fuel: 0, blocks: true, moveExtra: 0 },
};

/** Ignition point of a tile: whichever of its structure or contents catches first. */
export function ignitionOf(material: Material, contents: Contents): number {
  return Math.min(MATERIALS[material].ignition, CONTENTS[contents].ignition);
}
