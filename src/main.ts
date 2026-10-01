import { actionCost, performAction, type Action } from './core/actions';
import { exposureDamage } from './core/exposure';
import { endTurn, newGame, summarize } from './core/game';
import { conditions, isAdjacent, neighbors, samePos, tileAt } from './core/grid';
import { CONTENTS, ignitionOf, MATERIALS } from './core/materials';
import { reachable } from './core/pathing';
import { HOSE_SIZES, HYDRANT_LABEL, HYDRANT_TOTAL, hoseLeft, hydrantAt, linesThrough, supplyFor } from './core/hoses';
import { dischargeTiles, placementError, seatOf, supplyTiles, truckTiles } from './core/trucks';
import type { GameState, HoseSize, Orientation, Pos, Truck, Unit } from './core/types';
import { houseFire } from './scenarios/house';
import { MODES, planClick, type Mode } from './ui/intent';
import { drawFloor, isVisible, shownPos, TILE, type Overlay } from './ui/render';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const OVERLAYS: { overlay: Overlay; label: string }[] = [
  { overlay: 'normal', label: 'Normal' },
  { overlay: 'heat', label: 'Heat' },
  { overlay: 'smoke', label: 'Smoke' },
  { overlay: 'structure', label: 'Structure' },
];

let state: GameState = newGame(houseFire);
/** States before each action this turn, for undo. */
let history: GameState[] = [];
let selectedId: string | undefined;
let mode: Mode = 'auto';
let overlay: Overlay = 'normal';
let hover: Pos | undefined;
let hint = { text: '', error: false };
/** Truck currently being parked, if any. */
let placing: { truckId: string; orientation: Orientation; reversed: boolean } | undefined;

/** R turns the truck a quarter clockwise: front facing left → up → right → down. */
const FACINGS: { orientation: Orientation; reversed: boolean; label: string }[] = [
  { orientation: 'h', reversed: false, label: 'left' },
  { orientation: 'v', reversed: false, label: 'up' },
  { orientation: 'h', reversed: true, label: 'right' },
  { orientation: 'v', reversed: true, label: 'down' },
];

let canvas: HTMLCanvasElement;
/** The level being viewed: 0 = ground floor. Outside the building the ground always shows. */
let viewFloor = 0;

const firefighters = (): Unit[] => state.units.filter((u) => u.kind === 'firefighter');
const selected = (): Unit | undefined => state.units.find((u) => u.id === selectedId && u.status === 'active');
const truckById = (id?: string): Truck | undefined => state.trucks.find((t) => t.id === id);

function setHint(text: string, error = false): void {
  hint = { text, error };
}

/** Select a firefighter, switching to their floor if they can't be seen from this one. */
function select(id: string | undefined): void {
  selectedId = id;
  const u = selected();
  if (u && !u.aboard && !isVisible(state, viewFloor, u.pos)) viewFloor = u.pos.floor;
}

function setFloor(f: number): void {
  viewFloor = Math.max(0, Math.min(state.floors.length - 1, f));
  hover = undefined;
  render();
}

// ---------------------------------------------------------------- stage & layout

/** One canvas for the whole site, plus the floor navigator beside it. */
function buildStage(): void {
  const root = $('floors');
  root.innerHTML = '';
  const stage = document.createElement('div');
  stage.className = 'stage';
  const nav = document.createElement('nav');
  nav.className = 'floor-nav';
  nav.setAttribute('aria-label', 'Floors');
  nav.innerHTML = `
    <button id="floor-up" class="floor-arrow" title="Up a floor (↑)">▲<span class="fire-dot" id="fire-up"></span></button>
    <button id="floor-num" class="floor-num" title="Back to the ground floor (Home)"></button>
    <div id="floor-name" class="floor-name"></div>
    <button id="floor-down" class="floor-arrow" title="Down a floor (↓)">▼<span class="fire-dot" id="fire-down"></span></button>`;
  canvas = document.createElement('canvas');
  canvas.width = state.width * TILE;
  canvas.height = state.height * TILE;
  canvas.addEventListener('mousemove', (e) => {
    hover = eventPos(e);
    renderInspector();
  });
  canvas.addEventListener('mouseleave', () => {
    hover = undefined;
    renderInspector();
  });
  canvas.addEventListener('click', (e) => {
    const p = eventPos(e);
    if (p) onTileClick(p, tileFraction(e));
  });
  canvas.addEventListener('contextmenu', (e) => {
    if (!placing) return;
    e.preventDefault();
    rotatePlacement();
  });
  stage.append(nav, canvas);
  root.append(stage);
  $('floor-up').addEventListener('click', () => setFloor(viewFloor + 1));
  $('floor-down').addEventListener('click', () => setFloor(viewFloor - 1));
  $('floor-num').addEventListener('click', () => setFloor(0));
  layout();
}

