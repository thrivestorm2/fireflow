import { describe, expect, it } from 'vitest';
import { performAction } from '../src/core/actions';
import { buildState } from '../src/core/building';
import { endTurn, newGame, SCORE, summarize } from '../src/core/game';
import { houseFire } from '../src/scenarios/house';
import { miniScenario, onPump, standAt } from './helpers';

describe('game flow', () => {
  it('builds the house scenario with the outside, trucks and hydrants', () => {
    const s = newGame(houseFire);
    expect(s.floors).toHaveLength(3); // ground, upper floor, roof
    expect(s.trucks.map((t) => t.status)).toEqual(['staged', 'enroute', 'enroute']);
    expect(s.units.filter((u) => u.kind === 'firefighter').every((u) => u.aboard)).toBe(true);
    expect(s.hydrants).toHaveLength(2);
    expect(s.hydrants.every((h) => h.state === 'capped')).toBe(true);
    expect(s.floors[0].flat().some((t) => t.drivable)).toBe(true);
    expect(summarize(s).burning).toBeGreaterThan(0);
  });

  it('trucks arrive staggered according to the dispatch', () => {
    let s = newGame(houseFire);
    s = endTurn(endTurn(s));
    expect(s.turn).toBe(3);
    expect(s.trucks.map((t) => t.status)).toEqual(['staged', 'staged', 'enroute']);
  });

  it('restores AP and advances the turn', () => {
    let s = newGame(houseFire);
    s.units[0].ap = 0;
    s = endTurn(s);
    expect(s.turn).toBe(2);
    expect(s.units[0].ap).toBe(4);
  });

  it('is won when the last fire is put out', () => {
    let s = buildState(
      miniScenario([['......', '.#,,#.', '......', '======', '======']], {
        dispatch: [{ name: 'E', type: 'engine', arrivalTurn: 1, crew: ['A', 'B'] }],
        fires: [{ pos: { floor: 0, x: 3, y: 1 }, intensity: 2 }],
      }),
    );
    Object.assign(s.trucks[0], { status: 'placed', pos: { floor: 0, x: 0, y: 3 } });
    s = onPump(standAt(s, 'ff1', 2, 1), 'ff2');
    s.hoses.push({ id: 'line1', truckId: 'truck1', kind: 'attack', size: '1.75', origin: { floor: 0, x: 0, y: 0 }, tiles: [{ floor: 0, x: 2, y: 1 }], holder: 'ff1' });
    s.units[0].line = 'line1';
    const r = performAction(s, { type: 'spray', unitId: 'ff1', target: { floor: 0, x: 3, y: 1 } });
    expect(r.state.status).toBe('won');
    // Every drop on fire: 2 levels knocked down for 1 unit of water, full efficiency bonus.
    const sum = summarize(r.state);
    expect(sum.waterUsed).toBe(1);
    expect(sum.waterEfficiency).toBe(1);
    expect(sum.breakdown.find(([k]) => k.startsWith('Water'))![1]).toBe(SCORE.waterBonus);
    expect(sum.breakdown.find(([k]) => k.startsWith('Time'))![1]).toBe(-r.state.turn * SCORE.perTurn);
    expect(sum.score).toBe(sum.breakdown.reduce((n, [, v]) => n + v, 0));
  });

  it('water sprayed where there is no fire lowers the efficiency', () => {
    let s = buildState(
      miniScenario([['......', '.#,,,#', '......', '======', '======']], {
        dispatch: [{ name: 'E', type: 'engine', arrivalTurn: 1, crew: ['A', 'B'] }],
        fires: [{ pos: { floor: 0, x: 4, y: 1 }, intensity: 2 }],
      }),
    );
    Object.assign(s.trucks[0], { status: 'placed', pos: { floor: 0, x: 0, y: 3 } });
    s = onPump(standAt(s, 'ff1', 2, 1), 'ff2');
    s.hoses.push({ id: 'line1', truckId: 'truck1', kind: 'attack', size: '1.75', origin: { floor: 0, x: 0, y: 0 }, tiles: [{ floor: 0, x: 2, y: 1 }], holder: 'ff1' });
    s.units[0].line = 'line1';
    s = performAction(s, { type: 'spray', unitId: 'ff1', target: { floor: 0, x: 3, y: 1 } }).state; // a miss
    s = performAction(s, { type: 'spray', unitId: 'ff1', target: { floor: 0, x: 4, y: 1 } }).state;
    expect(summarize(s).waterEfficiency).toBe(0.5);
  });

  it('is lost when every firefighter is down', () => {
    let s = buildState(
      miniScenario([{ plan: ['#####', '#,,,#', '#####'], contents: ['', '  s'] }], {
        dispatch: [{ name: 'E', type: 'engine', arrivalTurn: 1, crew: ['A'] }],
        fires: [{ pos: { floor: 0, x: 2, y: 1 }, intensity: 3 }],
      }),
    );
    s = standAt(s, 'ff1', 2, 1);
    s.units[0].hp = 1;
    expect(endTurn(s).status).toBe('lost');
  });

  it('kills civilians left in smoke and heat', () => {
    let s = newGame(houseFire);
    for (let i = 0; i < 80 && s.status === 'playing'; i++) s = endTurn(s);
    expect(summarize(s).dead).toBeGreaterThan(0);
  });
});
