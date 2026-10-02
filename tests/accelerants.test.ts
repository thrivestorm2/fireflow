import { describe, expect, it } from 'vitest';
import { performAction } from '../src/core/actions';
import { buildState } from '../src/core/building';
import { ACCELERANT, fireSystem } from '../src/core/fire';
import { endTurn } from '../src/core/game';
import { tileAt } from '../src/core/grid';
import { smokeSystem } from '../src/core/smoke';
import type { GameState, Pos } from '../src/core/types';
import { miniScenario, onPump, standAt } from './helpers';

const P = (x: number, y: number, floor = 0): Pos => ({ floor, x, y });
const heatRoom = (s: GameState, temperature: number) => {
  for (const row of s.floors[0]) for (const t of row) if (t.kind === 'floor') t.temperature = temperature;
};

/**
 * A tiled room (x 1–7, y 2–4) with something in the middle at (4, 3), a window at (4, 1), a road below.
 * A single hot tile in a cool room loses its heat to the room, so the tests heat the whole room, as a fire would.
 */
const room = (item: string) =>
  buildState(
    miniScenario(
      [
        {
          plan: ['.........', '####W####', '#ttttttt#', '#ttttttt#', '#ttttttt#', '#########', '=========', '=========', '========='],
          contents: ['', '', '', `    ${item}`],
        },
      ],
      {
        dispatch: [{ name: 'E', type: 'engine', arrivalTurn: 1, crew: ['A', 'B'] }],
        // A fire far off in the corner keeps the incident open.
        fires: [{ pos: P(8, 8), intensity: 1 }],
      },
    ),
  );

describe('accelerants', () => {
  it('a gas can flashes to full fire and spills burning liquid across the floor', () => {
    let s = room('g');
    heatRoom(s, 300);
    s = endTurn(s, [fireSystem]);
    expect(tileAt(s, P(4, 3))!.fire).toBe(3);
    // Ceramic tile can't burn by itself, but the spilled gasoline does.
    for (const p of [P(3, 3), P(5, 3), P(4, 2), P(4, 4)]) expect(tileAt(s, p)!.fire).toBeGreaterThan(0);
    expect(s.log.some((l) => /burning liquid spreads/.test(l.text))).toBe(true);
  });

  it('a heated propane cylinder explodes: fire and heat around it, glass and walls hit, people hurt', () => {
    let s = standAt(room('P'), 'ff1', 5, 4);
    const hp = s.units[0].hp;
    const wall = tileAt(s, P(4, 5))!.integrity;
    heatRoom(s, 360);
    s = endTurn(s, [fireSystem]);
    expect(tileAt(s, P(4, 3))!.contents).toBe('none');
    expect(tileAt(s, P(4, 1))).toMatchObject({ open: true, broken: true });
    expect(tileAt(s, P(4, 5))!.integrity).toBeLessThan(wall);
    expect(s.units[0].hp).toBe(hp - ACCELERANT.blastInjury);
    expect(s.log.some((l) => /propane cylinder explodes/.test(l.text))).toBe(true);
  });

  it('burning accelerants pour out black smoke', () => {
    const smokeAt = (item: string) => {
      let s = room(item);
      tileAt(s, P(4, 3))!.fire = 2;
      s = endTurn(s, [smokeSystem]);
      return s.floors[0][3].reduce((n, t) => n + t.smoke, 0);
    };
    expect(smokeAt('D')).toBeGreaterThan(smokeAt('k') * 1.5);
  });

  it('water does little against burning liquid', () => {
    const sprayOn = (item: string) => {
      let s = room(item);
      Object.assign(s.trucks[0], { status: 'placed', pos: P(0, 7) });
      Object.assign(tileAt(s, P(4, 3))!, { fire: 3, fuel: 20 });
      s = onPump(standAt(s, 'ff1', 2, 3), 'ff2');
      s.hoses.push({ id: 'l1', truckId: 'truck1', kind: 'attack', size: '1.75', origin: P(2, 7), tiles: [P(2, 3)], holder: 'ff1' });
      s.units[0].line = 'l1';
      const r = performAction(s, { type: 'spray', unitId: 'ff1', target: P(4, 3) });
      expect(r.error).toBeUndefined();
      return tileAt(r.state, P(4, 3))!.fire;
    };
    expect(sprayOn('k')).toBe(1); // a burning table: 3 − 2
    expect(sprayOn('D')).toBe(2); // a burning solvent drum: 3 − 1
  });
});
