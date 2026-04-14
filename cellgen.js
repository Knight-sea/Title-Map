import { getState, generateId } from '../state.js';
import { TERRAINS } from '../constants.js';

// ============================================================
//  Voronoi式 セル自動生成
//  - 海・山を除外（canOwn:false タイルはスキップ）
//  - シード点をランダムに配置しBFSで等距離分割
//  - 最小サイズ未満のセルを隣接セルへ吸収
// ============================================================

export function autoGenerateCells(cellSize) {
  const s = getState();
  const W = s.mapWidth, H = s.mapHeight;

  // 既存セル情報をクリア
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) s.cells[y][x].cellId = null;
  s.cellRegions.clear();

  // --- 所有可能タイルのリストアップ（海・山除外）---
  const ownable = new Uint8Array(W * H);
  const ownableTiles = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = s.cells[y][x].terrain;
    if (TERRAINS[t].canOwn) {
      ownable[y * W + x] = 1;
      ownableTiles.push([x, y]);
    }
  }
  if (ownableTiles.length === 0) return;

  // --- シード点の配置 ---
  const numSeeds = Math.max(1, Math.round(ownableTiles.length / (cellSize * cellSize)));
  const minSpacing = Math.max(1, cellSize * 0.7);
  const seeds = pickSeeds(ownableTiles, ownable, W, H, numSeeds, minSpacing);
  if (seeds.length === 0) return;

  // --- セルIDを事前生成 ---
  const seedIds = seeds.map(() => {
    const id = generateId();
    s.cellRegions.set(id, { id });
    return id;
  });

  // --- BFS による Voronoi 分割（Manhattan距離） ---
  const assignment = new Int32Array(W * H).fill(-1); // seedインデックス
  const dist       = new Int32Array(W * H).fill(2147483647);
  const q = [];
  let qi = 0;

  for (let si = 0; si < seeds.length; si++) {
    const [sx, sy] = seeds[si];
    const i = sy * W + sx;
    dist[i] = 0;
    assignment[i] = si;
    q.push(i);
  }

  while (qi < q.length) {
    const i = q[qi++];
    const x = i % W, y = (i - x) / W;
    const d = dist[i], si = assignment[i];

    for (const [dx, dy] of [[0,-1],[0,1],[-1,0],[1,0]]) {
      const nx = x+dx, ny = y+dy;
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const ni = ny * W + nx;
      if (!ownable[ni]) continue;
      const nd = d + 1;
      if (nd < dist[ni]) {
        dist[ni] = nd;
        assignment[ni] = si;
        q.push(ni);
      }
    }
  }

  // --- State へ適用 ---
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (ownable[i] && assignment[i] >= 0) {
      s.cells[y][x].cellId = seedIds[assignment[i]];
    }
  }

  // --- セルサイズ集計 ---
  const cellSizeMap = new Map(); // id → count
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const cid = s.cells[y][x].cellId;
    if (cid) cellSizeMap.set(cid, (cellSizeMap.get(cid) || 0) + 1);
  }

  // --- 小さすぎるセルの吸収（最小サイズ = cellSize/2、最低2） ---
  const minSize = Math.max(2, Math.floor(cellSize * 0.5));
  absorbTinyCells(s, W, H, cellSizeMap, minSize, seedIds);

  // --- 使われていないセルIDを削除 ---
  cleanupRegions(s, W, H);
}

// ========== シード点配置 ==========

function pickSeeds(tiles, ownable, W, H, numSeeds, minSpacing) {
  // Fisher-Yatesシャッフル
  const arr = tiles.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }

  const seeds = [];
  const minSp2 = minSpacing * minSpacing;

  for (const [x, y] of arr) {
    if (seeds.length >= numSeeds) break;
    let ok = true;
    for (const [sx, sy] of seeds) {
      const dx = x - sx, dy = y - sy;
      if (dx*dx + dy*dy < minSp2) { ok = false; break; }
    }
    if (ok) seeds.push([x, y]);
  }

  // シード数が不足していたら間引きなしで補充
  if (seeds.length < Math.floor(numSeeds * 0.5)) {
    for (const [x, y] of arr) {
      if (seeds.length >= numSeeds) break;
      if (!seeds.some(([sx, sy]) => sx === x && sy === y)) seeds.push([x, y]);
    }
  }

  return seeds;
}

// ========== 小セルの吸収 ==========

function absorbTinyCells(s, W, H, sizeMap, minSize, seedIds) {
  const maxPasses = 10;
  for (let pass = 0; pass < maxPasses; pass++) {
    let absorbed = false;
    for (const [id, size] of [...sizeMap.entries()]) {
      if (size >= minSize) continue;
      // 隣接する最大のセルを探す
      let bestNeighbor = null, bestSize = -1;
      outer:
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (s.cells[y][x].cellId !== id) continue;
        for (const [dx, dy] of [[0,-1],[0,1],[-1,0],[1,0]]) {
          const nx = x+dx, ny = y+dy;
          if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
          const nc = s.cells[ny][nx].cellId;
          if (nc && nc !== id) {
            const ns = sizeMap.get(nc) || 0;
            if (ns > bestSize) { bestSize = ns; bestNeighbor = nc; }
          }
        }
      }
      if (!bestNeighbor) continue;

      // 吸収実行
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (s.cells[y][x].cellId === id) s.cells[y][x].cellId = bestNeighbor;
      }
      sizeMap.set(bestNeighbor, (sizeMap.get(bestNeighbor) || 0) + size);
      sizeMap.delete(id);
      s.cellRegions.delete(id);
      absorbed = true;
    }
    if (!absorbed) break;
  }
}

// ========== クリーンアップ ==========

function cleanupRegions(s, W, H) {
  const used = new Set();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const cid = s.cells[y][x].cellId;
    if (cid) used.add(cid);
  }
  for (const id of [...s.cellRegions.keys()]) {
    if (!used.has(id)) s.cellRegions.delete(id);
  }
}
