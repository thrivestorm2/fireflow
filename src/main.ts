import { actionCost, performAction, type Action } from './core/actions';
import { exposureDamage } from './core/exposure';
import { endTurn, newGame, summarize } from './core/game';
import { conditions, tileAt } from './core/grid';
import { CONTENTS, ignitionOf, MATERIALS } from './core/materials';
import { reachable } from './core/pathing';
import { placementError } from './core/trucks';
import type { GameState, Orientation, Pos, Truck, Unit } from './core/types';
import { houseFire } from './scenarios/house';
import { MODES, planClick, type Mode } from './ui/intent';
import { drawFloor, TILE, viewRect, type Overlay, type ViewRect } from './ui/render';

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
let placing: { truckId: string; orientation: Orientation } | undefined;

const canvases: HTMLCanvasElement[] = [];
let rects: ViewRect[] = [];

const firefighters = (): Unit[] => state.units.filter((u) => u.kind === 'firefighter');
const selected = (): Unit | undefined => state.units.find((u) => u.id === selectedId && u.status === 'active');
const truckById = (id?: string): Truck | undefined => state.trucks.find((t) => t.id === id);

function setHint(text: string, error = false): void {
  hint = { text, error };
}

// ---------------------------------------------------------------- floors & layout

function buildFloors(): void {
  const root = $('floors');
  root.innerHTML = '';
  canvases.length = 0;
  rects = state.floors.map((_, f) => viewRect(state, f));
  // Top floor first, so the page reads like a cutaway of the building.
  for (let f = state.floors.length - 1; f >= 0; f--) {
    const wrap = document.createElement('div');
    wrap.className = 'floor';
    const h = document.createElement('h3');
    h.id = `floor-label-${f}`;
    const canvas = document.createElement('canvas');
    canvas.width = rects[f].cols * TILE;
    canvas.height = rects[f].rows * TILE;
    canvas.addEventListener('mousemove', (e) => {
      hover = eventPos(canvas, f, e);
      renderInspector();
    });
    canvas.addEventListener('mouseleave', () => {
      hover = undefined;
      renderInspector();
    });
    canvas.addEventListener('click', (e) => {
      const p = eventPos(canvas, f, e);
      if (p) onTileClick(p);
    });
    canvas.addEventListener('contextmenu', (e) => {
      if (!placing) return;
      e.preventDefault();
      rotatePlacement();
    });
    canvases[f] = canvas;
    wrap.append(h, canvas);
    root.append(wrap);
  }
  layout();
}

/** Sizes every floor canvas with the same on-screen tile size, fitting the viewport where possible. */
function layout(): void {
  const root = $('floors');
  const width = root.clientWidth;
  const totalRows = rects.reduce((n, r) => n + r.rows, 0);
  const maxCols = Math.max(...rects.map((r) => r.cols));
  const available = window.innerHeight - 70 - rects.length * 34;
  const tile = Math.max(16, Math.min(40, Math.floor(Math.min(width / maxCols, available / totalRows))));
  canvases.forEach((c, f) => {
    c.style.width = `${rects[f].cols * tile}px`;
    c.style.height = `${rects[f].rows * tile}px`;
  });
}

function eventPos(canvas: HTMLCanvasElement, floor: number, e: MouseEvent): Pos | undefined {
  const r = canvas.getBoundingClientRect();
  const v = rects[floor];
  const x = v.x0 + Math.floor(((e.clientX - r.left) / r.width) * v.cols);
  const y = v.y0 + Math.floor(((e.clientY - r.top) / r.height) * v.rows);
  return x >= v.x0 && y >= v.y0 && x < v.x0 + v.cols && y < v.y0 + v.rows ? { floor, x, y } : undefined;
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
  }
  setHint(error ?? '', !!error);
  render();
  return !error;
}

