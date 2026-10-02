import { describe, expect, it } from 'vitest';
import { buildState } from '../src/core/building';
import { FIRE, fireSystem } from '../src/core/fire';
import { smokeSystem } from '../src/core/smoke';
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

describe('compartment fire behaviour', () => {
  const sofas = ['', ' sssss'];
  const sealed = () => room([{ x: 1, y: 1, intensity: 2 }], ['#######', '#,,,,,#', '#######'], sofas);
  const withWindow = () => room([{ x: 1, y: 1, intensity: 2 }], ['.......', '#,,,,,#', '###W###', '.......'], sofas);

  it('a fire starved of air can’t grow past the ventilation limit', () => {
    let s = sealed();
    for (let i = 0; i < 8; i++) {
      s = endTurn(s, [fireSystem]);
      for (const t of s.floors[0][1]) expect(t.fire).toBeLessThanOrEqual(FIRE.ventLimitedMax);
    }
  });

  it('flashover lights the whole room at once, but only if the fire can get air', () => {
    const heat = (s: ReturnType<typeof room>) => {
      for (const t of s.floors[0][1]) if (t.kind === 'floor') t.temperature = 900;
      return s;
    };
    const open = withWindow();
    open.floors[0][2][3].open = true;
    const lit = endTurn(heat(open), [fireSystem]);
    expect(lit.floors[0][1].filter((t) => t.kind === 'floor' && t.fire > 0)).toHaveLength(5);
    expect(lit.log.some((l) => /Flashover/.test(l.text))).toBe(true);

    const shut = endTurn(heat(sealed()), [fireSystem]);
    expect(shut.log.some((l) => /Flashover/.test(l.text))).toBe(false);
  });

  it('an open door to the outside feeds the fire like an open window', () => {
    let s = room([{ x: 1, y: 1, intensity: 2 }], ['.......', '#,,,,,#', '###d###', '.......'], sofas);
    for (let i = 0; i < 10; i++) s = endTurn(s, [fireSystem]);
    expect(s.log.some((l) => /Flashover/.test(l.text)) || s.floors[0][1].some((t) => t.fire === 3)).toBe(true);
  });

  /** Fire room on the left, a room on the right behind a door (open or closed). */
  const twoRooms = (door: 'D' | 'd') => room([{ x: 1, y: 1, intensity: 2 }], ['#########', `#,,,${door},,,#`, '#########']);
  const smokeAfter = (s: ReturnType<typeof room>, turns: number) => {
    for (let i = 0; i < turns; i++) s = endTurn(s, [smokeSystem]);
    return s.floors[0][1][7].smoke;
  };

  it('smoke leaks around a closed door, but far less than through an open one', () => {
    const closed = smokeAfter(twoRooms('D'), 4);
    const open = smokeAfter(twoRooms('d'), 4);
    expect(closed).toBeGreaterThan(0);
    expect(open).toBeGreaterThan(closed * 2);
  });

  it('smoke rises up an open stairwell and fills the floor above first', () => {
    let s = buildState(
      miniScenario(
        [
          ['#######', '#S,,,,#', '#######'],
          ['#######', '#S,,,,#', '#######'],
        ],
        { fires: [{ pos: { floor: 0, x: 5, y: 1 }, intensity: 2 }] },
      ),
    );
    for (let i = 0; i < 6; i++) s = endTurn(s, [smokeSystem]);
    const avg = (f: number) => s.floors[f][1].slice(1, 6).reduce((n, t) => n + t.smoke, 0) / 5;
    expect(avg(1)).toBeGreaterThan(avg(0));
  });
});