/** Fits the site into the space beside the navigator, keeping tiles square. */
function layout(): void {
  const width = $('floors').clientWidth - 96;
  const available = window.innerHeight - 90;
  const tile = Math.max(14, Math.min(44, Math.floor(Math.min(width / state.width, available / state.height))));
  canvas.style.width = `${state.width * tile}px`;
  canvas.style.height = `${state.height * tile}px`;
}

/** The tile under the mouse, as it is shown on the current floor (the ground, outside the building). */
function eventPos(e: MouseEvent): Pos | undefined {
  const r = canvas.getBoundingClientRect();
  const x = Math.floor(((e.clientX - r.left) / r.width) * state.width);
  const y = Math.floor(((e.clientY - r.top) / r.height) * state.height);
  return x >= 0 && y >= 0 && x < state.width && y < state.height ? shownPos(state, viewFloor, x, y) : undefined;
}

/** Where inside its tile a click landed, 0..1 on each axis. */
function tileFraction(e: MouseEvent): { fx: number; fy: number } {
  const r = canvas.getBoundingClientRect();
  const gx = ((e.clientX - r.left) / r.width) * state.width;
  const gy = ((e.clientY - r.top) / r.height) * state.height;
  return { fx: gx - Math.floor(gx), fy: gy - Math.floor(gy) };
}

/**
 * A click on an engine's hose connections: the half toward the front is the
 * red 1¾″ coupling, the half toward the back the blue 2½″.
 */
function couplingClick(p: Pos, frac: { fx: number; fy: number }): { size: HoseSize; side?: 0 | 1 } | undefined {
  for (const truck of state.trucks) {
    if (supplyTiles(truck).some((q) => samePos(q, p))) return { size: '5' };
    const d = dischargeTiles(truck).find((d) => samePos(d.pos, p));
    if (!d) continue;
    const along = truck.orientation === 'h' ? frac.fx : frac.fy;
    const frontHalf = truck.reversed ? along >= 0.5 : along < 0.5;
    return { size: frontHalf ? '1.75' : '2.5', side: d.side };
  }
  return undefined;
}

// ---------------------------------------------------------------- actions

function commit(actions: Action[]): boolean {
  const before = state;
  let s = state;
  let error: string | undefined;
  for (const a of actions) {
    const r = performAction(s, a);
    if (r.error) {
      error = r.error;
      break;
    }
    s = r.state;
  }
  if (s !== before) {
    history.push(before);
    state = s;
    select(selectedId); // follow the selected firefighter up or down stairs and ladders
  }
  setHint(error ?? '', !!error);
  render();
  return !error;
}

