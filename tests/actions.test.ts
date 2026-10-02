import { describe, expect, it } from 'vitest';
import { performAction, streamArea, type Action } from '../src/core/actions';
import { buildState } from '../src/core/building';
import { endTurn } from '../src/core/game';
import { forEachTile, tileAt } from '../src/core/grid';
import { hoseLeft, isSupplied } from '../src/core/hoses';
import { pathTo } from '../src/core/pathing';
import { seatOf, seatTiles } from '../src/core/trucks';
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
    expect(s.trucks[1].water).toBe(4); // the ladder truck's small tank
  });

  it('the engineer drives, the lieutenant rides front right, and the front can face either end', () => {
    let s = run(staged(), place('truck1', 0)); // front (cab) at the left
    expect(['ff1', 'ff2'].map((id) => seatOf(s, s.units.find((u) => u.id === id)!))).toEqual([P(0, 0), P(0, 1)]);
    s = run(staged(), { type: 'placeTruck', truckId: 'truck1', pos: P(0, 0), orientation: 'h', reversed: true });
    expect(s.trucks[0].reversed).toBe(true);
    expect(seatTiles(s.trucks[0])[0]).toEqual(P(4, 0)); // cab now at the right end
    expect(seatOf(s, s.units[1])).toEqual(P(4, 0)); // engineer drives: front left, facing east
    // Once off the truck, a firefighter no longer has a seat.
    s = run(s, move('ff1', P(0, 2)));
    expect(seatOf(s, s.units[0])).toBeUndefined();
    expect(seatOf(s, s.units[1])).toEqual(P(4, 0));
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
  // The engine parked at x 0..4 has its hose connections at x 2: (2,1) faces the sidewalk at (2,2).
  const take = (size: '1.75' | '2.5' = '1.75', unitId = 'ff1'): Action => ({ type: 'takeLine', unitId, kind: 'attack', size });

  it('attack lines come off the connections halfway down the engine and follow their holder', () => {
    let s = run(parked(), move('ff1', P(2, 2)), take(), move('ff1', P(3, 2)), { type: 'toggle', unitId: 'ff1', target: P(3, 3) });
    s = fresh(s);
    s = run(s, move('ff1', P(3, 3), P(3, 4)));
    expect(s.hoses[0]).toMatchObject({ size: '1.75', side: 1, origin: P(2, 1) });
    expect(s.hoses[0].tiles).toEqual([P(2, 2), P(3, 2), P(3, 3), P(3, 4)]);
    expect(hoseLeft(s, s.trucks[0])).toBe(24);
    // A door with a hose through it cannot be closed.
    const s2 = standAt(structuredClone(s), 'ff2', 3, 2);
    expect(performAction(s2, { type: 'toggle', unitId: 'ff2', target: P(3, 3) }).error).toMatch(/hose runs through/);
    // Walking back along the hose takes it back in.
    s = run(s, move('ff1', P(3, 3)));
    expect(s.hoses[0].tiles).toEqual([P(2, 2), P(3, 2), P(3, 3)]);
  });

  it('must stand beside the hose connections to take an attack line', () => {
    expect(performAction(standAt(parked(), 'ff1', 8, 4), take()).error).toMatch(/hose connections/);
    expect(performAction(standAt(parked(), 'ff1', 0, 2), take()).error).toMatch(/hose connections/); // beside the cab
  });

  it('each side has one 1¾″ and one 2½″ line', () => {
    let s = run(parked(), move('ff1', P(2, 2)), take('1.75'));
    s = standAt(s, 'ff2', 2, 2);
    s.units[0].pos = P(3, 2);
    expect(performAction(s, take('1.75', 'ff2')).error).toMatch(/1¾″ line on this side is already in use/);
    s = run(s, take('2.5', 'ff2'));
    expect(s.hoses.map((l) => l.size)).toEqual(['1.75', '2.5']);
  });

  it('cannot go further than the hose left on the engine', () => {
    let s = run(parked(), move('ff1', P(2, 2)), take());
    s.trucks[0].hose = 2;
    s = fresh(s);
    expect(performAction(s, move('ff1', P(3, 2), P(4, 2))).error).toMatch(/Not enough hose — 1/);
    expect(pathTo(s, s.units[0], P(4, 2))).toBeNull();
    expect(pathTo(s, s.units[0], P(3, 2))).not.toBeNull();
  });

  it('spraying needs an attack line and drains the engine tank', () => {
    let s = run(parked(), move('ff1', P(2, 2)));
    s = standAt(s, 'ff2', 5, 4);
    expect(performAction(s, { type: 'spray', unitId: 'ff2', target: P(6, 4) }).error).toMatch(/attack line/);
    s = run(s, take());
    s = fresh(s);
    s = run(s, move('ff1', P(3, 2)), { type: 'toggle', unitId: 'ff1', target: P(3, 3) }, move('ff1', P(3, 3), P(3, 4)));
    s = fresh(s);
    s = run(s, move('ff1', P(4, 4)), { type: 'spray', unitId: 'ff1', target: P(6, 4) });
    expect(s.floors[0][4][6].fire).toBe(1);
    expect(s.trucks[0].water).toBe(19);
    s.trucks[0].water = 0;
    expect(performAction(s, { type: 'spray', unitId: 'ff1', target: P(6, 4) }).error).toMatch(/out of water/);
  });

  it('a 2½″ line hits harder, cools more and reaches further but uses more water and is slow to advance', () => {
    let s = run(parked(), move('ff1', P(2, 2)), take('2.5'));
    s = fresh(s);
    // Laying out a new tile of 2½″ costs 2 AP; walking back along it costs the normal 1.
    expect(performAction(s, move('ff1', P(3, 2))).state.units[0].ap).toBe(2);
    s = run(s, move('ff1', P(3, 2)));
    expect(performAction(s, move('ff1', P(2, 2))).state.units[0].ap).toBe(1);

    s = standAt(fresh(s), 'ff1', 2, 5);
    tileAt(s, P(6, 5))!.contents = 'none';
    tileAt(s, P(6, 5))!.fire = 3;
    tileAt(s, P(6, 5))!.temperature = 800;
    tileAt(s, P(3, 5))!.kind = 'floor'; // clear the drywall stub out of the line of fire
    expect(performAction(s, { type: 'spray', unitId: 'ff1', target: P(6, 5) }).error).toBeUndefined(); // 4 tiles away
    s = run(s, { type: 'spray', unitId: 'ff1', target: P(6, 5) });
    expect(tileAt(s, P(6, 5))).toMatchObject({ fire: 0, temperature: 320 });
    expect(s.trucks[0].water).toBe(18);
  });

  it('nozzles can be put down, picked up by someone else, and packed away', () => {
    let s = run(parked(), move('ff1', P(2, 2)), take(), move('ff1', P(3, 2)));
    s = run(s, { type: 'dropLine', unitId: 'ff1' }, move('ff1', P(4, 2)));
    expect(s.hoses[0].holder).toBeUndefined();
    s = run(s, move('ff2', P(3, 2)));
    s = run(s, { type: 'pickupLine', unitId: 'ff2' });
    expect(s.units[1].line).toBe(s.hoses[0].id);
    s = run(s, { type: 'returnLine', unitId: 'ff2' });
    expect(s.hoses).toHaveLength(0);
    expect(hoseLeft(s, s.trucks[0])).toBe(28);
  });
});

