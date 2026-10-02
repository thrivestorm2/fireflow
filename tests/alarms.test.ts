import { describe, expect, it } from 'vitest';
import { performAction } from '../src/core/actions';
import { ALARM } from '../src/core/alarms';
import { endTurn, newGame } from '../src/core/game';
import { houseFire } from '../src/scenarios/house';
import { run } from './helpers';

describe('alarms', () => {
  it('a game starts at a 1st alarm; striking the 2nd dispatches more companies, further out', () => {
    let s = newGame(houseFire);
    expect(s.alarm).toBe(1);
    const before = s.trucks.length;
    s = run(s, { type: 'alarm' });
    expect(s.alarm).toBe(2);
    const added = s.trucks.slice(before);
    expect(added.map((t) => [t.name, t.type, t.status])).toEqual([
      ['Engine 5', 'engine', 'enroute'],
      ['Engine 6', 'engine', 'enroute'],
      ['Ladder 8', 'ladder', 'enroute'],
    ]);
    expect(added.map((t) => t.arrivalTurn)).toEqual([s.turn + ALARM.delay, s.turn + ALARM.delay + 1, s.turn + ALARM.delay + 2]);
    // Each truck comes with its crew: LT, ENG, then FF.
    const crew = s.units.filter((u) => u.truck === added[0].id);
    expect(crew.map((u) => u.rank)).toEqual(['LT', 'ENG', 'FF']);
    expect(new Set(s.units.map((u) => u.id)).size).toBe(s.units.length);
    expect(s.log.at(-1)!.text).toMatch(/2nd alarm struck: Engine 5, Engine 6 and Ladder 8/);
  });

  it('later alarms come from further away, and they stop at the highest alarm', () => {
    let s = run(newGame(houseFire), { type: 'alarm' });
    s = run(s, { type: 'alarm' });
    expect(s.trucks.filter((t) => t.status === 'enroute').at(-3)!.arrivalTurn).toBe(s.turn + ALARM.delay + 1);
    while (s.alarm < ALARM.maxLevel) s = run(s, { type: 'alarm' });
    expect(performAction(s, { type: 'alarm' }).error).toMatch(/5th alarm/);
  });

  it('called-in trucks arrive on their turn and wait to be parked', () => {
    let s = run(newGame(houseFire), { type: 'alarm' });
    const truck = s.trucks.at(-3)!;
    while (s.turn < truck.arrivalTurn) s = endTurn(s, []);
    expect(s.trucks.find((t) => t.id === truck.id)!.status).toBe('staged');
  });
});

describe('radio log', () => {
  it('credits the truck whose crew acted, and leaves general news uncredited', () => {
    let s = newGame(houseFire);
    const e1 = s.trucks[0];
    expect(s.log.find((l) => /at scene requesting assignment/.test(l.text))!.truckId).toBe(e1.id);
    s = run(s, { type: 'placeTruck', truckId: e1.id, pos: { floor: 0, x: 0, y: 15 }, orientation: 'h' });
    expect(s.log.at(-1)!.truckId).toBe(e1.id);
    s = run(s, { type: 'move', unitId: 'ff1', path: [{ floor: 0, x: 2, y: 14 }] });
    expect(s.log.filter((l) => /gets off/.test(l.text)).at(-1)!.truckId).toBe(e1.id);
    s = run(s, { type: 'alarm' });
    expect(s.log.at(-1)!.truckId).toBeUndefined();
  });
});
