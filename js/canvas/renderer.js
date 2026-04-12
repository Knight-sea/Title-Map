import { TERRAINS, UNASSIGNED_COLOR, GRID_COLOR, RANKS, BORDER_ZOOM_THRESHOLDS } from '../constants.js';
import { getState } from '../state.js';
import { getDisplayColor, findBorderRank } from '../territory/hierarchy.js';

export class Renderer {
  constructor(terrainCanvas, overlayCanvas, camera) {
    this.tCtx = terrainCanvas.getContext('2d');
    this.oCtx = overlayCanvas.getContext('2d');
    this.tCanvas = terrainCanvas;
    this.oCanvas = overlayCanvas;
    this.camera = camera;
    this.dirty = true;
    this._raf = null;
    this._running = false;
  }

  resize() {
    const container = this.tCanvas.parentElement;
    const w = container.clientWidth;
    const h = container.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    for (const c of [this.tCanvas, this.oCanvas]) {
      c.width = w * dpr;
      c.height = h * dpr;
      c.style.width = w + 'px';
      c.style.height = h + 'px';
    }
    this.width = w * dpr;
    this.height = h * dpr;
    this.dpr = dpr;
    this.dirty = true;
  }

  markDirty() { this.dirty = true; }

  start() {
    this._running = true;
    const loop = () => {
      if (!this._running) return;
      this.render();
      this._raf = requestAnimationFrame(loop);
    };
    loop();
  }

  stop() {
    this._running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
  }