describe('hydrants', () => {
  const hydrant = P(1, 2);
  const click = (unitId = 'ff1'): Action => ({ type: 'hydrant', unitId, target: hydrant });

  /**
   * Engine parked at the right end of the road facing right, so its rear (and the
   * supply coupling) is at x 7. ff1 walks the supply line to the hydrant on the left.
   */
  function supplyToHydrant(): GameState {
    let s = run(staged(), { type: 'placeTruck', truckId: 'truck1', pos: P(7, 0), orientation: 'h', reversed: true });
    s = run(s, move('ff1', P(7, 2)), { type: 'takeLine', unitId: 'ff1', kind: 'supply' }, move('ff1', P(6, 2), P(5, 2)));
    s = fresh(s);
    s = run(s, move('ff1', P(4, 2), P(3, 2), P(2, 2)));
    s.units[0].ap = 0;
    return s;
  }

  it('one click starts the hookup and the firefighter finishes it over the following turns', () => {
    let s = supplyToHydrant();
    expect(performAction(s, click()).error).toMatch(/no AP left/);
    s = endTurn(s);
    s.units[0].ap = 2; // only part of the 5 AP job fits this turn
    s = run(s, click());
    expect(s.hydrants[0]).toMatchObject({ state: 'uncapped', work: 2 });
    expect(s.units[0].task).toEqual(hydrant);
    expect(s.units[0].ap).toBe(0);

    // Next turn the job carries on by itself: 3 AP to finish coupling and opening.
    s.trucks[0].water = 5;
    s = endTurn(s);
    expect(s.hydrants[0]).toMatchObject({ state: 'opening', work: 5 });
    expect(s.units[0]).toMatchObject({ task: undefined, line: undefined, ap: 1 });
    expect(s.hoses[0].tiles).toHaveLength(7); // six tiles from the rear of the engine plus the hydrant coupling
    expect(s.trucks[0].water).toBe(5); // no water until the next fire phase

    s = endTurn(s);
    expect(s.hydrants[0].state).toBe('flowing');
    expect(s.trucks[0].water).toBe(13);
    s = endTurn(endTurn(s));
    expect(s.trucks[0].water).toBe(20); // capped at the tank size
  });

  it('with a full turn of AP the whole hookup is one click', () => {
    let s = fresh(supplyToHydrant());
    s.units[0].maxAp = 5;
    s.units[0].ap = 5;
    s = run(s, click());
    expect(s.hydrants[0].state).toBe('opening');
    expect(s.units[0].task).toBeUndefined();
  });

  it('walking away abandons the job', () => {
    let s = fresh(supplyToHydrant());
    s.units[0].ap = 1;
    s = run(s, click());
    expect(s.units[0].task).toEqual(hydrant);
    s = fresh(s);
    s = run(s, move('ff1', P(3, 2)));
    expect(s.units[0].task).toBeUndefined();
    s = endTurn(s);
    expect(s.hydrants[0].work).toBe(1);
  });

  it('the 5″ supply line comes off the coupling at the back of the engine', () => {
    let s = run(staged(), place('truck1', 0)); // facing left: the rear is at x 4
    s = standAt(s, 'ff1', 2, 2);
    expect(performAction(s, { type: 'takeLine', unitId: 'ff1', kind: 'supply' }).error).toMatch(/back of an engine or ladder truck/);
    s = standAt(s, 'ff1', 5, 0);
    s = run(s, { type: 'takeLine', unitId: 'ff1', kind: 'supply' });
    expect(s.hoses[0]).toMatchObject({ size: '5', origin: P(4, 0) });
    s = standAt(s, 'ff2', 5, 1);
    s = run(s, { type: 'takeLine', unitId: 'ff2', kind: 'supply' }); // a second line: hydrant and relay
    s = standAt(s, 'ff3', 4, 2);
    expect(performAction(s, { type: 'takeLine', unitId: 'ff3', kind: 'supply' }).error).toMatch(/already in use/);
  });

  it('without a supply line only the cap comes off', () => {
    let s = run(parked(), move('ff1', P(2, 2)));
    s = run(s, click());
    expect(s.hydrants[0]).toMatchObject({ state: 'uncapped', work: 1 });
    expect(s.units[0].task).toBeUndefined();
    expect(performAction(s, click()).error).toMatch(/supply line/);
    s = run(s, { type: 'takeLine', unitId: 'ff1', kind: 'attack' });
    expect(performAction(s, click()).error).toMatch(/supply line/);
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
    let s = run(parked(), move('ff1', P(2, 2)), { type: 'takeLine', unitId: 'ff1', kind: 'attack' }, move('ff1', P(3, 2)));
    s = run(s, { type: 'toggle', unitId: 'ff1', target: P(3, 3) });
    s = fresh(s);
    s = run(s, move('ff1', P(3, 3), P(3, 4)));
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
      move('ff1', P(2, 2)),
      { type: 'takeLine', unitId: 'ff1', kind: 'attack' },
      move('ff1', P(3, 2)),
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

describe('truck-to-truck supply and the aerial', () => {
  // parked(): engine at x 0–4 (rear coupling x 4, side inlets x 3); ladder truck at x 5–11 facing left
  // (side inlets x 8, turntable deck x 10, rear coupling x 11). Ladder crew is ff3.
  const tip = P(6, 2, 1); // open air just outside the upper floor's window at (6, 3)

  /** Engine supply line run from its rear to the ladder truck's inlet, and a second one on a flowing hydrant. */
  function relay(): GameState {
    let s = standAt(parked(), 'ff2', 4, 2);
    s = run(s, { type: 'takeLine', unitId: 'ff2', kind: 'supply' }, move('ff2', P(5, 2), P(6, 2), P(7, 2)));
    s = run(fresh(s), move('ff2', P(8, 2)), { type: 'inlet', unitId: 'ff2', truckId: 'truck2' });
    expect(s.hoses[0]).toMatchObject({ toTruck: 'truck2', holder: undefined });
    expect(s.hoses[0].tiles.at(-1)).toEqual(P(8, 1));
    s = standAt(s, 'ff1', 4, 2);
    s = run(s, { type: 'takeLine', unitId: 'ff1', kind: 'supply' });
    const line = s.hoses[1];
    Object.assign(s.hydrants[0], { state: 'flowing', lineId: line.id, work: 5 });
    Object.assign(line, { hydrant: P(1, 2), holder: undefined });
    s.units[0].line = undefined;
    return s;
  }

  it('a supply line can couple to another truck’s side inlet, relaying hydrant water', () => {
    let s = parked();
    expect(isSupplied(s, s.trucks[1])).toBe(false);
    s = relay();
    expect(isSupplied(s, s.trucks[0])).toBe(true);
    expect(isSupplied(s, s.trucks[1])).toBe(true);
    s.trucks[0].water = 0;
    s = endTurn(s);
    expect(s.trucks[0].water).toBe(8);
  });

  it('an engine can’t couple its own supply line to its own inlet', () => {
    let s = standAt(parked(), 'ff2', 4, 2);
    s = run(s, { type: 'takeLine', unitId: 'ff2', kind: 'supply' }, move('ff2', P(3, 2)));
    expect(performAction(s, { type: 'inlet', unitId: 'ff2', truckId: 'truck1' }).error).toMatch(/itself/);
  });

  it('anyone on the turntable can raise the aerial; it is a route up to a window', () => {
    let s = standAt(parked(), 'ff3', 10, 2);
    expect(performAction(s, { type: 'aerial', unitId: 'ff3', tip }).error).toMatch(/turntable/);
    s = run(s, move('ff3', P(10, 1)));
    expect(performAction(s, { type: 'aerial', unitId: 'ff3', tip: P(6, 4, 1) }).error).toMatch(/open air or on the roof/);
    expect(performAction(s, { type: 'aerial', unitId: 'ff3', tip: P(1, 2, 1) }).error).toMatch(/Out of reach/);
    s = run(s, { type: 'aerial', unitId: 'ff3', tip });
    expect(s.trucks[1].aerialTip).toEqual(tip);
    s = fresh(s);
    expect(pathTo(s, s.units[2], tip)).toEqual([tip]);
    s = run(s, move('ff3', tip), { type: 'toggle', unitId: 'ff3', target: P(6, 3, 1) }, move('ff3', P(6, 3, 1)));
    expect(s.units[2].pos).toEqual(P(6, 3, 1));
  });

  it('a raised aerial doesn’t get in anyone else’s way', () => {
    let s = run(standAt(parked(), 'ff3', 10, 1), { type: 'aerial', unitId: 'ff3', tip });
    s = standAt(s, 'ff1', 3, 2);
    s = endTurn(s);
    expect(pathTo(s, s.units[0], P(6, 2))).toEqual([P(4, 2), P(5, 2), P(6, 2)]);
    s = run(s, move('ff1', P(4, 2), P(5, 2), P(6, 2)), move('ff3', tip));
    expect(s.units[0].pos).toEqual(P(6, 2));
    expect(s.units[2].pos).toEqual(tip);
  });

  it('whoever is at the tip rides along when it swings', () => {
    let s = run(standAt(parked(), 'ff3', 10, 1), { type: 'aerial', unitId: 'ff3', tip });
    s = run(fresh(s), move('ff3', tip), { type: 'aerial', unitId: 'ff3', tip: P(7, 2, 1) });
    expect(s.units[2].pos).toEqual(P(7, 2, 1));
  });

  it('the master stream costs 1 AP, floods an area, and drains the small tank unless supplied', () => {
    const setup = (s: GameState) => {
      s = run(standAt(s, 'ff3', 10, 1), { type: 'aerial', unitId: 'ff3', tip });
      tileAt(s, P(6, 3, 1))!.open = true;
      for (const p of [P(6, 4, 1), P(5, 5, 1), P(6, 5, 1)]) tileAt(s, p)!.fire = 3;
      return fresh(s);
    };
    const stream = { type: 'masterStream', unitId: 'ff3', target: P(6, 4, 1) } as const;
    let s = setup(parked());
    expect(performAction(s, { ...stream, target: P(6, 5, 1) }).error).toBeUndefined();
    const ap = s.units[2].ap;
    s = run(s, stream);
    expect(s.units[2].ap).toBe(ap - 1);
    // The whole area around the target is knocked down, not just the target tile.
    for (const p of [P(6, 4, 1), P(5, 5, 1), P(6, 5, 1)]) expect(tileAt(s, p)!.fire).toBe(0);
    // ...but not through the wall beside the window.
    expect(streamArea(s, P(6, 4, 1)).some((p) => p.y === 3 && p.x !== 6)).toBe(false);
    expect(s.trucks[1].water).toBe(1);
    expect(performAction(fresh(s), stream).error).toMatch(/tank is dry/);

    s = setup(relay());
    s = run(s, stream, { ...stream, target: P(6, 5, 1) });
    expect(s.trucks[1].water).toBe(4);
  });
});

describe('master stream area', () => {
  /** A room split by a wall with a doorway; the door is open or closed. */
  const rooms = (door: 'D' | 'd') => buildState(miniScenario([['#######', '#,,w,,#', `#,,${door},,#`, '#,,w,,#', '#######']]));
  const hit = (s: GameState) => new Set(streamArea(s, P(2, 2)).map((p) => `${p.x},${p.y}`));

  it('walls and closed doors stop the water', () => {
    const area = hit(rooms('D'));
    expect([...area].sort()).toEqual(['1,1', '1,2', '1,3', '2,1', '2,2', '2,3'].sort());
  });

  it('an open door lets it through', () => {
    const area = hit(rooms('d'));
    expect(area.has('3,2')).toBe(true);
    expect(area.has('3,1')).toBe(false); // the wall beside the door still blocks
  });

  it('a broken window lets it through', () => {
    const s = buildState(miniScenario([['#######', '#,,W,,#', '#######']]));
    expect(streamArea(s, P(2, 1)).some((p) => p.x === 3)).toBe(false);
    Object.assign(tileAt(s, P(3, 1))!, { open: true, broken: true });
    expect(streamArea(s, P(2, 1)).some((p) => p.x === 3)).toBe(true);
  });
});
