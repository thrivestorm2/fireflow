import { actionCost, canSprayFrom, nozzleRange, type Action } from '../core/actions';
import { isAdjacent, isWalkable, samePos, tileAt } from '../core/grid';
import { hydrantAt } from '../core/hoses';
import { pathTo } from '../core/pathing';
import type { GameState, Pos, Unit } from '../core/types';

export type Mode = 'auto' | 'move' | 'spray' | 'door' | 'axe' | 'carry';

export const MODES: { mode: Mode; label: string; key: string; hint: string }[] = [
  { mode: 'auto', label: 'Auto', key: '1', hint: 'Pick the obvious action: move, spray, open doors, pick people up, work hydrants' },
  { mode: 'move', label: 'Move', key: '2', hint: 'Walk to a tile (stairs connect floors)' },
  { mode: 'spray', label: 'Spray', key: '3', hint: 'With an attack line: hose a tile up to 3 away in a straight line' },
  { mode: 'door', label: 'Door', key: '4', hint: 'Open or close an adjacent door or window' },
  { mode: 'axe', label: 'Tools', key: '5', hint: 'Ladder crews: force a locked door, axe a wall, door or window, or cut a roof vent (on the roof)' },
  { mode: 'carry', label: 'Carry', key: '6', hint: 'Pick up an adjacent civilian (click yourself to drop)' },
];

export type Plan = { actions: Action[] } | { error: string };

/** Translates a click on a tile into the actions the selected firefighter should take. */
export function planClick(state: GameState, unit: Unit, target: Pos, mode: Mode): Plan {
  const id = unit.id;
  const t = tileAt(state, target);
  if (!t) return { error: 'Out of bounds' };
  if (unit.aboard && mode !== 'auto' && mode !== 'move') return { error: `${unit.name} must get off the truck first` };

  const move = (): Plan => {
    if (samePos(unit.pos, target)) return { error: 'Already here' };
    const path = pathTo(state, unit, target);
    if (path) return { actions: [{ type: 'move', unitId: id, path }] };
    if (!isWalkable(t)) return { error: t.kind === 'door' || t.kind === 'window' ? `The ${t.kind} is closed` : 'Cannot stand there' };
    return { error: unit.ap === 0 ? `${unit.name} has no AP left this turn` : 'Cannot reach that tile this turn' };
  };
  const single = (a: Action): Plan => {
    const c = actionCost(state, a);
    return typeof c === 'string' ? { error: c } : { actions: [a] };
  };

  switch (mode) {
    case 'move':
      return move();
    case 'spray':
      return single({ type: 'spray', unitId: id, target });
    case 'door':
      return single({ type: 'toggle', unitId: id, target });
    case 'axe':
      if (t.kind === 'door' && t.locked) return single({ type: 'force', unitId: id, target });
      if (t.kind === 'roof') return single({ type: 'cutRoof', unitId: id, target });
      return single({ type: 'breach', unitId: id, target });
    case 'carry':
      if (unit.carrying && samePos(unit.pos, target)) return single({ type: 'drop', unitId: id });
      return single({ type: 'pickup', unitId: id, target });
    case 'auto': {
      if (unit.aboard) return move();
      const civ = state.units.find((u) => u.kind === 'civilian' && u.status === 'active' && !u.carriedBy && samePos(u.pos, target));
      if (civ && !unit.carrying && (isAdjacent(unit.pos, target) || samePos(unit.pos, target))) {
        return single({ type: 'pickup', unitId: id, target });
      }
      if (hydrantAt(state, target) && isAdjacent(unit.pos, target)) return single({ type: 'hydrant', unitId: id, target });
      const nozzle = state.hoses.some((l) => l.id === unit.line && l.kind === 'attack');
      if (t.fire > 0 && nozzle && !canSprayFrom(state, unit.pos, target, nozzleRange(state, unit))) {
        return single({ type: 'spray', unitId: id, target });
      }
      if ((t.kind === 'door' || t.kind === 'window') && !t.open && isAdjacent(unit.pos, target)) {
        if (t.locked && unit.role === 'ladder') return single({ type: 'force', unitId: id, target });
        return single({ type: 'toggle', unitId: id, target });
      }
      return move();
    }
  }
}
