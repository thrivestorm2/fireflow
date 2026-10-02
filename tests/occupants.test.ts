import { describe, expect, it } from 'vitest';
import { performAction } from '../src/core/actions';
import { buildState } from '../src/core/building';
import { endTurn } from '../src/core/game';
import { tileAt } from '../src/core/grid';
import { occupantSystem, waving } from '../src/core/occupants';
import type { GameState, Occupant, Pos } from '../src/core/types';
import { exposureDamage, exposureSystem } from '../src/core/exposure';
import { miniScenario, run, standAt } from './helpers';

const P = (x: number, y: number, floor = 0): Pos => ({ floor, x, y });

/** A room (x 1–5) with a door to the yard at (6, 2); the yard runs down the right and along the bottom. */
const house = (kind: Occupant, at = P(1, 2), door = 'D') =>
  buildState(
    miniScenario([{ plan: ['#######...', '#,,,,,#...', `#,,,,,${door}...`, '#,,,,,#...', '#######...', '..........', '..........'], contents: ['', '', '', '   b'] }], {
      civilians: [{ name: 'X', pos: at, kind }],
      dispatch: [{ name: 'E', type: 'engine', arrivalTurn: 1, crew: ['A'] }],
      // A fire well away in the far corner keeps the incident open (only the occupant system runs).
      fires: [{ pos: P(9, 0), intensity: 1 }],
    }),
  );
const turns = (s: GameState, n: number) => {
  for (let i = 0; i < n; i++) s = endTurn(s, [occupantSystem]);
  return s;
};
const who = (s: GameState) => s.units.find((u) => u.kind === 'civilian')!;

describe('residents', () => {
  it('make their own way out, opening the door', () => {
    const s = turns(house('resident'), 5);
    expect(who(s).status).toBe('rescued');
    expect(tileAt(s, P(6, 2))!.open).toBe(true);
    expect(s.log.some((l) => /gets out of the building on their own/.test(l.text))).toBe(true);
  });

  it('even unlock their own front door', () => {
    const s = turns(house('resident', P(1, 2), 'L'), 5);
    expect(who(s).status).toBe('rescued');
  });

  it('crawl a tile a turn in smoke', () => {
    let s = house('resident');
    for (const row of s.floors[0]) for (const t of row) if (t.kind === 'floor') t.smoke = 50;
    const start = who(s).pos.x;
    s = turns(s, 1);
    expect(Math.abs(who(s).pos.x - start) + Math.abs(who(s).pos.y - 2)).toBeLessThanOrEqual(1);
  });

  it('stop moving once unconscious', () => {
    let s = house('resident');
    who(s).unconscious = true;
    s = turns(s, 3);
    expect(who(s).pos).toEqual(P(1, 2));
  });
});

describe('when there is no clear way out', () => {
  /** An upstairs room with a window on the outside wall, its door opening onto a smoke-filled landing. */
  const upstairs = (limited = false) =>
    buildState(
      miniScenario(
        [
          ['..........', '#######...', '#,,,,,d...', '#######...', '..........'],
          ['          ', '###W###   ', '#,,,,,d,  ', '#######   ', '          '],
        ],
        {
          civilians: [{ name: 'X', pos: P(1, 2, 1), limited }],
          fires: [{ pos: P(9, 0), intensity: 1 }],
        },
      ),
    );

  it('residents get to the window and call for help, which the crew can see', () => {
    let s = upstairs();
    s.floors[1][2][7].smoke = 80; // the way out is smoke-logged
    s = turns(s, 3);
    expect(who(s).pos).toEqual(P(3, 2, 1));
    expect(who(s).found).toBe(true);
    expect(s.log.some((l) => /waving from a window, calling for help/.test(l.text))).toBe(true);
    expect(waving(s).map((w) => w.window)).toEqual([P(3, 1, 1)]);
  });

  it('limited mobility: a tile a turn, and no climbing out of windows', () => {
    const climb = buildState(
      miniScenario([['..........', '###W###...', '#,,,,,#...', '#######...', '..........']], {
        civilians: [{ name: 'X', pos: P(3, 2) }],
        fires: [{ pos: P(9, 0), intensity: 1 }],
      }),
    );
    expect(who(turns(structuredClone(climb), 2)).status).toBe('rescued'); // out through the window
    const slow = structuredClone(climb);
    slow.units[0].limited = true;
    expect(who(turns(slow, 4)).status).toBe('active');
  });
});

describe('pets', () => {
  it('a dog can’t open a door, but bolts through an open one', () => {
    expect(who(turns(house('dog'), 4)).status).toBe('active');
    expect(who(turns(house('dog', P(1, 2), 'd'), 4)).status).toBe('rescued');
  });

  it('a cat hides under the bed and stays there', () => {
    const s = turns(house('cat', P(3, 2)), 4);
    expect(who(s).pos).toEqual(P(3, 3));
  });
});

describe('bystanders', () => {
  it('are visible, keep off the road-side of the building and can’t be carried', () => {
    let s = house('bystander', P(5, 6));
    expect(who(s).found).toBe(true);
    s = turns(s, 12);
    const p = who(s).pos;
    const nearWall = [-1, 0, 1].some((dy) => [-1, 0, 1].some((dx) => {
      const t = tileAt(s, { ...p, x: p.x + dx, y: p.y + dy });
      return !!t && t.kind !== 'ground';
    }));
    expect(nearWall).toBe(false);
    s = standAt(s, 'ff1', p.x === 0 ? 1 : p.x - 1, p.y);
    expect(performAction(s, { type: 'pickup', unitId: 'ff1', target: p }).error).toMatch(/Nobody/);
  });
});

describe('collapsing in the smoke', () => {
  const smoky = () => {
    const s = house('resident', P(1, 2));
    for (const row of s.floors[0]) for (const t of row) if (t.kind === 'floor') t.smoke = 100;
    return s;
  };

  it('worn down, they collapse unconscious, stop moving, and take less smoke on the floor', () => {
    let s = smoky();
    who(s).hp = 45;
    who(s).found = true;
    s = endTurn(s, [exposureSystem]);
    expect(who(s).unconscious).toBe(true);
    expect(s.log.some((l) => /collapsed, unconscious/.test(l.text))).toBe(true);
    const hit = exposureDamage(s, who(s));
    s = turns(s, 2);
    expect(who(s).pos).toEqual(P(1, 2));
    const awake = structuredClone(s);
    awake.units.find((u) => u.kind === 'civilian')!.unconscious = false;
    expect(hit).toBeLessThan(exposureDamage(awake, who(awake)));
  });

  it('can still be carried out alive — or die if they are left too long', () => {
    let s = smoky();
    Object.assign(who(s), { hp: 30, unconscious: true, found: true });
    s = standAt(s, 'ff1', 2, 2);
    s = run(s, { type: 'pickup', unitId: 'ff1', target: P(1, 2) });
    expect(who(s).carriedBy).toBe('ff1');

    let left = smoky();
    Object.assign(who(left), { hp: 30, unconscious: true, found: true });
    for (let i = 0; i < 10 && who(left).status === 'active'; i++) left = endTurn(left, [exposureSystem]);
    expect(who(left).status).toBe('dead');
  });
});
