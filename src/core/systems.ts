import type { Rng } from './rng';
import type { GameState, LogEntry } from './types';

export interface SimContext {
  state: GameState;
  rng: Rng;
  log: (text: string, tone?: LogEntry['tone']) => void;
}

/**
 * One step of the environment simulation, run once per turn in order.
 * Fire is the first emergency; floods, gas leaks, earthquakes etc. can be
 * added later as further systems without touching the player rules.
 */
export interface SimSystem {
  name: string;
  step(ctx: SimContext): void;
}
