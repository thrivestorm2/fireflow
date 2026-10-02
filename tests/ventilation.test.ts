import { describe, expect, it } from 'vitest';
import { performAction, sprayRange } from '../src/core/actions';
import { buildState } from '../src/core/building';
import { endTurn, newGame } from '../src/core/game';
import { forEachTile, tileAt } from '../src/core/grid';
import { smokeSystem } from '../src/core/smoke';
import type { GameState, Pos } from '../src/core/types';
import { fanSystem } from '../src/core/ventilation';
import { houseFire } from '../src/scenarios/house';
import { miniScenario, run, standAt } from './helpers';

const P = (x: number, y: number, floor = 0): Pos => ({ floor, x, y });

/** One-room house with a locked side door, a window, an upper floor and a roof. Ladder crew ff1, engine crew ff2. */
const house = () =>
  buildState(
    miniScenario(
      [
        ['.........', '.#######.', '.#,,,,,W.', '.L,,,,,#.', '.#######.', '.........'],
        ['         ', ' ####### ', ' #,,,,,# ', ' #,,,,,# ', ' ####### ', '         '],
        ['         ', ' RRRRRRR ', ' RRRRRRR ', ' RRRRRRR ', ' RRRRRRR ', '         '],
      ],
      {
        dispatch: [
          { name: 'Ladder', type: 'ladder', arrivalTurn: 1, crew: ['L'] },
          { name: 'Engine', type: 'engine', arrivalTurn: 1, crew: ['E'] },
        ],
        civilians: [{ name: 'V', pos: P(6, 3) }],
        // A stray fire out in the yard keeps the incident open while the rules are exercised.
        fires: [{ pos: P(8, 0), intensity: 1 }],
      },
    ),
  );

const fillSmoke = (s: GameState, floor: number, amount: number) =>
  forEachTile(s, (t, p) => {
    if (p.floor === floor && t.kind === 'floor') t.smoke = amount;
  });
const fresh = (s: GameState) => {
  for (const u of s.units) u.ap = u.maxAp;
  return s;
};

describe('forcible entry', () => {
  it('any crew can force a locked door', () => {
    let s = standAt(standAt(house(), 'ff1', 0, 3), 'ff2', 1, 5);
    s.units[1].pos = P(0, 2);
    expect(performAction(s, { type: 'toggle', unitId: 'ff2', target: P(1, 3) }).error).toBeTruthy();
    s = standAt(s, 'ff2', 0, 4);
    s.units[1].pos = P(1, 4);
    const e = standAt(structuredClone(s), 'ff2', 0, 2);
    e.units[1].pos = P(0, 3);
    e.units[0].pos = P(0, 0);
    expect(performAction(e, { type: 'toggle', unitId: 'ff2', target: P(1, 3) }).error).toMatch(/Locked/);
    const forced = run(e, { type: 'force', unitId: 'ff2', target: P(1, 3) }); // engine crew
    expect(tileAt(forced, P(1, 3))).toMatchObject({ locked: false, open: true });
    s = run(s, { type: 'force', unitId: 'ff1', target: P(1, 3) });
    expect(tileAt(s, P(1, 3))).toMatchObject({ locked: false, open: true });
  });

  it('only ladder crews can force a reinforced door, and it takes longer', () => {
    let s = standAt(house(), 'ff2', 0, 3); // engine crew beside the door
    Object.assign(tileAt(s, P(1, 3))!, { reinforced: true });
    expect(performAction(s, { type: 'toggle', unitId: 'ff2', target: P(1, 3) }).error).toMatch(/reinforced/);
    expect(performAction(s, { type: 'force', unitId: 'ff2', target: P(1, 3) }).error).toMatch(/only a ladder crew/);
    s = standAt(standAt(s, 'ff2', 0, 0), 'ff1', 0, 3);
    const ap = s.units[0].ap;
    s = run(s, { type: 'force', unitId: 'ff1', target: P(1, 3) });
    expect(s.units[0].ap).toBe(ap - 3);
    expect(tileAt(s, P(1, 3))).toMatchObject({ locked: false, reinforced: false, open: true });
  });
});

