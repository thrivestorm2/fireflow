import { describe, expect, it } from 'vitest';
import { buildState } from '../src/core/building';
import { endTurn, newGame } from '../src/core/game';
import { fireSystem } from '../src/core/fire';
import { houseFire } from '../src/scenarios/house';
import { miniScenario } from './helpers';

const room = (fires: { x: number; y: number; intensity: number }[], plan: string[]) =>
  buildState(miniScenario([plan], { fires: fires.map(({ x, y, intensity }) => ({ pos: { floor: 0, x, y }, intensity })) }));

function burnTurns(state: ReturnType<typeof buildState>, n: number) {
  let s = state;
  for (let i = 0; i < n; i++) s = endTurn(s, [fireSystem]);
  return s;
}

describe('fire propagation', () => {
  it('spreads to adjacent flammable tiles', () => {
    const s = burnTurns(room([{ x: 1, y: 1, intensity: 3 }], ['#####', '#fff#', '#####']), 4);
    expect(s.floors[0][1][2].fire).toBeGreaterThan(0);
  });

  it('is stopped by brick walls', () => {
    const s = burnTurns(room([{ x: 1, y: 1, intensity: 3 }], ['#######', '#ff#ff#', '#######']), 15);
    expect(s.floors[0][1][4].fire).toBe(0);
    expect(s.floors[0][1][5].burnt).toBe(false);
  });

  it('burns through drywall eventually', () => {
    const s = burnTurns(room([{ x: 1, y: 1, intensity: 3 }, { x: 2, y: 1, intensity: 3 }], ['#######', '#ffwff#', '#######']), 30);
    const wall = s.floors[0][1][3];
    expect(wall.fire > 0 || wall.burnt).toBe(true);
  });

  it('does not ignite wet tiles', () => {
    let s = room([{ x: 1, y: 1, intensity: 3 }], ['#####', '#ff.#', '#####']);
    s.floors[0][1][2].wet = 100;
    s = burnTurns(s, 5);
    expect(s.floors[0][1][2].fire).toBe(0);
  });

  it('burns out when fuel runs out', () => {
    const s = burnTurns(room([{ x: 1, y: 1, intensity: 3 }], ['###', '#t#', '###']), 20);
    expect(s.floors[0][1][1].fire).toBe(0);
    expect(s.floors[0][1][1].burnt).toBe(true);
  });

  it('is deterministic for a given seed', () => {
    const a = burnTurns(newGame(houseFire), 10);
    const b = burnTurns(newGame(houseFire), 10);
    expect(a.floors).toEqual(b.floors);
  });

  it('heats the floor above through the ceiling', () => {
    const s = buildState(miniScenario([['###', '#f#', '###'], ['###', '#f#', '###']], { fires: [{ pos: { floor: 0, x: 1, y: 1 }, intensity: 3 }] }));
    const after = endTurn(s, [fireSystem]);
    expect(after.floors[1][1][1].heat).toBeGreaterThan(0);
  });
});