function onTileClick(p: Pos, frac = { fx: 0.5, fy: 0.5 }): void {
  if (state.status !== 'playing') return;

  if (placing) {
    if (p.floor !== 0) return setHintAndRender('Trucks park on the ground floor.', true);
    const truck = truckById(placing.truckId)!;
    if (commit([{ type: 'placeTruck', truckId: truck.id, pos: p, orientation: placing.orientation, reversed: placing.reversed }])) {
      placing = undefined;
      selectedId = state.units.find((u) => u.aboard === truck.id && u.status === 'active')?.id ?? selectedId;
      setHintAndRender(`${truck.name} parked. Click a crew member on the truck, then a tile next to it to get them off.`);
    }
    return;
  }

  const own = firefighters().find((u) => u.status === 'active' && !u.aboard && u.pos.floor === p.floor && u.pos.x === p.x && u.pos.y === p.y);
  const sel = selected();
  // Clicking a hose coupling with a firefighter beside it takes that attack line.
  const coupling = couplingClick(p, frac);
  if (coupling && sel && !sel.aboard) {
    commit([
      coupling.size === '5'
        ? { type: 'takeLine', unitId: sel.id, kind: 'supply' }
        : { type: 'takeLine', unitId: sel.id, kind: 'attack', size: coupling.size, side: coupling.side },
    ]);
    return;
  }
  // Clicking another firefighter selects them, unless an explicit mode targets that tile.
  if (own && (!sel || (own.id !== sel.id && (mode === 'auto' || mode === 'move')))) {
    selectedId = own.id;
    return setHintAndRender(`${own.name} selected.`);
  }
  // Clicking a crew member seated on a truck selects them.
  const seated = firefighters().find((u) => u.aboard && u.status === 'active' && samePos(seatOf(state, u) ?? NOWHERE, p));
  if (seated) {
    selectedId = seated.id;
    return setHintAndRender(`${seated.name} selected — click a tile next to ${truckById(seated.aboard)?.name} to get off.`);
  }
  // Clicking elsewhere on a parked truck selects the next crew member still aboard.
  const truck = state.trucks.find((t) => t.status === 'placed' && footprintHas(t, p));
  if (truck && (!sel || !sel.aboard || sel.aboard !== truck.id)) {
    const crew = state.units.find((u) => u.aboard === truck.id && u.status === 'active');
    if (crew) {
      selectedId = crew.id;
      return setHintAndRender(`${crew.name} selected — click a tile next to ${truck.name} to get off.`);
    }
  }
  if (!sel) return setHintAndRender('Select a firefighter first (Tab).', true);
  if (sel.aboard && truckById(sel.aboard)?.status !== 'placed') {
    return setHintAndRender(`${sel.name} is still on ${truckById(sel.aboard)?.name}. Park the truck first.`, true);
  }
  const plan = planClick(state, sel, p, mode);
  if ('error' in plan) return setHintAndRender(plan.error, true);
  commit(plan.actions);
}

const NOWHERE: Pos = { floor: -1, x: -1, y: -1 };

function footprintHas(t: Truck, p: Pos): boolean {
  return p.floor === 0 && truckTiles(t).some((q) => q.x === p.x && q.y === p.y);
}

function setHintAndRender(text: string, error = false): void {
  setHint(text, error);
  render();
}

function startPlacing(truck: Truck): void {
  viewFloor = 0; // trucks park on the ground
  placing = { truckId: truck.id, orientation: placing?.orientation ?? 'h', reversed: placing?.reversed ?? false };
  setHintAndRender(
    `Click a road or driveway tile to park ${truck.name}. R or right-click turns it (the arrow and white headlights mark the front, red lights the back). Esc cancels.`,
  );
}

function rotatePlacement(): void {
  if (!placing) return;
  const i = FACINGS.findIndex((f) => f.orientation === placing!.orientation && f.reversed === placing!.reversed);
  const next = FACINGS[(i + 1) % FACINGS.length];
  placing.orientation = next.orientation;
  placing.reversed = next.reversed;
  setHintAndRender(`${truckById(placing.truckId)?.name} facing ${next.label}.`);
}

function doEndTurn(): void {
  if (state.status !== 'playing') return;
  placing = undefined;
  showBanner('🔥 Fire phase');
  state = endTurn(state);
  history = [];
  if (!selected()) selectedId = firefighters().find((u) => u.status === 'active')?.id;
  const arrived = state.trucks.filter((t) => t.status === 'staged' && t.arrivalTurn === state.turn);
  setHint(arrived.length ? `${arrived.map((t) => t.name).join(' and ')} on scene — park it.` : `Turn ${state.turn}. Your move.`);
  render();
}

function showBanner(text: string): void {
  const b = $('banner');
  b.textContent = text;
  b.hidden = false;
  b.style.animation = 'none';
  void b.offsetWidth; // restart the animation
  b.style.animation = '';
  window.setTimeout(() => (b.hidden = true), 1100);
}

function undo(): void {
  const prev = history.pop();
  if (!prev) return;
  state = prev;
  setHintAndRender('Undone.');
}

function cycleSelection(): void {
  const usable = firefighters().filter((u) => u.status === 'active' && (!u.aboard || truckById(u.aboard)?.status === 'placed'));
  if (!usable.length) return;
  const i = usable.findIndex((u) => u.id === selectedId);
  select(usable[(i + 1) % usable.length].id);
  render();
}

