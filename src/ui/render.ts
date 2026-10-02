import { canSprayFrom, nozzleRange } from '../core/actions';
import { AMBIENT, ignitionOf } from '../core/materials';
import { HOSE, hydrantAt, supplyHops } from '../core/hoses';
import { AERIAL, aerialStation, aerialTipAt, aerialTipError, dischargeTiles, footprint, inletTiles, pumpOperator, seatOf, supplyTiles, truckTiles, turntableTiles } from '../core/trucks';
import type { Fan, GameState, HoseLine, Orientation, Pos, Tile, Truck, Unit } from '../core/types';
import { fanRunning } from '../core/ventilation';
import { DIRS, isOutside, posKey } from '../core/grid';
import { isExterior, knowledge, showing } from '../core/knowledge';
import { waving } from '../core/occupants';

/** Internal pixel size of a tile; canvases are scaled with CSS. */
export const TILE = 32;

export type Overlay = 'normal' | 'heat' | 'structure';

/** The part of a floor's grid that is drawn. */
export interface ViewRect {
  x0: number;
  y0: number;
  cols: number;
  rows: number;
}

export interface ViewState {
  selected?: Unit;
  hover?: Pos;
  /** Tiles the selected unit could finish a move on. */
  stops?: Set<string>;
  overlay: Overlay;
  time: number;
  placing?: { truck: Truck; orientation: Orientation; reversed: boolean; error: string | null };
}

/** The whole site is drawn for every level. */
export function siteRect(state: GameState): ViewRect {
  return { x0: 0, y0: 0, cols: state.width, rows: state.height };
}

/**
 * What the player sees at (x, y) while looking at `floor`: the floor's own
 * tile where the building is, otherwise the ground below (yard, road, trucks).
 * A ladder standing in open air belongs to the floor it reaches.
 */
export function shownPos(state: GameState, floor: number, x: number, y: number): Pos {
  const t = state.floors[floor]?.[y]?.[x];
  if (floor > 0 && t && t.kind === 'air' && !t.ladder && !aerialTipAt(state, { floor, x, y })) return { floor: 0, x, y };
  return { floor, x, y };
}

/** Whether something at `p` can be seen while looking at `floor`. */
export function isVisible(state: GameState, floor: number, p: Pos): boolean {
  const shown = shownPos(state, floor, p.x, p.y);
  return shown.floor === p.floor;
}

const MATERIAL_COLOR: Record<string, string> = {
  air: '#121820',
  grass: '#3d5a31',
  asphalt: '#2b2e33',
  concrete: '#8a8c87',
  brick: '#8c4b3c',
  drywall: '#c9c3b4',
  wood: '#9c7148',
  carpet: '#5f7398',
  ceramic: '#d4d2c8',
  glass: '#7fb2d0',
  debris: '#5c5853',
  shingle: '#5b4d48',
};

function darken(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (s: number) => Math.round(((n >> s) & 255) * f);
  return `rgb(${c(16)},${c(8)},${c(0)})`;
}

function drawBase(g: CanvasRenderingContext2D, t: Tile, px: number, py: number, x: number, y: number, known = true): void {
  const S = TILE;
  const base = t.kind === 'hole' ? '#050505' : MATERIAL_COLOR[t.material] ?? '#888888';
  g.fillStyle = t.burnt && known ? darken(base, 0.35) : base;
  g.fillRect(px, py, S, S);

  switch (t.kind) {
    case 'ground':
      if (t.material === 'grass') {
        g.fillStyle = 'rgba(255,255,255,0.035)';
        if ((x + y) % 2) g.fillRect(px, py, S, S);
      } else if (t.material === 'asphalt') {
        g.fillStyle = 'rgba(255,255,255,0.03)';
        g.fillRect(px + ((x * 7 + y * 3) % 20), py + ((x * 3 + y * 11) % 24), 3, 2);
      } else {
        g.strokeStyle = 'rgba(0,0,0,0.18)';
        g.strokeRect(px + 0.5, py + 0.5, S - 1, S - 1);
      }
      if (t.drivable && t.material === 'concrete') {
        g.fillStyle = 'rgba(0,0,0,0.12)';
        g.fillRect(px, py, S, S);
      }
      break;
    case 'wall':
      g.strokeStyle = 'rgba(0,0,0,0.25)';
      g.lineWidth = 1;
      if (t.material === 'brick') {
        for (let r = 0; r < 4; r++) {
          g.beginPath();
          g.moveTo(px, py + r * 8 + 0.5);
          g.lineTo(px + S, py + r * 8 + 0.5);
          for (let c = r % 2 ? 8 : 0; c < S; c += 16) {
            g.moveTo(px + c + 0.5, py + r * 8);
            g.lineTo(px + c + 0.5, py + r * 8 + 8);
          }
          g.stroke();
        }
      }
      break;
    case 'floor':
      if (t.material === 'ceramic') {
        g.fillStyle = 'rgba(0,0,0,0.07)';
        g.fillRect(px, py, S / 2, S / 2);
        g.fillRect(px + S / 2, py + S / 2, S / 2, S / 2);
      } else if (t.material === 'wood') {
        g.strokeStyle = 'rgba(0,0,0,0.15)';
        g.beginPath();
        for (let i = 8; i < S; i += 8) {
          g.moveTo(px, py + i + 0.5);
          g.lineTo(px + S, py + i + 0.5);
        }
        g.stroke();
      }
      break;
    case 'stairs':
      g.strokeStyle = 'rgba(0,0,0,0.45)';
      g.beginPath();
      for (let i = 4; i < S; i += 6) {
        g.moveTo(px + 2, py + i + 0.5);
        g.lineTo(px + S - 2, py + i + 0.5);
      }
      g.stroke();
      break;
    case 'door':
      if (t.open) {
        g.fillStyle = '#4a3a2a';
        g.fillRect(px, py, S, S);
        g.strokeStyle = '#c49a6c';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(px + 3, py + 3);
        g.lineTo(px + 3, py + S - 3);
        g.stroke();
        g.lineWidth = 1;
      } else {
        g.fillStyle = '#6b4423';
        g.fillRect(px + 3, py + 3, S - 6, S - 6);
        g.fillStyle = '#e0c060';
        g.fillRect(px + S - 10, py + S / 2 - 2, 3, 4);
        if (t.locked) {
          // Padlock
          g.strokeStyle = '#e0e0e0';
          g.lineWidth = 2;
          g.beginPath();
          g.arc(px + S / 2, py + 12, 4, Math.PI, 0);
          g.stroke();
          g.lineWidth = 1;
          g.fillStyle = '#e0e0e0';
          g.fillRect(px + S / 2 - 6, py + 12, 12, 9);
        }
      }
      break;
    case 'roof':
      g.strokeStyle = 'rgba(0,0,0,0.3)';
      g.beginPath();
      for (let i = 0; i < 4; i++) {
        g.moveTo(px, py + i * 8 + 7.5);
        g.lineTo(px + S, py + i * 8 + 7.5);
        for (let c = i % 2 ? 0 : 5; c < S; c += 10) {
          g.moveTo(px + c + 0.5, py + i * 8);
          g.lineTo(px + c + 0.5, py + i * 8 + 8);
        }
      }
      g.stroke();
      break;
    case 'vent':
      g.fillStyle = '#0a0a0a';
      g.fillRect(px + 3, py + 3, S - 6, S - 6);
      g.strokeStyle = '#d4a017';
      g.lineWidth = 2;
      g.strokeRect(px + 3, py + 3, S - 6, S - 6);
      g.lineWidth = 1;
      break;
    case 'window':
      if (t.open) {
        g.fillStyle = '#1c2630';
        g.fillRect(px + 3, py + 3, S - 6, S - 6);
        if (t.broken) {
          g.strokeStyle = '#a9d0e8';
          g.beginPath();
          g.moveTo(px + 5, py + 5);
          g.lineTo(px + 12, py + 14);
          g.moveTo(px + S - 5, py + 6);
          g.lineTo(px + S - 13, py + 16);
          g.stroke();
        }
      } else {
        g.strokeStyle = 'rgba(255,255,255,0.6)';
        g.beginPath();
        g.moveTo(px + S / 2 + 0.5, py + 3);
        g.lineTo(px + S / 2 + 0.5, py + S - 3);
        g.moveTo(px + 3, py + S / 2 + 0.5);
        g.lineTo(px + S - 3, py + S / 2 + 0.5);
        g.stroke();
      }
      break;
    case 'hole':
      g.strokeStyle = '#3a2a20';
      g.lineWidth = 2;
      g.strokeRect(px + 2, py + 2, S - 4, S - 4);
      g.lineWidth = 1;
      break;
    case 'rubble':
      g.fillStyle = '#8a847c';
      for (let i = 0; i < 6; i++) {
        g.fillRect(px + ((x * 7 + y * 13 + i * 11) % 24) + 3, py + ((x * 5 + y * 3 + i * 17) % 24) + 3, 4, 3);
      }
      break;
  }

  if (t.integrity < 70 && t.kind !== 'hole' && t.kind !== 'rubble') {
    g.strokeStyle = `rgba(0,0,0,${0.3 + (70 - t.integrity) / 100})`;
    g.beginPath();
    g.moveTo(px + 6, py + 4);
    g.lineTo(px + 14, py + 15);
    g.lineTo(px + 11, py + 22);
    if (t.integrity < 40) {
      g.moveTo(px + 14, py + 15);
      g.lineTo(px + 26, py + 18);
      g.lineTo(px + 24, py + 28);
    }
    g.stroke();
  }
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string): void {
  g.fillStyle = fill;
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  g.fill();
}

