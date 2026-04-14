import { getState } from '../state.js';

// ============================================================
//  Civ4スタイル マップ生成
//  - ドメインワーピングによる凸凹海岸線
//  - 勾配ベースの山岳 (傾斜×標高)
//  - Watershed法による川 (凹地補填→D8流向→流量蓄積)
//  - 海岸距離＋標高の湿度モデルによる森
//  - プレビューは本番と同一パイプライン使用
// ============================================================

// ========== Public API ==========

export function generateMap(params) {
  const { width: W, height: H, shape, seaPct, mountainPct, forestDensity, riverDensity, seed } = params;
  const s = getState();

  const { terrain } = runPipeline(W, H, shape, seaPct, mountainPct, forestDensity, riverDensity, seed, false);

  const names = ['sea', 'plain', 'mountain', 'forest', 'river'];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    s.cells[y][x].terrain = names[terrain[y * W + x]];
    s.cells[y][x].territoryId = null;
    s.cells[y][x].cellId = null;
  }
}

export function generatePreview(W, H, params) {
  const { shape, seaPct, mountainPct, forestDensity, riverDensity, seed } = params;
  const { terrain } = runPipeline(W, H, shape, seaPct, mountainPct, forestDensity, riverDensity, seed, true);

  const colors = [
    [26,  58,  90],   // 0:sea
    [143, 188, 143],  // 1:plain
    [122, 122, 122],  // 2:mountain
    [45,  90,  39],   // 3:forest
    [74,  143, 181],  // 4:river
  ];
  const img = new ImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    const [r, g, b] = colors[terrain[i]];
    img.data[i*4]   = r;
    img.data[i*4+1] = g;
    img.data[i*4+2] = b;
    img.data[i*4+3] = 255;
  }
  return img;
}

// ========== Core pipeline ==========

function runPipeline(W, H, shape, seaPct, mountainPct, forestDensity, riverDensity, seed, isPreview) {
  const octaves = isPreview ? 4 : 6;

  // 1. 標高マップ（ドメインワーピング付きFBM）
  const elev = buildElevation(W, H, shape, seed, octaves);

  // 2. 海レベル（パーセンタイル）
  const seaLevel = percentile(elev, seaPct / 100);

  // 3. 初期地形 sea/plain
  const T = new Uint8Array(W * H); // 0=sea 1=plain 2=mountain 3=forest 4=river
  for (let i = 0; i < W * H; i++) T[i] = elev[i] <= seaLevel ? 0 : 1;

  // 4. 山岳（勾配×標高スコア）
  if (mountainPct > 0) applyMountains(T, elev, W, H, mountainPct, seed);

  // 5. 森林（湿度モデル）
  applyForest(T, elev, W, H, forestDensity, seaLevel, seed, isPreview);

  // 6. 川（Watershed法）
  if (riverDensity !== 'なし') applyRivers(T, elev, W, H, riverDensity, seed, isPreview);

  // 7. 孤立タイル除去
  postProcess(T, W, H);

  return { terrain: T };
}

// ========== 1. 標高生成 ==========

function buildElevation(W, H, shape, seed, octaves) {
  const elev = new Float32Array(W * H);

  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const nx = x / W, ny = y / H;

    // 第1層ワーピング
    const wx1 = fbm(nx * 4 + 1.7, ny * 4 + 9.2, seed,      3) * 0.35;
    const wy1 = fbm(nx * 4 + 8.3, ny * 4 + 2.8, seed + 1,  3) * 0.35;
    // 第2層ワーピング（ワープのワープ）→ 細かい凸凹
    const wx2 = fbm(nx * 8 + wx1 + 3.1, ny * 8 + wy1 + 7.4, seed + 2, 2) * 0.15;
    const wy2 = fbm(nx * 8 + wx1 + 6.9, ny * 8 + wy1 + 1.3, seed + 3, 2) * 0.15;

    const warpedX = nx + wx1 + wx2;
    const warpedY = ny + wy1 + wy2;

    // 本体FBM標高
    let v = fbm(warpedX * 5, warpedY * 5, seed + 10, octaves);

    // 形状マスク（ソフト誘導のみ、強制しない）
    v = applyShapeMask(v, nx, ny, W, H, shape, seed);

    elev[y * W + x] = v;
  }

  return elev;
}

