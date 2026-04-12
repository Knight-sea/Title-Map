import { TERRAINS, UNASSIGNED_COLOR, GRID_COLOR, RANKS, BORDER_ZOOM_THRESHOLDS } from '../constants.js';
import { getState } from '../state.js';
import { getDisplayColor, findBorderRank } from '../territory/hierarchy.js';
import { getColorHex } from '../constants.js';

export class Renderer {
  constructor(canvas, camera) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.camera = camera;
    this._raf = null;
    this._running = false;
    this._dirty = true;
  }

  resize() {
    const c = this.canvas.parentElement;
    if (!c) return;
    const w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.vw = w; this.vh = h; this.dpr = dpr;
    this._dirty = true;
  }

  get viewW() { return this.vw || 0; }
  get viewH() { return this.vh || 0; }
  markDirty() { this._dirty = true; }

  start() {
    this._running = true;
    const loop = () => {
      if (!this._running) return;
      if (this._dirty) { this._dirty = false; this._render(); }
      this._raf = requestAnimationFrame(loop);
    };
    loop();
  }

  stop() { this._running = false; if (this._raf) cancelAnimationFrame(this._raf); }

  _render() {
    const state = getState();
    if (!state) return;
    const ctx = this.ctx;
    const cam = this.camera;
    const vw = this.vw, vh = this.vh;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, vw, vh);

    const range = cam.getVisibleRange(vw, vh, state.mapWidth, state.mapHeight);
    const scale = cam.scale;
    const ui = state.ui;

    // === Cells ===
    for (let y = range.y0; y <= range.y1; y++) {
      for (let x = range.x0; x <= range.x1; x++) {
        const cell = state.cells[y][x];
        const sx = (x - cam.x) * scale;
        const sy = (y - cam.y) * scale;

        // Base color
        let color;
        if (cell.territoryId) {
          color = getDisplayColor(cell.territoryId, ui.viewLevel);
        } else if (cell.cellId && state.locked) {
          // Show cell color when locked but no territory
          const cr = state.cellRegions.get(cell.cellId);
          color = cr ? getColorHex(cr.color.hue, cr.color.shade) : TERRAINS[cell.terrain].color;
          // Dim it since it's unassigned territory
          ctx.fillStyle = color;
          ctx.globalAlpha = 0.35;
          ctx.fillRect(sx, sy, scale + .5, scale + .5);
          ctx.globalAlpha = 1;
          // Then show terrain underneath
          ctx.fillStyle = TERRAINS[cell.terrain].color;
          ctx.globalAlpha = 0.5;
          ctx.fillRect(sx, sy, scale + .5, scale + .5);
          ctx.globalAlpha = 1;
          continue; // skip normal draw
        } else {
          color = TERRAINS[cell.terrain].color;
        }

        ctx.fillStyle = color;
        ctx.fillRect(sx, sy, scale + .5, scale + .5);

        // Terrain tint over territory
        if (cell.territoryId && cell.terrain !== 'plain') {
          ctx.globalAlpha = 0.2;
          ctx.fillStyle = TERRAINS[cell.terrain].color;
          ctx.fillRect(sx, sy, scale + .5, scale + .5);
          ctx.globalAlpha = 1;
        }

        // Terrain symbol
        if (cell.terrain !== 'plain' && TERRAINS[cell.terrain].symbol && scale > 16) {
          ctx.fillStyle = 'rgba(255,255,255,0.4)';
          ctx.font = `${Math.min(scale * .4, 12)}px sans-serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(TERRAINS[cell.terrain].symbol, sx + scale / 2, sy + scale / 2);
        }
      }
    }

    // === Grid ===
    if (scale > 8) {
      ctx.strokeStyle = GRID_COLOR;
      ctx.lineWidth = 0.5;
      for (let y = range.y0; y <= range.y1 + 1; y++) {
        const sy = (y - cam.y) * scale;
        ctx.beginPath(); ctx.moveTo((range.x0 - cam.x) * scale, sy); ctx.lineTo((range.x1 + 1 - cam.x) * scale, sy); ctx.stroke();
      }
      for (let x = range.x0; x <= range.x1 + 1; x++) {
        const sx = (x - cam.x) * scale;
        ctx.beginPath(); ctx.moveTo(sx, (range.y0 - cam.y) * scale); ctx.lineTo(sx, (range.y1 + 1 - cam.y) * scale); ctx.stroke();
      }
    }

    // === Cell boundaries (yellow dashed when not locked, solid when locked) ===
    if (state.cellRegions.size > 0 && scale > 3) {
      this._drawCellBorders(ctx, state, range, scale);
    }

    // === Territory borders ===
    this._drawTerritoryBorders(ctx, state, range, scale);

    // === Mode highlights ===
    if (ui.mode === 'creation') this._drawCreation(ctx, state, range, scale);
    if (ui.mode === 'invasion') this._drawInvasion(ctx, state, range, scale);
    if (ui.mode === 'cell') this._drawCellPaint(ctx, state, range, scale);

    // === Labels ===
    if (ui.showLabels && scale > 10) this._drawLabels(ctx, state, range, scale);
  }

  _drawCellBorders(ctx, state, range, scale) {
    const cam = this.camera;
    ctx.strokeStyle = state.locked ? 'rgba(200,180,80,0.5)' : 'rgba(255,220,80,0.6)';
    ctx.lineWidth = state.locked ? 1 : 1.5;
    if (!state.locked) ctx.setLineDash([3, 3]);

    for (let y = range.y0; y <= range.y1; y++) {
      for (let x = range.x0; x <= range.x1; x++) {
        const cid = state.cells[y][x].cellId;
        if (!cid) continue;
        const sx = (x - cam.x) * scale;
        const sy = (y - cam.y) * scale;

        // Check each neighbor
        const dirs = [[0,-1,sx,sy,sx+scale,sy],[0,1,sx,sy+scale,sx+scale,sy+scale],[-1,0,sx,sy,sx,sy+scale],[1,0,sx+scale,sy,sx+scale,sy+scale]];
        for (const [dx, dy, x1, y1, x2, y2] of dirs) {
          const nx = x + dx, ny = y + dy;
          const nCid = (nx >= 0 && nx < state.mapWidth && ny >= 0 && ny < state.mapHeight)
            ? state.cells[ny][nx].cellId : null;
          if (nCid !== cid) {
            ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
          }
        }
      }
    }
    ctx.setLineDash([]);
  }

  _drawTerritoryBorders(ctx, state, range, scale) {
    const cam = this.camera;
    for (let y = range.y0; y <= range.y1; y++) {
      for (let x = range.x0; x <= range.x1; x++) {
        const tid = state.cells[y][x].territoryId;
        if (!tid) continue;
        const sx = (x - cam.x) * scale;
        const sy = (y - cam.y) * scale;
        const dirs = [[0,-1,sx,sy,sx+scale,sy],[0,1,sx,sy+scale,sx+scale,sy+scale],[-1,0,sx,sy,sx,sy+scale],[1,0,sx+scale,sy,sx+scale,sy+scale]];
        for (const [dx, dy, x1, y1, x2, y2] of dirs) {
          const nx = x + dx, ny = y + dy;
          const nTid = (nx >= 0 && nx < state.mapWidth && ny >= 0 && ny < state.mapHeight)
            ? state.cells[ny][nx].territoryId : null;
          if (nTid === tid) continue;
          const rank = findBorderRank(tid, nTid, state);
          if (rank < 0) continue;
          if (cam.zoom < BORDER_ZOOM_THRESHOLDS[rank]) continue;
          const rd = RANKS[rank];
          ctx.strokeStyle = rd.borderColor; ctx.lineWidth = rd.borderWidth;
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        }
      }
    }
  }

  _drawCreation(ctx, state, range, scale) {
    const cam = this.camera;
    const sel = state.ui.creationSelectedCells;
    if (state.locked) {
      // Highlight entire cells
      for (const cellId of sel) {
        for (let y = range.y0; y <= range.y1; y++) {
          for (let x = range.x0; x <= range.x1; x++) {
            if (state.cells[y][x].cellId !== cellId) continue;
            const sx = (x - cam.x) * scale, sy = (y - cam.y) * scale;
            ctx.fillStyle = 'rgba(60,140,255,0.2)';
            ctx.fillRect(sx, sy, scale, scale);
          }
        }
        // Draw border around selected cell
        for (let y = range.y0; y <= range.y1; y++) {
          for (let x = range.x0; x <= range.x1; x++) {
            if (state.cells[y][x].cellId !== cellId) continue;
            const sx = (x - cam.x) * scale, sy = (y - cam.y) * scale;
            const dirs = [[0,-1,sx,sy,sx+scale,sy],[0,1,sx,sy+scale,sx+scale,sy+scale],[-1,0,sx,sy,sx,sy+scale],[1,0,sx+scale,sy,sx+scale,sy+scale]];
            for (const [dx, dy, x1, y1, x2, y2] of dirs) {
              const nx = x + dx, ny = y + dy;
              const nCid = (nx >= 0 && nx < state.mapWidth && ny >= 0 && ny < state.mapHeight) ? state.cells[ny][nx].cellId : null;
              if (!sel.has(nCid)) {
                ctx.strokeStyle = 'rgba(60,140,255,0.8)'; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
              }
            }
          }
        }
      }
    } else {
      // Tile-based
      for (const key of sel) {
        const [cx, cy] = key.split(',').map(Number);
        if (cx < range.x0 || cx > range.x1 || cy < range.y0 || cy > range.y1) continue;
        const sx = (cx - cam.x) * scale, sy = (cy - cam.y) * scale;
        ctx.fillStyle = 'rgba(60,140,255,0.25)'; ctx.fillRect(sx, sy, scale, scale);
        ctx.strokeStyle = 'rgba(60,140,255,0.8)'; ctx.lineWidth = 2;
        ctx.strokeRect(sx + 1, sy + 1, scale - 2, scale - 2);
      }
    }
  }

  _drawInvasion(ctx, state, range, scale) {
    const cam = this.camera;
    const targetId = state.ui.invasionTargetId;
    for (let y = range.y0; y <= range.y1; y++) {
      for (let x = range.x0; x <= range.x1; x++) {
        const cell = state.cells[y][x];
        const sx = (x - cam.x) * scale, sy = (y - cam.y) * scale;
        if (!TERRAINS[cell.terrain].canOwn && !cell.cellId) {
          ctx.fillStyle = 'rgba(100,100,100,0.35)'; ctx.fillRect(sx, sy, scale, scale);
        } else if (cell.territoryId === targetId) {
          ctx.strokeStyle = 'rgba(255,80,80,0.5)'; ctx.lineWidth = 1.5;
          ctx.strokeRect(sx + 1, sy + 1, scale - 2, scale - 2);
        } else {
          ctx.strokeStyle = 'rgba(80,255,80,0.3)'; ctx.lineWidth = 1;
          ctx.strokeRect(sx + 1, sy + 1, scale - 2, scale - 2);
        }
      }
    }
  }

  _drawCellPaint(ctx, state, range, scale) {
    const cam = this.camera;
    const curCellId = state.ui.currentCellId;
    if (!curCellId) return;
    // Highlight tiles of current cell being painted
    for (let y = range.y0; y <= range.y1; y++) {
      for (let x = range.x0; x <= range.x1; x++) {
        if (state.cells[y][x].cellId === curCellId) {
          const sx = (x - cam.x) * scale, sy = (y - cam.y) * scale;
          ctx.fillStyle = 'rgba(255,220,60,0.2)';
          ctx.fillRect(sx, sy, scale, scale);
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
        if (x < b.minX) b.minX = x; if (x > b.maxX) b.maxX = x;
        if (y < b.minY) b.minY = y; if (y > b.maxY) b.maxY = y;
      }
    }
    const fs = Math.max(7, Math.min(13, scale * .35));
    ctx.font = `bold ${fs}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const [tid, b] of bounds) {
      const t = state.territories.get(tid);
      if (!t || !t.name) continue;
      const cx = ((b.minX + b.maxX + 1) / 2 - cam.x) * scale;
      const cy = ((b.minY + b.maxY + 1) / 2 - cam.y) * scale;
      ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillText(t.name, cx + 1, cy + 1);
      ctx.fillStyle = '#fff'; ctx.fillText(t.name, cx, cy);
    }
  }
}
