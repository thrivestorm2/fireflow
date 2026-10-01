import { performAction, type Action } from './core/actions';
import { exposureDamage } from './core/exposure';
import { endTurn, newGame, summarize } from './core/game';
import { tileAt } from './core/grid';
import { MATERIALS } from './core/materials';
import { reachable } from './core/pathing';
import type { GameState, Pos, Unit } from './core/types';
import { houseFire } from './scenarios/house';
import { MODES, planClick, type Mode } from './ui/intent';
import { drawFloor, TILE, type Overlay } from './ui/render';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const OVERLAYS: { overlay: Overlay; label: string }[] = [
  { overlay: 'normal', label: 'Normal' },
  { overlay: 'heat', label: 'Heat' },
  { overlay: 'smoke', label: 'Smoke' },
  { overlay: 'structure', label: 'Structure' },
];

let state: GameState = newGame(houseFire);
/** States at the start of each action this turn, for undo. */
let history: GameState[] = [];
let selectedId: string | undefined;
let mode: Mode = 'auto';
let overlay: Overlay = 'normal';
let hover: Pos | undefined;
let hint = { text: '', error: false };

const canvases: HTMLCanvasElement[] = [];

function firefighters(): Unit[] {
  return state.units.filter((u) => u.kind === 'firefighter');
}

function selected(): Unit | undefined {
  return state.units.find((u) => u.id === selectedId && u.status === 'active');
}

function setHint(text: string, error = false): void {
  hint = { text, error };
}

function buildFloors(): void {
  const root = $('floors');
  root.innerHTML = '';
  root.style.setProperty('--floor-count', String(state.floors.length));
  canvases.length = 0;
  // Top floor first, so the page reads like a cutaway of the building.
  for (let f = state.floors.length - 1; f >= 0; f--) {
    const wrap = document.createElement('div');
    wrap.className = 'floor';
    const h = document.createElement('h3');
    h.id = `floor-label-${f}`;
    const canvas = document.createElement('canvas');
    canvas.width = state.width * TILE;
    canvas.height = state.height * TILE;
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
    canvases[f] = canvas;
    wrap.append(h, canvas);
    root.append(wrap);
  }
}

function eventPos(canvas: HTMLCanvasElement, floor: number, e: MouseEvent): Pos | undefined {
  const r = canvas.getBoundingClientRect();
  const x = Math.floor(((e.clientX - r.left) / r.width) * state.width);
  const y = Math.floor(((e.clientY - r.top) / r.height) * state.height);
  return x >= 0 && y >= 0 && x < state.width && y < state.height ? { floor, x, y } : undefined;
}

function commit(actions: Action[]): void {
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
}

function onTileClick(p: Pos): void {
  if (state.status !== 'playing') return;
  const own = firefighters().find((u) => u.status === 'active' && u.pos.floor === p.floor && u.pos.x === p.x && u.pos.y === p.y);
  const sel = selected();
  // Clicking another firefighter selects them, unless an explicit mode targets that tile.
  if (own && (!sel || (own.id !== sel.id && (mode === 'auto' || mode === 'move')))) {
    selectedId = own.id;
    setHint(`${own.name} selected.`);
    render();
    return;
  }
  if (!sel) {
    setHint('Select a firefighter first (Tab).', true);
    render();
    return;
  }
  const plan = planClick(state, sel, p, mode);
  if ('error' in plan) {
    setHint(plan.error, true);
    render();
    return;
  }
  commit(plan.actions);
}

function doEndTurn(): void {
  if (state.status !== 'playing') return;
  state = endTurn(state);
  history = [];
  if (!selected()) selectedId = firefighters().find((u) => u.status === 'active')?.id;
  setHint(`Turn ${state.turn}. The fire has moved — your crew is ready.`);
  render();
}

function undo(): void {
  const prev = history.pop();
  if (!prev) return;
  state = prev;
  setHint('Undone.');
  render();
}

function cycleSelection(): void {
  const active = firefighters().filter((u) => u.status === 'active');
  if (!active.length) return;
  const i = active.findIndex((u) => u.id === selectedId);
  selectedId = active[(i + 1) % active.length].id;
  render();
}

function setMode(m: Mode): void {
  mode = m;
  setHint(MODES.find((x) => x.mode === m)!.hint);
  render();
}

// ---------------------------------------------------------------- rendering

