import { describe, expect, it } from 'vitest';
import { buildState } from '../src/core/building';
import { endTurn } from '../src/core/game';
import { structureSystem } from '../src/core/structure';
import { miniScenario } from './helpers';

describe('structure', () => {
  it('collapses a burning upper floor and drops occupants to the floor below', () => {
    const s = buildState(
      miniScenario([['#####', '#___#', '#####'], ['#####', '#___#', '#####']], {
        firefighters: [{ name: 'A', pos: { floor: 1, x: 2, y: 1 } }],
      }),
    );
    const t = s.floors[1][1][2];
    t.fire = 3;
    t.integrity = 5;
    const after = endTurn(s, [structureSystem]);
    expect(after.floors[1][1][2].kind).toBe('hole');
    const ff = after.units[0];
    expect(ff.pos.floor).toBe(0);
    expect(ff.hp).toBeLessThan(100);
    // Burning debris lands on the floor below.
    expect(after.floors[0][1][2].fire).toBeGreaterThan(0);
  });

  it('weakens the floor above a fire', () => {
    const s = buildState(miniScenario([['###', '#_#', '###'], ['###', '#_#', '###']], { fires: [{ pos: { floor: 0, x: 1, y: 1 }, intensity: 2 }] }));
    const after = endTurn(s, [structureSystem]);
    expect(after.floors[1][1][1].integrity).toBeLessThan(100);
    // The ground floor sits on a slab and does not lose integrity.
    expect(after.floors[0][1][1].integrity).toBe(100);
  });

  it('turns a burnt-through wall into passable rubble', () => {
    const s = buildState(miniScenario([['#####', '#_w_#', '#####']]));
    const wall = s.floors[0][1][2];
    wall.fire = 2;
    wall.integrity = 1;
    const after = endTurn(s, [structureSystem]);
    expect(after.floors[0][1][2].kind).toBe('rubble');
  });
});
