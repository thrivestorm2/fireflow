import { DIRS, isOpenAir, isOutside, isShaft, posKey, tileAt } from './grid';
import type { SimSystem } from './systems';
import type { Fan, GameState, Pos } from './types';

export const FAN = {
  /** Smoke kept each fire phase in the fan's flow path, with and without an exhaust opening. */
  smokeKeptWithExhaust: 0.25,
  smokeKeptSealed: 0.85,
  /** Chance per burning tile in the flow path to grow a level: the fan feeds the fire oxygen. */
  fireBoost: 0.7,
  /** Heat driven from burning tiles into their neighbours along the flow. */
  heatPush: 60,
} as const;

/** Whether the opening a fan blows through is open. */
export function fanRunning(state: GameState, fan: Fan): boolean {
  const t = tileAt(state, fan.target);
  return !!t && (t.kind === 'rubble' || ((t.kind === 'door' || t.kind === 'window') && t.open));
}

/**
 * Interior space the fan pressurises: everything connected to its opening
 * through open air on that floor, and up any stairwell from there.
 */
export function fanRegion(state: GameState, fan: Fan): Pos[] {
  if (!fanRunning(state, fan)) return [];
  const seen = new Set<string>([posKey(fan.target)]);
  const out: Pos[] = [fan.target];
  for (let i = 0; i < out.length; i++) {
    const p = out[i];
    const here = tileAt(state, p)!;
    const next: Pos[] = DIRS.map(([dx, dy]) => ({ ...p, x: p.x + dx, y: p.y + dy }));
    const up = { ...p, floor: p.floor + 1 };
    const upTile = tileAt(state, up);
    if (upTile && isShaft(here, upTile) && !isOutside(upTile)) next.push(up);
    for (const n of next) {
      const t = tileAt(state, n);
      if (!t || seen.has(posKey(n)) || !isOpenAir(t) || isOutside(t)) continue;
      seen.add(posKey(n));
      out.push(n);
    }
  }
  return out;
}

/** An opening other than the fan's own where the pushed air (and smoke) can leave. */
export function hasExhaust(state: GameState, fan: Fan, region: Pos[]): boolean {
  return region.some((p) => {
    if (p.floor === fan.target.floor && p.x === fan.target.x && p.y === fan.target.y) return false;
    const above = tileAt(state, { ...p, floor: p.floor + 1 });
    if (above && above.kind === 'vent') return true;
    return DIRS.some(([dx, dy]) => {
      const n = tileAt(state, { ...p, x: p.x + dx, y: p.y + dy });
      return !!n && isOutside(n);
    });
  });
}

/**
 * Positive-pressure ventilation. With an exhaust opening the fan clears smoke
 * fast; without one it only pressurises. Any fire in the flow path gets fed:
 * it grows and is driven into its neighbours, so knock the fire down first.
 */
export const fanSystem: SimSystem = {
  name: 'ventilation',
  step({ state, rng, log }) {
    for (const fan of state.fans) {
      const region = fanRegion(state, fan);
      if (!region.length) continue;
      const kept = hasExhaust(state, fan, region) ? FAN.smokeKeptWithExhaust : FAN.smokeKeptSealed;
      const inRegion = new Set(region.map(posKey));
      let fed = false;
      for (const p of region) {
        const t = tileAt(state, p)!;
        t.smoke *= kept;
        if (t.fire === 0) continue;
        fed = true;
        if (t.fire < 3 && t.fuel > 0 && rng.chance(FAN.fireBoost)) t.fire += 1;
        for (const [dx, dy] of DIRS) {
          const n = { ...p, x: p.x + dx, y: p.y + dy };
          if (inRegion.has(posKey(n))) tileAt(state, n)!.temperature += FAN.heatPush;
        }
      }
      if (fed) log('The fan is feeding the fire — knock it down before ventilating!', 'bad');
    }
  },
};
