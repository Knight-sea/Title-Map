import { getState, generateId } from '../state.js';
import { TERRAINS } from '../constants.js';

export function autoGenerateCells(cellSize) {
  const s = getState(), W = s.mapWidth, H = s.mapHeight;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) s.cells[y][x].cellId = null;
  s.cellRegions.clear();

  const ownable = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
    ownable[y * W + x] = TERRAINS[s.cells[y][x].terrain].canOwn ? 1 : 0;

  const assigned = new Uint8Array(W * H);
  const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!ownable[y * W + x] || assigned[y * W + x]) continue;

      const id = generateId();
      s.cellRegions.set(id, { id });

      // Vary target size slightly: ±1
      const variation = Math.random() < 0.1 ? (Math.random() < 0.5 ? -1 : 1) : 0;
      const targetSize = Math.max(1, cellSize + variation);

      const seedTerrain = s.cells[y][x].terrain;
      const region = [];
      const candidates = [{ x, y, dist: 0, crossBorder: false }];
      const inQueue = new Set([`${x},${y}`]);

      while (region.length < targetSize && candidates.length > 0) {
        // Sort: prefer non-border-crossing, then by distance
        let bestIdx = 0, bestScore = scoreCandidate(candidates[0]);
        for (let i = 1; i < candidates.length; i++) {
          const sc = scoreCandidate(candidates[i]);
          if (sc < bestScore) { bestScore = sc; bestIdx = i; }
        }
        const cur = candidates.splice(bestIdx, 1)[0];

        if (assigned[cur.y * W + cur.x]) continue;
        if (!ownable[cur.y * W + cur.x]) continue;

        assigned[cur.y * W + cur.x] = 1;
        s.cells[cur.y][cur.x].cellId = id;
        region.push(cur);

        for (const [dx, dy] of dirs) {
          const nx = cur.x + dx, ny = cur.y + dy;
          if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
          const nk = `${nx},${ny}`;
          if (inQueue.has(nk) || assigned[ny * W + nx]) continue;
          if (!ownable[ny * W + nx]) continue;
          inQueue.add(nk);
          const dist = Math.max(Math.abs(nx - x), Math.abs(ny - y));
          const crossBorder = s.cells[ny][nx].terrain !== seedTerrain;
          candidates.push({ x: nx, y: ny, dist, crossBorder });
        }
      }
    }
  }

  // Second pass: absorb tiny orphan pockets (1-2 tiles) into neighbor cells
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!ownable[y * W + x] || s.cells[y][x].cellId) continue;
    // Find a neighbor cell to join
    for (const [dx, dy] of dirs) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const nCid = s.cells[ny][nx].cellId;
      if (nCid) { s.cells[y][x].cellId = nCid; break; }
    }
  }

  // Clean up empty regions
  const used = new Set();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
    if (s.cells[y][x].cellId) used.add(s.cells[y][x].cellId);
  for (const id of [...s.cellRegions.keys()])
    if (!used.has(id)) s.cellRegions.delete(id);
}

function scoreCandidate(c) {
  // Prefer: close distance, same terrain (no border crossing)
  return c.dist * 2 + (c.crossBorder ? 10 : 0);
}
