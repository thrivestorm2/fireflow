import { describe, expect, it } from 'vitest';
import { newGame } from '../src/core/game';
import { tileAt } from '../src/core/grid';
import { houseFire } from '../src/scenarios/house';
import { isVisible, shownPos } from '../src/ui/render';

describe('one floor at a time', () => {
  const s = newGame(houseFire);

  it('shows the floor inside the building and the ground everywhere outside it', () => {
    expect(shownPos(s, 1, 10, 5)).toEqual({ floor: 1, x: 10, y: 5 }); // inside the house, upstairs
    expect(shownPos(s, 1, 10, 16)).toEqual({ floor: 0, x: 10, y: 16 }); // the road, seen from upstairs
    expect(shownPos(s, 2, 10, 5)).toEqual({ floor: 2, x: 10, y: 5 }); // the roof
    expect(shownPos(s, 2, 1, 1)).toEqual({ floor: 0, x: 1, y: 1 }); // the yard, seen from the roof
  });

  it('a ladder in open air belongs to the floor it reaches', () => {
    const t = structuredClone(s);
    tileAt(t, { floor: 1, x: 3, y: 5 })!.ladder = true;
    expect(shownPos(t, 1, 3, 5)).toEqual({ floor: 1, x: 3, y: 5 });
  });

  it('hides what is inside other floors but not what is outside', () => {
    expect(isVisible(s, 1, { floor: 0, x: 7, y: 9 })).toBe(false); // ground-floor study, from upstairs
    expect(isVisible(s, 1, { floor: 0, x: 6, y: 14 })).toBe(true); // the hydrant on the sidewalk
    expect(isVisible(s, 0, { floor: 1, x: 6, y: 4 })).toBe(false); // an upstairs bedroom, from the ground
  });
});
