import { tileAt } from './grid';
import type { SimSystem } from './systems';
import { describe, isOccupant, isPet } from './occupants';
import type { GameState, Unit } from './types';

/**
 * Damage per turn from standing in a tile. Firefighters wear turnout gear and
 * breathing apparatus; civilians do not. Temperatures in °C.
 */
export const EXPOSURE = {
  firefighter: { perFire: 15, heatThreshold: 250, heatFactor: 0.06, smokeThreshold: Infinity, smokeFactor: 0 },
  civilian: { perFire: 30, heatThreshold: 80, heatFactor: 0.15, smokeThreshold: 30, smokeFactor: 0.35 },
  /** Residents and pets worn down to this collapse, unconscious. */
  unconsciousHp: 40,
  /**
   * Collapsed on the floor, below the worst of the smoke layer, they take this
   * share of the smoke and heat damage: time for a rescue. Flames are as bad as ever.
   */
  onTheFloor: 0.5,
} as const;

export function exposureDamage(state: GameState, u: Unit): number {
  const t = tileAt(state, u.pos);
  if (!t || u.aboard) return 0;
  const e = EXPOSURE[u.kind];
  const air = Math.max(0, t.temperature - e.heatThreshold) * e.heatFactor + Math.max(0, t.smoke - e.smokeThreshold) * e.smokeFactor;
  return Math.round(t.fire * e.perFire + air * (u.unconscious && !u.carriedBy ? EXPOSURE.onTheFloor : 1));
}

/** Heat, flames and smoke hurt anyone still inside. */
export const exposureSystem: SimSystem = {
  name: 'exposure',
  step({ state, log }) {
    for (const u of state.units) {
      if (u.status !== 'active') continue;
      u.hp -= exposureDamage(state, u);
      if (u.hp > 0) {
        if (isOccupant(u) && !u.unconscious && u.hp < EXPOSURE.unconsciousHp) {
          u.unconscious = true;
          if (u.found) log(`${describe(u)} has collapsed, unconscious — get them out!`, 'bad');
        }
        continue;
      }
      u.hp = 0;
      if (u.kind === 'firefighter') {
        u.status = 'down';
        log(`${u.name} is down!`, 'bad', u.truck);
      } else {
        u.status = 'dead';
        if (isPet(u)) log(u.found ? `${describe(u)} didn't make it.` : 'A pet trapped inside has died.', 'bad');
        else log(u.found ? `${u.name} has succumbed to the fire.` : 'A missing resident has succumbed to the smoke.', 'bad');
      }
      releaseCarry(state, u);
    }
  },
};

/** Lets go of whoever or whatever the unit is holding. */
export function releaseCarry(state: GameState, u: Unit): void {
  const line = state.hoses.find((l) => l.id === u.line);
  if (line) line.holder = undefined;
  u.line = undefined;
  const other = state.units.find((o) => o.id === (u.carrying ?? u.carriedBy));
  if (other) {
    other.carrying = undefined;
    other.carriedBy = undefined;
  }
  u.carrying = undefined;
  u.carriedBy = undefined;
}
