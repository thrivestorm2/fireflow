import { actionCost, canSprayFrom, fanAt, nozzleRange, pathCost, type Action } from '../core/actions';
import { isAdjacent, isWalkable, samePos, tileAt } from '../core/grid';
import { hydrantAt } from '../core/hoses';
import { isKnown, knowledge } from '../core/knowledge';
import { pathTo } from '../core/pathing';
import { AERIAL, aerialStation, aerialTipError } from '../core/trucks';
import type { GameState, Pos, Unit } from '../core/types';

/** Something the selected firefighter could do with a click: shown in the tap menu when there's more than one. */
export interface Option {
  label: string;
  actions: Action[];
  cost: number;
}

export type Choice = { options: Option[] } | { error: string };

/** Heat a thermal camera shows clearly enough to aim water at, without seeing the flames. */
const THERMAL_AIM = 200;

/**
 * Everything the selected firefighter could do by clicking `target`, most
 * likely first. One option means just do it; several mean ask with a tap menu.
 * `raw` is the tile on the floor being viewed, even where that floor is open air
 * (which otherwise shows the ground below): the aerial can be swung there.
 */
export function clickOptions(state: GameState, unit: Unit, target: Pos, raw: Pos = target): Choice {
  const id = unit.id;
  const t = tileAt(state, target);
  if (!t) return { error: 'Out of bounds' };
  const options: Option[] = [];
  let firstError: string | undefined;
  const offer = (label: string, a: Action) => {
    const c = actionCost(state, a);
    if (typeof c === 'number') options.push({ label, actions: [a], cost: c });
    else firstError ??= c;
  };
  const move = () => {
    if (samePos(unit.pos, target) && !unit.aboard) return;
    const path = pathTo(state, unit, target);
    if (path) {
      const c = pathCost(state, unit, path);
      if (typeof c === 'number') options.push({ label: unit.aboard ? 'Get off here' : 'Move here', actions: [{ type: 'move', unitId: id, path }], cost: c });
      return;
    }
    if (!isWalkable(t)) firstError ??= t.kind === 'door' || t.kind === 'window' ? `The ${t.kind} is closed` : 'Cannot stand there';
    else firstError ??= unit.ap === 0 ? `${unit.name} has no AP left this turn` : 'Cannot reach that tile this turn';
  };

  if (unit.aboard) {
    move();
    return options.length ? { options } : { error: firstError ?? 'Nothing to do there' };
  }

  // On yourself: jobs done where you stand.
  if (samePos(unit.pos, target)) {
    if (unit.carrying) offer('Put the person down', { type: 'drop', unitId: id });
    const civ = civilianAt(state, target);
    if (civ && !unit.carrying) offer(`Pick up ${civ.name}`, { type: 'pickup', unitId: id, target });
    offer('Search here', { type: 'search', unitId: id });
    if (unit.line) {
      offer('Put the hose down', { type: 'dropLine', unitId: id });
      offer('Pack the hose onto its truck', { type: 'returnLine', unitId: id });
    } else offer('Pick up the hose', { type: 'pickupLine', unitId: id });
    offer('Raise a ground ladder', { type: 'ladder', unitId: id });
    return options.length ? { options } : { error: firstError ?? 'Nothing to do here' };
  }

  const civ = civilianAt(state, target);
  if (civ && !unit.carrying) offer(`Pick up ${civ.name}`, { type: 'pickup', unitId: id, target });
  const h = hydrantAt(state, target);
  if (h) offer(h.state === 'capped' ? 'Hook up the hydrant' : 'Work the hydrant', { type: 'hydrant', unitId: id, target });

  // Water: on fire the crew can see, or heat the thermal camera shows.
  const aim = (t.fire > 0 && isKnown(state, target)) || (knowledge(state).thermal.has(`${target.floor},${target.x},${target.y}`) && t.temperature >= THERMAL_AIM);
  const line = state.hoses.find((l) => l.id === unit.line && l.kind === 'attack');
  if (aim && line && !canSprayFrom(state, unit.pos, target, nozzleRange(state, unit))) offer('Spray', { type: 'spray', unitId: id, target });
  const aerial = aerialStation(state, unit);
  if (aim && aerial?.aerialTip && !unit.line && !canSprayFrom(state, aerial.aerialTip, target, AERIAL.streamRange)) {
    offer('Master stream', { type: 'masterStream', unitId: id, target });
  }
  if (aerial && !aerialTipError(state, aerial, raw) && !(aerial.aerialTip && samePos(aerial.aerialTip, raw))) {
    offer(aerial.aerialTip ? 'Swing the aerial here' : 'Raise the aerial here', { type: 'aerial', unitId: id, tip: raw });
  }

  // Doors, windows and walls next to you.
  if (isAdjacent(unit.pos, target)) {
    if (t.kind === 'door' && t.locked) offer(t.reinforced ? 'Force the reinforced door' : 'Force the door', { type: 'force', unitId: id, target });
    if ((t.kind === 'door' || t.kind === 'window') && !t.open && !t.locked) offer(`Open the ${t.kind}`, { type: 'toggle', unitId: id, target });
  }
  move();
  if (isAdjacent(unit.pos, target)) {
    if ((t.kind === 'door' || t.kind === 'window') && t.open && !t.broken) offer(`Close the ${t.kind}`, { type: 'toggle', unitId: id, target });
    if (t.kind === 'window' && !t.broken) offer('Break the window', { type: 'breach', unitId: id, target });
    if (t.kind === 'door' && !t.open) offer('Axe through the door', { type: 'breach', unitId: id, target });
    if (t.kind === 'wall') offer('Axe through the wall', { type: 'breach', unitId: id, target });
    if (t.kind === 'roof') offer('Cut a vent', { type: 'cutRoof', unitId: id, target });
    if ((t.kind === 'door' || t.kind === 'window' || t.kind === 'rubble') && (t.open || t.kind === 'rubble')) {
      offer('Set up a fan blowing in here', { type: 'placeFan', unitId: id, target });
    }
  }
  if (fanAt(state, target)) offer('Shut down the fan', { type: 'removeFan', unitId: id, target });

  return options.length ? { options } : { error: firstError ?? 'Nothing to do there' };
}

function civilianAt(state: GameState, p: Pos): Unit | undefined {
  return state.units.find((u) => u.kind === 'civilian' && u.occupant !== 'bystander' && u.status === 'active' && u.found && !u.carriedBy && samePos(u.pos, p));
}
