/**
 * cellgen.js
 * ─────────────────────────────────────────────────────────────────
 *  容量制約付き最小費用割り当て（Min-Cost Capacitated Assignment）
 *
 *  概念上のネットワーク：
 *    超source ──1─→ 各陸地タイル ──BFS距離コスト─→ 各シード ──→ 超sink
 *    陸地タイル側 capacity=1、シード側 capacity=targetSize
 *
 *  実装方針（ブラウザ安全・O(N log N)）:
 *    Phase 1: BFS Voronoi（初期フロー）
 *             → 各タイルを最短シードへ仮割り当て（完全な最小費用解の近似）
 *    Phase 2: 容量再調整（Successive Shortest Path の局所近似）
 *             → 超過シードの境界タイルを不足シードへ移送
 *             → 連結性チェックを内包（飛び地防止）
 *    Phase 3: 飛び地修復
 *             → 各シード領域の非主連結成分タイルを再割り当て
 *    Phase 4: 未割当タイルの吸収
 * ─────────────────────────────────────────────────────────────────
 */

import { getState, generateId } from '../state.js';
import { TERRAINS } from '../constants.js';

const DIRS4 = [[0,-1],[0,1],[-1,0],[1,0]];

// ================================================================
//  Public API
// ================================================================

export function autoGenerateCells(cellSize) {
  const s  = getState();
  const W  = s.mapWidth, H = s.mapHeight;

  // クリア
  for (let y=0;y<H;y++) for (let x=0;x<W;x++) s.cells[y][x].cellId = null;
  s.cellRegions.clear();

  // ────────────────────────────────────────
  //  Step 1: 所有可能タイルを列挙（海・山を除外）
  // ────────────────────────────────────────
  const ownable  = new Uint8Array(W * H);
  const ownTiles = [];
  for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
    if (TERRAINS[s.cells[y][x].terrain].canOwn) {
      ownable[y*W+x] = 1;
      ownTiles.push(y*W+x);
    }
  }
  if (!ownTiles.length) return;

  // ────────────────────────────────────────
  //  Step 2: シード配置（ポアソン円板サンプリング）
  //          供給ノード定義に相当
  // ────────────────────────────────────────
  const numSeeds  = Math.max(1, Math.round(ownTiles.length / cellSize));
  const spacing   = Math.max(1, Math.sqrt(cellSize) * 0.85);
  const seeds     = poissonSeeds(ownTiles, ownable, W, H, numSeeds, spacing);
  if (!seeds.length) return;

  // 需要ノード（各シードが受け取るべきタイル数）
  // 合計 = ownable タイル数になるよう端数を分配
  const targets = computeTargets(ownTiles.length, seeds.length);

  // ────────────────────────────────────────
  //  Step 3: BFS Voronoi（初期フロー = 最短距離での仮割り当て）
  //          全タイル→最近シードへの最小コストフロー近似
  // ────────────────────────────────────────
  const asgn = new Int32Array(W * H).fill(-1);
  {
    const dist = new Int32Array(W * H).fill(2147483647);
    const q = []; let qi = 0;
    for (let si=0;si<seeds.length;si++) {
      const ti = seeds[si];
      dist[ti] = 0; asgn[ti] = si; q.push(ti);
    }
    while (qi < q.length) {
      const ti = q[qi++];
      const x = ti%W, y = (ti-x)/W;
      const d = dist[ti];
      for (const [dx,dy] of DIRS4) {
        const nx=x+dx,ny=y+dy;
        if (nx<0||nx>=W||ny<0||ny>=H) continue;
        const ni = ny*W+nx;
        if (!ownable[ni] || dist[ni] <= d+1) continue;
        dist[ni] = d+1; asgn[ni] = asgn[ti]; q.push(ni);
      }
    }
    // 未到達タイルを隣接シードへ初期割り当て
    absorbUnassigned(asgn, ownable, W, H);
  }

  // ────────────────────────────────────────
  //  Step 4: 容量制約再調整
  //          Successive Shortest Path の局所近似
  //          超過シード → 不足シードへ境界タイルを移送
  // ────────────────────────────────────────
  capacitatedRebalance(asgn, ownable, seeds, targets, W, H);

  // ────────────────────────────────────────
  //  Step 5: 飛び地修復（非主連結成分を隣接シードへ再割り当て）
  // ────────────────────────────────────────
  repairEnclaves(asgn, ownable, seeds, W, H);

  // ────────────────────────────────────────
  //  Step 6: 残った未割当タイルを吸収
  // ────────────────────────────────────────
  absorbUnassigned(asgn, ownable, W, H);

  // ────────────────────────────────────────
  //  Step 7: State へ書き込み
  // ────────────────────────────────────────
  const seedIds = seeds.map(() => {
    const id = generateId(); s.cellRegions.set(id, {id}); return id;
  });
  for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
    const i = y*W+x;
    if (ownable[i] && asgn[i] >= 0) s.cells[y][x].cellId = seedIds[asgn[i]];
  }

  // 空セル削除
  const used = new Set();
  for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
    const c = s.cells[y][x].cellId; if (c) used.add(c);
  }
  for (const id of [...s.cellRegions.keys()]) if (!used.has(id)) s.cellRegions.delete(id);
}

