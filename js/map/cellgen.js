import { getState, generateId } from '../state.js';
import { TERRAINS } from '../constants.js';

/**
 * Auto-generate cells using region growth.
 * cellSize: target number of tiles per cell (1~20)
 */
export function autoGenerateCells(cellSize) {
  const s = getState();
  const w = s.mapWidth, h = s.mapHeight;

  // Clear existing
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) s.cells[y][x].cellId = null;
  s.cellRegions.clear();

  // Build list of ownable tiles
  const ownable = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    ownable[y * w + x] = TERRAINS[s.cells[y][x].terrain].canOwn ? 1 : 0;
  }

  const assigned = new Uint8Array(w * h);
  const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];

  // Scan left-to-right, top-to-bottom for seeds
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!ownable[y * w + x] || assigned[y * w + x]) continue;

      // Start a new cell from this seed
      const id = generateId();
      const color = { hue: (s.cellRegions.size * 7) % 25, shade: (s.cellRegions.size * 3) % 5 };
      s.cellRegions.set(id, { id, color });

      // Region growth: BFS prioritized by distance from seed
      const region = [];
      // Priority queue approximation: use array sorted by distance
      const candidates = [{ x, y, dist: 0 }];
      const inQueue = new Set([`${x},${y}`]);

      while (region.length < cellSize && candidates.length > 0) {
        // Pick candidate closest to seed (compact shape)
        let bestIdx = 0, bestDist = candidates[0].dist;
        for (let i = 1; i < candidates.length; i++) {
          if (candidates[i].dist < bestDist) { bestDist = candidates[i].dist; bestIdx = i; }
        }
        const cur = candidates.splice(bestIdx, 1)[0];

        if (assigned[cur.y * w + cur.x]) continue;
        if (!ownable[cur.y * w + cur.x]) continue;

        // Assign
        assigned[cur.y * w + cur.x] = 1;
        s.cells[cur.y][cur.x].cellId = id;
        region.push(cur);

        // Add neighbors as candidates
        for (const [dx, dy] of dirs) {
          const nx = cur.x + dx, ny = cur.y + dy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          const nk = `${nx},${ny}`;
          if (inQueue.has(nk) || assigned[ny * w + nx]) continue;
          if (!ownable[ny * w + nx]) continue;
          inQueue.add(nk);
          // Chebyshev distance from seed for compactness
          const dist = Math.max(Math.abs(nx - x), Math.abs(ny - y));
          candidates.push({ x: nx, y: ny, dist });
        }
      }
    }
  }

  // Clean up empty regions
  const used = new Set();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
    if (s.cells[y][x].cellId) used.add(s.cells[y][x].cellId);
  for (const id of [...s.cellRegions.keys()])
    if (!used.has(id)) s.cellRegions.delete(id);
}
