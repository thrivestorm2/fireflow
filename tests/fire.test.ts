import { describe, expect, it } from 'vitest';
import { buildState } from '../src/core/building';
import { fireSystem } from '../src/core/fire';
import { endTurn, newGame } from '../src/core/game';
import { houseFire } from '../src/scenarios/house';
import { miniScenario } from './helpers';

const room = (fires: { x: number; y: number; intensity: number }[], plan: string[], contents?: string[]) =>
  buildState(miniScenario([{ plan, contents }], { fires: fires.map(({ x, y, intensity }) => ({ pos: { floor: 0, x, y }, intensity })) }));

function burnTurns(state: ReturnType<typeof buildState>, n: number) {
  let s = state;
  for (let i = 0; i < n; i++) s = endTurn(s, [fireSystem]);
  return s;
}

describe('fire propagation', () => {
  it('spreads to adjacent flammable contents', () => {
    const s = burnTurns(room([{ x: 1, y: 1, intensity: 3 }], ['#####', '#ttt#', '#####'], ['', ' ss']), 4);
    expect(s.floors[0][1][2].fire).toBeGreaterThan(0);
  });

  it('does not burn non-combustible tiles', () => {
    const s = burnTurns(room([{ x: 1, y: 1, intensity: 3 }], ['#####', '#,tt#', '#####']), 6);
    expect(s.floors[0][1][2].fire).toBe(0);
    expect(s.floors[0][1][2].temperature).toBeGreaterThan(100);
  });

  it('is stopped by brick walls', () => {
    const s = burnTurns(room([{ x: 1, y: 1, intensity: 3 }], ['#######', '#,,#,,#', '#######'], ['', ' ss ss']), 15);
    expect(s.floors[0][1][4].fire).toBe(0);
    expect(s.floors[0][1][5].burnt).toBe(false);
  });

  it('burns through drywall eventually', () => {
    const s = burnTurns(
      room([{ x: 1, y: 1, intensity: 3 }, { x: 2, y: 1, intensity: 3 }], ['#######', '#,,w,,#', '#######'], ['', ' ss ss']),
      30,
    );
    const wall = s.floors[0][1][3];
    expect(wall.fire > 0 || wall.burnt).toBe(true);
  });

  it('does not ignite wet tiles', () => {
    let s = room([{ x: 1, y: 1, intensity: 3 }], ['#####', '#,,t#', '#####'], ['', ' ss']);
    s.floors[0][1][2].wet = 100;
    s = burnTurns(s, 5);
    expect(s.floors[0][1][2].fire).toBe(0);
  });

  it('burns out when fuel runs out, destroying the contents', () => {
    const s = burnTurns(room([{ x: 1, y: 1, intensity: 3 }], ['###', '#t#', '###'], ['', ' p']), 20);
    const t = s.floors[0][1][1];
    expect(t.fire).toBe(0);
    expect(t.burnt).toBe(true);
    expect(t.contents).toBe('none');
  });

  it('is deterministic for a given seed', () => {
    const a = burnTurns(newGame(houseFire), 10);
    const b = burnTurns(newGame(houseFire), 10);
    expect(a.floors).toEqual(b.floors);
  });

  it('heats the floor above through the ceiling', () => {
    const s = buildState(miniScenario([['###', '#,#', '###'], ['###', '#,#', '###']], { fires: [{ pos: { floor: 0, x: 1, y: 1 }, intensity: 3 }] }));
    const after = endTurn(s, [fireSystem]);
    expect(after.floors[1][1][1].temperature).toBeGreaterThan(20);
  });

  it('reports temperature in °C, starting at ambient', () => {
    const s = newGame(houseFire);
    expect(s.floors[0][16][0].temperature).toBe(20); // the road
    expect(s.floors[0][3][18].temperature).toBeGreaterThanOrEqual(400); // the burning stove
  });
});