function setMode(m: Mode): void {
  mode = m;
  setHintAndRender(MODES.find((x) => x.mode === m)!.hint);
}

type UnitButton = 'drop' | 'attack' | 'attack25' | 'supply' | 'nozzle' | 'pack' | 'hydrant' | 'ladder' | 'search' | 'fan';
const UNIT_BUTTONS: UnitButton[] = ['drop', 'attack', 'attack25', 'supply', 'nozzle', 'pack', 'hydrant', 'ladder', 'search', 'fan'];

/** The action behind each side-panel button, for the selected firefighter. */
function buttonAction(kind: UnitButton, u: Unit): Action | undefined {
  switch (kind) {
    case 'drop':
    case 'ladder':
    case 'search':
      return { type: kind, unitId: u.id };
    case 'fan': {
      // Shut down a fan next to you, or set one up at an adjacent open door/window.
      const near = state.fans.find((f) => f.pos.floor === u.pos.floor && Math.abs(f.pos.x - u.pos.x) + Math.abs(f.pos.y - u.pos.y) <= 1);
      if (near) return { type: 'removeFan', unitId: u.id, target: near.pos };
      const opening = neighbors(state, u.pos).find((p) => {
        const t = tileAt(state, p)!;
        return (t.kind === 'door' || t.kind === 'window') && t.open;
      });
      return opening && { type: 'placeFan', unitId: u.id, target: opening };
    }
    case 'attack':
      return { type: 'takeLine', unitId: u.id, kind: 'attack', size: '1.75' };
    case 'attack25':
      return { type: 'takeLine', unitId: u.id, kind: 'attack', size: '2.5' };
    case 'supply':
      return { type: 'takeLine', unitId: u.id, kind: 'supply' };
    case 'nozzle':
      return { type: u.line ? 'dropLine' : 'pickupLine', unitId: u.id };
    case 'pack':
      return { type: 'returnLine', unitId: u.id };
    case 'hydrant': {
      const h = state.hydrants.find((h) => isAdjacent(h.pos, u.pos));
      return h && { type: 'hydrant', unitId: u.id, target: h.pos };
    }
  }
}

function unitAction(kind: UnitButton): void {
  const u = selected();
  const a = u && buttonAction(kind, u);
  if (!u) return setHintAndRender('Select a firefighter first.', true);
  if (!a) return setHintAndRender(kind === 'fan' ? 'Stand beside an open door or window first.' : 'Stand next to a hydrant first.', true);
  commit([a]);
}

// ---------------------------------------------------------------- panels

function renderSummary(): void {
  const s = summarize(state);
  $('turn').innerHTML = `Turn ${state.turn}<span class="phase">${state.status === 'playing' ? 'your move' : state.status}</span>`;
  $('scenario').textContent = state.scenarioName;
  const rows: [string, string | number][] = [
    ['Burning tiles', s.burning],
    ['Structure intact', `${s.structureSaved}%`],
    ['Civilians inside', s.inside],
    ['  not yet found', s.missing],
    ['Rescued', s.rescued],
    ['Lost', s.dead],
    ['Crew down', s.firefightersDown],
  ];
  $('summary').innerHTML = rows.map(([k, v]) => `<span class="k">${k}</span><span class="v">${v}</span>`).join('');
  ($('end-turn') as HTMLButtonElement).disabled = state.status !== 'playing';
  ($('undo') as HTMLButtonElement).disabled = history.length === 0;
}

function crewCard(u: Unit): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'card' + (u.id === selectedId ? ' active' : '');
  const truck = truckById(u.aboard);
  b.disabled = u.status !== 'active' || (!!truck && truck.status !== 'placed');
  const carrying = u.carrying ? state.units.find((c) => c.id === u.carrying)?.name : undefined;
  const where = u.aboard ? 'aboard' : u.pos.floor === 0 ? 'ground floor' : `floor ${u.pos.floor + 1}`;
  const held = state.hoses.find((l) => l.id === u.line);
  const water = held
    ? `${held.kind === 'attack' ? `🧯 ${HOSE_SIZES[held.size].label} attack line` : '🟡 5″ supply line'} (${truckById(held.truckId)?.name}) · `
    : u.role === 'ladder'
      ? '🪜 '
      : '';
  const task = u.task ? '🔧 hooking up hydrant · ' : '';
  b.innerHTML = `
    <span class="name"><span class="dot ${u.role}"></span> ${u.name}${u.status === 'down' ? ' — DOWN' : ''}</span>
    <span class="pips" title="Action points">${'●'.repeat(u.ap)}${'○'.repeat(Math.max(0, u.maxAp - u.ap))}</span>
    <div class="bar"><span style="width:${(100 * u.hp) / u.maxHp}%"></span></div>
    <span class="meta">${task}${water}${where}${carrying ? ` · carrying ${carrying}` : ''}</span>`;
  b.addEventListener('click', () => {
    select(u.id);
    placing = undefined;
    render();
  });
  return b;
}