function renderSummary(): void {
  const s = summarize(state);
  $('turn').textContent = `Turn ${state.turn}`;
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

function renderCrew(): void {
  const crew = $('crew');
  crew.innerHTML = '';
  for (const u of firefighters()) {
    const b = document.createElement('button');
    b.className = 'card' + (u.id === selectedId ? ' active' : '');
    b.disabled = u.status !== 'active';
    const carrying = u.carrying ? state.units.find((c) => c.id === u.carrying)?.name : undefined;
    const where = u.pos.floor === 0 ? 'Ground floor' : `Floor ${u.pos.floor + 1}`;
    b.innerHTML = `
      <span class="name">${u.name}${u.status === 'down' ? ' — DOWN' : ''}</span>
      <span class="pips" title="Action points">${'●'.repeat(u.ap)}${'○'.repeat(Math.max(0, u.maxAp - u.ap))}</span>
      <div class="bar"><span style="width:${(100 * u.hp) / u.maxHp}%"></span></div>
      <span class="meta">💧 ${u.water}/${u.maxWater} · ${where}${carrying ? ` · carrying ${carrying}` : ''}</span>`;
    b.addEventListener('click', () => {
      selectedId = u.id;
      render();
    });
    crew.append(b);
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
  ($('drop') as HTMLButtonElement).disabled = !sel?.carrying;
  ($('refill') as HTMLButtonElement).disabled = !sel;
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
  const mat = MATERIALS[t.material];
  const people = state.units
    .filter((u) => u.status === 'active' && u.pos.floor === hover!.floor && u.pos.x === hover!.x && u.pos.y === hover!.y)
    .map((u) => `${u.name} (${u.hp} HP, −${exposureDamage(state, u)}/turn)`);
  const fire = ['none', 'smouldering', 'burning', 'fully involved'][t.fire];
  el.innerHTML = `
    <b>${kind[0].toUpperCase() + kind.slice(1)}</b> · ${mat.label}${t.burnt ? ' (burnt)' : ''}<br/>
    Fire: <b>${fire}</b> · Heat <b>${Math.round(t.heat)}</b>${Number.isFinite(mat.ignition) ? ` / ignites ${mat.ignition}` : ''}<br/>
    Smoke <b>${Math.round(t.smoke)}</b> · Fuel <b>${t.fuel.toFixed(1)}</b> · Integrity <b>${Math.max(0, Math.round(t.integrity))}</b>${t.wet ? ' · wet' : ''}
    ${people.length ? `<br/>${people.join(', ')}` : ''}`;
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
    $(`floor-label-${f}`).innerHTML = `<span>${f === 0 ? 'Ground floor' : `Floor ${f + 1}`}</span>${burning ? `<span class="fire-count">🔥 ${burning}</span>` : ''}`;
  });
}

let reachCache: { state: GameState; id: string; reach: Map<string, number> } | undefined;

function drawAll(time: number): void {
  const sel = selected();
  let reach: Map<string, number> | undefined;
  if (sel) {
    if (!reachCache || reachCache.state !== state || reachCache.id !== sel.id) {
      reachCache = { state, id: sel.id, reach: reachable(state, sel).cost };
    }
    reach = reachCache.reach;
  }
  canvases.forEach((c, f) => {
    drawFloor(c.getContext('2d')!, state, f, { selected: sel, hover, reach, mode, overlay, time });
  });
}

function render(): void {
  renderSummary();
  renderCrew();
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
  selectedId = firefighters()[0]?.id;
  mode = 'auto';
  setHint('Select a firefighter and click a tile. Fire acts at the start of every turn.');
  buildFloors();
  render();
}

// ---------------------------------------------------------------- wiring

$('end-turn').addEventListener('click', doEndTurn);
$('undo').addEventListener('click', undo);
$('drop').addEventListener('click', () => selected() && commit([{ type: 'drop', unitId: selected()!.id }]));
$('refill').addEventListener('click', () => selected() && commit([{ type: 'refill', unitId: selected()!.id }]));

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  const m = MODES.find((x) => x.key === e.key);
  if (m) return setMode(m.mode);
  switch (e.key) {
    case 'Tab':
      e.preventDefault();
      return cycleSelection();
    case 'Enter':
      e.preventDefault();
      return doEndTurn();
    case 'z':
    case 'Z':
      return undo();
    case 'g':
    case 'G':
      return void (selected() && commit([{ type: 'drop', unitId: selected()!.id }]));
    case 'r':
    case 'R':
      return void (selected() && commit([{ type: 'refill', unitId: selected()!.id }]));
    case 'h':
      overlay = overlay === 'heat' ? 'normal' : 'heat';
      return render();
    case 'v':
      overlay = overlay === 'smoke' ? 'normal' : 'smoke';
      return render();
    case 'Escape':
      return setMode('auto');
  }
});

restart();
requestAnimationFrame(loop);
