import { posKey, samePos } from './grid';
import type { SimSystem } from './systems';
import type { GameState, HoseLine, HoseSize, Hydrant, HydrantState, LogEntry, Pos, Truck, Unit } from './types';

/**
 * What each hose does. Attack lines: 1¾″ is light and quick; 2½″ moves more
 * water, hits harder, cools the room faster and reaches further, but uses
 * twice the water and is slow to advance.
 */
export const HOSE_SIZES: Record<HoseSize, { label: string; water: number; knockdown: number; cooling: number; splashCooling: number; range: number; advanceExtra: number }> = {
  '1.75': { label: '1¾″', water: 1, knockdown: 2, cooling: 320, splashCooling: 80, range: 3, advanceExtra: 0 },
  '2.5': { label: '2½″', water: 2, knockdown: 3, cooling: 480, splashCooling: 180, range: 4, advanceExtra: 1 },
  '5': { label: '5″ LDH', water: 0, knockdown: 0, cooling: 0, splashCooling: 0, range: 0, advanceExtra: 0 },
};

/** Attack line sizes on each side of an engine: one of each. */
export const ATTACK_SIZES: HoseSize[] = ['1.75', '2.5'];

export const HOSE = {
  /** Supply lines (to a hydrant) per engine. Attack lines are limited by the couplings: one of each size per side. */
  maxSupplyLines: 1,
  /** Water units a flowing hydrant adds to its engine's tank each turn. */
  hydrantRefill: 8,
} as const;

/**
 * AP of crew work to hook up a hydrant: take the cap off, couple the 5" supply
 * line, open the hydrant. One click starts the job; the firefighter keeps at
 * it on following turns until it is done.
 */
export const HYDRANT_WORK = { cap: 1, couple: 2, open: 2 } as const;
export const HYDRANT_TOTAL = HYDRANT_WORK.cap + HYDRANT_WORK.couple + HYDRANT_WORK.open;

export const HYDRANT_LABEL: Record<HydrantState, string> = {
  capped: 'capped',
  uncapped: 'cap off',
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

type Log = (text: string, tone?: LogEntry['tone']) => void;

/** The supply line a firefighter is holding, if any. */
export function heldSupply(state: GameState, u: Unit): HoseLine | undefined {
  return state.hoses.find((l) => l.id === u.line && l.kind === 'supply');
}

/**
 * How much hookup work `u` can do on `h` now, or why none. Without a supply
 * line in hand only the cap can come off.
 */
export function hydrantWorkAvailable(state: GameState, u: Unit, h: Hydrant): number | string {
  if (h.state === 'opening') return 'The hydrant is opening — water arrives next turn';
  if (h.state === 'flowing') return 'The hydrant is already flowing';
  const line = heldSupply(state, u);
  if (line && h.state !== 'connected') {
    const truck = state.trucks.find((t) => t.id === line.truckId)!;
    if (hoseLeft(state, truck) < 1) return 'Not enough hose to reach the hydrant';
  }
  const left = HYDRANT_TOTAL - h.work;
  if (h.state === 'connected' || line) return left;
  const capLeft = Math.max(0, HYDRANT_WORK.cap - h.work);
  return capLeft > 0 ? capLeft : 'Bring a supply line from an engine to couple';
}

/** Puts up to `ap` of work into the hydrant, advancing its state. Returns the AP actually spent. */
export function workHydrant(state: GameState, u: Unit, h: Hydrant, ap: number, log: Log): number {
  let spent = 0;
  while (spent < ap && h.state !== 'opening' && h.state !== 'flowing') {
    const line = heldSupply(state, u);
    if (h.state === 'uncapped' && !line) break;
    h.work += 1;
    spent += 1;
    if (h.state === 'capped' && h.work >= HYDRANT_WORK.cap) {
      h.state = 'uncapped';
      log(`${u.name} takes the cap off the hydrant.`);
    } else if (h.state === 'uncapped' && h.work >= HYDRANT_WORK.cap + HYDRANT_WORK.couple) {
      line!.tiles = extendLine(line!.tiles, [{ ...h.pos }]);
      line!.hydrant = { ...h.pos };
      line!.holder = undefined;
      u.line = undefined;
      h.state = 'connected';
      h.lineId = line!.id;
      log(`${u.name} couples the 5" supply line to the hydrant.`);
    } else if (h.state === 'connected' && h.work >= HYDRANT_TOTAL) {
      h.state = 'opening';
      log(`${u.name} opens the hydrant. Water will reach the engine next turn.`, 'good');
    }
  }
  return spent;
}

/** Firefighters partway through hooking up a hydrant carry on with their remaining AP. */
export function continueHydrantWork(state: GameState, log: Log): void {
  for (const u of state.units) {
    if (!u.task) continue;
    const h = hydrantAt(state, u.task);
    const work = h && u.status === 'active' ? hydrantWorkAvailable(state, u, h) : 'gone';
    if (!h || typeof work === 'string' || Math.abs(h.pos.x - u.pos.x) + Math.abs(h.pos.y - u.pos.y) !== 1 || h.pos.floor !== u.pos.floor) {
      u.task = undefined;
      continue;
    }
    u.ap -= workHydrant(state, u, h, Math.min(u.ap, work), log);
    const more = hydrantWorkAvailable(state, u, h);
    if (typeof more === 'string' || more === 0) u.task = undefined;
  }
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
