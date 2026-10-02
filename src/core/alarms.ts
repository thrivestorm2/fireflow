import { createFirefighter, crewRank, TRUCK_SPECS } from './building';
import type { GameState, Truck, TruckType } from './types';

/**
 * Striking another alarm calls in more companies. The trucks dispatched with
 * the call are the 1st alarm. Each further alarm brings `engines` engines and
 * `ladders` ladder trucks from further away, one turn apart: the first is due
 * `delay` turns after it's struck, plus `perLevel` more for every alarm beyond
 * the 2nd, and never before every truck already on its way.
 */
export const ALARM = { maxLevel: 5, engines: 2, ladders: 1, delay: 4, perLevel: 2, crew: { engine: 3, ladder: 2 } } as const;

/** Surnames for the crews of companies called in by later alarms. */
const NAMES = [
  'Ibarra', 'Jensen', 'Kowalski', 'Lopez', 'Morgan', 'Nakamura', 'Okafor', 'Patel', 'Quinn', 'Reyes', 'Santos',
  'Turner', 'Usman', 'Vega', 'Walsh', 'Xu', 'Young', 'Zimmer', 'Abbott', 'Baker', 'Castillo', 'Dunn', 'Ellis',
  'Fischer', 'Grant', 'Hughes', 'Iverson', 'Jordan', 'Kim', 'Larsen', 'Moreno', 'Novak', 'Ortiz', 'Price',
];

export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${s}`;
}

/** The companies the next alarm would send, without changing the state. */
export function nextAlarm(state: GameState): { level: number; trucks: { name: string; type: TruckType; arrivalTurn: number }[] } {
  const level = state.alarm + 1;
  const number = (type: TruckType) =>
    Math.max(0, ...state.trucks.filter((t) => t.type === type).map((t) => Number(t.name.match(/\d+/)?.[0] ?? 0)));
  const types: TruckType[] = [...Array<TruckType>(ALARM.engines).fill('engine'), ...Array<TruckType>(ALARM.ladders).fill('ladder')];
  const used: Record<TruckType, number> = { engine: number('engine'), ladder: number('ladder') };
  const lastDue = Math.max(state.turn, ...state.trucks.map((t) => t.arrivalTurn));
  const first = Math.max(state.turn + ALARM.delay + ALARM.perLevel * (level - 2), lastDue + 1);
  const trucks = types.map((type, i) => {
    used[type] += 1;
    return { name: `${type === 'engine' ? 'Engine' : 'Ladder'} ${used[type]}`, type, arrivalTurn: first + i };
  });
  return { level, trucks };
}

/** Strikes the next alarm: its trucks and crews are dispatched. Mutates `state`. */
export function strikeAlarm(state: GameState): Truck[] {
  const { level, trucks } = nextAlarm(state);
  state.alarm = level;
  const added: Truck[] = [];
  let ff = state.units.filter((u) => u.kind === 'firefighter').length;
  for (const d of trucks) {
    const spec = TRUCK_SPECS[d.type];
    const truck: Truck = {
      id: `truck${state.trucks.length + 1}`,
      name: d.name,
      type: d.type,
      arrivalTurn: d.arrivalTurn,
      status: 'enroute',
      orientation: 'h',
      reversed: false,
      water: spec.water,
      maxWater: spec.water,
      hose: spec.hose,
      fans: spec.fans,
    };
    state.trucks.push(truck);
    added.push(truck);
    for (let j = 0; j < ALARM.crew[d.type]; j++) {
      ff++;
      state.units.push(createFirefighter(`ff${ff}`, NAMES[(ff - 1) % NAMES.length], d.type, truck.id, undefined, crewRank(j)));
    }
  }
  return added;
}
