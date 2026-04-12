import { TERRAINS, UNASSIGNED_COLOR, GRID_COLOR, RANKS, BORDER_ZOOM_THRESHOLDS } from '../constants.js';
import { getState } from '../state.js';
import { getDisplayColor, findBorderRank } from '../territory/hierarchy.js';

export class Renderer {
  constructor(canvas, camera) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.camera = camera;
    this._raf = null;
    this._running = false;
    this._needsRender = true;
  }

  resize() {
    const container = this.canvas.parentElement;
    if (!container) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.viewW = w;
    this.viewH = h;
    this.dpr = dpr;
    this._needsRender = true;
  }

  markDirty() { this._needsRender = true; }

  start() {
    this._running = true;
    const loop = () => {
      if (!this._running) return;
      if (this._needsRender) {
        this._needsRender = false;
        this._render();
      }
      this._raf = requestAnimationFrame(loop);
    };
    loop();
  }

  stop() {
    this._running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
  }

  _render() {
    const state = getState();
    if (!state) return;

    const ctx = this.ctx;
    const cam = this.camera;
    const dpr = this.dpr;
    const vw = this.viewW;
    const vh = this.viewH;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vw, vh);

    const range = cam.getVisibleRange(vw, vh, state.mapWidth, state.mapHeight);
    const scale = cam.scale;
    const ui = state.ui;

    // ---- Draw cells ----
    for (let y = range.y0; y <= range.y1; y++) {
      for (let x = range.x0; x <= range.x1; x++) {
        const cell = state.cells[y][x];
        const sx = (x - cam.x) * scale;
        const sy = (y - cam.y) * scale;

        // Base color: territory or terrain
        let color;
        if (cell.territoryId) {
          color = getDisplayColor(cell.territoryId, ui.viewLevel);
        } else {
          // No territory: show terrain color directly
          color = TERRAINS[cell.terrain].color;
        }
        ctx.fillStyle = color;
        ctx.fillRect(sx, sy, scale + 0.5, scale + 0.5);

        // Terrain tint on top of territory color
        if (cell.territoryId && cell.terrain !== 'plain') {
          ctx.globalAlpha = 0.25;
          ctx.fillStyle = TERRAINS[cell.terrain].color;
          ctx.fillRect(sx, sy, scale + 0.5, scale + 0.5);
          ctx.globalAlpha = 1;
        }

        // Terrain symbol when zoomed in
        if (cell.terrain !== 'plain' && TERRAINS[cell.terrain].symbol && scale > 16) {
          ctx.fillStyle = 'rgba(255,255,255,0.45)';
          ctx.font = `${Math.min(scale * 0.45, 13)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(TERRAINS[cell.terrain].symbol, sx + scale / 2, sy + scale / 2);
        }
      }
    }

    // ---- Grid lines ----
    if (scale > 8) {
      ctx.strokeStyle = GRID_COLOR;
      ctx.lineWidth = 0.5;
      for (let y = range.y0; y <= range.y1 + 1; y++) {
        const sy = (y - cam.y) * scale;
        const sx0 = (range.x0 - cam.x) * scale;
        const sx1 = (range.x1 + 1 - cam.x) * scale;
        ctx.beginPath(); ctx.moveTo(sx0, sy); ctx.lineTo(sx1, sy); ctx.stroke();
      }
      for (let x = range.x0; x <= range.x1 + 1; x++) {
        const sx = (x - cam.x) * scale;
        const sy0 = (range.y0 - cam.y) * scale;
        const sy1 = (range.y1 + 1 - cam.y) * scale;
        ctx.beginPath(); ctx.moveTo(sx, sy0); ctx.lineTo(sx, sy1); ctx.stroke();
      }
    }

    // ---- Territory borders ----
    this._drawBorders(ctx, state, range, scale);

    // ---- Selection highlights ----
    if (ui.mode === 'creation') {
      for (const key of ui.creationSelectedCells) {
        const [cx, cy] = key.split(',').map(Number);
        if (cx < range.x0 || cx > range.x1 || cy < range.y0 || cy > range.y1) continue;
        const sx = (cx - cam.x) * scale;
        const sy = (cy - cam.y) * scale;
        ctx.fillStyle = 'rgba(60,140,255,0.25)';
        ctx.fillRect(sx, sy, scale, scale);
        ctx.strokeStyle = 'rgba(60,140,255,0.8)';
        ctx.lineWidth = 2;
        ctx.strokeRect(sx + 1, sy + 1, scale - 2, scale - 2);
      }
    }

    if (ui.mode === 'invasion') {
      const targetId = ui.invasionTargetId;
      for (let y = range.y0; y <= range.y1; y++) {
        for (let x = range.x0; x <= range.x1; x++) {
          const cell = state.cells[y][x];
          const sx = (x - cam.x) * scale;
          const sy = (y - cam.y) * scale;
          if (!TERRAINS[cell.terrain].canOwn) {
            ctx.fillStyle = 'rgba(100,100,100,0.35)';
            ctx.fillRect(sx, sy, scale, scale);
          } else if (cell.territoryId === targetId) {
            ctx.strokeStyle = 'rgba(255,80,80,0.5)';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(sx + 1, sy + 1, scale - 2, scale - 2);
          } else {
            ctx.strokeStyle = 'rgba(80,255,80,0.3)';
            ctx.lineWidth = 1;
            ctx.strokeRect(sx + 1, sy + 1, scale - 2, scale - 2);
          }
        }
      }
    }

    // ---- Labels ----
    if (ui.showLabels && scale > 10) {
      this._drawLabels(ctx, state, range, scale);
    }
  }

  _drawBorders(ctx, state, range, scale) {
    const cam = this.camera;
    for (let y = range.y0; y <= range.y1; y++) {
      for (let x = range.x0; x <= range.x1; x++) {
        const tid = state.cells[y][x].territoryId;
        if (!tid) continue;

        const sx = (x - cam.x) * scale;
        const sy = (y - cam.y) * scale;

        const dirs = [
          [0, -1, sx, sy, sx + scale, sy],         // top
          [0, 1, sx, sy + scale, sx + scale, sy + scale], // bottom
          [-1, 0, sx, sy, sx, sy + scale],          // left
          [1, 0, sx + scale, sy, sx + scale, sy + scale], // right
        ];

        for (const [dx, dy, x1, y1, x2, y2] of dirs) {
          const nx = x + dx, ny = y + dy;
          const nTid = (nx >= 0 && nx < state.mapWidth && ny >= 0 && ny < state.mapHeight)
            ? state.cells[ny][nx].territoryId : null;
          if (nTid === tid) continue;

          const rank = findBorderRank(tid, nTid, state);
          if (rank < 0) continue;
          if (cam.zoom < BORDER_ZOOM_THRESHOLDS[rank]) continue;

          const rd = RANKS[rank];
          ctx.strokeStyle = rd.borderColor;
          ctx.lineWidth = rd.borderWidth;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
      }
    }
  }

  _drawLabels(ctx, state, range, scale) {
    const cam = this.camera;
    const bounds = new Map();
    for (let y = range.y0; y <= range.y1; y++) {
      for (let x = range.x0; x <= range.x1; x++) {
        const tid = state.cells[y][x].territoryId;
        if (!tid) continue;
        if (!bounds.has(tid)) bounds.set(tid, { minX: x, minY: y, maxX: x, maxY: y });
        const b = bounds.get(tid);
        if (x < b.minX) b.minX = x;
        if (x > b.maxX) b.maxX = x;
        if (y < b.minY) b.minY = y;
        if (y > b.maxY) b.maxY = y;
      }
    }
    const fs = Math.max(7, Math.min(13, scale * 0.35));
    ctx.font = `bold ${fs}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [tid, b] of bounds) {
      const t = state.territories.get(tid);
      if (!t || !t.name) continue;
      const cx = ((b.minX + b.maxX + 1) / 2 - cam.x) * scale;
      const cy = ((b.minY + b.maxY + 1) / 2 - cam.y) * scale;
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillText(t.name, cx + 1, cy + 1);
      ctx.fillStyle = '#fff';
      ctx.fillText(t.name, cx, cy);
    }
  }
}
