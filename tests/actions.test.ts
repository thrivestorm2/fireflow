import { describe, expect, it } from 'vitest';
import { performAction, type Action } from '../src/core/actions';
import { buildState } from '../src/core/building';
import { endTurn } from '../src/core/game';
import { forEachTile } from '../src/core/grid';
import { hoseLeft } from '../src/core/hoses';
import { pathTo } from '../src/core/pathing';
import type { GameState, Pos } from '../src/core/types';
import { miniScenario, run, standAt } from './helpers';

const P = (x: number, y: number, floor = 0): Pos => ({ floor, x, y });

/** A small lot: two-lane road, sidewalk with hydrant, a one-room house with stairs, and an upper floor. */
const site = () =>
  buildState(
    miniScenario(
      [
        {
          plan: [
            '============',
            '============',
            '------------',
            '.##D####....',
            '.#,,,,,#....',
            '.#,w,,,#....',
            '.###S###....',
          ],
          contents: ['', '', ' H', '', '', '      c'],
        },
        {
          plan: [
            '            ',
            '            ',
            '            ',
            ' #####W#    ',
            ' #,,,,,#    ',
            ' #,,,,,#    ',
            ' ###S###    ',
          ],
        },
      ],
      {
        dispatch: [
          { name: 'Engine', type: 'engine', arrivalTurn: 1, crew: ['A', 'B'] },
          { name: 'Ladder', type: 'ladder', arrivalTurn: 1, crew: ['L'] },
        ],
        civilians: [{ name: 'C', pos: P(2, 4) }],
        fires: [{ pos: P(6, 4), intensity: 3 }],
      },
    ),
  );

/** Site with both trucks arrived and waiting to park (newGame does this; buildState does not). */
function staged(): GameState {
  const s = site();
  for (const t of s.trucks) t.status = 'staged';
  return s;
}

/** Engine parked at the left end of the road, beside the hydrant; ladder truck at the right end. */
const parked = () => run(staged(), place('truck1', 0), place('truck2', 5));

const place = (truckId: string, x: number, y = 0, orientation: 'h' | 'v' = 'h'): Action => ({ type: 'placeTruck', truckId, pos: P(x, y), orientation });
const move = (unitId: string, ...path: Pos[]): Action => ({ type: 'move', unitId, path });
const fresh = (s: GameState) => {
  for (const u of s.units) u.ap = u.maxAp;
  return s;
};

describe('trucks', () => {
  it('cannot be placed before arriving', () => {
    expect(performAction(site(), place('truck1', 0)).error).toMatch(/arrives on turn/);
  });

  it('engines take 2×5 tiles and ladders 2×7, parked on drivable tiles only', () => {
    let s = staged();
    expect(performAction(s, place('truck1', 0, 1)).error).toMatch(/road or driveway/); // second row hits the sidewalk
    expect(performAction(s, place('truck1', 8)).error).toMatch(/Off the map/);
    s = run(s, place('truck1', 0));
    expect(performAction(s, place('truck2', 4)).error).toMatch(/Another truck/);
    expect(performAction(s, place('truck2', 6)).error).toMatch(/Off the map/); // 7 long
    s = run(s, place('truck2', 5));
    expect(s.trucks.map((t) => t.status)).toEqual(['placed', 'placed']);
    s = standAt(s, 'ff1', 4, 2);
    expect(performAction(s, move('ff1', P(4, 1))).error).toMatch(/truck is parked/);
  });

  it('arrive with a tank of water and a fixed amount of hose', () => {
    const s = parked();
    expect(s.trucks[0].water).toBe(20);
    expect(hoseLeft(s, s.trucks[0])).toBe(28);
    expect(s.trucks[1].water).toBe(0);
  });

  it('crew stay aboard until the truck parks, then offload next to it', () => {
    let s = staged();
    expect(performAction(s, move('ff1', P(0, 2))).error).toMatch(/park it first/);
    s = run(s, place('truck1', 0));
    expect(performAction(s, { type: 'toggle', unitId: 'ff1', target: P(3, 3) }).error).toMatch(/get off/);
    s = run(s, move('ff1', P(2, 2), P(3, 2)));
    expect(s.units[0].aboard).toBeUndefined();
    expect(s.units[0].pos).toEqual(P(3, 2));
    expect(s.units[0].ap).toBe(2);
  });
});

