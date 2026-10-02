import { performAction, type Action } from './core/actions';
import { ALARM, nextAlarm, ordinal } from './core/alarms';
import { exposureDamage } from './core/exposure';
import { isKnown, knowledge, showing } from './core/knowledge';
import { waving } from './core/occupants';
import { endTurn, newGame, summarize } from './core/game';
import { conditions, samePos, tileAt } from './core/grid';
import { CONTENTS, ignitionOf, MATERIALS } from './core/materials';
import { reachable } from './core/pathing';
import { HOSE_SIZES, HYDRANT_LABEL, HYDRANT_TOTAL, hoseLeft, hydrantAt, isSupplied, linesThrough, supplyFor } from './core/hoses';
import { dischargeTiles, footprint, inletTiles, placementError, pumpOperator, seatOf, supplyTiles, truckTiles, turntableAt } from './core/trucks';
import type { GameState, HoseSize, Orientation, Pos, Truck, Unit } from './core/types';
import { houseFire } from './scenarios/house';
import { clickOptions, type Option } from './ui/intent';
import { drawFloor, isVisible, shownPos, TILE, unitLabel, type Overlay } from './ui/render';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const OVERLAYS: { overlay: Overlay; label: string; symbol: string }[] = [
  { overlay: 'normal', label: 'Normal view', symbol: '👁️' },
  { overlay: 'heat', label: 'Thermal camera (H)', symbol: '🌡️' },
  { overlay: 'structure', label: 'Structure', symbol: '🧱' },
];

/** A fresh seed for each game, so the fire starts somewhere different. The game itself stays replayable from its seed. */
const freshSeed = (): number => crypto.getRandomValues(new Uint32Array(1))[0];
const newHouseFire = (): GameState => newGame({ ...houseFire, seed: freshSeed() });

let state: GameState = newHouseFire();
/** States before each action this turn, for undo. */
let history: GameState[] = [];
let selectedId: string | undefined;
let overlay: Overlay = 'normal';
let hover: Pos | undefined;
let hint = { text: '', error: false };
/** Truck currently being parked, if any. On touch screens `previewAt` is the tile tapped to preview it (a second tap there parks). */
let placing: { truckId: string; orientation: Orientation; reversed: boolean; preview?: string; previewAt?: Pos } | undefined;
/**
 * A touch drag of the parking ghost in progress: `grab` is the tile offset from the
 * ghost's anchor to where the finger went down, so the truck doesn't jump under the finger.
 */