function renderDispatch(): void {
  const el = $('dispatch');
  el.innerHTML = '';
  for (const t of state.trucks) {
    const box = document.createElement('div');
    box.className = `truck ${t.status}`;
    const head = document.createElement('div');
    head.className = 'truck-head';
    let status: string;
    if (t.status === 'enroute') {
      const n = t.arrivalTurn - state.turn;
      status = `en route — arrives turn ${t.arrivalTurn}${n === 1 ? ' (next)' : ''}`;
    } else if (t.status === 'staged') {
      status = 'on scene — waiting to park';
    } else if (t.type === 'engine') {
      const supply = supplyFor(state, t);
      const src = supply ? (supply.state === 'flowing' ? ' · hydrant ✓' : ' · hydrant ' + supply.state) : '';
      status = `💧 ${t.water}/${t.maxWater} · hose ${hoseLeft(state, t)}/${t.hose}${src}`;
    } else {
      status = 'parked';
    }
    head.innerHTML = `<span class="dot ${t.type}"></span><span class="tname">${t.name}</span><span class="tstatus">${status}</span>`;
    if (t.status === 'staged') {
      const btn = document.createElement('button');
      btn.textContent = placing?.truckId === t.id ? 'Cancel' : 'Park';
      btn.className = placing?.truckId === t.id ? '' : 'primary';
      btn.addEventListener('click', () => {
        if (placing?.truckId === t.id) {
          placing = undefined;
          setHintAndRender('Parking cancelled.');
        } else startPlacing(t);
      });
      head.append(btn);
    }
    box.append(head);
    if (t.status !== 'enroute') {
      const list = document.createElement('div');
      list.className = 'crewlist';
      const crew = state.units.filter((u) => u.truck === t.id);
      for (const u of crew) list.append(crewCard(u));
      box.append(list);
    }
    el.append(box);
  }
}

function renderModes(): void {
  const el = $('modes');
  el.innerHTML = '';
  for (const m of MODES) {
    const b = document.createElement('button');
    b.className = m.mode === mode ? 'active' : '';
    b.title = m.hint;
    b.innerHTML = `${m.label}<kbd>${m.key}</kbd>`;
    b.addEventListener('click', () => setMode(m.mode));
    el.append(b);
  }
  const ov = $('overlays');
  ov.innerHTML = '';
  for (const o of OVERLAYS) {
    const b = document.createElement('button');
    b.className = o.overlay === overlay ? 'active' : '';
    b.textContent = o.label;
    b.addEventListener('click', () => {
      overlay = o.overlay;
      render();
    });
    ov.append(b);
  }
  const sel = selected();
  for (const kind of UNIT_BUTTONS) {
    const btn = $(kind) as HTMLButtonElement;
    const a = sel && buttonAction(kind, sel);
    const cost = a ? actionCost(state, a) : 'Select a firefighter';
    btn.disabled = typeof cost !== 'number';
    btn.title = `${btn.dataset.label}${typeof cost === 'number' ? ` — ${cost} AP` : ` — ${cost}`}`;
    if (kind === 'nozzle') btn.textContent = sel?.line ? 'Put hose down' : 'Pick up hose';
    if (kind === 'fan') btn.textContent = a?.type === 'removeFan' ? 'Remove fan' : 'Place fan';
    if (kind === 'hydrant') {
      const h = sel && state.hydrants.find((h) => isAdjacent(h.pos, sel.pos));
      btn.textContent = h && (h.state === 'opening' || h.state === 'flowing') ? 'Hydrant' : 'Hook up hydrant';
    }
  }
  const h = $('hint');
  h.textContent = hint.text;
  h.className = 'hint' + (hint.error ? ' error' : '');
}

