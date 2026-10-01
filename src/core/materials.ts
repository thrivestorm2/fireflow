import type { Material } from './types';

export interface MaterialProps {
  label: string;
  /** Heat at which the material can ignite. Infinity = non-combustible. */
  ignition: number;
  /** Starting fuel. */
  fuel: number;
  /** Integrity lost per turn per point of fire intensity. */
  burnDamage: number;
}

export const MATERIALS: Record<Material, MaterialProps> = {
  none: { label: 'Nothing', ignition: Infinity, fuel: 0, burnDamage: 0 },
  earth: { label: 'Earth', ignition: Infinity, fuel: 0, burnDamage: 0 },
  brick: { label: 'Brick', ignition: Infinity, fuel: 0, burnDamage: 0 },
  glass: { label: 'Glass', ignition: Infinity, fuel: 0, burnDamage: 0 },
  drywall: { label: 'Drywall', ignition: 70, fuel: 6, burnDamage: 9 },
  wood: { label: 'Wood', ignition: 50, fuel: 12, burnDamage: 5 },
  carpet: { label: 'Carpet', ignition: 40, fuel: 8, burnDamage: 4 },
  tile: { label: 'Tile', ignition: 60, fuel: 4, burnDamage: 3 },
  furniture: { label: 'Furniture', ignition: 35, fuel: 20, burnDamage: 4 },
};