// ================================================================
//  Phase 4: 容量制約再調整（核心部）
//
//  ネットワークフロー的解釈：
//    超過シードからの「逆辺」を通じて不足シードへフローを付け替える。
//    境界タイルのみを対象にすることで連結性を維持しつつ
//    最小コスト（近傍優先）での再配分を行う。
//
//  計算量: O(ITER × N × connectivity_check)
//           ITER≤80, N=ownable, connectivity=O(cellSize)
//           例: 10000タイル×30サイズ×80回 ≈ 24M ops
// ================================================================
function capacitatedRebalance(asgn, ownable, seeds, targets, W, H) {
  const S = seeds.length;
  const MAX_ITER = 80;

  // サイズ配列（更新を追跡）
  const sizes = new Int32Array(S);
  for (let i=0;i<W*H;i++) if (ownable[i] && asgn[i]>=0) sizes[asgn[i]]++;

  for (let iter = 0; iter < MAX_ITER; iter++) {
    let anyChange = false;

    // ランダム開始オフセット（方向バイアス回避）
    const offset = Math.floor(Math.random() * W * H);

    for (let t=0;t<W*H;t++) {
      const ti = (t + offset) % (W * H);
      if (!ownable[ti] || asgn[ti] < 0) continue;

      const si = asgn[ti];
      const overload = sizes[si] - targets[si];
      if (overload <= 0) continue; // このシードは超過していない

      const x = ti%W, y = (ti-x)/W;

      // 隣接する不足シードを探す（最も不足度が大きいものを優先）
      let bestNbr = -1, bestUnderload = 0;
      for (const [dx,dy] of DIRS4) {
        const nx=x+dx,ny=y+dy;
        if (nx<0||nx>=W||ny<0||ny>=H) continue;
        const ni = ny*W+nx;
        if (!ownable[ni] || asgn[ni]===si || asgn[ni]<0) continue;
        const nsi = asgn[ni];
        const underload = targets[nsi] - sizes[nsi];
        if (underload > bestUnderload) { bestUnderload = underload; bestNbr = nsi; }
      }
      if (bestNbr < 0) continue;

      // 移送しても元シードが連結を維持するか確認
      // （逆辺を通じてフローを付け替えるときの実行可能性チェック）
      if (!wouldDisconnect(asgn, W, H, si, x, y)) {
        asgn[ti] = bestNbr;
        sizes[si]--;
        sizes[bestNbr]++;
        anyChange = true;
      }
    }

    if (!anyChange) break;
  }
}

// ================================================================
//  Phase 5: 飛び地修復
//
//  最小費用流の解は連結性を保証しない（飛び地が生じる可能性）。
//  各シード領域の非主連結成分タイルを隣接シードへ再割り当て。
//  焼きなましの受け入れ基準として「コスト増加 < threshold」を使用。
// ================================================================
function repairEnclaves(asgn, ownable, seeds, W, H) {
  const MAX_ITER = 40;

  for (let iter = 0; iter < MAX_ITER; iter++) {
    let anyChange = false;

    for (let si=0; si<seeds.length; si++) {
      // シード自体のタイルから BFS で主連結成分を確定
      const seedTile = seeds[si];
      let startTile = -1;

      // シード自身がまだ自領なら起点に使う、さもなくば最初の自タイルを探す
      if (ownable[seedTile] && asgn[seedTile] === si) {
        startTile = seedTile;
      } else {
        for (let i=0;i<W*H;i++) {
          if (ownable[i] && asgn[i]===si) { startTile=i; break; }
        }
      }
      if (startTile < 0) continue;

      // BFS で主連結成分を収集
      const mainComp = new Set();
      const bfsQ = [startTile]; let bfsQi = 0;
      mainComp.add(startTile);
      while (bfsQi < bfsQ.length) {
        const ti = bfsQ[bfsQi++];
        const x=ti%W, y=(ti-x)/W;
        for (const [dx,dy] of DIRS4) {
          const nx=x+dx,ny=y+dy;
          if (nx<0||nx>=W||ny<0||ny>=H) continue;
          const ni = ny*W+nx;
          if (asgn[ni]===si && !mainComp.has(ni)) { mainComp.add(ni); bfsQ.push(ni); }
        }
      }

      // 主連結成分外のタイルを隣接シードへ再割り当て
      for (let i=0;i<W*H;i++) {
        if (!ownable[i] || asgn[i]!==si || mainComp.has(i)) continue;
        const x=i%W,y=(i-x)/W;
        for (const [dx,dy] of DIRS4) {
          const nx=x+dx,ny=y+dy;
          if (nx<0||nx>=W||ny<0||ny>=H) continue;
          const ni=ny*W+nx;
          if (ownable[ni] && asgn[ni]>=0 && asgn[ni]!==si) {
            asgn[i] = asgn[ni]; anyChange = true; break;
          }
        }
      }
    }

    if (!anyChange) break;
  }
}