describe('hoses', () => {
  it('a line is pulled from an adjacent engine and follows its holder', () => {
    let s = run(parked(), move('ff1', P(3, 2)));
    s = run(s, { type: 'takeLine', unitId: 'ff1', kind: 'attack' }, { type: 'toggle', unitId: 'ff1', target: P(3, 3) });
    s = fresh(s);
    s = run(s, move('ff1', P(3, 3), P(3, 4)));
    expect(s.hoses[0].tiles).toEqual([P(3, 2), P(3, 3), P(3, 4)]);
    expect(hoseLeft(s, s.trucks[0])).toBe(25);
    // A door with a hose through it cannot be closed.
    const s2 = standAt(structuredClone(s), 'ff2', 3, 2);
    expect(performAction(s2, { type: 'toggle', unitId: 'ff2', target: P(3, 3) }).error).toMatch(/hose runs through/);
    // Walking back along the hose takes it back in.
    s = run(s, move('ff1', P(3, 3)));
    expect(s.hoses[0].tiles).toEqual([P(3, 2), P(3, 3)]);
  });

  it('must be next to an engine to take a line', () => {
    const s = standAt(parked(), 'ff1', 8, 4);
    expect(performAction(s, { type: 'takeLine', unitId: 'ff1', kind: 'attack' }).error).toMatch(/next to an engine/);
  });

  it('cannot go further than the hose left on the engine', () => {
    let s = run(parked(), move('ff1', P(3, 2)), { type: 'takeLine', unitId: 'ff1', kind: 'attack' });
    s.trucks[0].hose = 2;
    s = fresh(s);
    expect(performAction(s, move('ff1', P(4, 2), P(5, 2))).error).toMatch(/Not enough hose — 1/);
    expect(pathTo(s, s.units[0], P(5, 2))).toBeNull();
    expect(pathTo(s, s.units[0], P(4, 2))).not.toBeNull();
  });

  it('spraying needs an attack line and drains the engine tank', () => {
    let s = run(parked(), move('ff1', P(3, 2)));
    s = standAt(s, 'ff2', 5, 4);
    expect(performAction(s, { type: 'spray', unitId: 'ff2', target: P(6, 4) }).error).toMatch(/attack line/);
    s = run(s, { type: 'takeLine', unitId: 'ff1', kind: 'attack' });
    s = fresh(s);
    s = run(s, { type: 'toggle', unitId: 'ff1', target: P(3, 3) }, move('ff1', P(3, 3), P(3, 4)));
    s = fresh(s);
    s = run(s, move('ff1', P(4, 4)), { type: 'spray', unitId: 'ff1', target: P(6, 4) });
    expect(s.floors[0][4][6].fire).toBe(1);
    expect(s.trucks[0].water).toBe(19);
    s.trucks[0].water = 0;
    expect(performAction(s, { type: 'spray', unitId: 'ff1', target: P(6, 4) }).error).toMatch(/out of water/);
  });

  it('nozzles can be put down, picked up by someone else, and packed away', () => {
    let s = run(parked(), move('ff1', P(3, 2)), { type: 'takeLine', unitId: 'ff1', kind: 'attack' }, move('ff1', P(4, 2)));
    s = run(s, { type: 'dropLine', unitId: 'ff1' }, move('ff1', P(5, 2)));
    expect(s.hoses[0].holder).toBeUndefined();
    s = run(s, move('ff2', P(4, 1 + 1)));
    s = run(s, { type: 'pickupLine', unitId: 'ff2' });
    expect(s.units[1].line).toBe(s.hoses[0].id);
    s = run(s, { type: 'returnLine', unitId: 'ff2' });
    expect(s.hoses).toHaveLength(0);
    expect(hoseLeft(s, s.trucks[0])).toBe(28);
  });
});