function drawContents(g: CanvasRenderingContext2D, t: Tile, px: number, py: number): void {
  const S = TILE;
  switch (t.contents) {
    case 'sofa':
      roundRect(g, px + 3, py + 6, S - 6, S - 10, 5, '#8e4b4b');
      roundRect(g, px + 3, py + 4, S - 6, 7, 3, '#6e3434');
      break;
    case 'bed':
      roundRect(g, px + 2, py + 2, S - 4, S - 4, 3, '#e8e4dc');
      roundRect(g, px + 4, py + 12, S - 8, S - 16, 2, '#4f6fa8');
      break;
    case 'table':
      roundRect(g, px + 5, py + 5, S - 10, S - 10, 2, '#7a5634');
      g.fillStyle = '#4a3420';
      for (const [dx, dy] of [[6, 6], [S - 9, 6], [6, S - 9], [S - 9, S - 9]]) g.fillRect(px + dx, py + dy, 3, 3);
      break;
    case 'cabinet':
      roundRect(g, px + 1, py + 1, S - 2, S - 2, 2, '#5b4a3a');
      g.fillStyle = '#c8b89a';
      g.fillRect(px + 7, py + S / 2 - 1, 5, 2);
      g.fillRect(px + S - 12, py + S / 2 - 1, 5, 2);
      break;
    case 'stove':
      roundRect(g, px + 1, py + 1, S - 2, S - 2, 2, '#3b3e44');
      g.strokeStyle = '#9aa0a8';
      for (const [dx, dy] of [[10, 10], [22, 10], [10, 22], [22, 22]]) {
        g.beginPath();
        g.arc(px + dx, py + dy, 4, 0, Math.PI * 2);
        g.stroke();
      }
      break;
    case 'bookshelf': {
      roundRect(g, px + 2, py + 2, S - 4, S - 4, 2, '#5a3e26');
      const colors = ['#c0392b', '#2e86c1', '#d4ac0d', '#27ae60', '#8e44ad'];
      for (let i = 0; i < 5; i++) {
        g.fillStyle = colors[i];
        g.fillRect(px + 5 + i * 5, py + 6, 3, 9);
        g.fillRect(px + 5 + ((i + 2) % 5) * 5, py + 18, 3, 9);
      }
      break;
    }
    case 'plant':
      roundRect(g, px + 12, py + 20, 8, 8, 2, '#8b5a2b');
      g.fillStyle = '#3f9b4a';
      g.beginPath();
      g.arc(px + 16, py + 15, 8, 0, Math.PI * 2);
      g.fill();
      break;
    case 'tree':
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.beginPath();
      g.arc(px + 18, py + 18, 15, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#2f6b2f';
      g.beginPath();
      g.arc(px + 16, py + 16, 15, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#3d8a3d';
      g.beginPath();
      g.arc(px + 13, py + 13, 7, 0, Math.PI * 2);
      g.fill();
      break;
    case 'hydrant':
      roundRect(g, px + 10, py + 8, 12, 18, 3, '#d32f2f');
      roundRect(g, px + 7, py + 13, 18, 5, 2, '#b71c1c');
      roundRect(g, px + 12, py + 5, 8, 5, 2, '#ef5350');
      break;
    case 'gascan': // red jerry can
      roundRect(g, px + 9, py + 10, 14, 16, 3, '#c62828');
      roundRect(g, px + 18, py + 6, 4, 6, 1, '#8e1b1b');
      hazard(g, px + 16, py + 18, 4);
      break;
    case 'propane': // white cylinder with a valve collar
      roundRect(g, px + 10, py + 7, 12, 20, 6, '#eceff1');
      roundRect(g, px + 12, py + 4, 8, 5, 2, '#90a4ae');
      hazard(g, px + 16, py + 18, 4);
      break;
    case 'drum': // blue 55-gallon drum with a flammable diamond
      roundRect(g, px + 5, py + 4, S - 10, S - 8, 4, '#1e4f91');
      g.fillStyle = '#163d70';
      g.fillRect(px + 5, py + 11, S - 10, 2);
      g.fillRect(px + 5, py + S - 13, S - 10, 2);
      hazard(g, px + S / 2, py + S / 2, 6);
      break;
  }
}

/** A small red-and-white flammable diamond. */
function hazard(g: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  g.fillStyle = '#d32f2f';
  g.beginPath();
  g.moveTo(cx, cy - r);
  g.lineTo(cx + r, cy);
  g.lineTo(cx, cy + r);
  g.lineTo(cx - r, cy);
  g.closePath();
  g.fill();
  g.strokeStyle = '#ffffff';
  g.lineWidth = 1;
  g.stroke();
}

function drawLadder(g: CanvasRenderingContext2D, px: number, py: number): void {
  g.strokeStyle = '#d9d9d9';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(px + 9, py + 1);
  g.lineTo(px + 9, py + TILE - 1);
  g.moveTo(px + TILE - 9, py + 1);
  g.lineTo(px + TILE - 9, py + TILE - 1);
  for (let i = 4; i < TILE; i += 7) {
    g.moveTo(px + 9, py + i);
    g.lineTo(px + TILE - 9, py + i);
  }
  g.stroke();
  g.lineWidth = 1;
}

function flame(g: CanvasRenderingContext2D, x: number, base: number, w: number, h: number): void {
  g.beginPath();
  g.moveTo(x - w / 2, base);
  g.quadraticCurveTo(x - w / 2, base - h * 0.6, x, base - h);
  g.quadraticCurveTo(x + w / 2, base - h * 0.6, x + w / 2, base);
  g.closePath();
  g.fill();
}

function drawFire(g: CanvasRenderingContext2D, t: Tile, px: number, py: number, time: number, seed: number): void {
  const S = TILE;
  g.fillStyle = `rgba(255,90,0,${0.25 + t.fire * 0.12})`;
  g.fillRect(px, py, S, S);
  const flames = t.fire + 1;
  for (let i = 0; i < flames; i++) {
    const phase = time / 140 + seed * 1.7 + i * 2.1;
    const fx = px + S * ((i + 0.5) / flames) + Math.sin(phase) * 2;
    const h = 10 + t.fire * 5 + Math.sin(phase * 1.3) * 3;
    const w = 6 + t.fire;
    g.fillStyle = '#ff6a00';
    flame(g, fx, py + S - 3, w, h);
    g.fillStyle = '#ffd23f';
    flame(g, fx, py + S - 3, w * 0.55, h * 0.6);
  }
}

function drawOverlay(g: CanvasRenderingContext2D, t: Tile, px: number, py: number, overlay: Overlay): void {
  const S = TILE;
  const heat = Math.min(1, (t.temperature - AMBIENT) / 780);
  if (overlay === 'heat') {
    g.fillStyle = `rgba(255,${Math.round(220 - heat * 220)},0,${heat * 0.85})`;
    g.fillRect(px, py, S, S);
  } else if (overlay === 'structure') {
    if (t.kind === 'ground' || t.kind === 'air') return;
    const v = t.integrity / 100;
    g.fillStyle = `rgba(${Math.round(255 * (1 - v))},${Math.round(200 * v)},60,0.55)`;
    g.fillRect(px, py, S, S);
  } else {
    // Smoke: a light grey haze that thickens and darkens toward black as it builds.
    if (t.smoke > 5) {
      const shade = Math.round(150 - Math.min(1, t.smoke / 100) * 115);
      g.fillStyle = `rgba(${shade},${shade},${shade + 6},${Math.min(0.8, 0.12 + t.smoke / 115)})`;
      g.fillRect(px, py, S, S);
    }
    if (t.fire === 0 && t.temperature > 150) {
      g.fillStyle = `rgba(255,60,0,${Math.min(0.45, (t.temperature - 150) / 1000)})`;
      g.fillRect(px, py, S, S);
    }
  }
}

/** Thermal imaging: cool is dark, hot runs through red and orange to white; flames read white-hot. */
function drawThermal(g: CanvasRenderingContext2D, t: Tile, px: number, py: number): void {
  const heat = t.fire > 0 ? 1 : Math.min(1, (t.temperature - AMBIENT) / 600);
  if (heat < 0.03) return;
  const r = 255;
  const gr = Math.round(heat < 0.6 ? heat * 200 : 120 + (heat - 0.6) * 340);
  const b = Math.round(heat < 0.8 ? 0 : (heat - 0.8) * 1200);
  g.fillStyle = `rgba(${r},${Math.min(255, gr)},${Math.min(255, b)},${0.25 + heat * 0.6})`;
  g.fillRect(px, py, TILE, TILE);
}

/**
 * Smoke and fire showing at an opening on the outside of the building: puffs
 * of smoke drifting out (thicker and darker the worse it is inside, a thin seep
 * round a closed frame), the glow of fire behind glass, flames through an open
 * or broken window or door.
 */
function drawShowing(g: CanvasRenderingContext2D, state: GameState, p: Pos, show: { smoke: number; fire: number; heat: number }, px: number, py: number, time: number): void {
  const S = TILE;
  const out = DIRS.find(([dx, dy]) => {
    const n = state.floors[p.floor][p.y + dy]?.[p.x + dx];
    return !!n && isOutside(n);
  });
  if (!out) return;
  const t = state.floors[p.floor][p.y][p.x];
  if (show.fire > 0) {
    if (t.open) drawFire(g, { ...t, fire: show.fire }, px, py, time, p.x * 13 + p.y * 7);
    else {
      g.fillStyle = `rgba(255,120,20,${0.35 + 0.15 * Math.sin(time / 180 + p.x)})`;
      g.fillRect(px + 4, py + 4, S - 8, S - 8);
    }
  } else if (show.heat > 300 && !t.open) {
    g.fillStyle = 'rgba(255,90,20,0.18)'; // glass darkened and glowing from the heat behind it
    g.fillRect(px + 4, py + 4, S - 8, S - 8);
  }
  if (show.smoke < 6) return;
  const [dx, dy] = out;
  const puffs = 2 + Math.round(show.smoke / 20);
  const shade = Math.round(150 - Math.min(1, show.smoke / 100) * 110); // light grey → near black
  for (let i = 0; i < puffs; i++) {
    const life = ((time / 1400 + i / puffs + (p.x * 0.37 + p.y * 0.61)) % 1 + 1) % 1;
    const dist = life * S * 1.6;
    const spread = Math.sin(i * 2.4 + p.x) * S * 0.3 * life;
    const cx = px + S / 2 + dx * (S / 2 + dist) + dy * spread;
    const cy = py + S / 2 + dy * (S / 2 + dist) + dx * spread;
    g.fillStyle = `rgba(${shade},${shade},${shade + 6},${(1 - life) * Math.min(0.75, 0.2 + show.smoke / 140)})`;
    g.beginPath();
    g.arc(cx, cy, 4 + life * 9, 0, Math.PI * 2);
    g.fill();
  }
}

/** Tiles close to their ignition point get a warning border. */
function atRisk(t: Tile): boolean {
  if (t.fire > 0 || t.fuel <= 0 || t.wet > 0) return false;
  const ign = ignitionOf(t.material, t.contents);
  return t.temperature - AMBIENT >= (ign - AMBIENT) * 0.75;
}

/** Officers wear red; engineers and firefighters yellow. */
const HELMET = { officer: '#d32f2f', crew: '#f5c518' };

/** Short unit designation from a truck name: "Engine 1" → "E1", "Ladder 7" → "L7". */
export const unitLabel = (truckName: string): string => truckName.replace(/^(\w)\w*\s*/, '$1');

function drawUnit(g: CanvasRenderingContext2D, u: Unit, px: number, py: number, selected: boolean, truckName?: string): void {
  const S = TILE;
  const cx = px + S / 2;
  const cy = py + S / 2;
  if (u.kind === 'civilian') {
    if (u.status === 'dead') {
      g.strokeStyle = '#9a9a9a';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(cx - 6, cy - 6);
      g.lineTo(cx + 6, cy + 6);
      g.moveTo(cx + 6, cy - 6);
      g.lineTo(cx - 6, cy + 6);
      g.stroke();
      g.lineWidth = 1;
      return;
    }
    const carried = !!u.carriedBy;
    const ox = carried ? 9 : 0;
    const oy = carried ? -8 : 0;
    if (u.occupant === 'dog' || u.occupant === 'cat' || u.occupant === 'bystander') {
      // Pets and bystanders: a small disc with an emoji, so they read apart from residents (white "!").
      const r = carried ? 7 : 10;
      g.fillStyle = u.unconscious ? 'rgba(140,140,140,0.9)' : u.occupant === 'bystander' ? 'rgba(160,180,200,0.85)' : 'rgba(255,230,180,0.9)';
      g.strokeStyle = '#222';
      g.beginPath();
      g.arc(cx + ox, cy + oy, r, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.font = `${carried ? 10 : 14}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(u.occupant === 'dog' ? '🐕' : u.occupant === 'cat' ? '🐈' : '🧍', cx + ox, cy + oy + 1);
      if (u.unconscious) {
        g.font = `${carried ? 8 : 11}px system-ui, sans-serif`;
        g.fillText('💤', cx + ox + 8, cy + oy - 8);
      }
      g.textBaseline = 'alphabetic';
      hpBar(g, u, px, py);
      return;
    }
    g.fillStyle = u.unconscious ? '#9e9e9e' : '#f2f2f2';
    g.strokeStyle = '#222';
    g.beginPath();
    g.arc(cx + ox, cy + oy, carried ? 6 : 9, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.fillStyle = '#c62828';
    g.font = `bold ${carried ? 9 : 12}px system-ui`;
    g.textAlign = 'center';
    g.fillText('!', cx + ox, cy + oy + 4);
    if (u.unconscious) {
      g.font = `${carried ? 8 : 11}px system-ui, sans-serif`;
      g.fillText('💤', cx + ox + 8, cy + oy - 7);
    }
    hpBar(g, u, px, py);
    return;
  }
  if (selected) {
    g.strokeStyle = '#4fd1ff';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(cx, cy, 15, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 1;
  }
  const officer = u.rank === 'LT';
  g.fillStyle = u.status === 'down' ? '#555' : officer ? HELMET.officer : HELMET.crew;
  g.strokeStyle = '#1a1a1a';
  g.lineWidth = 2;
  g.beginPath();
  g.arc(cx, cy, 12, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.lineWidth = 1;
  // Unit on top (E1, L7), position below (LT, ENG, FF).
  g.fillStyle = officer || u.status === 'down' ? '#ffffff' : '#1a1a1a';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = 'bold 9px system-ui, sans-serif';
  g.fillText(truckName ? unitLabel(truckName) : '', cx, cy - 4);
  g.font = 'bold 7px system-ui, sans-serif';
  g.fillText(u.rank ?? 'FF', cx, cy + 5);
  g.textBaseline = 'alphabetic';
  if (u.ap === 0 && u.status === 'active') {
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath();
    g.arc(cx, cy, 13, 0, Math.PI * 2);
    g.fill();
  }
  hpBar(g, u, px, py);
}

function hpBar(g: CanvasRenderingContext2D, u: Unit, px: number, py: number): void {
  if (u.hp >= u.maxHp) return;
  const w = TILE - 6;
  g.fillStyle = '#300';
  g.fillRect(px + 3, py + 1, w, 3);
  g.fillStyle = u.hp > 50 ? '#4caf50' : u.hp > 25 ? '#ffb300' : '#e53935';
  g.fillRect(px + 3, py + 1, (w * u.hp) / u.maxHp, 3);
}

/**
 * Draws a truck over its tiles. The front (cab, windshield, white headlights)
 * is the left/top end unless the truck is reversed; the back has red tail
 * lights. While placing, a chevron shows which way it faces.
 */
function drawTruckShape(g: CanvasRenderingContext2D, truck: Truck, tiles: Pos[], view: ViewRect, alpha: number, ghost = false): void {
  const S = TILE;
  const xs = tiles.map((p) => (p.x - view.x0) * S);
  const ys = tiles.map((p) => (p.y - view.y0) * S);
  const x = Math.min(...xs) + 2;
  const y = Math.min(...ys) + 2;
  const w = Math.max(...xs) + S - 2 - x;
  const h = Math.max(...ys) + S - 2 - y;
  const horizontal = truck.orientation === 'h';
  const L = horizontal ? w : h; // length, front to back
  const D = horizontal ? h : w; // width, side to side
  const dir = truck.reversed ? -1 : 1;
  const front = horizontal ? (truck.reversed ? x + w : x) : truck.reversed ? y + h : y;
  /** Point `a` px back from the front and `c` px across from the top/left side. */
  const at = (a: number, c: number): [number, number] => (horizontal ? [front + dir * a, y + c] : [x + c, front + dir * a]);
  /** Rectangle between a0..a1 along the truck and c0..c1 across it. */
  const box = (a0: number, a1: number, c0: number, c1: number, fill: string, r = 0) => {
    const [x0, y0] = at(a0, c0);
    const [x1, y1] = at(a1, c1);
    roundRect(g, Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0), r, fill);
  };

  g.globalAlpha = alpha;
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(x + 3, y + 3, w, h);
  roundRect(g, x, y, w, h, 5, '#c62828');
  box(0, S - 4, 0, D, '#9a1c1c', 5); // cab
  box(5, 10, 4, D - 4, '#9fd3f0'); // windshield
  box(0, 3, 3, 9, '#fffde7'); // headlights
  box(0, 3, D - 9, D - 3, '#fffde7');
  box(L - 3, L, 3, 8, '#ff1744'); // tail lights
  box(L - 3, L, D - 8, D - 3, '#ff1744');

  if (truck.type === 'ladder' && !truck.aerialTip) {
    g.strokeStyle = '#e0e0e0';
    g.lineWidth = 2;
    g.beginPath();
    for (const c of [D / 2 - 5, D / 2 + 5]) {
      g.moveTo(...at(S, c));
      g.lineTo(...at(L - 6, c));
    }
    for (let a = S; a < L - 6; a += 7) {
      g.moveTo(...at(a, D / 2 - 5));
      g.lineTo(...at(a, D / 2 + 5));
    }
    g.stroke();
    g.lineWidth = 1;
  } else {
    box(S, L - 6, D / 2 - 2, D / 2 + 2, '#f5f5f5');
  }
  if (truck.maxWater > 0) {
    // Tank gauge along one side.
    box(S, L - 6, D - 6, D - 2, 'rgba(0,0,0,0.5)');
    const frac = truck.water / truck.maxWater;
    if (frac > 0) box(S, S + (L - 6 - S) * frac, D - 6, D - 2, frac > 0.3 ? '#64b5f6' : '#ef5350');
  }
  // Big white unit name (E1, L7) on the clear part of the body, outlined so it reads on any background.
  // Rotated so it reads upright to someone standing at the rear looking toward the cab.
  const label = unitLabel(truck.name);
  const [lx, ly] = at(truck.type === 'engine' ? 3.5 * S : L * 0.6, D / 2);
  const angle = horizontal ? (truck.reversed ? Math.PI / 2 : -Math.PI / 2) : truck.reversed ? Math.PI : 0;
  g.save();
  g.translate(lx, ly);
  g.rotate(angle);
  let size = Math.round(D * 0.6);
  g.font = `900 ${size}px system-ui, sans-serif`;
  const fit = (D - 8) / g.measureText(label).width; // text now runs across the truck's width
  if (fit < 1) {
    size = Math.floor(size * fit);
    g.font = `900 ${size}px system-ui, sans-serif`;
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = 5;
  g.strokeStyle = 'rgba(0,0,0,0.75)';
  g.strokeText(label, 0, 0);
  g.fillStyle = '#ffffff';
  g.fillText(label, 0, 0);
  g.restore();

  if (ghost) {
    // Chevron pointing the way the truck faces.
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(...at(S + 2, D / 2));
    g.lineTo(...at(S + 14, D / 2 - 9));
    g.lineTo(...at(S + 14, D / 2 + 9));
    g.closePath();
    g.fill();
  }
  g.globalAlpha = 1;
}

export function drawFloor(g: CanvasRenderingContext2D, state: GameState, floor: number, view: ViewState): void {
  const S = TILE;
  const rect = siteRect(state);
  g.clearRect(0, 0, g.canvas.width, g.canvas.height);
  const seen = (p: Pos) => isVisible(state, floor, p);
  const px = (x: number) => x * S;
  const py = (y: number) => y * S;
  const W = state.width;
  const H = state.height;
  const shown = (x: number, y: number) => shownPos(state, floor, x, y);
  const tileOf = (p: Pos) => state.floors[p.floor][p.y][p.x];
  // Fog of war: fire, smoke and heat inside are only drawn where the crew can perceive them.
  const know = knowledge(state);
  const known = (p: Pos) => isExterior(state, p) || know.seen.has(posKey(p));

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const at = shown(x, y);
      const t = tileOf(at);
      drawBase(g, t, px(x), py(y), x, y, known(at));
      if (t.contents !== 'tree') drawContents(g, t, px(x), py(y));
      if (t.contents === 'hydrant') drawHydrantState(g, state, at, px(x), py(y), view.time);
      // Centre line between the two lanes of a road at least four tiles wide.
      if (t.material === 'asphalt') {
        const col = state.floors[at.floor];
        let above = 0;
        let below = 0;
        while (col[y - above - 1]?.[x]?.material === 'asphalt') above++;
        while (col[y + below + 1]?.[x]?.material === 'asphalt') below++;
        const width = above + below + 1;
        if (width >= 4 && above === width / 2 - 1) {
          g.fillStyle = '#e8c547';
          g.fillRect(px(x) + 4, py(y) + S - 1, S / 2, 2);
        }
      }
      if (t.searched && t.fire === 0 && isWalkableish(t)) {
        g.fillStyle = 'rgba(120,220,140,0.55)';
        g.fillRect(px(x) + S - 6, py(y) + S - 6, 3, 3);
      }
      if (t.ladder) drawLadder(g, px(x), py(y));
      if (view.placing && t.drivable && at.floor === 0) {
        g.strokeStyle = 'rgba(79,209,255,0.35)';
        g.strokeRect(px(x) + 1.5, py(y) + 1.5, S - 3, S - 3);
      }
    }
  }
  // Trees overhang neighbouring tiles, so draw them after the ground.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const at = shown(x, y);
      const t = tileOf(at);
      if (t.contents === 'tree') drawContents(g, t, px(x), py(y));
      if (!known(at)) {
        // Unknown inside: fogged. The thermal camera still reads heat through smoke.
        g.fillStyle = 'rgba(8,10,14,0.62)';
        g.fillRect(px(x), py(y), S, S);
        if (view.overlay === 'heat' && know.thermal.has(posKey(at))) drawThermal(g, t, px(x), py(y));
        continue;
      }
      if (view.overlay === 'heat' && !isOutside(t)) drawThermal(g, t, px(x), py(y));
      else drawOverlay(g, t, px(x), py(y), view.overlay);
      if (t.fire > 0) drawFire(g, t, px(x), py(y), view.time, x * 31 + y * 17 + at.floor * 7);
      if (atRisk(t)) {
        g.strokeStyle = '#ff8c1a';
        g.setLineDash([4, 3]);
        g.strokeRect(px(x) + 1.5, py(y) + 1.5, S - 3, S - 3);
        g.setLineDash([]);
      }
    }
  }

  // Someone waving from a window for help: a hand out of the window, waving.
  for (const { window: w } of waving(state)) {
    if (w.floor !== floor) continue;
    const out = DIRS.find(([dx, dy]) => {
      const n = state.floors[w.floor][w.y + dy]?.[w.x + dx];
      return !!n && isOutside(n);
    }) ?? [0, -1];
    const wave = Math.sin(view.time / 150) * 0.5;
    g.save();
    g.translate(px(w.x) + S / 2 + out[0] * S * 0.55, py(w.y) + S / 2 + out[1] * S * 0.55);
    g.rotate(wave);
    g.font = '18px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('👋', 0, 0);
    g.restore();
  }

  // Size-up from the street: smoke and fire showing at the building's windows and doors.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const at = shown(x, y);
      if (at.floor !== floor) continue;
      const show = showing(state, at);
      if (show) drawShowing(g, state, at, show, px(x), py(y), view.time);
    }
  }

  for (const truck of state.trucks) {
    const tiles = truckTiles(truck);
    if (!tiles.length || !tiles.every(seen)) continue;
    drawTruckShape(g, truck, tiles, rect, 1);
    drawCouplings(g, state, truck, rect, view);
  }

  drawHoses(g, state, seen, view.time);
  for (const truck of state.trucks) drawAerial(g, truck, rect, floor);

  const sel = view.selected;
  const station = sel && sel.status === 'active' && !view.placing ? aerialStation(state, sel) : undefined;
  if (station && sel) {
    // On the aerial: where the tip can go on this (upper) floor, and the fire the master stream can hit.
    const tip = station.aerialTip;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const at = { floor, x, y };
        const shownAt = shown(x, y);
        const stream =
          !!tip && !sel.line && shownAt.floor === tip.floor && tileOf(shownAt).fire > 0 && known(shownAt) && !canSprayFrom(state, tip, shownAt, AERIAL.streamRange);
        const spot = !stream && floor > 0 && !(tip && tip.floor === floor && tip.x === x && tip.y === y) && !aerialTipError(state, station, at);
        if (!stream && !spot) continue;
        g.strokeStyle = stream ? '#2196f3' : 'rgba(255,255,255,0.22)';
        g.lineWidth = 2;
        g.strokeRect(px(x) + 2, py(y) + 2, S - 4, S - 4);
        g.lineWidth = 1;
      }
    }
  }
  if (sel && sel.status === 'active' && !view.placing) {
    if (view.stops) {
      for (const key of view.stops) {
        const [f, x, y] = key.split(',').map(Number);
        if (!seen({ floor: f, x, y })) continue;
        g.fillStyle = 'rgba(79,209,255,0.16)';
        g.fillRect(px(x), py(y), S, S);
        g.strokeStyle = 'rgba(79,209,255,0.45)';
        g.strokeRect(px(x) + 0.5, py(y) + 0.5, S - 1, S - 1);
      }
    }
    const nozzle = state.hoses.find((l) => l.id === sel.line && l.kind === 'attack');
    const reach = nozzleRange(state, sel);
    if (nozzle && !sel.aboard) {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const at = shown(x, y);
          if (at.floor !== sel.pos.floor) continue;
          const t = tileOf(at);
          const fire = t.fire > 0 && known(at);
          if (fire && !canSprayFrom(state, sel.pos, at, reach)) {
            g.strokeStyle = '#2196f3';
            g.lineWidth = 2;
            g.strokeRect(px(x) + 2, py(y) + 2, S - 4, S - 4);
            g.lineWidth = 1;
          }
        }
      }
    }
  }

  for (const fan of state.fans) if (seen(fan.pos)) drawFan(g, state, fan, px(fan.pos.x), py(fan.pos.y), view.time);

  const truckName = (u: Unit) => state.trucks.find((t) => t.id === u.truck)?.name;
  // Crew still aboard sit on their truck (engineer driving, lieutenant beside) and can be clicked like anyone else.
  for (const u of state.units) {
    if (!u.aboard || u.status !== 'active') continue;
    const seat = seatOf(state, u);
    if (seat && seen(seat)) drawUnit(g, u, px(seat.x), py(seat.y), sel?.id === u.id, truckName(u));
  }

  for (const u of state.units) {
    if (u.status === 'rescued' || u.aboard || u.carriedBy || !seen(u.pos)) continue;
    if (u.kind === 'civilian' && !u.found) continue; // nobody has found them yet
    drawUnit(g, u, px(u.pos.x), py(u.pos.y), sel?.id === u.id, truckName(u));
    const carried = u.carrying && state.units.find((c) => c.id === u.carrying);
    if (carried) drawUnit(g, carried, px(u.pos.x), py(u.pos.y), false);
  }

  // On upper levels, shade the ground so the floor being viewed stands out.
  if (floor > 0) {
    g.fillStyle = 'rgba(8,12,18,0.28)';
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (shown(x, y).floor === 0) g.fillRect(px(x), py(y), S, S);
  }

  if (view.placing && view.hover) {
    const tiles = footprint({ ...view.hover, floor: 0 }, view.placing.orientation, view.placing.truck.type).filter(
      (p) => p.x >= 0 && p.y >= 0 && p.x < W && p.y < H,
    );
    if (tiles.length) {
      drawTruckShape(g, { ...view.placing.truck, orientation: view.placing.orientation, reversed: view.placing.reversed }, tiles, rect, 0.7, true);
      g.strokeStyle = view.placing.error ? '#ef5350' : '#66bb6a';
      g.lineWidth = 3;
      for (const p of tiles) g.strokeRect(px(p.x) + 2, py(p.y) + 2, S - 4, S - 4);
      g.lineWidth = 1;
    }
  } else if (view.hover) {
    g.strokeStyle = '#ffffff';
    g.lineWidth = 2;
    g.strokeRect(px(view.hover.x) + 1, py(view.hover.y) + 1, S - 2, S - 2);
    g.lineWidth = 1;
  }
}


/** 1¾″ attack lines are red, 2½″ attack lines blue, 5″ LDH supply lines yellow. */
export const HOSE_COLOR = { '1.75': '#e53935', '2.5': '#1e88e5', '5': '#fdd835' } as const;
const HOSE_WIDTH = { '1.75': 3, '2.5': 5, '5': 8 } as const;

/** Hose lines: blue attack lines, thick yellow 5" supply lines. Dashed when no water is behind them. */
function drawHoses(g: CanvasRenderingContext2D, state: GameState, seen: (p: Pos) => boolean, time: number): void {
  const S = TILE;
  const cx = (p: Pos) => p.x * S + S / 2;
  const cy = (p: Pos) => p.y * S + S / 2;
  const hops = supplyHops(state);
  state.hoses.forEach((line, i) => {
    const truck = state.trucks.find((t) => t.id === line.truckId);
    if (!truck) return;
    const off = ((i % 3) - 1) * 4;
    const pts: (Pos | null)[] = [];
    // Start at the coupling on the truck.
    if (seen(line.tiles[0]) && seen(line.origin)) pts.push(line.origin);
    for (const p of line.tiles) pts.push(seen(p) ? p : null);
    const flow = line.kind === 'supply' ? supplyFlow(state, line, hops) : truck.water > 0 && pumpOperator(state, truck) ? 1 : 0;
    const charged = flow !== 0;
    g.strokeStyle = HOSE_COLOR[line.size];
    g.lineWidth = HOSE_WIDTH[line.size] + (charged ? 1 : 0);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    if (!charged) g.setLineDash([7, 5]);
    g.beginPath();
    let pen = false;
    for (const p of pts) {
      if (!p) {
        pen = false;
        continue;
      }
      if (pen) g.lineTo(cx(p) + off, cy(p) + off);
      else g.moveTo(cx(p) + off, cy(p) + off);
      pen = true;
    }
    g.stroke();
    g.setLineDash([]);
    if (line.kind === 'supply' && charged) {
      // A thin blue line of water down the middle of the LDH, with ripples moving along it.
      g.strokeStyle = '#1e88e5';
      g.lineWidth = 2;
      g.stroke();
      g.strokeStyle = 'rgba(179,229,252,0.8)';
      g.setLineDash([3, 9]);
      // The path runs from the truck outwards; a positive offset moves the ripples back toward the truck.
      g.lineDashOffset = (flow * time) / 60;
      g.stroke();
      g.setLineDash([]);
      g.lineDashOffset = 0;
    }
    g.lineWidth = 1;
    g.lineCap = 'butt';
    const end = line.tiles[line.tiles.length - 1];
    if (line.kind === 'attack' && seen(end)) {
      g.fillStyle = '#9e9e9e';
      g.strokeStyle = '#212121';
      g.beginPath();
      g.arc(cx(end) + off, cy(end) + off, 4, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      if (!line.holder) {
        g.strokeStyle = HOSE_COLOR[line.size];
        g.beginPath();
        g.arc(cx(end) + off, cy(end) + off, 8, 0, Math.PI * 2);
        g.stroke();
      }
    } else if (line.kind === 'supply' && !line.hydrant && !line.holder && seen(end)) {
      g.strokeStyle = HOSE_COLOR[line.size];
      g.beginPath();
      g.arc(cx(end) + off, cy(end) + off, 8, 0, Math.PI * 2);
      g.stroke();
    }
  });
}

/**
 * Water in a supply line and which way it runs along the line's path (which
 * starts at the truck it was pulled from): 1 toward that truck, -1 away from
 * it, 0 dry. A flowing hydrant feeds its truck; in a truck-to-truck line water
 * runs from the truck nearer the hydrant.
 */
function supplyFlow(state: GameState, line: HoseLine, hops: Map<string, number>): number {
  if (line.hydrant) return hydrantAt(state, line.hydrant)?.state === 'flowing' ? 1 : 0;
  if (!line.toTruck) return 0;
  const from = hops.get(line.truckId);
  const to = hops.get(line.toTruck);
  if (from === undefined || to === undefined) return 0;
  return from <= to ? -1 : 1;
}

/** Small badge on a hydrant showing how far the crew has got with it. */
function drawHydrantState(g: CanvasRenderingContext2D, state: GameState, p: Pos, px: number, py: number, time: number): void {
  const h = hydrantAt(state, p);
  if (!h || h.state === 'capped') return;
  const S = TILE;
  g.fillStyle = '#212121';
  g.beginPath();
  g.arc(px + S - 7, py + 7, 5, 0, Math.PI * 2);
  g.fill();
  if (h.state === 'opening' || h.state === 'flowing') {
    const pulse = h.state === 'flowing' ? 0.6 + 0.4 * Math.sin(time / 200) : 0.5;
    g.fillStyle = `rgba(100,181,246,${pulse})`;
    g.beginPath();
    g.arc(px + S - 7, py + 7, 4, 0, Math.PI * 2);
    g.fill();
  } else if (h.state === 'connected') {
    g.strokeStyle = '#64b5f6';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(px + S - 7, py + 7, 4, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 1;
  }
}

function isWalkableish(t: Tile): boolean {
  return t.kind === 'floor' || t.kind === 'stairs' || t.kind === 'rubble';
}

/** A fan: spinning blades while it blows through an open doorway, with an arrow showing the flow. */
function drawFan(g: CanvasRenderingContext2D, state: GameState, fan: Fan, px: number, py: number, time: number): void {
  const S = TILE;
  const cx = px + S / 2;
  const cy = py + S / 2;
  const running = fanRunning(state, fan);
  roundRect(g, px + 4, py + 4, S - 8, S - 8, 6, '#37474f');
  g.fillStyle = '#cfd8dc';
  const spin = running ? time / 80 : 0;
  for (let i = 0; i < 3; i++) {
    const a = spin + (i * Math.PI * 2) / 3;
    g.beginPath();
    g.ellipse(cx + Math.cos(a) * 5, cy + Math.sin(a) * 5, 6, 3, a, 0, Math.PI * 2);
    g.fill();
  }
  if (running) {
    const dx = fan.target.x - fan.pos.x;
    const dy = fan.target.y - fan.pos.y;
    g.strokeStyle = '#80deea';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(cx + dx * 10, cy + dy * 10);
    g.lineTo(cx + dx * 22, cy + dy * 22);
    g.lineTo(cx + dx * 17 - dy * 4, cy + dy * 17 - dx * 4);
    g.moveTo(cx + dx * 22, cy + dy * 22);
    g.lineTo(cx + dx * 17 + dy * 4, cy + dy * 17 + dx * 4);
    g.stroke();
    g.lineWidth = 1;
  }
}

/**
 * A truck's hose connections. Engines: halfway down each long side a red 1¾″
 * coupling toward the front and a blue 2½″ one toward the back. Engines and
 * ladder trucks: a yellow 5″ supply coupling on the rear, and a 5″ inlet on
 * each side; ladder trucks also show their turntable. Greyed out when in use; outlined when the selected
 * firefighter can take that line.
 */
function drawCouplings(g: CanvasRenderingContext2D, state: GameState, truck: Truck, rect: ViewRect, view: ViewState): void {
  const S = TILE;
  const sel = view.selected;
  for (const d of dischargeTiles(truck)) {
    const px = (d.pos.x - rect.x0) * S;
    const py = (d.pos.y - rect.y0) * S;
    roundRect(g, px + 3, py + 3, S - 6, S - 6, 4, '#37474f');
    const towardFront = truck.reversed ? 1 : -1;
    const reachable = !!sel && !sel.aboard && !sel.line && sel.pos.floor === 0 && Math.abs(sel.pos.x - d.pos.x) + Math.abs(sel.pos.y - d.pos.y) === 1;
    for (const size of ['1.75', '2.5'] as const) {
      const shift = (size === '1.75' ? 1 : -1) * towardFront * (S / 4);
      const cx = px + S / 2 + (truck.orientation === 'h' ? shift : 0);
      const cy = py + S / 2 + (truck.orientation === 'v' ? shift : 0);
      const inUse = state.hoses.some((l) => l.truckId === truck.id && l.kind === 'attack' && l.side === d.side && l.size === size);
      g.fillStyle = inUse ? '#616161' : HOSE_COLOR[size];
      g.beginPath();
      g.arc(cx, cy, size === '2.5' ? 6 : 5, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#cfd8dc';
      g.lineWidth = 1.5;
      g.stroke();
      if (reachable && !inUse) {
        g.strokeStyle = `rgba(255,255,255,${0.6 + 0.4 * Math.sin(view.time / 200)})`;
        g.lineWidth = 2;
        g.beginPath();
        g.arc(cx, cy, 9, 0, Math.PI * 2);
        g.stroke();
      }
      g.lineWidth = 1;
    }
  }

  // The 5″ supply coupling, centred on the back of the truck.
  const rear = supplyTiles(truck);
  if (rear.length) {
    const backward = truck.reversed ? -1 : 1;
    const mx = rear.reduce((n, p) => n + (p.x - rect.x0) * S + S / 2, 0) / rear.length;
    const my = rear.reduce((n, p) => n + (p.y - rect.y0) * S + S / 2, 0) / rear.length;
    const cx = mx + (truck.orientation === 'h' ? backward * (S / 4) : 0);
    const cy = my + (truck.orientation === 'v' ? backward * (S / 4) : 0);
    const inUse = state.hoses.filter((l) => l.truckId === truck.id && l.kind === 'supply').length >= HOSE.maxSupplyLines;
    roundRect(g, cx - 10, cy - 10, 20, 20, 4, '#37474f');
    g.fillStyle = inUse ? '#616161' : HOSE_COLOR['5'];
    g.beginPath();
    g.arc(cx, cy, 7, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#cfd8dc';
    g.lineWidth = 1.5;
    g.stroke();
    const reachable =
      !!sel && !sel.aboard && !sel.line && sel.pos.floor === 0 && rear.some((p) => Math.abs(sel.pos.x - p.x) + Math.abs(sel.pos.y - p.y) === 1);
    if (reachable && !inUse) {
      g.strokeStyle = `rgba(255,255,255,${0.6 + 0.4 * Math.sin(view.time / 200)})`;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(cx, cy, 11, 0, Math.PI * 2);
      g.stroke();
    }
    g.lineWidth = 1;
  }
  // 5″ side inlets (truck-to-truck supply), on the outer edge of each long side.
  const inletUsed = state.hoses.some((l) => l.toTruck === truck.id);
  const holdingSupply = !!sel && state.hoses.some((l) => l.id === sel.line && l.kind === 'supply' && l.truckId !== truck.id);
  for (const d of inletTiles(truck)) {
    const outward = d.side === 0 ? -1 : 1;
    const cx = (d.pos.x - rect.x0) * S + S / 2 + (truck.orientation === 'v' ? outward * (S / 2 - 7) : 0);
    const cy = (d.pos.y - rect.y0) * S + S / 2 + (truck.orientation === 'h' ? outward * (S / 2 - 7) : 0);
    g.fillStyle = '#cfd8dc';
    g.beginPath();
    g.arc(cx, cy, 6, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = inletUsed ? '#616161' : HOSE_COLOR['5'];
    g.beginPath();
    g.arc(cx, cy, 4, 0, Math.PI * 2);
    g.fill();
    const reachable = holdingSupply && !inletUsed && sel!.pos.floor === 0 && Math.abs(sel!.pos.x - d.pos.x) + Math.abs(sel!.pos.y - d.pos.y) === 1;
    if (reachable) {
      g.strokeStyle = `rgba(255,255,255,${0.6 + 0.4 * Math.sin(view.time / 200)})`;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(cx, cy, 9, 0, Math.PI * 2);
      g.stroke();
      g.lineWidth = 1;
    }
  }

  // A ladder truck's turntable deck: firefighters can stand here to work the aerial.
  const deck = turntableTiles(truck);
  if (deck.length) {
    const xs = deck.map((p) => (p.x - rect.x0) * S);
    const ys = deck.map((p) => (p.y - rect.y0) * S);
    const x = Math.min(...xs) + 3;
    const y = Math.min(...ys) + 3;
    roundRect(g, x, y, Math.max(...xs) + S - 3 - x, Math.max(...ys) + S - 3 - y, 6, '#455a64');
    const [cx, cy] = deckCentre(deck, rect);
    g.strokeStyle = '#cfd8dc';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(cx, cy, 10, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 1;
  }
}

/** Screen centre of a turntable deck. */
function deckCentre(deck: Pos[], rect: ViewRect): [number, number] {
  const S = TILE;
  return [
    deck.reduce((n, p) => n + (p.x - rect.x0) * S + S / 2, 0) / deck.length,
    deck.reduce((n, p) => n + (p.y - rect.y0) * S + S / 2, 0) / deck.length,
  ];
}

/**
 * A raised aerial, seen from above: the ladder from the turntable out to the
 * tip, with the tip's platform. The tip is labelled with its floor when it
 * isn't on the one being viewed.
 */
function drawAerial(g: CanvasRenderingContext2D, truck: Truck, rect: ViewRect, floor: number): void {
  const deck = turntableTiles(truck);
  const tip = truck.aerialTip;
  if (!deck.length || !tip || truck.status !== 'placed') return;
  const S = TILE;
  const [x0, y0] = deckCentre(deck, rect);
  const x1 = (tip.x - rect.x0) * S + S / 2;
  const y1 = (tip.y - rect.y0) * S + S / 2;
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const nx = (-(y1 - y0) / len) * 5;
  const ny = ((x1 - x0) / len) * 5;
  g.strokeStyle = '#e0e0e0';
  g.lineWidth = 2;
  g.beginPath();
  for (const k of [1, -1]) {
    g.moveTo(x0 + k * nx, y0 + k * ny);
    g.lineTo(x1 + k * nx, y1 + k * ny);
  }
  for (let d = 8; d < len; d += 7) {
    const fx = x0 + ((x1 - x0) * d) / len;
    const fy = y0 + ((y1 - y0) * d) / len;
    g.moveTo(fx + nx, fy + ny);
    g.lineTo(fx - nx, fy - ny);
  }
  g.stroke();
  g.lineWidth = 1;
  roundRect(g, x1 - 9, y1 - 9, 18, 18, 3, tip.floor === floor ? '#c62828' : 'rgba(198,40,40,0.55)');
  if (tip.floor !== floor) {
    g.fillStyle = '#ffffff';
    g.font = 'bold 9px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(`F${tip.floor + 1}`, x1, y1);
    g.textBaseline = 'alphabetic';
  }
}
