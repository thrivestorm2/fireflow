import { buildState, type Scenario } from './building';
import { exposureSystem } from './exposure';
import { fireSystem } from './fire';
import { forEachTile } from './grid';
import { continueHydrantWork, waterSystem } from './hoses';
import { spotVictims } from './search';
import { fanSystem } from './ventilation';
import { Rng } from './rng';
import { smokeSystem } from './smoke';
import { structureSystem } from './structure';
import type { SimContext, SimSystem } from './systems';
import type { GameState, LogEntry } from './types';

/** Environment systems, run in order at the start of every turn. */
export const SYSTEMS: SimSystem[] = [fireSystem, smokeSystem, fanSystem, structureSystem, exposureSystem, waterSystem];

function runEnvironment(state: GameState, systems: SimSystem[] = SYSTEMS): void {
  const rng = new Rng(state.rngState);
  const ctx: SimContext = {
    state,
    rng,
    log: (text: string, tone: LogEntry['tone'] = 'info') => state.log.push({ turn: state.turn, text, tone }),
  };
  for (const s of systems) s.step(ctx);
  state.rngState = rng.state;
}

/** Trucks due this turn reach the scene and wait in staging until the player parks them. */
function arriveTrucks(state: GameState): void {
  for (const t of state.trucks) {
    if (t.status === 'enroute' && t.arrivalTurn <= state.turn) {
      t.status = 'staged';
      state.log.push({ turn: state.turn, text: `${t.name} is on scene — choose where to park it.`, tone: 'good' });
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
  const log = (text: string, tone: LogEntry['tone'] = 'info') => state.log.push({ turn: state.turn, text, tone });
  for (const u of state.units) if (u.status === 'active') u.ap = u.maxAp;
  continueHydrantWork(state, log);
  spotVictims(state, log);
  evaluate(state);
  return state;
}

export interface Summary {
  burning: number;
  rescued: number;
  dead: number;
  inside: number;
  /** Victims still inside that nobody has found yet. */
  missing: number;
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
  const civ = state.units.filter((u) => u.kind === 'civilian');
  const ff = state.units.filter((u) => u.kind === 'firefighter');
  const rescued = civ.filter((u) => u.status === 'rescued').length;
  const dead = civ.filter((u) => u.status === 'dead').length;
  const firefightersDown = ff.filter((u) => u.status === 'down').length;
  const structureSaved = structural ? Math.round(100 * (1 - lost / structural)) : 100;
  const score = Math.max(0, rescued * 500 - dead * 300 - firefightersDown * 250 + structureSaved * 10 - state.turn * 10);
  return {
    burning,
    rescued,
    dead,
    inside: civ.filter((u) => u.status === 'active').length,
    missing: civ.filter((u) => u.status === 'active' && !u.found).length,
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
    for (const u of state.units) if (u.kind === 'civilian' && u.status === 'active') u.status = 'rescued';
    state.status = 'won';
    state.log.push({ turn: state.turn, text: 'Fire under control! All remaining occupants are evacuated.', tone: 'good' });
  }
}
