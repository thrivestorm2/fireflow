import { canSprayFrom } from '../core/actions';
import { posKey } from '../core/grid';
import { MATERIALS } from '../core/materials';
import type { GameState, Tile, Unit } from '../core/types';

export const TILE = 32;

export type Overlay = 'normal' | 'heat' | 'smoke' | 'structure';

export interface ViewState {
  selected?: Unit;
  hover?: { floor: number; x: number; y: number };
  reach?: Map<string, number>;
  mode: string;
  overlay: Overlay;
  time: number;
}

const BASE: Record<string, string> = {
  ground: '#3b4436',
  air: '#121820',
  brick: '#8c4b3c',
  drywall: '#c9c3b4',
  wood: '#9c7148',
  carpet: '#5f7398',
  tile: '#d4d2c8',
  furniture: '#9c7148',
  glass: '#7fb2d0',
  hole: '#050505',
  rubble: '#5c5853',
};

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (s: number) => Math.round(((n >> s) & 255) * f);
  return `rgb(${c(16)},${c(8)},${c(0)})`;
}

function drawTile(g: CanvasRenderingContext2D, t: Tile, px: number, py: number, x: number, y: number): void {
  const S = TILE;
  let color = t.kind === 'ground' || t.kind === 'air' || t.kind === 'hole' || t.kind === 'rubble' ? BASE[t.kind] : BASE[t.material] ?? '#888';
  if (t.burnt) color = shade(color.startsWith('#') ? color : '#666666', 0.35);
  g.fillStyle = color;
  g.fillRect(px, py, S, S);

  switch (t.kind) {
    case 'ground':
      g.fillStyle = 'rgba(255,255,255,0.04)';
      if ((x + y) % 2) g.fillRect(px, py, S, S);
      if (t.engine) {
        g.fillStyle = '#c62828';
        g.fillRect(px + 2, py + 6, S - 4, S - 12);
        g.fillStyle = '#fff';
        g.font = 'bold 11px system-ui';
        g.textAlign = 'center';
        g.fillText('E', px + S / 2, py + S / 2 + 4);
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
          const off = r % 2 ? 8 : 0;
          for (let c = off; c < S; c += 16) {
            g.moveTo(px + c + 0.5, py + r * 8);
            g.lineTo(px + c + 0.5, py + r * 8 + 8);
          }
          g.stroke();
        }
      }
      break;
    case 'floor':
      if (t.material === 'tile') {
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
      } else if (t.material === 'furniture') {
        g.fillStyle = t.burnt ? '#24201a' : '#5d6b4f';
        g.beginPath();
        g.roundRect(px + 3, py + 3, S - 6, S - 6, 6);
        g.fill();
        g.fillStyle = t.burnt ? '#1a1712' : '#738263';
        g.beginPath();
        g.roundRect(px + 8, py + 8, S - 16, S - 16, 4);
        g.fill();
      }
      break;
    case 'stairs':
      g.strokeStyle = 'rgba(0,0,0,0.4)';
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
      }
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
        const rx = ((x * 7 + y * 13 + i * 11) % 24) + 3;
        const ry = ((x * 5 + y * 3 + i * 17) % 24) + 3;
        g.fillRect(px + rx, py + ry, 4, 3);
      }
      break;
  }

  // Structural damage cracks.
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

  if (t.wet > 0) {
    g.fillStyle = 'rgba(80,160,255,0.22)';
    g.fillRect(px, py, S, S);
  }
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
    const base = py + S - 3;
    g.fillStyle = '#ff6a00';
    flame(g, fx, base, w, h);
    g.fillStyle = '#ffd23f';
    flame(g, fx, base, w * 0.55, h * 0.6);
  }
}

function flame(g: CanvasRenderingContext2D, x: number, base: number, w: number, h: number): void {
  g.beginPath();
  g.moveTo(x - w / 2, base);
  g.quadraticCurveTo(x - w / 2, base - h * 0.6, x, base - h);
  g.quadraticCurveTo(x + w / 2, base - h * 0.6, x + w / 2, base);
  g.closePath();
  g.fill();
}

function drawOverlay(g: CanvasRenderingContext2D, t: Tile, px: number, py: number, overlay: Overlay): void {
  const S = TILE;
  if (overlay === 'heat') {
    g.fillStyle = `rgba(255,${Math.round(200 - t.heat * 2)},0,${t.heat / 120})`;
    g.fillRect(px, py, S, S);
  } else if (overlay === 'smoke') {
    g.fillStyle = `rgba(200,200,210,${t.smoke / 110})`;
    g.fillRect(px, py, S, S);
  } else if (overlay === 'structure') {
    if (t.kind === 'ground' || t.kind === 'air') return;
    const v = t.integrity / 100;
    g.fillStyle = `rgba(${Math.round(255 * (1 - v))},${Math.round(200 * v)},60,0.55)`;
    g.fillRect(px, py, S, S);
  } else {
    if (t.smoke > 8) {
      g.fillStyle = `rgba(60,60,66,${Math.min(0.7, t.smoke / 130)})`;
      g.fillRect(px, py, S, S);
    }
    if (t.fire === 0 && t.heat > 30) {
      g.fillStyle = `rgba(255,60,0,${(t.heat - 30) / 250})`;
      g.fillRect(px, py, S, S);
    }
  }
}