describe('hydrants', () => {
  it('take several crew actions over more than one turn before water flows', () => {
    // Engine away from the hydrant: x 0..4 is free; park at the right end instead.
    let s = run(staged(), place('truck1', 7));
    s = run(s, move('ff1', P(7, 2), P(6, 2)), { type: 'takeLine', unitId: 'ff1', kind: 'supply' });
    s = fresh(s);
    s = run(s, move('ff1', P(5, 2), P(4, 2), P(3, 2), P(2, 2)));
    const hydrant = P(1, 2);
    expect(performAction(s, { type: 'hydrant', unitId: 'ff1', target: hydrant }).error).toMatch(/Needs 1 AP/);
    s.units[0].ap = 1;
    s = run(s, { type: 'hydrant', unitId: 'ff1', target: hydrant }); // remove cap (1 AP)
    expect(s.hydrants[0].state).toBe('uncapped');
    expect(performAction(s, { type: 'hydrant', unitId: 'ff1', target: hydrant }).error).toMatch(/Needs 2 AP/);
    s = fresh(s);
    s = run(s, { type: 'hydrant', unitId: 'ff1', target: hydrant }); // couple hose (2 AP)
    expect(s.hydrants[0].state).toBe('connected');
    expect(s.units[0].line).toBeUndefined();
    expect(s.hoses[0].tiles).toHaveLength(6); // five tiles walked plus the hydrant coupling
    s = run(s, { type: 'hydrant', unitId: 'ff1', target: hydrant }); // open (2 AP)
    expect(s.hydrants[0].state).toBe('opening');
    // The tank is not refilled until water arrives in the next fire phase.
    s.trucks[0].water = 5;
    s = endTurn(s);
    expect(s.hydrants[0].state).toBe('flowing');
    expect(s.trucks[0].water).toBe(13);
    s = endTurn(endTurn(s));
    expect(s.trucks[0].water).toBe(20); // capped at the tank size
  });

  it('coupling needs a supply line, not an attack line', () => {
    let s = run(parked(), move('ff1', P(2, 2)), { type: 'hydrant', unitId: 'ff1', target: P(1, 2) });
    s = run(s, { type: 'takeLine', unitId: 'ff1', kind: 'attack' });
    s = fresh(s);
    expect(performAction(s, { type: 'hydrant', unitId: 'ff1', target: P(1, 2) }).error).toMatch(/supply line/);
  });

  it('a tank without a hydrant never refills', () => {
    let s = parked();
    s.trucks[0].water = 3;
    s = endTurn(endTurn(s));
    expect(s.trucks[0].water).toBe(3);
  });
});

describe('movement', () => {
  it('only one unit may stand on a tile, but teammates can pass through', () => {
    let s = run(parked(), move('ff1', P(2, 2)));
    expect(performAction(s, move('ff2', P(2, 2))).error).toMatch(/taken/);
    expect(pathTo(s, s.units[1], P(3, 2))).not.toBeNull();
  });

  it('cannot walk through a closed door, but can after opening it', () => {
    let s = standAt(staged(), 'ff1', 3, 2);
    expect(performAction(s, move('ff1', P(3, 3))).error).toMatch(/closed/);
    s = run(s, { type: 'toggle', unitId: 'ff1', target: P(3, 3) }, move('ff1', P(3, 3)));
    expect(s.units[0].pos).toEqual(P(3, 3));
  });

  it('is blocked by large contents', () => {
    const s = standAt(staged(), 'ff1', 5, 5);
    expect(performAction(s, move('ff1', P(6, 5))).error).toMatch(/Cabinets in the way/);
  });

  it('refuses to walk into a fully burning tile', () => {
    const s = standAt(staged(), 'ff1', 5, 4);
    expect(performAction(s, move('ff1', P(6, 4))).error).toMatch(/hot/);
  });

  it('finds paths across floors via the stairs within the AP budget', () => {
    const s = standAt(staged(), 'ff1', 4, 5);
    expect(pathTo(s, s.units[0], P(4, 5, 1))).toEqual([P(4, 6), P(4, 6, 1), P(4, 5, 1)]);
    expect(pathTo(s, s.units[0], P(2, 4, 1))).toBeNull(); // too far for 4 AP
  });

  it('does not mutate the previous state', () => {
    const s = standAt(staged(), 'ff1', 3, 2);
    run(s, { type: 'toggle', unitId: 'ff1', target: P(3, 3) });
    expect(s.floors[0][3][3].open).toBe(false);
    expect(s.units[0].ap).toBe(4);
  });
});

