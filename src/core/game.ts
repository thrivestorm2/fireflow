import { buildState, type Scenario } from './building';
import { exposureSystem } from './exposure';
import { fireSystem } from './fire';
import { forEachTile } from './grid';
import { continueHydrantWork, waterSystem } from './hoses';
import { spotVictims } from './search';
import { fanSystem } from './ventilation';
import { isBystander, isPet, occupantSystem } from './occupants';
import { Rng } from './rng';
import { smokeSystem } from './smoke';
import { structureSystem } from './structure';
import type { SimContext, SimSystem } from './systems';
import type { GameState, LogEntry } from './types';

/** Environment systems, run in order at the start of every turn. */
export const SYSTEMS: SimSystem[] = [fireSystem, smokeSystem, fanSystem, occupantSystem, structureSystem, exposureSystem, waterSystem];

function runEnvironment(state: GameState, systems: SimSystem[] = SYSTEMS): void {
  const rng = new Rng(state.rngState);
  const ctx: SimContext = {
    state,
    rng,
    log: (text: string, tone: LogEntry['tone'] = 'info', truckId?: string) => state.log.push({ turn: state.turn, text, tone, truckId }),
  };
  for (const s of systems) s.step(ctx);
  state.rngState = rng.state;
}

/** Trucks due this turn reach the scene and wait in staging until the player parks them. */
function arriveTrucks(state: GameState): void {
  for (const t of state.trucks) {
    if (t.status === 'enroute' && t.arrivalTurn <= state.turn) {
      t.status = 'staged';
      state.log.push({ turn: state.turn, text: `${t.name} at scene requesting assignment.`, tone: 'good', truckId: t.id });
    }
  }
}

export function newGame(scenario: Scenario): GameState {
  const state = buildState(scenario);
  for (let i = 0; i < scenario.preburn; i++) runEnvironment(state);
  state.log.push({ turn: 1, text: scenario.description, tone: 'info' });
  arriveTrucks(state);
  return state;
}

/**
 * Ends the player phase. The fire phase follows: fire spreads, smoke moves, the
 * structure weakens and people are exposed. Then the next player phase begins:
 * new trucks arrive and every firefighter's AP is restored.
 */
export function endTurn(prev: GameState, systems: SimSystem[] = SYSTEMS): GameState {
  if (prev.status !== 'playing') return prev;
  const state = structuredClone(prev);
  state.turn += 1;
  runEnvironment(state, systems);
  arriveTrucks(state);
  const log = (text: string, tone: LogEntry['tone'] = 'info', truckId?: string) => state.log.push({ turn: state.turn, text, tone, truckId });
  for (const u of state.units) if (u.status === 'active') u.ap = u.maxAp;
  continueHydrantWork(state, log);
  spotVictims(state, log);
  evaluate(state);
  return state;
}

/**
 * Scoring. Water efficiency rewards putting water on fire, not on the building:
 * levels of fire knocked down per unit of water, against the best possible (a
 * 1¾″ line knocks a fire down 2 levels per unit when every drop hits fire).
 */
const LOST = 300;

export const SCORE = {
  rescued: 500,
  lost: LOST,
  petRescued: 150,
  petLost: 50,
  /** A firefighter lost costs twice a lost resident. */
  crewDown: 2 * LOST,
  perStructurePercent: 10,
  perTurn: 50,
  waterBonus: 400,
  bestKnockdownPerWater: 2,
} as const;

export interface Summary {
  burning: number;
  rescued: number;
  dead: number;
  inside: number;
  /** Victims still inside that nobody has found yet. */
  missing: number;
  petsRescued: number;
  petsLost: number;
  /** Water used, and levels of fire knocked down per unit of it, as a share of the best possible (0–1). */
  waterUsed: number;
  waterEfficiency: number;
  /** Where the score came from: label and points, in order. */
  breakdown: [string, number][];
  firefightersUp: number;
  firefightersDown: number;
  /** Percentage of combustible/structural tiles still intact (not burnt or collapsed). */
  structureSaved: number;
  score: number;
}

export function summarize(state: GameState): Summary {
  let burning = 0;
  let structural = 0;
  let lost = 0;
  forEachTile(state, (t) => {
    if (t.fire > 0) burning++;
    if (t.kind === 'ground' || t.kind === 'air') return;
    structural++;
    if (t.burnt || t.kind === 'hole' || t.kind === 'rubble') lost++;
  });
  // Residents count toward rescues and losses; pets count separately; bystanders not at all.
  const civ = state.units.filter((u) => u.kind === 'civilian' && !isPet(u) && !isBystander(u));
  const pets = state.units.filter(isPet);
  const petsRescued = pets.filter((u) => u.status === 'rescued').length;
  const petsLost = pets.filter((u) => u.status === 'dead').length;
  const ff = state.units.filter((u) => u.kind === 'firefighter');
  const rescued = civ.filter((u) => u.status === 'rescued').length;
  const dead = civ.filter((u) => u.status === 'dead').length;
  const firefightersDown = ff.filter((u) => u.status === 'down').length;
  const structureSaved = structural ? Math.round(100 * (1 - lost / structural)) : 100;
  const water = state.water ?? { used: 0, knocked: 0 };
  const waterEfficiency = water.used ? Math.min(1, water.knocked / (water.used * SCORE.bestKnockdownPerWater)) : 0;
  const breakdown: [string, number][] = [
    [`Residents safe (${rescued})`, rescued * SCORE.rescued],
    [`Residents lost (${dead})`, -dead * SCORE.lost],
    [`Pets safe (${petsRescued})`, petsRescued * SCORE.petRescued],
    [`Pets lost (${petsLost})`, -petsLost * SCORE.petLost],
    [`Crew down (${firefightersDown})`, -firefightersDown * SCORE.crewDown],
    [`Structure saved (${structureSaved}%)`, structureSaved * SCORE.perStructurePercent],
    [`Water efficiency (${Math.round(waterEfficiency * 100)}% of ${water.used} units)`, Math.round(waterEfficiency * SCORE.waterBonus)],
    [`Time (${state.turn} turns)`, -state.turn * SCORE.perTurn],
  ];
  const score = Math.max(0, breakdown.reduce((n, [, v]) => n + v, 0));
  return {
    burning,
    rescued,
    dead,
    inside: civ.filter((u) => u.status === 'active').length,
    missing: civ.filter((u) => u.status === 'active' && !u.found).length,
    petsRescued,
    petsLost,
    waterUsed: water.used,
    waterEfficiency,
    breakdown,
    firefightersUp: ff.length - firefightersDown,
    firefightersDown,
    structureSaved,
    score,
  };
}

/** Updates win/loss status. Once the fire is out, civilians still inside are safe to walk out. */
export function evaluate(state: GameState): void {
  const s = summarize(state);
  if (s.firefightersDown > 0 && s.firefightersUp === 0) {
    state.status = 'lost';
    state.log.push({ turn: state.turn, text: 'All firefighters are down. The building is lost.', tone: 'bad' });
    return;
  }
  if (s.burning === 0) {
    for (const u of state.units) if (u.kind === 'civilian' && !isBystander(u) && u.status === 'active') u.status = 'rescued';
    state.status = 'won';
    state.log.push({ turn: state.turn, text: 'Fire under control! All remaining occupants are evacuated.', tone: 'good' });
  }
}
