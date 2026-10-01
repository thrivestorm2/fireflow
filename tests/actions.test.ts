import { describe, expect, it } from 'vitest';
import { performAction, type Action } from '../src/core/actions';
import { buildState } from '../src/core/building';
import { forEachTile } from '../src/core/grid';
import { pathTo } from '../src/core/pathing';
import type { GameState, Pos } from '../src/core/types';
import { miniScenario, run, standAt } from './helpers';

const P = (x: number, y: number, floor = 0): Pos => ({ floor, x, y });

/** A small lot: road, sidewalk with hydrant, a one-room house with stairs, and an upper floor. */
const site = () =>
  buildState(
    miniScenario(
      [
        {
          plan: [
            '==========',
            '----------',
            '.##D####..',
            '.#,,,,,#..',
            '.#,w,,,#..',
            '.###S###..',
          ],
          contents: ['', ' H', '', '', '      c'],
        },
        {
          plan: [
            '          ',
            '          ',
            ' #####W#  ',
            ' #,,,,,#  ',
            ' #,,,,,#  ',
            ' ###S###  ',
          ],
        },
      ],
      {
        dispatch: [
          { name: 'Engine', type: 'engine', arrivalTurn: 1, crew: ['A', 'B'] },
          { name: 'Ladder', type: 'ladder', arrivalTurn: 1, crew: ['L'] },
        ],
        civilians: [{ name: 'C', pos: P(3, 3) }],
        fires: [{ pos: P(6, 3), intensity: 3 }],
      },
    ),
  );

/** Site with all trucks arrived and staged (newGame does this; buildState does not). */
function staged(): GameState {
  const s = site();
  for (const t of s.trucks) t.status = 'staged';
  return s;
}

const place = (truckId: string, x: number, y = 0, orientation: 'h' | 'v' = 'h'): Action => ({ type: 'placeTruck', truckId, pos: P(x, y), orientation });
const move = (unitId: string, ...path: Pos[]): Action => ({ type: 'move', unitId, path });

describe('trucks', () => {
  it('cannot be placed before arriving', () => {
    expect(performAction(site(), place('truck1', 0)).error).toMatch(/arrives on turn/);
  });

  it('park only on drivable tiles, without overlapping', () => {
    let s = staged();
    expect(performAction(s, place('truck1', 0, 1)).error).toMatch(/road or driveway/);
    expect(performAction(s, place('truck1', 8)).error).toMatch(/Off the map/);
    s = run(s, place('truck1', 0));
    expect(performAction(s, place('truck2', 2)).error).toMatch(/Another truck/);
    s = run(s, place('truck2', 3));
    expect(s.trucks.map((t) => t.status)).toEqual(['placed', 'placed']);
  });

  it('hook up to a nearby hydrant for unlimited water', () => {
    expect(run(staged(), place('truck1', 0)).trucks[0].hydrant).toBe(true);
    expect(run(staged(), place('truck1', 7)).trucks[0].hydrant).toBe(false);
  });

  it('crew stay aboard until the truck parks, then offload next to it', () => {
    let s = staged();
    expect(performAction(s, move('ff1', P(2, 1))).error).toMatch(/park it first/);
    s = run(s, place('truck1', 0));
    expect(performAction(s, { type: 'toggle', unitId: 'ff1', target: P(3, 2) }).error).toMatch(/get off/);
    s = run(s, move('ff1', P(2, 1), P(3, 1)));
    const a = s.units[0];
    expect(a.aboard).toBeUndefined();
    expect(a.pos).toEqual(P(3, 1));
    expect(a.ap).toBe(2);
    expect(performAction(s, move('ff2', P(4, 0))).error).toMatch(/Not adjacent/);
  });
});

describe('movement', () => {
  it('only one unit may stand on a tile, but teammates can pass through', () => {
    let s = run(staged(), place('truck1', 0));
    s = run(s, move('ff1', P(2, 1)));
    expect(performAction(s, move('ff2', P(2, 1))).error).toMatch(/taken/);
    expect(pathTo(s, s.units[1], P(3, 1))).not.toBeNull();
  });

  it('cannot walk through a closed door, but can after opening it', () => {
    let s = standAt(staged(), 'ff1', 3, 1);
    expect(performAction(s, move('ff1', P(3, 2))).error).toMatch(/closed/);
    s = run(s, { type: 'toggle', unitId: 'ff1', target: P(3, 2) }, move('ff1', P(3, 2)));
    expect(s.units[0].pos).toEqual(P(3, 2));
    expect(s.units[0].ap).toBe(2);
  });

  it('is blocked by large contents', () => {
    const s = standAt(staged(), 'ff1', 5, 4);
    expect(performAction(s, move('ff1', P(6, 4))).error).toMatch(/Cabinets in the way/);
  });

  it('refuses to walk into a fully burning tile', () => {
    const s = standAt(staged(), 'ff1', 5, 3);
    expect(performAction(s, move('ff1', P(6, 3))).error).toMatch(/hot/);
  });

  it('finds paths across floors via the stairs within the AP budget', () => {
    const s = standAt(staged(), 'ff1', 4, 4);
    expect(pathTo(s, s.units[0], P(4, 4, 1))).toEqual([P(4, 5), P(4, 5, 1), P(4, 4, 1)]);
    expect(pathTo(s, s.units[0], P(2, 3, 1))).toBeNull(); // too far for 4 AP
  });

  it('does not mutate the previous state', () => {
    const s = standAt(staged(), 'ff1', 3, 1);
    run(s, { type: 'toggle', unitId: 'ff1', target: P(3, 2) });
    expect(s.floors[0][2][3].open).toBe(false);
    expect(s.units[0].ap).toBe(4);
  });
});