describe('roof ventilation', () => {
  it('ground ladders reach the roof; ladder crews cut vents that let smoke out', () => {
    let s = standAt(house(), 'ff1', 0, 2);
    s = run(s, { type: 'ladder', unitId: 'ff1' });
    expect([0, 1, 2].map((f) => tileAt(s, P(0, 2, f))!.ladder)).toEqual([true, true, true]);
    s = run(s, { type: 'move', unitId: 'ff1', path: [P(0, 2, 1), P(0, 2, 2), P(1, 2, 2)] });
    expect(performAction(s, { type: 'cutRoof', unitId: 'ff1', target: P(3, 2, 2) }).error).toMatch(/adjacent/);
    s = fresh(s);
    s = run(s, { type: 'cutRoof', unitId: 'ff1', target: P(2, 2, 2) });
    expect(tileAt(s, P(2, 2, 2))!.kind).toBe('vent');

    // Same smoky upper floor with and without the vent.
    const sealed = house();
    fillSmoke(s, 1, 80);
    fillSmoke(sealed, 1, 80);
    const smokeLeft = (x: GameState) => {
      let total = 0;
      forEachTile(endTurn(endTurn(x, [smokeSystem]), [smokeSystem]), (t, p) => p.floor === 1 && (total += t.smoke));
      return total;
    };
    expect(smokeLeft(s)).toBeLessThan(smokeLeft(sealed) * 0.6);
  });

  it('engine crews cannot cut the roof', () => {
    const s = standAt(house(), 'ff2', 1, 2, 2);
    expect(performAction(s, { type: 'cutRoof', unitId: 'ff2', target: P(2, 2, 2) }).error).toMatch(/Only ladder crews/);
  });
});

describe('fans', () => {
  /** Ladder crew forces the side door and sets a fan outside it. */
  const withFan = (windowOpen: boolean) => {
    let s = standAt(house(), 'ff1', 0, 3);
    s = run(s, { type: 'force', unitId: 'ff1', target: P(1, 3) }, { type: 'placeFan', unitId: 'ff1', target: P(1, 3) });
    tileAt(s, P(7, 2))!.open = windowOpen;
    return s;
  };

  it('needs an open door or window and the truck to have a fan', () => {
    const s = standAt(house(), 'ff1', 0, 3);
    expect(performAction(s, { type: 'placeFan', unitId: 'ff1', target: P(1, 3) }).error).toMatch(/open door or window/);
    const placed = withFan(true);
    expect(placed.fans).toHaveLength(1);
    expect(placed.trucks[0].fans).toBe(0);
  });

  it('clears smoke fast when there is an exhaust opening, slowly when sealed', () => {
    const vented = withFan(true);
    const sealed = withFan(false);
    fillSmoke(vented, 0, 80);
    fillSmoke(sealed, 0, 80);
    const a = endTurn(vented, [fanSystem]);
    const b = endTurn(sealed, [fanSystem]);
    expect(tileAt(a, P(4, 2))!.smoke).toBe(20);
    expect(tileAt(b, P(4, 2))!.smoke).toBe(68);
  });

  it('makes the fire worse if it has not been put out', () => {
    const s = withFan(true);
    const t = tileAt(s, P(4, 2))!;
    t.fire = 1;
    const before = tileAt(s, P(5, 2))!.temperature;
    let grew = 0;
    let after = s;
    for (let i = 0; i < 5; i++) {
      const trial = structuredClone(s);
      trial.rngState = i + 1;
      after = endTurn(trial, [fanSystem]);
      if (tileAt(after, P(4, 2))!.fire > 1) grew++;
    }
    expect(grew).toBeGreaterThan(0);
    expect(tileAt(after, P(5, 2))!.temperature).toBeGreaterThan(before);
    expect(after.log.some((l) => /feeding the fire/.test(l.text))).toBe(true);
  });

  it('can be shut down and goes back on the truck', () => {
    let s = fresh(withFan(true));
    s = run(s, { type: 'removeFan', unitId: 'ff1', target: P(0, 3) });
    expect(s.fans).toHaveLength(0);
    expect(s.trucks[0].fans).toBe(1);
  });
});