function applyShapeMask(v, nx, ny, W, H, shape, seed) {
  const cx = nx - 0.5, cy = ny - 0.5;
  const dist = Math.sqrt(cx * cx + cy * cy) * 2; // 0〜√2

  // 海岸線用ノイズ（shape maskに凸凹を加える）
  const coastNoise = fbm(nx * 6 + 2.1, ny * 6 + 5.3, seed + 99, 3) * 0.45;

  let mask;
  switch (shape) {
    case '大陸':
      mask = Math.max(0.05, 1.1 - (dist + coastNoise * 0.5) * 1.5);
      break;
    case 'パンゲア':
      mask = Math.max(0.05, 1.4 - (dist + coastNoise * 0.3) * 1.1);
      break;
    case '群島':
      // 全体的に低め、ノイズで島を散らす
      mask = 0.35 + coastNoise * 1.1;
      break;
    case '内海':
      // 端が陸、中央が海のリング形状
      mask = Math.max(0.05, 0.9 - Math.abs(dist - 0.5) * 2.8 + coastNoise * 0.6);
      break;
    case '大陸+島':
      // 大陸マスク＋島ノイズを合成
      { const cont = Math.max(0, 1.0 - (dist + coastNoise * 0.2) * 1.4);
        const isle = Math.max(0, coastNoise * 0.9 - 0.25);
        mask = Math.max(cont, isle); }
      break;
    case 'フラクタル':
      // マスクほぼ無効、ノイズに任せる
      mask = 0.25 + coastNoise * 1.5;
      break;
    default:
      mask = 1;
  }

  // ミックス：ハードカットではなくソフトブレンド
  // maskが0.5以上なら地形を底上げ、0以下なら引き下げ
  return v * 0.5 + v * mask * 0.5 + (mask - 0.5) * 0.3;
}

// ========== 2. 山岳（勾配×標高） ==========

function applyMountains(T, elev, W, H, mountainPct, seed) {
  // 勾配マグニチュード計算
  const grad = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    if (T[y * W + x] === 0) continue;
    const gx = (elev[y * W + (x+1)] - elev[y * W + (x-1)]) * 0.5;
    const gy = (elev[(y+1) * W + x] - elev[(y-1) * W + x]) * 0.5;
    grad[y * W + x] = Math.sqrt(gx * gx + gy * gy);
  }

  // 山スコア = 標高 × 勾配 → 「高くて急峻な場所」が山
  const score = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (T[i] === 0) continue;
    // 高標高ボーナス
    const elevNorm = Math.max(0, elev[i]);
    score[i] = elevNorm * grad[i];
  }

  // 陸地タイルのみでパーセンタイル計算
  const landScores = [];
  for (let i = 0; i < W * H; i++) if (T[i] !== 0 && score[i] > 0) landScores.push(score[i]);
  landScores.sort((a, b) => a - b);

  let totalLand = 0;
  for (let i = 0; i < W * H; i++) if (T[i] !== 0) totalLand++;
  const targetMtn = Math.floor(totalLand * mountainPct / 100);
  const thresh = landScores.length > 0
    ? landScores[Math.max(0, landScores.length - targetMtn)]
    : Infinity;

  for (let i = 0; i < W * H; i++) {
    if (T[i] !== 0 && score[i] >= thresh && score[i] > 0) T[i] = 2;
  }

  // 孤立1タイルの山を除去（地形と馴染ませる）
  smoothMountains(T, W, H);
}

function smoothMountains(T, W, H) {
  const tmp = new Uint8Array(T);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    if (T[y * W + x] !== 2) continue;
    let mtn = 0;
    for (const [dx, dy] of [[0,-1],[0,1],[-1,0],[1,0]]) {
      if (T[(y+dy)*W+(x+dx)] === 2) mtn++;
    }
    if (mtn === 0) tmp[y * W + x] = 1; // 孤立山 → 平地
  }
  T.set(tmp);
}

// ========== 3. 森林（湿度モデル） ==========

