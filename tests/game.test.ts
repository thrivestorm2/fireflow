import { describe, expect, it } from 'vitest';
import { performAction } from '../src/core/actions';
import { buildState } from '../src/core/building';
import { endTurn, newGame, summarize } from '../src/core/game';
import { houseFire } from '../src/scenarios/house';
import { miniScenario } from './helpers';

describe('game flow', () => {
  it('builds the house scenario', () => {
    const s = newGame(houseFire);
    expect(s.floors).toHaveLength(2);
    expect(s.units.filter((u) => u.kind === 'firefighter')).toHaveLength(3);
    expect(summarize(s).burning).toBeGreaterThan(0);
  });

  it('restores AP and advances the turn', () => {
    let s = newGame(houseFire);
    s.units[0].ap = 0;
    s = endTurn(s);
    expect(s.turn).toBe(2);
    expect(s.units[0].ap).toBe(4);
  });

  it('is won when the last fire is put out', () => {
    const s = buildState(
      miniScenario([['......', '.#__#.', '......']], {
        firefighters: [{ name: 'A', pos: { floor: 0, x: 2, y: 1 } }],
        fires: [{ pos: { floor: 0, x: 3, y: 1 }, intensity: 2 }],
      }),
    );
    const r = performAction(s, { type: 'spray', unitId: 'ff1', target: { floor: 0, x: 3, y: 1 } });
    expect(r.state.status).toBe('won');
  });

  it('is lost when every firefighter is down', () => {
    const s = buildState(
      miniScenario([['#####', '#fff#', '#####']], {
        firefighters: [{ name: 'A', pos: { floor: 0, x: 2, y: 1 } }],
        fires: [{ pos: { floor: 0, x: 2, y: 1 }, intensity: 3 }],
      }),
    );
    s.units[0].hp = 1;
    expect(endTurn(s).status).toBe('lost');
  });

  it('kills civilians left in smoke and heat', () => {
    let s = newGame(houseFire);
    for (let i = 0; i < 60 && s.status === 'playing'; i++) s = endTurn(s);
    expect(summarize(s).dead).toBeGreaterThan(0);
  });
});
