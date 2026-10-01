import type { Scenario } from '../src/core/building';

/** A tiny single-floor (or multi-floor) scenario for focused rule tests. */
export function miniScenario(floors: string[][], extra: Partial<Scenario> = {}): Scenario {
  return { name: 'test', description: 'test', seed: 1, preburn: 0, floors, fires: [], civilians: [], firefighters: [], ...extra };
}
