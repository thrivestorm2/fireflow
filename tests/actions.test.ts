import { describe, expect, it } from 'vitest';
import { performAction, type Action } from '../src/core/actions';
import { buildState } from '../src/core/building';
import { pathTo } from '../src/core/pathing';
import type { GameState } from '../src/core/types';
import { miniScenario } from './helpers';

function run(s: GameState, ...actions: Action[]): GameState {
  for (const a of actions) {
    const r = performAction(s, a);
    if (r.error) throw new Error(r.error);
    s = r.state;
  }
  return s;
}

const yard = () =>
  buildState(
    miniScenario(
      [
        [
          'E.......',
          '.##D####',
          '.#,,,,f#',
          '.#,,w,,#',
          '.###S###',
        ],
        [
          '        ',
          ' ######W',
          ' #,,,,,#',
          ' #,,,,,#',
          ' ###S###',
        ],
      ],
      {
        firefighters: [{ name: 'A', pos: { floor: 0, x: 3, y: 0 } }],
        civilians: [{ name: 'C', pos: { floor: 0, x: 3, y: 2 } }],
        fires: [{ pos: { floor: 0, x: 6, y: 2 }, intensity: 3 }],
      },
    ),
  );

describe('player actions', () => {
  it('cannot walk through a closed door, but can after opening it', () => {
    let s = yard();
    const step: Action = { type: 'move', unitId: 'ff1', to: { floor: 0, x: 3, y: 1 } };
    expect(performAction(s, step).error).toMatch(/closed/);
    s = run(s, { type: 'toggle', unitId: 'ff1', target: { floor: 0, x: 3, y: 1 } }, step);
    expect(s.units[0].pos).toEqual({ floor: 0, x: 3, y: 1 });
    expect(s.units[0].ap).toBe(2);
  });

  it('does not mutate the previous state', () => {
    const s = yard();
    run(s, { type: 'toggle', unitId: 'ff1', target: { floor: 0, x: 3, y: 1 } });
    expect(s.floors[0][1][3].open).toBe(false);
    expect(s.units[0].ap).toBe(4);
  });

  it('rescues a civilian carried out to the street', () => {
    let s = yard();
    s = run(
      s,
      { type: 'toggle', unitId: 'ff1', target: { floor: 0, x: 3, y: 1 } },
      { type: 'move', unitId: 'ff1', to: { floor: 0, x: 3, y: 1 } },
      { type: 'pickup', unitId: 'ff1', target: { floor: 0, x: 3, y: 2 } },
    );
    expect(s.units[1].carriedBy).toBe('ff1');
    s.units[0].ap = 4;
    s = run(s, { type: 'move', unitId: 'ff1', to: { floor: 0, x: 3, y: 0 } });
    expect(s.units[1].status).toBe('rescued');
    expect(s.units[0].carrying).toBeUndefined();
  });

  it('sprays in straight unobstructed lines within range', () => {
    let s = yard();
    s.units[0].pos = { floor: 0, x: 3, y: 2 };
    expect(performAction(s, { type: 'spray', unitId: 'ff1', target: { floor: 0, x: 6, y: 3 } }).error).toMatch(/straight/);
    s = run(s, { type: 'spray', unitId: 'ff1', target: { floor: 0, x: 6, y: 2 } });
    const t = s.floors[0][2][6];
    expect(t.fire).toBe(1);
    expect(t.wet).toBeGreaterThan(0);
    expect(s.units[0].water).toBe(5);
    s.units[0].pos = { floor: 0, x: 3, y: 3 };
    expect(performAction(s, { type: 'spray', unitId: 'ff1', target: { floor: 0, x: 5, y: 3 } }).error).toMatch(/blocked/);
  });

  it('breaches drywall but not brick', () => {
    let s = yard();
    s.units[0].pos = { floor: 0, x: 3, y: 3 };
    expect(performAction(s, { type: 'breach', unitId: 'ff1', target: { floor: 0, x: 3, y: 4 } }).error).toMatch(/solid/);
    s = run(s, { type: 'breach', unitId: 'ff1', target: { floor: 0, x: 4, y: 3 } });
    expect(s.floors[0][3][4].kind).toBe('rubble');
  });

  it('refills only next to the engine', () => {
    let s = yard();
    s.units[0].water = 0;
    expect(performAction(s, { type: 'refill', unitId: 'ff1' }).error).toMatch(/engine/);
    s.units[0].pos = { floor: 0, x: 1, y: 1 };
    s = run(s, { type: 'refill', unitId: 'ff1' });
    expect(s.units[0].water).toBe(s.units[0].maxWater);
  });

  it('finds paths across floors via the stairs within the AP budget', () => {
    const s = yard();
    s.units[0].pos = { floor: 0, x: 4, y: 3 };
    s.floors[0][3][4] = { ...s.floors[0][2][4] }; // remove the drywall stub
    const path = pathTo(s, s.units[0], { floor: 1, x: 4, y: 3 });
    expect(path).toEqual([
      { floor: 0, x: 4, y: 4 },
      { floor: 1, x: 4, y: 4 },
      { floor: 1, x: 4, y: 3 },
    ]);
    expect(pathTo(s, s.units[0], { floor: 1, x: 2, y: 2 })).toBeNull(); // too far for 4 AP
  });

  it('refuses to walk into a fully burning tile', () => {
    const s = yard();
    s.units[0].pos = { floor: 0, x: 5, y: 2 };
    expect(performAction(s, { type: 'move', unitId: 'ff1', to: { floor: 0, x: 6, y: 2 } }).error).toMatch(/hot/);
  });
});