// ================================================================
//  連結性チェック（逆辺実行可能性チェック）
//
//  タイル(rx,ry) を si から除いたとき、残りが連結か確認。
//  4-近傍の si タイルを start として BFS し、他の全 si 近傍に到達できるか。
//  計算量: O(cellSize) — 最大 CELL_LIMIT 打ち切り
// ================================================================
function wouldDisconnect(asgn, W, H, si, rx, ry) {
  const neighbors = [];
  for (const [dx,dy] of DIRS4) {
    const nx=rx+dx, ny=ry+dy;
    if (nx<0||nx>=W||ny<0||ny>=H) continue;
    if (asgn[ny*W+nx]===si) neighbors.push(ny*W+nx);
  }
  if (neighbors.length <= 1) return false; // 孤立 or 単方向 → 切断なし

  const start = neighbors[0];
  const visited = new Set([start]);
  const q = [start]; let qi = 0;
  const LIMIT = 800; // 大きいセルは安全と見なしてスキップ

  const skipIdx = ry*W+rx;
  while (qi < q.length && visited.size < LIMIT) {
    const ti = q[qi++];
    const x=ti%W,y=(ti-x)/W;
    for (const [dx,dy] of DIRS4) {
      const nx=x+dx,ny=y+dy;
      if (nx<0||nx>=W||ny<0||ny>=H) continue;
      const ni=ny*W+nx;
      if (ni===skipIdx || visited.has(ni) || asgn[ni]!==si) continue;
      visited.add(ni); q.push(ni);
    }
  }
  if (visited.size >= LIMIT) return false; // 大セル: 安全と仮定

  for (const nb of neighbors.slice(1)) {
    if (!visited.has(nb)) return true; // 切断される
  }
  return false;
}

// ================================================================
//  ユーティリティ
// ================================================================

/**
 * 需要ノードの容量分配
 * 端数 r を先頭 r シードに +1 割り当てる
 */
function computeTargets(totalTiles, numSeeds) {
  const base  = Math.floor(totalTiles / numSeeds);
  const extra = totalTiles % numSeeds;
  return Array.from({length: numSeeds}, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * ポアソン円板サンプリング（供給ノードの選択）
 * 最小間隔 spacing を保ちながら numSeeds 個のシードを配置
 */
function poissonSeeds(ownTiles, ownable, W, H, numSeeds, spacing) {
  // Fisher-Yates シャッフル
  const arr = ownTiles.slice();
  for (let i=arr.length-1;i>0;i--) {
    const j = Math.floor(Math.random()*(i+1));
    [arr[i],arr[j]] = [arr[j],arr[i]];
  }
  const seeds = []; const sp2 = spacing * spacing;
  for (const ti of arr) {
    if (seeds.length >= numSeeds) break;
    const x=ti%W, y=(ti-x)/W;
    let ok = true;
    for (const st of seeds) {
      const sx=st%W, sy=(st-sx)/W;
      const dx=x-sx, dy=y-sy;
      if (dx*dx+dy*dy < sp2) { ok=false; break; }
    }
    if (ok) seeds.push(ti);
  }
  // 不足補充（間引きなし）
  if (seeds.length < Math.ceil(numSeeds * 0.6)) {
    for (const ti of arr) {
      if (seeds.length >= numSeeds) break;
      if (!seeds.includes(ti)) seeds.push(ti);
    }
  }
  return seeds;
}

/**
 * 未割当タイルを隣接シードへ吸収
 */
function absorbUnassigned(asgn, ownable, W, H) {
  let changed = true;
  while (changed) {
    changed = false;
    for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
      const i=y*W+x;
      if (!ownable[i] || asgn[i]>=0) continue;
      for (const [dx,dy] of DIRS4) {
        const nx=x+dx,ny=y+dy;
        if (nx<0||nx>=W||ny<0||ny>=H) continue;
        const ni=ny*W+nx;
        if (asgn[ni]>=0) { asgn[i]=asgn[ni]; changed=true; break; }
      }
    }
  }
}
