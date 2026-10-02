import { describe, expect, it } from 'vitest';
import { buildState, ORIGIN_WEIGHT } from '../src/core/building';
import { forEachTile, posKey, tileAt } from '../src/core/grid';
import { isKnown, knowledge, showing } from '../src/core/knowledge';
import type { GameState, Pos } from '../src/core/types';
import { houseFire } from '../src/scenarios/house';
import { miniScenario, standAt } from './helpers';

const P = (x: number, y: number, floor = 0): Pos => ({ floor, x, y });

function origin(s: GameState): Pos {
  let found: Pos | undefined;
  forEachTile(s, (t, p) => {
    if (t.fire === 2) found = p;
  });
  return found!;
}

describe('random fire origin', () => {
  it('starts somewhere likely, the same for the same seed, different across seeds', () => {
    const counts = new Map<string, number>();
    const places = new Set<string>();
    for (let seed = 1; seed <= 200; seed++) {
      const s = buildState({ ...houseFire, seed });
      const p = origin(s);
      const t = tileAt(s, p)!;
      expect(ORIGIN_WEIGHT[t.contents]).toBeGreaterThan(0);
      expect(s.units.some((u) => u.kind === 'civilian' && posKey(u.pos) === posKey(p))).toBe(false);
      counts.set(t.contents, (counts.get(t.contents) ?? 0) + 1);
      places.add(posKey(p));
    }
    expect(posKey(origin(buildState({ ...houseFire, seed: 7 })))).toBe(posKey(origin(buildState({ ...houseFire, seed: 7 }))));
    expect(places.size).toBeGreaterThan(5);
    const top = [...counts].sort((a, b) => b[1] - a[1])[0][0];
    expect(top).toBe('stove'); // cooking is the most common cause
  });
});

describe('fog of war', () => {
  // Knowledge is cached per state (states are immutable in play); tests that edit a state look at a copy.
  const look = (s: GameState) => structuredClone(s);
  /** A long room (x 1–7) with a window on the outside wall, one engine crew member (ff1, the LT). */
  const house = () =>
    buildState(
      miniScenario([['..........', '#########.', '#,,,,,,,W.', '#########.', '..........']], {
        dispatch: [{ name: 'E', type: 'engine', arrivalTurn: 1, crew: ['A'] }],
        fires: [{ pos: P(7, 2), intensity: 2 }],
      }),
    );
  const smokeOut = (s: GameState, amount: number) =>
    forEachTile(s, (t) => {
      if (t.kind === 'floor') t.smoke = amount;
    });

  it('fire inside is unknown until the crew can see it; outside and the outer walls are always known', () => {
    const s = look(house());
    expect(isKnown(s, P(7, 2))).toBe(false);
    expect(isKnown(s, P(4, 0))).toBe(true); // the yard
    expect(isKnown(s, P(8, 2))).toBe(true); // the window, on the outer wall
    const inside = look(standAt(house(), 'ff1', 4, 2));
    expect(isKnown(inside, P(7, 2))).toBe(true); // 3 tiles through clear air
  });

  it('in thick smoke the crew only feels what is next to them, but flames glow through it nearby', () => {
    let s = standAt(house(), 'ff1', 4, 2);
    smokeOut(s, 80);
    s = look(s);
    expect(isKnown(s, P(5, 2))).toBe(true); // within reach
    expect(isKnown(s, P(7, 2))).toBe(false); // 3 away in smoke
    s = look(standAt(s, 'ff1', 5, 2));
    expect(isKnown(s, P(7, 2))).toBe(true); // glow, 2 away
    expect(isKnown(s, P(1, 2))).toBe(false);
  });

  it('the officer’s thermal camera reads heat through smoke, but not through walls', () => {
    let s = standAt(house(), 'ff1', 2, 2);
    smokeOut(s, 80);
    s = look(s);
    const { thermal } = knowledge(s);
    expect(thermal.has(posKey(P(7, 2)))).toBe(true);
    expect(isKnown(s, P(7, 2))).toBe(false); // read as heat, not seen
    expect(thermal.has(posKey(P(2, 4)))).toBe(false); // the other side of the wall
  });

  it('smoke and fire show at the windows', () => {
    const s = house();
    smokeOut(s, 70);
    expect(showing(s, P(8, 2))!.smoke).toBeLessThan(70); // closed: a seep round the frame
    expect(showing(s, P(8, 2))!.fire).toBe(2);
    tileAt(s, P(8, 2))!.open = true;
    expect(showing(s, P(8, 2))!.smoke).toBe(70);
    expect(showing(s, P(4, 1))).toBeUndefined(); // a wall, not an opening
  });
});