  render() {
    const state = getState();
    if (!state) return;

    const ctx = this.tCtx;
    const oCtx = this.oCtx;
    const cam = this.camera;
    const dpr = this.dpr;
    const cw = this.width;
    const ch = this.height;

    // Clear both layers
    ctx.clearRect(0, 0, cw, ch);
    oCtx.clearRect(0, 0, cw, ch);

    ctx.save();
    oCtx.save();
    ctx.scale(dpr, dpr);
    oCtx.scale(dpr, dpr);

    const viewW = cw / dpr;
    const viewH = ch / dpr;
    const range = cam.getVisibleRange(viewW, viewH, state.mapWidth, state.mapHeight);
    const scale = cam.scale;
    const ui = state.ui;

    // Draw cells
    for (let y = range.y0; y <= range.y1; y++) {
      for (let x = range.x0; x <= range.x1; x++) {
        const cell = state.cells[y][x];
        const sx = (x - cam.x) * scale;
        const sy = (y - cam.y) * scale;
        const sw = scale;
        const sh = scale;

        // Territory color or terrain color
        let color;
        if (cell.territoryId) {
          color = getDisplayColor(cell.territoryId, ui.viewLevel);
        } else {
          color = UNASSIGNED_COLOR;
        }
        ctx.fillStyle = color;
        ctx.fillRect(sx, sy, sw + 0.5, sh + 0.5);

        // Terrain overlay (for non-plain)
        const terrain = TERRAINS[cell.terrain];
        if (cell.terrain !== 'plain') {
          if (!cell.territoryId) {
            ctx.fillStyle = terrain.color;
            ctx.fillRect(sx, sy, sw + 0.5, sh + 0.5);
          } else {
            // Slight terrain tint overlay
            ctx.fillStyle = terrain.color;
            ctx.globalAlpha = 0.3;
            ctx.fillRect(sx, sy, sw + 0.5, sh + 0.5);
            ctx.globalAlpha = 1;
          }
          // Symbol if zoomed in enough
          if (terrain.symbol && scale > 14) {
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.font = `${Math.min(scale * 0.5, 14)}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(terrain.symbol, sx + sw / 2, sy + sh / 2);
          }
        }

        // Grid lines (only if zoomed in)
        if (scale > 6) {
          ctx.strokeStyle = GRID_COLOR;
          ctx.lineWidth = 0.5;
          ctx.strokeRect(sx, sy, sw, sh);
        }
      }
    }

    // Draw borders on overlay
    this._drawBorders(oCtx, state, range, viewW, viewH);

    // Draw selection highlights
    if (ui.mode === 'creation') {
      this._drawCreationHighlight(oCtx, state, range);
    } else if (ui.mode === 'invasion') {
      this._drawInvasionHighlight(oCtx, state, range);
    }

    // Draw labels
    if (ui.showLabels && scale > 8) {
      this._drawLabels(oCtx, state, range);
    }

    ctx.restore();
    oCtx.restore();
  }

  _drawBorders(ctx, state, range) {
    const cam = this.camera;
    const scale = cam.scale;

    for (let y = range.y0; y <= range.y1; y++) {
      for (let x = range.x0; x <= range.x1; x++) {
        const cell = state.cells[y][x];
        if (!cell.territoryId) continue;

        const sx = (x - cam.x) * scale;
        const sy = (y - cam.y) * scale;

        // Check each neighbor
        const neighbors = [
          [x, y - 1, sx, sy, scale, 0],             // top: horizontal line at top
          [x, y + 1, sx, sy + scale, scale, 0],     // bottom
          [x - 1, y, sx, sy, 0, scale],              // left: vertical line at left
          [x + 1, y, sx + scale, sy, 0, scale],      // right
        ];

        for (const [nx, ny, lx, ly, lw, lh] of neighbors) {
          const neighborTid = (nx >= 0 && nx < state.mapWidth && ny >= 0 && ny < state.mapHeight)
            ? state.cells[ny][nx].territoryId
            : null;

          if (neighborTid === cell.territoryId) continue;

          // Find highest rank at which these two cells differ
          const borderRank = findBorderRank(cell.territoryId, neighborTid, state);
          if (borderRank < 0) continue;

          // Check zoom threshold
          if (cam.zoom < BORDER_ZOOM_THRESHOLDS[borderRank]) continue;

          const rankDef = RANKS[borderRank];
          ctx.strokeStyle = rankDef.borderColor;
          ctx.lineWidth = rankDef.borderWidth;
          ctx.beginPath();
          if (lw > 0) {
            ctx.moveTo(lx, ly);
            ctx.lineTo(lx + lw, ly + lh);
          } else {
            ctx.moveTo(lx, ly);
            ctx.lineTo(lx + lw, ly + lh);
          }
          ctx.stroke();
        }
      }
    }
  }

  _drawCreationHighlight(ctx, state, range) {
    const cam = this.camera;
    const scale = cam.scale;
    const selected = state.ui.creationSelectedCells;

    for (const key of selected) {
      const [x, y] = key.split(',').map(Number);
      if (x < range.x0 || x > range.x1 || y < range.y0 || y > range.y1) continue;
      const sx = (x - cam.x) * scale;
      const sy = (y - cam.y) * scale;
      ctx.fillStyle = 'rgba(60,140,255,0.25)';
      ctx.fillRect(sx, sy, scale, scale);
      ctx.strokeStyle = 'rgba(60,140,255,0.8)';
      ctx.lineWidth = 2;
      ctx.strokeRect(sx + 1, sy + 1, scale - 2, scale - 2);
    }
  }

  _drawInvasionHighlight(ctx, state, range) {
    const cam = this.camera;
    const scale = cam.scale;
    const targetId = state.ui.invasionTargetId;

    for (let y = range.y0; y <= range.y1; y++) {
      for (let x = range.x0; x <= range.x1; x++) {
        const cell = state.cells[y][x];
        const sx = (x - cam.x) * scale;
        const sy = (y - cam.y) * scale;
        const terrain = TERRAINS[cell.terrain];

        if (!terrain.canOwn) {
          // Mountain/sea - grayed out
          ctx.fillStyle = 'rgba(100,100,100,0.4)';
          ctx.fillRect(sx, sy, scale, scale);
        } else if (cell.territoryId === targetId) {
          // Own territory - red border (removable)
          ctx.strokeStyle = 'rgba(255,80,80,0.6)';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(sx + 1, sy + 1, scale - 2, scale - 2);
        } else {
          // Available to add - green border
          ctx.strokeStyle = 'rgba(80,255,80,0.4)';
          ctx.lineWidth = 1;
          ctx.strokeRect(sx + 1, sy + 1, scale - 2, scale - 2);
        }
      }
    }
  }

  _drawLabels(ctx, state, range) {
    const cam = this.camera;
    const scale = cam.scale;

    // Collect territory bounding boxes in view
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

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const fontSize = Math.max(8, Math.min(14, scale * 0.4));
    ctx.font = `bold ${fontSize}px sans-serif`;

    for (const [tid, b] of bounds) {
      const t = state.territories.get(tid);
      if (!t || !t.name) continue;
      const cx = ((b.minX + b.maxX + 1) / 2 - cam.x) * scale;
      const cy = ((b.minY + b.maxY + 1) / 2 - cam.y) * scale;
      // Shadow
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillText(t.name, cx + 1, cy + 1);
      ctx.fillStyle = '#fff';
      ctx.fillText(t.name, cx, cy);
    }
  }
}