describe('player actions', () => {
  it('rescues a civilian carried out of the building', () => {
    let s = standAt(staged(), 'ff1', 3, 1);
    s = run(s, { type: 'toggle', unitId: 'ff1', target: P(3, 2) }, move('ff1', P(3, 2)), { type: 'pickup', unitId: 'ff1', target: P(3, 3) });
    expect(s.units.find((u) => u.id === 'cv1')!.carriedBy).toBe('ff1');
    s.units[0].ap = 4;
    s = run(s, move('ff1', P(3, 1)));
    expect(s.units.find((u) => u.id === 'cv1')!.status).toBe('rescued');
    expect(s.units[0].carrying).toBeUndefined();
  });

  it('sprays in straight unobstructed lines within range', () => {
    let s = standAt(staged(), 'ff1', 3, 3);
    expect(performAction(s, { type: 'spray', unitId: 'ff1', target: P(6, 4) }).error).toMatch(/straight/);
    s = run(s, { type: 'spray', unitId: 'ff1', target: P(6, 3) });
    const t = s.floors[0][3][6];
    expect(t.fire).toBe(1);
    expect(t.wet).toBeGreaterThan(0);
    expect(s.units[0].water).toBe(5);
    s = standAt(s, 'ff1', 2, 4);
    expect(performAction(s, { type: 'spray', unitId: 'ff1', target: P(4, 4) }).error).toMatch(/blocked/);
  });

  it('ladder crews have no hose', () => {
    const s = standAt(staged(), 'ff3', 5, 3);
    expect(performAction(s, { type: 'spray', unitId: 'ff3', target: P(6, 3) }).error).toMatch(/no hose/);
  });

  it('breaches drywall but not brick', () => {
    let s = standAt(staged(), 'ff1', 2, 4);
    expect(performAction(s, { type: 'breach', unitId: 'ff1', target: P(1, 4) }).error).toMatch(/solid/);
    s = run(s, { type: 'breach', unitId: 'ff1', target: P(3, 4) });
    expect(s.floors[0][4][3].kind).toBe('rubble');
  });

  it('refills next to an engine, drawing from its tank unless it is on a hydrant', () => {
    let s = run(staged(), place('truck1', 7));
    s = standAt(s, 'ff2', 6, 1);
    s.units[1].water = 0;
    expect(performAction(standAt(structuredClone(s), 'ff2', 3, 1), { type: 'refill', unitId: 'ff2' }).error).toMatch(/engine/);
    s = run(s, { type: 'refill', unitId: 'ff2' });
    expect(s.units[1].water).toBe(6);
    expect(s.trucks[0].water).toBe(18);
  });

  it('ladder crews raise ladders to upper windows and climb them', () => {
    let s = standAt(staged(), 'ff3', 6, 1);
    expect(performAction(standAt(structuredClone(s), 'ff1', 4, 1), { type: 'ladder', unitId: 'ff1' }).error).toMatch(/ladder crews/);
    s = run(s, { type: 'ladder', unitId: 'ff3' });
    expect(s.floors[0][1][6].ladder && s.floors[1][1][6].ladder).toBe(true);
    s = run(s, move('ff3', P(6, 1, 1)), { type: 'breach', unitId: 'ff3', target: P(6, 2, 1) });
    s.units[2].ap = 5;
    s = run(s, move('ff3', P(6, 2, 1), P(6, 3, 1)));
    expect(s.units[2].pos).toEqual(P(6, 3, 1));
  });

  it('never starts or spreads fire during the player phase', () => {
    const burning = (s: GameState) => {
      let n = 0;
      forEachTile(s, (t) => (n += t.fire));
      return n;
    };
    let s = run(staged(), place('truck1', 0));
    const steps: Action[] = [
      move('ff1', P(2, 1), P(3, 1)),
      { type: 'toggle', unitId: 'ff1', target: P(3, 2) },
      move('ff1', P(3, 2)),
      { type: 'breach', unitId: 'ff2', target: P(3, 4) },
      { type: 'spray', unitId: 'ff2', target: P(6, 3) },
    ];
    const before = burning(s);
    for (const a of steps) {
      if (a.type === 'breach') s = standAt(s, 'ff2', 4, 4);
      if (a.type === 'spray') s = standAt(s, 'ff2', 4, 3);
      const prev = burning(s);
      s = run(s, a);
      expect(burning(s)).toBeLessThanOrEqual(prev);
    }
    expect(burning(s)).toBeLessThan(before);
  });
});