describe('smoke slows the crew', () => {
  it('victims are hidden until seen through clear air or searched for', () => {
    let s = standAt(house(), 'ff1', 0, 3);
    s = run(s, { type: 'force', unitId: 'ff1', target: P(1, 3) });
    // Clear room: the victim 5 tiles away is out of sight range until the crew steps in.
    expect(s.units.find((u) => u.id === 'cv1')!.found).toBe(false);
    s = run(s, { type: 'move', unitId: 'ff1', path: [P(1, 3), P(2, 3), P(3, 3)] });
    expect(s.units.find((u) => u.id === 'cv1')!.found).toBe(true);
  });

  it('in thick smoke the crew must search tile by tile, at extra cost', () => {
    let s = standAt(house(), 'ff1', 0, 3);
    s = run(s, { type: 'force', unitId: 'ff1', target: P(1, 3) });
    fillSmoke(s, 0, 80);
    s = fresh(s);
    s = run(s, { type: 'move', unitId: 'ff1', path: [P(1, 3), P(2, 3)] }); // 1 + 2 in thick smoke
    expect(s.units.find((u) => u.id === 'cv1')!.found).toBe(false);
    s = fresh(s);
    s = run(s, { type: 'move', unitId: 'ff1', path: [P(3, 3), P(4, 3)] });
    s = fresh(s);
    s = run(s, { type: 'move', unitId: 'ff1', path: [P(4, 2), P(5, 2)] });
    expect(s.units.find((u) => u.id === 'cv1')!.found).toBe(false); // right beside them, but blind
    s = fresh(s);
    expect(performAction(s, { type: 'search', unitId: 'ff1' }).state.units.find((u) => u.id === 'cv1')!.found).toBe(true);
    expect(s.units[0].ap - performAction(s, { type: 'search', unitId: 'ff1' }).state.units[0].ap).toBe(2);
  });

  it('unfound victims cannot be picked up', () => {
    let s = standAt(house(), 'ff1', 5, 3);
    fillSmoke(s, 0, 80);
    s.units.find((u) => u.id === 'cv1')!.found = false;
    expect(performAction(s, { type: 'pickup', unitId: 'ff1', target: P(6, 3) }).error).toMatch(/Nobody/);
  });

  it('spraying costs 1 AP whatever the smoke, but thick smoke cuts the reach', () => {
    let s = standAt(house(), 'ff2', 3, 2);
    s.hoses.push({ id: 'l1', truckId: 'truck2', kind: 'attack', size: '1.75', side: 0, origin: P(0, 0), tiles: [P(3, 2)], holder: 'ff2' });
    s.units[1].line = 'l1';
    s.trucks[1].status = 'placed';
    const at = P(3, 2);
    const spray = { type: 'spray', unitId: 'ff2', target: P(4, 2) } as const;
    for (const [smoke, range] of [[0, 3], [40, 3], [70, 2]]) {
      tileAt(s, at)!.smoke = smoke;
      expect(sprayRange(s, at)).toBe(range);
      const ap = s.units[1].ap;
      expect(run(s, spray).units[1].ap).toBe(ap - 1);
    }
  });
});

describe('roads', () => {
  it('are 2 tiles wide for one lane or at least 4 for two lanes', () => {
    const s = newGame(houseFire);
    const run = (x: number, y: number, dx: number, dy: number) => {
      let n = 0;
      for (let i = 1; tileAt(s, P(x + dx * i, y + dy * i))?.drivable; i++) n++;
      return n;
    };
    forEachTile(s, (t, p) => {
      if (!t.drivable) return;
      const width = Math.min(1 + run(p.x, p.y, 1, 0) + run(p.x, p.y, -1, 0), 1 + run(p.x, p.y, 0, 1) + run(p.x, p.y, 0, -1));
      expect([2, 4, 5, 6].includes(width) || width >= 4, `road width ${width} at ${p.x},${p.y}`).toBe(true);
      expect(width).not.toBe(3);
      expect(width).toBeGreaterThanOrEqual(2);
    });
  });
});