function renderInspector(): void {
  const el = $('inspector');
  const t = hover && tileAt(state, hover);
  if (!hover || !t) {
    el.innerHTML = 'Hover a tile to inspect it.';
    return;
  }
  const kind = t.kind === 'door' || t.kind === 'window' ? `${t.broken ? 'broken' : t.open ? 'open' : 'closed'} ${t.kind}` : t.kind;
  const ign = ignitionOf(t.material, t.contents);
  const people = state.units
    .filter((u) => u.status === 'active' && !u.aboard && (u.kind === 'firefighter' || u.found) && u.pos.floor === hover!.floor && u.pos.x === hover!.x && u.pos.y === hover!.y)
    .map((u) => `${u.name} (${u.hp} HP, −${exposureDamage(state, u)}/turn)`);
  const extras = [
    t.drivable ? 'drivable' : '',
    t.ladder ? 'ladder' : '',
    t.locked ? 'locked' : '',
    t.searched ? 'searched' : '',
    state.fans.some((f) => f.pos.floor === hover!.floor && f.pos.x === hover!.x && f.pos.y === hover!.y) ? 'fan' : '',
  ]
    .filter(Boolean)
    .join(', ');
  el.innerHTML = `
    <dl>
      <dt>Tile</dt><dd>${kind}${extras ? ` (${extras})` : ''}</dd>
      <dt>Material</dt><dd>${MATERIALS[t.material].label}</dd>
      <dt>Contents</dt><dd>${CONTENTS[t.contents].label}</dd>
      <dt>Condition</dt><dd>${conditions(t).join(', ')}</dd>
      <dt>Temperature</dt><dd>${Math.round(t.temperature)}°C${Number.isFinite(ign) && t.fuel > 0 ? ` (ignites ~${ign}°C)` : ''}</dd>
      <dt>Smoke · fuel</dt><dd>${Math.round(t.smoke)}% · ${t.fuel.toFixed(1)}</dd>
      <dt>Integrity</dt><dd>${Math.max(0, Math.round(t.integrity))}%</dd>
      ${hydrantInfo(hover)}
      ${hoseInfo(hover)}
      ${people.length ? `<dt>People</dt><dd>${people.join(', ')}</dd>` : ''}
    </dl>`;
}

function levelName(f: number): string {
  if (f === 0) return 'Ground floor & street';
  const isRoof = state.floors[f].flat().every((t) => t.kind === 'air' || t.kind === 'roof' || t.kind === 'vent');
  return isRoof ? 'Roof' : `Floor ${f + 1}`;
}

function hydrantInfo(p: Pos): string {
  const h = hydrantAt(state, p);
  if (!h) return '';
  const progress = h.state === 'opening' || h.state === 'flowing' ? '' : ` · hookup ${h.work}/${HYDRANT_TOTAL} AP`;
  return `<dt>Hydrant</dt><dd>${HYDRANT_LABEL[h.state]}${progress}</dd>`;
}

function hoseInfo(p: Pos): string {
  const lines = linesThrough(state, p);
  if (!lines.length) return '';
  const desc = lines.map((l) => `${HOSE_SIZES[l.size].label} ${l.kind} line from ${truckById(l.truckId)?.name}`).join(', ');
  return `<dt>Hose</dt><dd>${desc}</dd>`;
}

function renderLog(): void {
  $('log').innerHTML = state.log
    .slice(-60)
    .reverse()
    .map((l) => `<li class="${l.tone}"><span class="t">T${l.turn}</span>${l.text}</li>`)
    .join('');
}

function renderModal(): void {
  const modal = $('modal');
  if (state.status === 'playing') {
    modal.hidden = true;
    return;
  }
  const s = summarize(state);
  modal.hidden = false;
  modal.innerHTML = `
    <div class="box">
      <h2>${state.status === 'won' ? '🚒 Fire under control' : '💀 Building lost'}</h2>
      <p>Turn ${state.turn} · ${s.rescued} rescued · ${s.dead} lost · ${s.firefightersDown} crew down · ${s.structureSaved}% of the structure saved</p>
      <div class="score">${s.score}</div>
      <button id="again" class="primary">Play again</button>
    </div>`;
  $('again').addEventListener('click', restart);
}

