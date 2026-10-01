import { posKey, samePos } from './grid';
import type { SimSystem } from './systems';
import type { GameState, HoseLine, Hydrant, HydrantState, Pos, Truck } from './types';

export const HOSE = {
  /** Attack lines (into the fire) and supply lines (to a hydrant) per engine. */
  maxAttackLines: 2,
  maxSupplyLines: 1,
  /** Water units a flowing hydrant adds to its engine's tank each turn. */
  hydrantRefill: 8,
} as const;

/** The crew action that advances a hydrant from each state, and what it costs. */
export const HYDRANT_STEPS: Partial<Record<HydrantState, { label: string; ap: number }>> = {
  capped: { label: 'Remove cap', ap: 1 },
  uncapped: { label: 'Couple supply hose', ap: 2 },
  connected: { label: 'Open hydrant', ap: 2 },
};

export const HYDRANT_LABEL: Record<HydrantState, string> = {
  capped: 'capped',
  uncapped: 'cap off, no hose',
  connected: 'hose coupled, closed',
  opening: 'opening — water arrives next turn',
  flowing: 'flowing',
};

export function hoseUsed(state: GameState, truckId: string): number {
  return state.hoses.filter((l) => l.truckId === truckId).reduce((n, l) => n + l.tiles.length, 0);
}

export function hoseLeft(state: GameState, truck: Truck): number {
  return truck.hose - hoseUsed(state, truck.id);
}

/**
 * The hose follows the holder's path: stepping back onto the previous hose
 * tile takes the hose back in, anything else lays out another tile.
 */
export function extendLine(tiles: Pos[], path: Pos[]): Pos[] {
  const out = tiles.map((p) => ({ ...p }));
  for (const p of path) {
    if (out.length >= 2 && samePos(out[out.length - 2], p)) out.pop();
    else out.push({ ...p });
  }
  return out;
}

export function linesThrough(state: GameState, p: Pos): HoseLine[] {
  const k = posKey(p);
  return state.hoses.filter((l) => l.tiles.some((t) => posKey(t) === k));
}

export function hydrantAt(state: GameState, p: Pos): Hydrant | undefined {
  return state.hydrants.find((h) => samePos(h.pos, p));
}

/** The hydrant (if any) currently supplying this truck. */
export function supplyFor(state: GameState, truck: Truck): Hydrant | undefined {
  return state.hydrants.find((h) => h.lineId && state.hoses.find((l) => l.id === h.lineId)?.truckId === truck.id);
}

/** Opened hydrants charge their supply line; flowing hydrants refill their engine. */
export const waterSystem: SimSystem = {
  name: 'water',
  step({ state, log }) {
    for (const h of state.hydrants) {
      const line = state.hoses.find((l) => l.id === h.lineId);
      const truck = line && state.trucks.find((t) => t.id === line.truckId);
      if (!truck) continue;
      if (h.state === 'opening') {
        h.state = 'flowing';
        log(`Water from the hydrant reaches ${truck.name}.`, 'good');
      }
      if (h.state === 'flowing') truck.water = Math.min(truck.maxWater, truck.water + HOSE.hydrantRefill);
    }
  },
};