function onTileClick(p: Pos): void {
  if (state.status !== 'playing') return;

  if (placing) {
    if (p.floor !== 0) return setHintAndRender('Trucks park on the ground floor.', true);
    const truck = truckById(placing.truckId)!;
    if (commit([{ type: 'placeTruck', truckId: truck.id, pos: p, orientation: placing.orientation }])) {
      placing = undefined;
      selectedId = state.units.find((u) => u.aboard === truck.id && u.status === 'active')?.id ?? selectedId;
      setHintAndRender(`${truck.name} parked. Click a tile next to it to get the crew off.`);
    }
    return;
  }

  const own = firefighters().find((u) => u.status === 'active' && !u.aboard && u.pos.floor === p.floor && u.pos.x === p.x && u.pos.y === p.y);
  const sel = selected();
  // Clicking another firefighter selects them, unless an explicit mode targets that tile.
  if (own && (!sel || (own.id !== sel.id && (mode === 'auto' || mode === 'move')))) {
    selectedId = own.id;
    return setHintAndRender(`${own.name} selected.`);
  }
  // Clicking a parked truck selects the next crew member still aboard.
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

function footprintHas(t: Truck, p: Pos): boolean {
  if (!t.pos || p.floor !== 0) return false;
  for (let i = 0; i < 3; i++) {
    const x = t.orientation === 'h' ? t.pos.x + i : t.pos.x;
    const y = t.orientation === 'v' ? t.pos.y + i : t.pos.y;
    if (x === p.x && y === p.y) return true;
  }
  return false;
}

function setHintAndRender(text: string, error = false): void {
  setHint(text, error);
  render();
}

function startPlacing(truck: Truck): void {
  placing = { truckId: truck.id, orientation: placing?.orientation ?? 'h' };
  setHintAndRender(`Click a road or driveway tile to park ${truck.name}. R or right-click rotates, Esc cancels.`);
}

function rotatePlacement(): void {
  if (!placing) return;
  placing.orientation = placing.orientation === 'h' ? 'v' : 'h';
  render();
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
  selectedId = usable[(i + 1) % usable.length].id;
  render();
}

function setMode(m: Mode): void {
  mode = m;
  setHintAndRender(MODES.find((x) => x.mode === m)!.hint);
}

function unitAction(type: 'drop' | 'refill' | 'ladder'): void {
  const u = selected();
  if (u) commit([{ type, unitId: u.id }]);
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
  const water = u.maxWater ? `💧 ${u.water}/${u.maxWater} · ` : '🪜 ';
  b.innerHTML = `
    <span class="name"><span class="dot ${u.role}"></span> ${u.name}${u.status === 'down' ? ' — DOWN' : ''}</span>
    <span class="pips" title="Action points">${'●'.repeat(u.ap)}${'○'.repeat(Math.max(0, u.maxAp - u.ap))}</span>
    <div class="bar"><span style="width:${(100 * u.hp) / u.maxHp}%"></span></div>
    <span class="meta">${water}${where}${carrying ? ` · carrying ${carrying}` : ''}</span>`;
  b.addEventListener('click', () => {
    selectedId = u.id;
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
      status = t.hydrant ? 'parked · on hydrant ∞' : `parked · tank ${t.water}/${t.maxWater}`;
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
  const can = (type: 'drop' | 'refill' | 'ladder') => !!sel && typeof actionCost(state, { type, unitId: sel.id }) === 'number';
  ($('drop') as HTMLButtonElement).disabled = !can('drop');
  ($('refill') as HTMLButtonElement).disabled = !can('refill');
  ($('ladder') as HTMLButtonElement).disabled = !can('ladder');
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
    .filter((u) => u.status === 'active' && !u.aboard && u.pos.floor === hover!.floor && u.pos.x === hover!.x && u.pos.y === hover!.y)
    .map((u) => `${u.name} (${u.hp} HP, −${exposureDamage(state, u)}/turn)`);
  const extras = [t.drivable ? 'drivable' : '', t.ladder ? 'ladder' : ''].filter(Boolean).join(', ');
  el.innerHTML = `
    <dl>
      <dt>Tile</dt><dd>${kind}${extras ? ` (${extras})` : ''}</dd>
      <dt>Material</dt><dd>${MATERIALS[t.material].label}</dd>
      <dt>Contents</dt><dd>${CONTENTS[t.contents].label}</dd>
      <dt>Condition</dt><dd>${conditions(t).join(', ')}</dd>
      <dt>Temperature</dt><dd>${Math.round(t.temperature)}°C${Number.isFinite(ign) && t.fuel > 0 ? ` (ignites ~${ign}°C)` : ''}</dd>
      <dt>Smoke · fuel</dt><dd>${Math.round(t.smoke)}% · ${t.fuel.toFixed(1)}</dd>
      <dt>Integrity</dt><dd>${Math.max(0, Math.round(t.integrity))}%</dd>
      ${people.length ? `<dt>People</dt><dd>${people.join(', ')}</dd>` : ''}
    </dl>`;
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

function renderFloorLabels(): void {
  state.floors.forEach((rows, f) => {
    const burning = rows.flat().filter((t) => t.fire > 0).length;
    const name = f === 0 ? 'Ground floor & street' : `Floor ${f + 1}`;
    $(`floor-label-${f}`).innerHTML = `<span>${name}</span>${burning ? `<span class="fire-count">🔥 ${burning}</span>` : ''}`;
  });
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
    error: hover ? placementError(state, hover, placing.orientation) : 'no position',
  };
  canvases.forEach((c, f) => {
    drawFloor(c.getContext('2d')!, state, f, { selected: sel, hover, stops, mode, overlay, time, placing: placingView }, rects[f]);
  });
}

function render(): void {
  renderSummary();
  renderDispatch();
  renderModes();
  renderInspector();
  renderLog();
  renderFloorLabels();
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
  buildFloors();
  const first = state.trucks.find((t) => t.status === 'staged');
  if (first) startPlacing(first);
  else render();
}

// ---------------------------------------------------------------- wiring

$('end-turn').addEventListener('click', doEndTurn);
$('undo').addEventListener('click', undo);
$('drop').addEventListener('click', () => unitAction('drop'));
$('refill').addEventListener('click', () => unitAction('refill'));
$('ladder').addEventListener('click', () => unitAction('ladder'));
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
      return placing ? rotatePlacement() : unitAction('refill');
    case 'l':
      return unitAction('ladder');
    case 'h':
      overlay = overlay === 'heat' ? 'normal' : 'heat';
      return render();
    case 'v':
      overlay = overlay === 'smoke' ? 'normal' : 'smoke';
      return render();
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