function applyForest(T, elev, W, H, forestDensity, seaLevel, seed, isPreview) {
  if (forestDensity === 'なし') return;
  const densMap = { '小': 0.12, '中': 0.28, '大': 0.50 };
  const targetPct = densMap[forestDensity] || 0;

  // BFS による海からの距離
  const seaDist = computeSeaDist(T, W, H);
  let maxDist = 0;
  for (let i = 0; i < W * H; i++) if (T[i] !== 0 && seaDist[i] < Infinity) maxDist = Math.max(maxDist, seaDist[i]);

  const moisture = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (T[i] === 0 || T[i] === 2) continue;

    // 海からの距離（近いほど湿潤）
    const distF = maxDist > 0 ? 1 - Math.min(1, seaDist[i] / maxDist) : 0.5;
    // 標高（高いほど乾燥）
    const elevF = 1 - Math.max(0, (elev[i] - seaLevel) / Math.max(0.01, 1 - seaLevel));
    // ノイズ（ドメインワーピングで自然なパッチ状に）
    const nx = x / W, ny = y / H;
    const warpX = fbm(nx * 3 + 1.3, ny * 3 + 4.7, seed + 400, 3) * 0.3;
    const warpY = fbm(nx * 3 + 7.2, ny * 3 + 2.1, seed + 401, 3) * 0.3;
    const noiseV = fbm(nx * 5 + warpX, ny * 5 + warpY, seed + 500, isPreview ? 3 : 4);

    moisture[i] = distF * 0.35 + elevF * 0.25 + noiseV * 0.40;
  }

  // 平地タイルのみのパーセンタイル
  const plainMoist = [];
  for (let i = 0; i < W * H; i++) if (T[i] === 1) plainMoist.push(moisture[i]);
  plainMoist.sort((a, b) => a - b);
  const thresh = plainMoist[Math.floor(plainMoist.length * (1 - targetPct))] ?? Infinity;

  for (let i = 0; i < W * H; i++) {
    if (T[i] === 1 && moisture[i] >= thresh) T[i] = 3;
  }
}

function computeSeaDist(T, W, H) {
  const dist = new Float32Array(W * H).fill(Infinity);
  const q = [];
  let qi = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (T[y * W + x] === 0) { dist[y * W + x] = 0; q.push(y * W + x); }
  }
  while (qi < q.length) {
    const i = q[qi++];
    const x = i % W, y = (i - x) / W;
    const d = dist[i];
    for (const [dx, dy] of [[0,-1],[0,1],[-1,0],[1,0]]) {
      const nx = x+dx, ny = y+dy;
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const ni = ny * W + nx;
      if (dist[ni] > d + 1) { dist[ni] = d + 1; q.push(ni); }
    }
  }
  return dist;
}

// ========== 4. 川（Watershed法） ==========

function applyRivers(T, elev, W, H, riverDensity, seed, isPreview) {
  // 1. 凹地補填（全川が海まで流れるよう保証）
  const filled = isPreview ? elev : fillDepressions(elev, T, W, H);

  // 2. D8流向（8方向で最低標高へ）
  const flowDir = computeFlowDir(filled, W, H);

  // 3. 流量蓄積
  const flowAcc = computeFlowAcc(flowDir, W, H);

  // 4. 閾値以上を川に
  const densMap = { '小': 0.0018, '中': 0.004, '大': 0.009 };
  const ratio = densMap[riverDensity] || 0.004;
  // 陸地数の比率で閾値決定
  let landCount = 0;
  for (let i = 0; i < W * H; i++) if (T[i] !== 0) landCount++;
  const thresh = Math.max(10, Math.floor(landCount * ratio));

  for (let i = 0; i < W * H; i++) {
    if (T[i] !== 0 && T[i] !== 2 && flowAcc[i] >= thresh) T[i] = 4;
  }

  // 5. 山を通過する川を除去（山の上に川は不自然）
  for (let i = 0; i < W * H; i++) {
    if (T[i] === 4) {
      // 流量が少なすぎる川を除去（ノイズ対策）
      if (flowAcc[i] < thresh * 1.5 && T[i] === 4) {
        // 隣接川がなければ除去
        const x = i % W, y = (i - x) / W;
        let riverNeighbor = 0;
        for (const [dx, dy] of [[0,-1],[0,1],[-1,0],[1,0]]) {
          const nx = x+dx, ny = y+dy;
          if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
          if (T[ny*W+nx] === 4) riverNeighbor++;
        }
        if (riverNeighbor === 0) T[i] = T[i] === 4 ? 1 : T[i];
      }
    }
  }
}

