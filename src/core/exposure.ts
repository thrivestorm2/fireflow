import { tileAt } from './grid';
import type { SimSystem } from './systems';
import type { GameState, Unit } from './types';

/** Firefighters wear turnout gear and breathing apparatus; civilians do not. */
export const EXPOSURE = {
  firefighter: { perFire: 15, heatThreshold: 70, heatFactor: 0.5, smokeThreshold: Infinity, smokeFactor: 0 },
  civilian: { perFire: 30, heatThreshold: 45, heatFactor: 0.5, smokeThreshold: 30, smokeFactor: 0.2 },
} as const;

export function exposureDamage(state: GameState, u: Unit): number {
  const t = tileAt(state, u.pos);
  if (!t) return 0;
  const e = EXPOSURE[u.kind];
  return Math.round(
    t.fire * e.perFire +
      Math.max(0, t.heat - e.heatThreshold) * e.heatFactor +
      Math.max(0, t.smoke - e.smokeThreshold) * e.smokeFactor,
  );
}

/** Heat, flames and smoke hurt anyone still inside. */
export const exposureSystem: SimSystem = {
  name: 'exposure',
  step({ state, log }) {
    for (const u of state.units) {
      if (u.status !== 'active') continue;
      u.hp -= exposureDamage(state, u);
      if (u.hp > 0) continue;
      u.hp = 0;
      if (u.kind === 'firefighter') {
        u.status = 'down';
        log(`${u.name} is down!`, 'bad');
      } else {
        u.status = 'dead';
        log(`${u.name} has succumbed to the fire.`, 'bad');
      }
      releaseCarry(state, u);
    }
  },
};

export function releaseCarry(state: GameState, u: Unit): void {
  const other = state.units.find((o) => o.id === (u.carrying ?? u.carriedBy));
  if (other) {
    other.carrying = undefined;
    other.carriedBy = undefined;
  }
  u.carrying = undefined;
  u.carriedBy = undefined;
}
