export class Camera {
  constructor() {
    this.x = 0; // world offset
    this.y = 0;
    this.zoom = 1;
    this.minZoom = 0.05;
    this.maxZoom = 5;
    this.cellSize = 24; // base cell size in pixels
  }

  get scale() { return this.zoom * this.cellSize; }

  /** World coords to screen coords */
  worldToScreen(wx, wy) {
    return {
      x: (wx - this.x) * this.zoom * this.cellSize,
      y: (wy - this.y) * this.zoom * this.cellSize,
    };
  }

  /** Screen coords to world coords (cell indices) */
  screenToWorld(sx, sy) {
    return {
      x: sx / (this.zoom * this.cellSize) + this.x,
      y: sy / (this.zoom * this.cellSize) + this.y,
    };
  }

  /** Screen coords to cell coords (floored) */
  screenToCell(sx, sy) {
    const w = this.screenToWorld(sx, sy);
    return { x: Math.floor(w.x), y: Math.floor(w.y) };
  }

  /** Pan by screen delta */
  pan(dx, dy) {
    this.x -= dx / (this.zoom * this.cellSize);
    this.y -= dy / (this.zoom * this.cellSize);
  }

  /** Zoom toward screen point */
  zoomAt(sx, sy, delta) {
    const before = this.screenToWorld(sx, sy);
    this.zoom *= delta > 0 ? 0.9 : 1.1;
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom));
    const after = this.screenToWorld(sx, sy);
    this.x -= (after.x - before.x);
    this.y -= (after.y - before.y);
  }

  /** Fit entire map into viewport */
  fitMap(mapWidth, mapHeight, canvasWidth, canvasHeight) {
    const zx = canvasWidth / (mapWidth * this.cellSize);
    const zy = canvasHeight / (mapHeight * this.cellSize);
    this.zoom = Math.min(zx, zy) * 0.95;
    this.x = -(canvasWidth / (this.zoom * this.cellSize) - mapWidth) / 2;
    this.y = -(canvasHeight / (this.zoom * this.cellSize) - mapHeight) / 2;
  }

  /** Get visible cell range */
  getVisibleRange(canvasWidth, canvasHeight, mapWidth, mapHeight) {
    const tl = this.screenToWorld(0, 0);
    const br = this.screenToWorld(canvasWidth, canvasHeight);
    return {
      x0: Math.max(0, Math.floor(tl.x)),
      y0: Math.max(0, Math.floor(tl.y)),
      x1: Math.min(mapWidth - 1, Math.ceil(br.x)),
      y1: Math.min(mapHeight - 1, Math.ceil(br.y)),
    };
  }
}