let dragging: { pointerId: number; grab: { dx: number; dy: number }; moved: boolean } | undefined;
/** 'mouse', 'touch' or 'pen' — the last pointer used on the map. */
let lastPointer = 'mouse';
/** Aiming the aerial: the next tap on the map picks where its tip goes. */
let aimingAerial = false;

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
    <div id="overlays" class="view-buttons" role="group" aria-label="View"></div>
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
  canvas.addEventListener('pointerdown', (e) => {
    lastPointer = e.pointerType;
    // Touching the parking ghost picks it up: drag it into place, or tap it to park.
    const p = eventPos(e);
    const at = placing?.previewAt;
    if (e.pointerType !== 'mouse' && placing && at && p && onGhost(p)) {
      dragging = { pointerId: e.pointerId, grab: { dx: p.x - at.x, dy: p.y - at.y }, moved: false };
      canvas.setPointerCapture(e.pointerId);
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging || e.pointerId !== dragging.pointerId || !placing) return;
    const p = eventPos(e);
    if (!p) return;
    const to = { floor: 0, x: p.x - dragging.grab.dx, y: p.y - dragging.grab.dy };
    const at = placing.previewAt;
    if (at && at.x === to.x && at.y === to.y) return;
    dragging.moved = true;
    placing.previewAt = to;
    placing.preview = `${to.x},${to.y}`;
    const truck = truckById(placing.truckId)!;
    const err = parkError(truck, to, placing.orientation);
    setHintAndRender(err ?? `Let go, then tap ${truck.name} to park it here.`, !!err);
  });
  const endDrag = (e: PointerEvent) => {
    if (!dragging || e.pointerId !== dragging.pointerId) return;
    const tapped = !dragging.moved && e.type === 'pointerup';
    dragging = undefined;
    if (tapped && placing?.previewAt) parkAt(placing.previewAt);
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  // A touch that starts on the ghost belongs to the ghost: don't scroll the page or fire a click.
  const claimTouch = (e: TouchEvent) => {
    const t = e.touches[0];
    if (!t || !placing?.previewAt) return;
    const p = eventPos(t);
    if (dragging || (e.type === 'touchstart' && p && onGhost(p))) e.preventDefault();
  };
  canvas.addEventListener('touchstart', claimTouch, { passive: false });
  canvas.addEventListener('touchmove', claimTouch, { passive: false });
  canvas.addEventListener('click', (e) => {
    const p = eventPos(e);
    if (!p) return;
    // Phones have no hover: a tap also shows the tile's details.
    hover = p;
    onTileClick(p, tileFraction(e), { x: e.clientX, y: e.clientY });
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
  let tile: number;
  if (window.innerWidth < 900) {
    // Phone: the page scrolls and tiles stay big enough to tap (a wide site scrolls sideways).
    tile = Math.max(22, Math.min(40, Math.floor(width / state.width)));
  } else {
    const available = window.innerHeight - 90;
    tile = Math.max(14, Math.min(44, Math.floor(Math.min(width / state.width, available / state.height))));
  }
  canvas.style.width = `${state.width * tile}px`;
  canvas.style.height = `${state.height * tile}px`;
}

/** The tile under the mouse, as it is shown on the current floor (the ground, outside the building). */
function eventPos(e: { clientX: number; clientY: number }): Pos | undefined {
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
 * A click on a truck's hose connections: the rear 5″ supply coupling, a side
 * inlet, or an engine's crosslays, where the half toward the front is the red
 * 1¾″ coupling and the half toward the back the blue 2½″.
 */
function couplingClick(p: Pos, frac: { fx: number; fy: number }): { size: HoseSize; side?: 0 | 1; inlet?: Truck } | undefined {
  for (const truck of state.trucks) {
    if (supplyTiles(truck).some((q) => samePos(q, p))) return { size: '5' };
    if (inletTiles(truck).some((d) => samePos(d.pos, p))) return { size: '5', inlet: truck };
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

function onTileClick(p: Pos, frac = { fx: 0.5, fy: 0.5 }, at?: { x: number; y: number }): void {
  closeTapMenu();
  if (state.status !== 'playing') return;

  if (placing) {
    if (p.floor !== 0) return setHintAndRender('Trucks park on the ground floor.', true);
    const truck = truckById(placing.truckId)!;
    // On touch screens the first tap previews the spot; then drag the truck, or tap it to park.
    const key = `${p.x},${p.y}`;
    if (lastPointer === 'touch' && placing.preview !== key) {
      placing.preview = key;
      placing.previewAt = { floor: 0, x: p.x, y: p.y };
      const err = parkError(truck, p, placing.orientation);
      return setHintAndRender(err ?? `Drag ${truck.name} into place, then tap it to park. Rotate turns it.`, !!err);
    }
    parkAt(p);
    return;
  }

  const own = firefighters().find((u) => u.status === 'active' && !u.aboard && u.pos.floor === p.floor && u.pos.x === p.x && u.pos.y === p.y);
  const sel = selected();
  // Clicking a hose coupling with a firefighter beside it takes that attack line.
  const coupling = couplingClick(p, frac);
  if (coupling && sel && !sel.aboard) {
    commit([
      coupling.inlet
        ? { type: 'inlet', unitId: sel.id, truckId: coupling.inlet.id }
        : coupling.size === '5'
          ? { type: 'takeLine', unitId: sel.id, kind: 'supply' }
          : { type: 'takeLine', unitId: sel.id, kind: 'attack', size: coupling.size, side: coupling.side },
    ]);
    return;
  }
  // Clicking another firefighter selects them.
  if (own && (!sel || own.id !== sel.id)) {
    aimingAerial = false;
    selectedId = own.id;
    return setHintAndRender(`${own.name} selected. Tap a tile to act, or tap ${own.name} for jobs right here.`);
  }
  // Clicking a crew member seated on a truck selects them.
  const seated = firefighters().find((u) => u.aboard && u.status === 'active' && samePos(seatOf(state, u) ?? NOWHERE, p));
  if (seated) {
    aimingAerial = false;
    selectedId = seated.id;
    return setHintAndRender(`${seated.name} selected — click a tile next to ${truckById(seated.aboard)?.name} to get off.`);
  }
  // Clicking elsewhere on a parked truck selects the next crew member still aboard.
  const truck = state.trucks.find((t) => t.status === 'placed' && footprintHas(t, p));
  const toTurntable = !!turntableAt(state, p) && !!sel && !sel.aboard; // climbing onto the turntable
  if (truck && !toTurntable && (!sel || !sel.aboard || sel.aboard !== truck.id)) {
    const crew = state.units.find((u) => u.aboard === truck.id && u.status === 'active');
    if (crew) {
      aimingAerial = false;
      selectedId = crew.id;
      return setHintAndRender(`${crew.name} selected — click a tile next to ${truck.name} to get off.`);
    }
  }
  if (!sel) return setHintAndRender('Tap a firefighter to select them.', true);
  if (sel.aboard && truckById(sel.aboard)?.status !== 'placed') {
    return setHintAndRender(`${sel.name} is still on ${truckById(sel.aboard)?.name}. Park the truck first.`, true);
  }
  // The floor being viewed, open air included (shown as the ground below): somewhere the aerial could go.
  const raw = { floor: viewFloor, x: p.x, y: p.y };
  if (aimingAerial) {
    if (samePos(sel.pos, p)) {
      aimingAerial = false;
      return setHintAndRender('Aerial left where it is.');
    }
    if (commit([{ type: 'aerial', unitId: sel.id, tip: raw }])) {
      aimingAerial = false;
      setHintAndRender('Aerial in place. Tap the tip to climb it, or fire it can reach for the master stream.');
    }
    return;
  }
  const choice = clickOptions(state, sel, p, raw);
  if ('error' in choice) return setHintAndRender(choice.error, true);
  // Tapping yourself always asks, so nothing costs AP without saying what it is.
  const self = samePos(sel.pos, p) && !sel.aboard;
  if (at && (self || choice.options.length > 1)) return openTapMenu(choice.options, at);
  pick(choice.options[0]);
}

function pick(o: Option): void {
  if (o.ui === 'aim-aerial') {
    aimingAerial = true;
    if (viewFloor === 0) viewFloor = 1; // the tip goes on an upper floor or the roof
    return setHintAndRender(
      'Aiming the aerial: tap an outlined open-air or roof tile (change floor with ▲ ▼). Tap the firefighter again to cancel.',
    );
  }
  commit(o.actions);
}

// ---------------------------------------------------------------- tap menu

/** When a tap could mean several things, a small menu at the tap lists them with their AP cost. */
function openTapMenu(options: Option[], at: { x: number; y: number }): void {
  closeTapMenu();
  const menu = document.createElement('div');
  menu.id = 'tapmenu';
  menu.className = 'tapmenu';
  menu.setAttribute('role', 'menu');
  for (const o of options) {
    const b = document.createElement('button');
    b.setAttribute('role', 'menuitem');
    b.innerHTML = `<span>${o.label}</span><span class="ap">${o.cost} AP</span>`;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTapMenu();
      pick(o);
    });
    menu.append(b);
  }
  document.body.append(menu);
  // Keep it on screen.
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(at.x + 8, window.innerWidth - r.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(at.y + 8, window.innerHeight - r.height - 8))}px`;
  (menu.firstElementChild as HTMLButtonElement | null)?.focus();
}

function closeTapMenu(): void {
  document.getElementById('tapmenu')?.remove();
}

const NOWHERE: Pos = { floor: -1, x: -1, y: -1 };

function footprintHas(t: Truck, p: Pos): boolean {
  return p.floor === 0 && truckTiles(t).some((q) => q.x === p.x && q.y === p.y);
}

function setHintAndRender(text: string, error = false): void {
  setHint(text, error);
  render();
}

/**
 * Why the truck can't park here: the game's rules (road only, no overlaps…) or,
 * on this screen, part of it would sit outside what the player can see.
 */
function parkError(truck: Truck, pos: Pos, orientation: Orientation): string | null {
  return placementError(state, truck, pos, orientation) ?? offScreenError(footprint(pos, orientation, truck.type));
}

/**
 * The part of the map the player can actually see: the canvas, clipped by any
 * scrolling container around it, the window, and the phone's bottom bar.
 */
function visibleMapRect(): { left: number; top: number; right: number; bottom: number } {
  const r = canvas.getBoundingClientRect();
  let box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  const clip = (c: { left: number; top: number; right: number; bottom: number }) => {
    box = { left: Math.max(box.left, c.left), top: Math.max(box.top, c.top), right: Math.min(box.right, c.right), bottom: Math.min(box.bottom, c.bottom) };
  };
  for (let el = canvas.parentElement; el; el = el.parentElement) {
    const s = getComputedStyle(el);
    if (s.overflowX !== 'visible' || s.overflowY !== 'visible') clip(el.getBoundingClientRect());
  }
  clip({ left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight });
  const bar = document.querySelector('.mobilebar');
  if (bar && getComputedStyle(bar).display !== 'none') clip({ left: -Infinity, top: -Infinity, right: Infinity, bottom: bar.getBoundingClientRect().top });
  return box;
}

function offScreenError(tiles: Pos[]): string | null {
  const r = canvas.getBoundingClientRect();
  if (!r.width || !r.height) return null; // not laid out (e.g. tests): nothing to judge
  const tw = r.width / state.width;
  const th = r.height / state.height;
  const v = visibleMapRect();
  const slack = 1;
  const hidden = tiles.some((p) => {
    const left = r.left + p.x * tw;
    const top = r.top + p.y * th;
    return left < v.left - slack || top < v.top - slack || left + tw > v.right + slack || top + th > v.bottom + slack;
  });
  return hidden ? 'Part of the truck is off screen. Move it fully into view.' : null;
}

/** Whether `p` is under the parking ghost. */
function onGhost(p: Pos): boolean {
  const at = placing?.previewAt;
  if (!placing || !at || p.floor !== 0) return false;
  return footprint(at, placing.orientation, truckById(placing.truckId)!.type).some((q) => q.x === p.x && q.y === p.y);
}

/** Parks the truck being placed with its top-left tile at `p`, if it fits there and is fully on screen. */
function parkAt(p: Pos): void {
  if (!placing) return;
  const truck = truckById(placing.truckId)!;
  const err = parkError(truck, p, placing.orientation);
  if (err) return setHintAndRender(err, true);
  if (commit([{ type: 'placeTruck', truckId: truck.id, pos: { floor: 0, x: p.x, y: p.y }, orientation: placing.orientation, reversed: placing.reversed }])) {
    placing = undefined;
    setHintAndRender(`${truck.name} parked. Tap a crew member on the truck, then a tile next to it to get them off.`);
  }
}

function startPlacing(truck: Truck): void {
  viewFloor = 0; // trucks park on the ground
  placing = { truckId: truck.id, orientation: placing?.orientation ?? 'h', reversed: placing?.reversed ?? false };
  setHintAndRender(
    `Click or tap a road or driveway tile to park ${truck.name}. Rotate, R or right-click turns it (the arrow and white headlights mark the front, red lights the back). Esc cancels.`,
  );
}

function rotatePlacement(): void {
  if (!placing) return;
  const i = FACINGS.findIndex((f) => f.orientation === placing!.orientation && f.reversed === placing!.reversed);
  const next = FACINGS[(i + 1) % FACINGS.length];
  placing.orientation = next.orientation;
  placing.reversed = next.reversed;
  const truck = truckById(placing.truckId)!;
  // Previewing on a touch screen: say whether it still fits there this way round; the second tap there parks it.
  const err = placing.previewAt && parkError(truck, placing.previewAt, placing.orientation);
  if (placing.previewAt) setHintAndRender(err ?? `${truck.name} facing ${next.label}. Drag it into place, or tap it to park.`, !!err);
  else setHintAndRender(`${truck.name} facing ${next.label}.`);
}

function doEndTurn(): void {
  if (state.status !== 'playing') return;
  placing = undefined;
  aimingAerial = false;
  showBanner('🔥 Fire phase');
  state = endTurn(state);
  history = [];
  if (!selected())
    selectedId = firefighters().find((u) => u.status === 'active' && truckById(u.truck)?.status === 'placed')?.id;
  const arrived = state.trucks.filter((t) => t.status === 'staged' && t.arrivalTurn === state.turn);
  setHint(
    arrived.length
      ? `${arrived.map((t) => t.name).join(' and ')} at scene requesting assignment.`
      : `Turn ${state.turn}. Your move.`,
  );
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

// ---------------------------------------------------------------- panels

function renderSummary(): void {
  const s = summarize(state);
  $('turn').innerHTML = `Turn ${state.turn}<span class="phase">${state.status === 'playing' ? 'your move' : state.status}</span>`;
  $('scenario').textContent = state.scenarioName;
  const rows: [string, string | number][] = [
    ['Fire seen (tiles)', knownFire(state)],
    ['Structure intact', `${s.structureSaved}%`],
    ['Residents inside', s.inside],
    ['  not yet found', s.missing],
    ['Residents safe', s.rescued],
    ['Residents lost', s.dead],
    ['Pets safe · lost', `${s.petsRescued} · ${s.petsLost}`],
    ['Water used', s.waterUsed ? `${s.waterUsed} · ${Math.round(s.waterEfficiency * 100)}% on fire` : 0],
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
    <span class="name"><span class="dot ${u.rank === 'LT' ? 'officer' : 'crew'}"></span> ${u.rank ?? 'FF'} ${u.name}${u.status === 'down' ? ' — DOWN' : ''}</span>
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

const STATUS_LABEL: Record<Truck['status'], string> = { enroute: 'En route', staged: 'Staging', placed: 'Assigned' };

function renderAlarm(): void {
  const btn = $('alarm') as HTMLButtonElement;
  if (state.alarm >= ALARM.maxLevel) {
    btn.textContent = `${ordinal(state.alarm)} alarm`;
    btn.disabled = true;
    btn.title = 'Every available company is committed.';
    return;
  }
  const next = nextAlarm(state);
  const turns = next.trucks.map((t) => t.arrivalTurn);
  btn.textContent = `🚨 Strike ${ordinal(next.level)} alarm`;
  btn.disabled = state.status !== 'playing';
  btn.title = `${next.trucks.map((t) => t.name).join(', ')} · due in ${Math.min(...turns) - state.turn}–${Math.max(...turns) - state.turn} turns`;
}

function renderDispatch(): void {
  renderAlarm();
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
      status = n <= 1 ? 'arrives next turn' : `arrives in ${n} turns`;
    } else if (t.status === 'staged') {
      status = placing?.truckId === t.id ? 'click a road tile to park · click here to cancel' : 'click to park';
    } else {
      const supply = supplyFor(state, t);
      const relay = state.hoses.some((l) => l.toTruck && (l.truckId === t.id || l.toTruck === t.id));
      const src = isSupplied(state, t)
        ? ' · supplied ✓'
        : supply
          ? ` · hydrant ${HYDRANT_LABEL[supply.state]}`
          : relay
            ? ' · relay, no water yet'
            : '';
      const tank = t.maxWater ? `💧 ${t.water}/${t.maxWater} · ` : '';
      const aerial = t.type === 'ladder' ? (t.aerialTip ? ' · aerial up' : ' · aerial bedded') : '';
      const op = t.type === 'engine' ? pumpOperator(state, t) : undefined;
      const pump = t.type === 'engine' ? (op ? ` · pump: ${op.name}` : ' · pump unmanned') : '';
      status = `${tank}hose ${hoseLeft(state, t)}/${t.hose}${src}${pump}${aerial}`;
    }
    // Every truck wears a coloured status badge: en route, staging, or assigned (parked and working).
    const badge = `<span class="status-badge ${t.status}">${STATUS_LABEL[t.status]}</span>`;
    head.innerHTML = `<span class="tname">${t.name}</span>${badge}<span class="tstatus">${status}</span>`;
    if (t.status === 'staged') {
      // The whole card toggles parking: click once to pick the truck up, again to put it back.
      if (placing?.truckId === t.id) box.classList.add('placing');
      box.title = placing?.truckId === t.id ? `Cancel parking ${t.name}` : `Park ${t.name}`;
      box.addEventListener('click', () => {
        if (placing?.truckId === t.id) {
          placing = undefined;
          setHintAndRender('Parking cancelled.');
        } else startPlacing(t);
      });
      if (placing?.truckId === t.id) {
        const rot = document.createElement('button');
        rot.textContent = 'Rotate';
        rot.addEventListener('click', (e) => {
          e.stopPropagation(); // don't let the card's click cancel parking
          rotatePlacement();
        });
        head.append(rot);
      }
    }
    box.append(head);
    // Crew only become available once the truck is parked.
    if (t.status === 'placed') {
      const list = document.createElement('div');
      list.className = 'crewlist';
      const crew = state.units.filter((u) => u.truck === t.id);
      for (const u of crew) list.append(crewCard(u));
      box.append(list);
    }
    el.append(box);
  }
}

function renderView(): void {
  const ov = $('overlays');
  ov.innerHTML = '';
  for (const o of OVERLAYS) {
    const b = document.createElement('button');
    b.className = 'view-button' + (o.overlay === overlay ? ' active' : '');
    b.textContent = o.symbol;
    b.title = o.label;
    b.setAttribute('aria-label', o.label);
    b.setAttribute('aria-pressed', String(o.overlay === overlay));
    b.addEventListener('click', () => {
      overlay = o.overlay;
      render();
    });
    ov.append(b);
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
  if (!isKnown(state, hover)) {
    // Fog of war: the layout is known, conditions aren't. An officer's thermal camera reads the heat.
    const thermal = knowledge(state).thermal.has(`${hover.floor},${hover.x},${hover.y}`);
    el.innerHTML = `
      <dl>
        <dt>Tile</dt><dd>${kind}</dd>
        <dt>Condition</dt><dd>unknown — nobody can see in here</dd>
        ${thermal ? `<dt>Thermal camera</dt><dd>${t.fire > 0 ? 'white-hot (fire)' : `~${Math.round(t.temperature / 10) * 10}°C`}</dd>` : ''}
      </dl>`;
    return;
  }
  const ign = ignitionOf(t.material, t.contents);
  const people = state.units
    .filter((u) => u.status === 'active' && !u.aboard && (u.kind === 'firefighter' || u.found) && u.pos.floor === hover!.floor && u.pos.x === hover!.x && u.pos.y === hover!.y)
    .map((u) => `${u.name}${u.unconscious ? ', unconscious' : ''} (${u.hp} HP, −${exposureDamage(state, u)}/turn)`);
  const extras = [
    t.drivable ? 'drivable' : '',
    t.ladder ? 'ladder' : '',
    t.locked ? (t.reinforced ? 'locked, reinforced' : 'locked') : '',
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
    .map((l) => {
      // Credit the apparatus: E1, L7…
      const by = truckById(l.truckId);
      const tag = by ? `<span class="by">${unitLabel(by.name)}</span>` : '';
      return `<li class="${l.tone}"><span class="t">T${l.turn}</span>${tag}${l.text}</li>`;
    })
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
      <table class="breakdown">
        ${s.breakdown.map(([k, v]) => `<tr><td>${k}</td><td>${v > 0 ? '+' : ''}${v}</td></tr>`).join('')}
      </table>
      <div class="score">${s.score}</div>
      <button id="again" class="primary">Play again</button>
    </div>`;
  $('again').addEventListener('click', () => restart());
}

/** Burning tiles the crew can see (fog of war), on one floor or all of them. */
function knownFire(s: GameState, floor?: number): number {
  let n = 0;
  s.floors.forEach((rows, f) => {
    if (floor !== undefined && f !== floor) return;
    rows.forEach((row, y) => row.forEach((t, x) => (n += t.fire > 0 && isKnown(s, { floor: f, x, y }) ? 1 : 0)));
  });
  return n;
}

/** Whether smoke (or fire) is showing at any window or door on that floor. */
function smokeShowing(s: GameState, floor: number): boolean {
  return s.floors[floor].some((row, y) =>
    row.some((_, x) => {
      const show = showing(s, { floor, x, y });
      return !!show && (show.smoke >= 6 || show.fire > 0);
    }),
  );
}

function renderNavigator(): void {
  const top = state.floors.length - 1;
  const wavers = waving(state);
  const hint = (floors: number[]) =>
    floors.some((f) => wavers.some((w) => w.window.floor === f))
      ? '🙋'
      : floors.some((f) => knownFire(state, f) > 0)
        ? '🔥'
        : floors.some((f) => smokeShowing(state, f))
          ? '💨'
          : '';
  const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);
  ($('floor-up') as HTMLButtonElement).disabled = viewFloor >= top;
  ($('floor-down') as HTMLButtonElement).disabled = viewFloor <= 0;
  $('fire-up').textContent = hint(range(viewFloor + 1, top + 1));
  $('fire-down').textContent = hint(range(0, viewFloor));
  $('floor-num').textContent = String(viewFloor + 1);
  const count = knownFire(state, viewFloor);
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
  // The parking ghost follows the pointer; on a touch screen it stays on the tapped preview tile
  // (tapping Rotate in the sidebar moves the pointer off the map).
  const ghostAt = placing ? (lastPointer === 'touch' ? placing.previewAt ?? hover : hover ?? placing.previewAt) : hover;
  const placingView = placing && {
    truck: truckById(placing.truckId)!,
    orientation: placing.orientation,
    reversed: placing.reversed,
    error: ghostAt ? parkError(truckById(placing.truckId)!, ghostAt, placing.orientation) : 'no position',
  };
  drawFloor(canvas.getContext('2d')!, state, viewFloor, { selected: sel, hover: ghostAt, stops, overlay, time, placing: placingView });
}

/** Phone-only bar pinned to the bottom: what's happening, who is selected, End turn. */
function renderMobileBar(): void {
  const sel = selected();
  $('m-status').textContent = hint.text || `Turn ${state.turn} · your move`;
  $('m-status').className = 'm-status' + (hint.error ? ' error' : '');
  $('m-unit').textContent = sel ? `${sel.name} · ${sel.ap}/${sel.maxAp} AP` : 'No one selected';
  ($('m-end-turn') as HTMLButtonElement).disabled = state.status !== 'playing';
  ($('m-undo') as HTMLButtonElement).disabled = history.length === 0;
}

function render(): void {
  renderMobileBar();
  renderSummary();
  renderDispatch();
  renderView();
  renderInspector();
  renderLog();
  renderNavigator();
  renderModal();
}

function loop(time: number): void {
  drawAll(time);
  requestAnimationFrame(loop);
}

function restart(saved?: GameState): void {
  state = saved ?? newHouseFire();
  history = [];
  placing = undefined;
  selectedId = undefined;
  viewFloor = 0;
  buildStage();
  const first = state.trucks.find((t) => t.status === 'staged');
  if (first) setHint(`${first.name} at scene requesting assignment.`);
  render();
}

// ---------------------------------------------------------------- wiring

$('end-turn').addEventListener('click', doEndTurn);
$('alarm').addEventListener('click', () => commit([{ type: 'alarm' }]));
$('undo').addEventListener('click', undo);
// A tap anywhere else closes the tap menu.
document.addEventListener('pointerdown', (e) => {
  if (!(e.target instanceof Node) || !document.getElementById('tapmenu')?.contains(e.target)) {
    if (e.target !== canvas) closeTapMenu();
  }
});
window.addEventListener('resize', layout);

window.addEventListener('keydown', (e) => {
  // Optional shortcuts; everything is also a tap on the map or a button.
  if (e.target instanceof HTMLInputElement) return;
  switch (e.key.toLowerCase()) {
    case 'tab':
      e.preventDefault();
      return cycleSelection();
    case 'enter':
      e.preventDefault();
      return doEndTurn();
    case 'z':
      return undo();
    case 'r':
      return rotatePlacement();
    case 'h':
      overlay = overlay === 'heat' ? 'normal' : 'heat';
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
      closeTapMenu();
      if (aimingAerial) {
        aimingAerial = false;
        return setHintAndRender('Aerial left where it is.');
      }
      if (placing) {
        placing = undefined;
        return setHintAndRender('Parking cancelled.');
      }
      return;
  }
});

$('m-end-turn').addEventListener('click', doEndTurn);
$('m-undo').addEventListener('click', undo);

// When the published page is updated while open, carry the game in progress across.
const hot = (window as unknown as { claude?: { hot?: HotApi } }).claude?.hot;
interface HotApi {
  snapshot?: (fn: () => unknown) => void;
  ready?: (start: (data: unknown) => void) => void;
  data?: unknown;
}
hot?.snapshot?.(() => ({ state }));
const start = (data: unknown) => {
  const saved = (data as { state?: GameState } | undefined)?.state;
  restart(saved && saved.scenarioName === houseFire.name && saved.fans && saved.units.some((u) => u.rank) && saved.alarm && saved.water ? saved : undefined);
  requestAnimationFrame(loop);
};
if (hot?.ready) hot.ready(start);
else start(hot?.data ?? {});