describe('player actions', () => {
  it('rescues a civilian carried out of the building', () => {
    let s = standAt(staged(), 'ff1', 3, 2);
    s = run(s, { type: 'toggle', unitId: 'ff1', target: P(3, 3) }, move('ff1', P(3, 3), P(3, 4)), { type: 'pickup', unitId: 'ff1', target: P(2, 4) });
    expect(s.units.find((u) => u.id === 'cv1')!.carriedBy).toBe('ff1');
    s = fresh(s);
    s = run(s, move('ff1', P(3, 3), P(3, 2)));
    expect(s.units.find((u) => u.id === 'cv1')!.status).toBe('rescued');
  });

  it('cannot carry someone while holding a hose', () => {
    let s = run(parked(), move('ff1', P(3, 2)), { type: 'takeLine', unitId: 'ff1', kind: 'attack' });
    s = fresh(s);
    s = run(s, { type: 'toggle', unitId: 'ff1', target: P(3, 3) }, move('ff1', P(3, 3), P(3, 4)));
    expect(performAction(s, { type: 'pickup', unitId: 'ff1', target: P(2, 4) }).error).toMatch(/hose down/);
  });

  it('ladder crews breach drywall but not brick', () => {
    let s = standAt(staged(), 'ff3', 2, 5);
    expect(performAction(standAt(structuredClone(s), 'ff1', 2, 5), { type: 'breach', unitId: 'ff1', target: P(3, 5) }).error).toMatch(/Only ladder crews/);
    expect(performAction(s, { type: 'breach', unitId: 'ff3', target: P(1, 5) }).error).toMatch(/solid/);
    s = run(s, { type: 'breach', unitId: 'ff3', target: P(3, 5) });
    expect(s.floors[0][5][3].kind).toBe('rubble');
  });

  it('ladder crews raise ladders to upper windows and climb them', () => {
    let s = standAt(staged(), 'ff3', 6, 2);
    expect(performAction(standAt(structuredClone(s), 'ff1', 4, 2), { type: 'ladder', unitId: 'ff1' }).error).toMatch(/Only ladder crews/);
    s = run(s, { type: 'ladder', unitId: 'ff3' });
    expect(s.floors[0][2][6].ladder && s.floors[1][2][6].ladder).toBe(true);
    s = run(s, move('ff3', P(6, 2, 1)), { type: 'breach', unitId: 'ff3', target: P(6, 3, 1) });
    s = fresh(s);
    s = run(s, move('ff3', P(6, 3, 1), P(6, 4, 1)));
    expect(s.units[2].pos).toEqual(P(6, 4, 1));
  });

  it('never starts or spreads fire during the player phase', () => {
    const burning = (s: GameState) => {
      let n = 0;
      forEachTile(s, (t) => (n += t.fire));
      return n;
    };
    let s = parked();
    const steps: Action[] = [
      move('ff1', P(3, 2)),
      { type: 'takeLine', unitId: 'ff1', kind: 'attack' },
      { type: 'toggle', unitId: 'ff1', target: P(3, 3) },
      move('ff1', P(3, 3)),
      move('ff1', P(3, 4), P(4, 4)),
      { type: 'spray', unitId: 'ff1', target: P(6, 4) },
      { type: 'dropLine', unitId: 'ff1' },
    ];
    const before = burning(s);
    for (const a of steps) {
      s = fresh(s);
      const prev = burning(s);
      s = run(s, a);
      expect(burning(s)).toBeLessThanOrEqual(prev);
    }
    expect(burning(s)).toBeLessThan(before);
  });
});
