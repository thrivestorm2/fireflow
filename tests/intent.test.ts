import { describe, expect, it } from 'vitest';
import { buildState } from '../src/core/building';
import type { GameState, Pos } from '../src/core/types';
import { clickOptions } from '../src/ui/intent';
import { miniScenario, standAt } from './helpers';

const P = (x: number, y: number, floor = 0): Pos => ({ floor, x, y });

/** Two rooms joined by a closed door at (3, 2). Engine crew ff1, ladder crew ff2. */
const rooms = () =>
  buildState(
    miniScenario([['.......', '#######', '#,,D,,#', '#######', '.......']], {
      dispatch: [
        { name: 'E', type: 'engine', arrivalTurn: 1, crew: ['A'] },
        { name: 'L', type: 'ladder', arrivalTurn: 1, crew: ['B'] },
      ],
    }),
  );

const labels = (s: GameState, id: string, target: Pos) => {
  const c = clickOptions(s, s.units.find((u) => u.id === id)!, target);
  return 'error' in c ? c.error : c.options.map((o) => o.label);
};

describe('tap to act', () => {
  it('one obvious action: just do it', () => {
    const s = standAt(rooms(), 'ff1', 2, 2);
    expect(labels(s, 'ff1', P(3, 2))).toEqual(['Open the door']);
    expect(labels(s, 'ff1', P(1, 2))).toEqual(['Move here']);
  });

  it('several possible actions: offer them all, most likely first', () => {
    const s = standAt(rooms(), 'ff2', 2, 2);
    expect(labels(s, 'ff2', P(3, 2))).toEqual(['Open the door', 'Axe through the door']);
  });

  it('an open door: walk through first, or close it', () => {
    const s = standAt(rooms(), 'ff1', 2, 2);
    s.floors[0][2][3].open = true;
    expect(labels(s, 'ff1', P(3, 2))).toEqual(['Move here', 'Close the door']);
  });

  it('tapping yourself offers the jobs done where you stand', () => {
    const s = standAt(rooms(), 'ff1', 2, 2);
    expect(labels(s, 'ff1', P(2, 2))).toEqual(['Search here']);
  });

  it('nothing possible: say why', () => {
    const s = standAt(rooms(), 'ff1', 2, 2);
    expect(labels(s, 'ff1', P(0, 2))).toMatch(/Cannot stand there/);
  });
});

describe('on the aerial turntable', () => {
  it('tapping yourself offers to aim the aerial (a mode, no AP spent yet)', () => {
    const s = buildState(
      miniScenario([['..............', '==============', '=============='], ['              ', '              ', '              ']], {
        dispatch: [{ name: 'L', type: 'ladder', arrivalTurn: 1, crew: ['A'] }],
        fires: [{ pos: P(0, 0), intensity: 1 }],
      }),
    );
    Object.assign(s.trucks[0], { status: 'placed', pos: P(0, 1) });
    const at = standAt(s, 'ff1', 5, 1); // the turntable: one row ahead of the rear coupling
    const c = clickOptions(at, at.units[0], P(5, 1));
    expect('options' in c && c.options[0]).toMatchObject({ label: 'Raise the aerial…', ui: 'aim-aerial', actions: [] });
  });
});