/** Tiles close to their ignition point get a warning border. */
function atRisk(t: Tile): boolean {
  return t.fire === 0 && t.fuel > 0 && t.wet === 0 && t.heat >= MATERIALS[t.material].ignition * 0.75;
}

function drawUnit(g: CanvasRenderingContext2D, u: Unit, px: number, py: number, selected: boolean, offset: number): void {
  const S = TILE;
  const cx = px + S / 2 + offset;
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
    const r = u.carriedBy ? 6 : 9;
    const ox = u.carriedBy ? 9 : 0;
    g.fillStyle = '#f2f2f2';
    g.strokeStyle = '#222';
    g.beginPath();
    g.arc(cx + ox, cy - (u.carriedBy ? 8 : 0), r, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.fillStyle = '#c62828';
    g.font = `bold ${u.carriedBy ? 9 : 12}px system-ui`;
    g.textAlign = 'center';
    g.fillText('!', cx + ox, cy - (u.carriedBy ? 8 : 0) + 4);
    hpBar(g, u, px, py);
    return;
  }
  if (selected) {
    g.strokeStyle = '#4fd1ff';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(cx, cy, 13, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 1;
  }
  g.fillStyle = u.status === 'down' ? '#555' : '#f5c518';
  g.strokeStyle = '#1a1a1a';
  g.lineWidth = 2;
  g.beginPath();
  g.arc(cx, cy, 10, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.lineWidth = 1;
  g.fillStyle = '#1a1a1a';
  g.font = 'bold 12px system-ui';
  g.textAlign = 'center';
  g.fillText(u.name[0], cx, cy + 4);
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

export function drawFloor(g: CanvasRenderingContext2D, state: GameState, floor: number, view: ViewState): void {
  const rows = state.floors[floor];
  const S = TILE;
  g.clearRect(0, 0, g.canvas.width, g.canvas.height);

  rows.forEach((row, y) =>
    row.forEach((t, x) => {
      const px = x * S;
      const py = y * S;
      drawTile(g, t, px, py, x, y);
      drawOverlay(g, t, px, py, view.overlay);
      if (t.fire > 0) drawFire(g, t, px, py, view.time, x * 31 + y * 17 + floor * 7);
      if (atRisk(t)) {
        g.strokeStyle = '#ff8c1a';
        g.setLineDash([4, 3]);
        g.strokeRect(px + 1.5, py + 1.5, S - 3, S - 3);
        g.setLineDash([]);
      }
    }),
  );

  const sel = view.selected;
  if (sel && sel.status === 'active') {
    if ((view.mode === 'auto' || view.mode === 'move') && view.reach) {
      for (const [key, cost] of view.reach) {
        const [f, x, y] = key.split(',').map(Number);
        if (f !== floor || cost === 0) continue;
        g.fillStyle = 'rgba(79,209,255,0.16)';
        g.fillRect(x * S, y * S, S, S);
        g.strokeStyle = 'rgba(79,209,255,0.45)';
        g.strokeRect(x * S + 0.5, y * S + 0.5, S - 1, S - 1);
      }
    }
    if ((view.mode === 'spray' || view.mode === 'auto') && sel.pos.floor === floor && sel.water > 0) {
      rows.forEach((row, y) =>
        row.forEach((t, x) => {
          const p = { floor, x, y };
          if ((view.mode === 'spray' || t.fire > 0) && !canSprayFrom(state, sel.pos, p)) {
            g.strokeStyle = t.fire > 0 ? '#2196f3' : 'rgba(33,150,243,0.5)';
            g.lineWidth = 2;
            g.strokeRect(x * S + 2, y * S + 2, S - 4, S - 4);
            g.lineWidth = 1;
          }
        }),
      );
    }
  }

  const byTile = new Map<string, Unit[]>();
  for (const u of state.units) {
    if (u.pos.floor !== floor || u.status === 'rescued') continue;
    if (u.kind === 'civilian' && u.carriedBy) continue;
    const k = posKey(u.pos);
    byTile.set(k, [...(byTile.get(k) ?? []), u]);
  }
  for (const units of byTile.values()) {
    units.forEach((u, i) => {
      const offset = units.length > 1 ? (i - (units.length - 1) / 2) * 8 : 0;
      drawUnit(g, u, u.pos.x * S, u.pos.y * S, sel?.id === u.id, offset);
      const carried = u.carrying && state.units.find((c) => c.id === u.carrying);
      if (carried) drawUnit(g, carried, u.pos.x * S, u.pos.y * S, false, offset);
    });
  }

  if (view.hover && view.hover.floor === floor) {
    g.strokeStyle = '#ffffff';
    g.lineWidth = 2;
    g.strokeRect(view.hover.x * S + 1, view.hover.y * S + 1, S - 2, S - 2);
    g.lineWidth = 1;
  }
}