function fillDepressions(elev, T, W, H) {
  // Planchon-Darboux 簡易版
  const INF = 999.0;
  const filled = Float32Array.from(elev);

  // 海タイルと端隣接タイルは実際の標高
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (T[i] === 0) { filled[i] = elev[i]; continue; }
    let border = (x === 0 || x === W-1 || y === 0 || y === H-1);
    if (!border) {
      for (const [dx, dy] of [[0,-1],[0,1],[-1,0],[1,0]]) {
        if (T[(y+dy)*W+(x+dx)] === 0) { border = true; break; }
      }
    }
    filled[i] = border ? elev[i] : INF;
  }

  // 収束するまで繰り返し
  let changed = true, iter = 0;
  while (changed && iter < 60) {
    changed = false; iter++;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (T[i] === 0) continue;
      for (const [dx, dy] of [[0,-1],[0,1],[-1,0],[1,0]]) {
        const nx = x+dx, ny = y+dy;
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        const ni = ny * W + nx;
        const candidate = filled[ni] + 0.0001;
        if (candidate < INF && candidate < filled[i] && candidate > elev[i]) {
          filled[i] = candidate; changed = true;
        } else if (filled[ni] < INF && filled[i] > filled[ni] + 0.0001 && elev[i] <= filled[ni] + 0.0001) {
          filled[i] = Math.max(elev[i], filled[ni] + 0.0001); changed = true;
        }
      }
    }
  }
  return filled;
}

function computeFlowDir(elev, W, H) {
  // 8方向 D8
  const DIRS8 = [[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1]];
  const dir = new Int8Array(W * H).fill(-1);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    let minE = elev[i], best = -1;
    for (let d = 0; d < 8; d++) {
      const [dx, dy] = DIRS8[d];
      const nx = x+dx, ny = y+dy;
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const ne = elev[ny * W + nx];
      if (ne < minE) { minE = ne; best = d; }
    }
    dir[i] = best;
  }
  return dir;
}

function computeFlowAcc(flowDir, W, H) {
  const DIRS8 = [[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1]];
  const acc = new Int32Array(W * H).fill(1);

  // 入次数計算
  const inDeg = new Int32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = flowDir[y * W + x];
    if (d < 0) continue;
    const [dx, dy] = DIRS8[d];
    const nx = x+dx, ny = y+dy;
    if (nx >= 0 && nx < W && ny >= 0 && ny < H) inDeg[ny * W + nx]++;
  }

  // トポロジカルソート（Kahn法）
  const q = [];
  let qi = 0;
  for (let i = 0; i < W * H; i++) if (inDeg[i] === 0) q.push(i);

  while (qi < q.length) {
    const i = q[qi++];
    const d = flowDir[i];
    if (d < 0) continue;
    const x = i % W, y = (i - x) / W;
    const [dx, dy] = DIRS8[d];
    const nx = x+dx, ny = y+dy;
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
    const ni = ny * W + nx;
    acc[ni] += acc[i];
    if (--inDeg[ni] === 0) q.push(ni);
  }
  return acc;
}

// ========== 5. 後処理 ==========

function postProcess(T, W, H) {
  const tmp = new Uint8Array(T);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 1; y < H-1; y++) for (let x = 1; x < W-1; x++) {
      const t = T[y * W + x];
      if (t === 4) continue; // 川はそのまま
      const cnt = [0,0,0,0,0];
      for (const [dx, dy] of [[0,-1],[0,1],[-1,0],[1,0],[-1,-1],[-1,1],[1,-1],[1,1]]) {
        cnt[T[(y+dy)*W+(x+dx)]]++;
      }
      if (cnt[t] <= 1) {
        // 孤立タイル → 多数派（川以外）に変換
        let best = t, bc = -1;
        for (let k = 0; k < 4; k++) { if (cnt[k] > bc) { bc = cnt[k]; best = k; } }
        tmp[y * W + x] = best;
      }
    }
    T.set(tmp);
  }
}

// ========== ユーティリティ ==========

function fbm(x, y, seed, octaves) {
  let v = 0, amp = 0.5, freq = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    v     += vNoise(x * freq, y * freq, seed + o * 137) * amp;
    total += amp;
    amp   *= 0.5;
    freq  *= 2.0;
  }
  return v / total;
}

function percentile(arr, p) {
  const sorted = Float32Array.from(arr).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function vNoise(x, y, s) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  return lerp(
    lerp(hash(x0,   y0,   s), hash(x0+1, y0,   s), sx),
    lerp(hash(x0,   y0+1, s), hash(x0+1, y0+1, s), sx),
    sy
  );
}
function hash(x, y, s) {
  let h = (s|0) + x * 374761393 + y * 668265263;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h & 0x7fffffff) / 0x7fffffff;
}
function lerp(a, b, t) { return a + (b - a) * t; }