function renderNavigator(): void {
  const top = state.floors.length - 1;
  const burning = (f: number) => state.floors[f].flat().some((t) => t.fire > 0);
  const fireAbove = state.floors.some((_, f) => f > viewFloor && burning(f));
  const fireBelow = state.floors.some((_, f) => f < viewFloor && burning(f));
  ($('floor-up') as HTMLButtonElement).disabled = viewFloor >= top;
  ($('floor-down') as HTMLButtonElement).disabled = viewFloor <= 0;
  $('fire-up').textContent = fireAbove ? '🔥' : '';
  $('fire-down').textContent = fireBelow ? '🔥' : '';
  $('floor-num').textContent = String(viewFloor + 1);
  const count = state.floors[viewFloor].flat().filter((t) => t.fire > 0).length;
  $('floor-name').innerHTML = `${levelName(viewFloor)}${count ? `<br><span class="fire-count">🔥 ${count}</span>` : ''}`;
}

// ---------------------------------------------------------------- drawing

let reachCache: { state: GameState; id: string; stops: Set<string> } | undefined;

function drawAll(time: number): void {
  const sel = selected();
  let stops: Set<string> | undefined;
  if (sel && (!sel.aboard || truckById(sel.aboard)?.status === 'placed')) {
    if (!reachCache || reachCache.state !== state || reachCache.id !== sel.id) {
      reachCache = { state, id: sel.id, stops: reachable(state, sel).stops };
    }
    stops = reachCache.stops;
  }
  const placingView = placing && {
    truck: truckById(placing.truckId)!,
    orientation: placing.orientation,
    reversed: placing.reversed,
    error: hover ? placementError(state, truckById(placing.truckId)!, hover, placing.orientation) : 'no position',
  };
  drawFloor(canvas.getContext('2d')!, state, viewFloor, { selected: sel, hover, stops, mode, overlay, time, placing: placingView });
}

function render(): void {
  renderSummary();
  renderDispatch();
  renderModes();
  renderInspector();
  renderLog();
  renderNavigator();
  renderModal();
}

function loop(time: number): void {
  drawAll(time);
  requestAnimationFrame(loop);
}

function restart(): void {
  state = newGame(houseFire);
  history = [];
  placing = undefined;
  selectedId = undefined;
  mode = 'auto';
  viewFloor = 0;
  buildStage();
  const first = state.trucks.find((t) => t.status === 'staged');
  if (first) startPlacing(first);
  else render();
}

// ---------------------------------------------------------------- wiring

$('end-turn').addEventListener('click', doEndTurn);
$('undo').addEventListener('click', undo);
for (const kind of UNIT_BUTTONS) {
  const btn = $(kind);
  btn.dataset.label = btn.textContent ?? kind;
  btn.addEventListener('click', () => unitAction(kind));
}
window.addEventListener('resize', layout);

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  const m = MODES.find((x) => x.key === e.key);
  if (m) return setMode(m.mode);
  switch (e.key.toLowerCase()) {
    case 'tab':
      e.preventDefault();
      return cycleSelection();
    case 'enter':
      e.preventDefault();
      return doEndTurn();
    case 'z':
      return undo();
    case 'g':
      return unitAction('drop');
    case 'r':
      return rotatePlacement();
    case 'a':
      return unitAction('attack');
    case 'd':
      return unitAction('attack25');
    case 's':
      return unitAction('supply');
    case 'n':
      return unitAction('nozzle');
    case 'b':
      return unitAction('pack');
    case 'y':
      return unitAction('hydrant');
    case 'l':
      return unitAction('ladder');
    case 'e':
      return unitAction('search');
    case 'p':
      return unitAction('fan');
    case 'h':
      overlay = overlay === 'heat' ? 'normal' : 'heat';
      return render();
    case 'v':
      overlay = overlay === 'smoke' ? 'normal' : 'smoke';
      return render();
    case 'arrowup':
      e.preventDefault();
      return setFloor(viewFloor + 1);
    case 'arrowdown':
      e.preventDefault();
      return setFloor(viewFloor - 1);
    case 'home':
      return setFloor(0);
    case 'escape':
      if (placing) {
        placing = undefined;
        return setHintAndRender('Parking cancelled.');
      }
      return setMode('auto');
  }
});

restart();
requestAnimationFrame(loop);
