import { getState } from '../state.js';

export function generateMap(params) {
  const { width: W, height: H, shape, seaPct, mountainPct, forestDensity, riverDensity, seed } = params;
  const s = getState();
  const rng = makeRng(seed);

  // 1. Elevation noise (land/sea shape)
  const elev = new Float32Array(W * H);
  const octs = buildOctaves(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = 0;
    for (const o of octs) v += o.a * vNoise(x / o.s, y / o.s, seed + octs.indexOf(o) * 1000);
    v *= shapeMask(x, y, W, H, shape, seed);
    v *= edgeFade(x, y, W, H, shape);
    elev[y * W + x] = v;
  }

  // Sea threshold by percentile
  const sorted = Float32Array.from(elev).sort();
  const seaT = sorted[Math.floor(sorted.length * seaPct / 100)] || -999;

  // Mark sea
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    s.cells[y][x].terrain = elev[y * W + x] <= seaT ? 'sea' : 'plain';
    s.cells[y][x].territoryId = null;
    s.cells[y][x].cellId = null;
  }

  // 2. Mountain ridges via spline backbones
  const ridgeLines = generateRidgeLines(W, H, shape, mountainPct, rng);
  const mtnMap = new Float32Array(W * H);
  for (const line of ridgeLines) {
    const pts = interpolateSpline(line.controlPts, 2);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (s.cells[y][x].terrain === 'sea') continue;
      const d = distToPolyline(x, y, pts);
      // Width varies with noise
      const widthNoise = 0.5 + vNoise(x / 20, y / 20, seed + 7777) * 1.0;
      const w = line.baseWidth * widthNoise;
      // Ridge noise for texture
      const ridge = ridgeNoise(x / 8, y / 8, seed + 3333);
      // Gap noise for passes
      const nearest = nearestParamOnPolyline(x, y, pts);
      const gapN = vNoise(nearest * 3, 0.5, seed + 5555);
      const gapFactor = gapN < 0.25 ? 0 : 1; // 25% chance of gap

      if (d < w && ridge > 0.3 && gapFactor > 0) {
        const score = (1 - d / w) * ridge * gapFactor;
        mtnMap[y * W + x] = Math.max(mtnMap[y * W + x], score);
      }
    }
  }

  // Independent peaks
  const numPeaks = Math.round(W * H * mountainPct / 100 * 0.0003);
  for (let i = 0; i < numPeaks; i++) {
    const px = Math.floor(rng() * W), py = Math.floor(rng() * H);
    if (s.cells[py][px].terrain === 'sea') continue;
    const r = 1 + Math.floor(rng() * 2);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const nx = px + dx, ny = py + dy;
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      if (s.cells[ny][nx].terrain === 'sea') continue;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= r) mtnMap[ny * W + nx] = Math.max(mtnMap[ny * W + nx], 0.6);
    }
  }

  // Apply mountain threshold by percentile of land tiles
  const landMtn = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
    if (s.cells[y][x].terrain !== 'sea' && mtnMap[y * W + x] > 0) landMtn.push(mtnMap[y * W + x]);
  landMtn.sort((a, b) => a - b);
  // Target: mountainPct of LAND tiles
  const landCount = landMtn.length + (W * H - landMtn.length); // approximate
  let totalLand = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (s.cells[y][x].terrain !== 'sea') totalLand++;
  const targetMtnCount = Math.floor(totalLand * mountainPct / 100);
  const mtnThresh = landMtn.length > targetMtnCount ? landMtn[landMtn.length - targetMtnCount] : 0;

  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (s.cells[y][x].terrain !== 'sea' && mtnMap[y * W + x] >= mtnThresh && mtnMap[y * W + x] > 0.1) {
      s.cells[y][x].terrain = 'mountain';
    }
  }

  // 3. Fill isolated plains inside mountains
  fillIsolatedPlains(s, W, H);

  // 4. Mountain width guard
  mountainWidthGuard(s, W, H, mountainPct, rng);

  // 5. Forest with domain warping
  if (forestDensity !== 'なし') {
    const fMap = { '小': 0.15, '中': 0.35, '大': 0.60 };
    const fPct = fMap[forestDensity] || 0;
    const humid = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const wx = x + vNoise(x / 30, y / 30, seed + 200) * 8;
      const wy = y + vNoise(x / 30, y / 30, seed + 300) * 8;
      let v = 0;
      for (let o = 0; o < 5; o++) v += octs[o].a * vNoise(wx / octs[o].s, wy / octs[o].s, seed + 5000 + o * 1000);
      humid[y * W + x] = v;
    }
    const hSorted = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
      if (s.cells[y][x].terrain === 'plain') hSorted.push(humid[y * W + x]);
    hSorted.sort((a, b) => a - b);
    const fT = hSorted[Math.floor(hSorted.length * (1 - fPct))] || 999;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
      if (s.cells[y][x].terrain === 'plain' && humid[y * W + x] >= fT) s.cells[y][x].terrain = 'forest';
  }

  // 6. Rivers
  if (riverDensity !== 'なし') {
    const rMap = { '小': 0.04, '中': 0.1, '大': 0.2 };
    const numR = Math.max(1, Math.round(Math.sqrt(W * H) * (rMap[riverDensity] || 0)));
    genRivers(s, elev, W, H, numR, rng);
  }

  // 7. Inland sea → lake or remove
  fixInlandSea(s, W, H);

  // 8. Post-process: remove isolated tiles
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const t = s.cells[y][x].terrain;
      if (t === 'river') continue;
      let same = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        if (s.cells[y + dy][x + dx].terrain === t) same++;
      }
      if (same <= 1) {
        const counts = {};
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nt = s.cells[y + dy][x + dx].terrain;
          if (nt !== 'river') counts[nt] = (counts[nt] || 0) + 1;
        }
        let best = t, bc = 0;
        for (const [k, v] of Object.entries(counts)) if (v > bc) { best = k; bc = v; }
        s.cells[y][x].terrain = best;
      }
    }
  }
}

function generateRidgeLines(W, H, shape, mtnPct, rng) {
  const lines = [];
  const baseCount = Math.max(1, Math.round(Math.sqrt(W * H) / 30 * (mtnPct / 15)));
  const count = Math.min(baseCount, 12);
  const maxDim = Math.max(W, H);

  for (let i = 0; i < count; i++) {
    const numPts = 4 + Math.floor(rng() * 5);
    const pts = [];
    // Start point biased toward center for continents
    let sx, sy, angle;
    if (shape === 'パンゲア' || shape === '大陸') {
      sx = W * (0.2 + rng() * 0.6);
      sy = H * (0.2 + rng() * 0.6);
      angle = rng() * Math.PI * 2;
    } else if (shape === '内海') {
      const a = rng() * Math.PI * 2;
      sx = W / 2 + Math.cos(a) * W * 0.25;
      sy = H / 2 + Math.sin(a) * H * 0.25;
      angle = a + Math.PI / 2;
    } else {
      sx = rng() * W;
      sy = rng() * H;
      angle = rng() * Math.PI * 2;
    }

    for (let p = 0; p < numPts; p++) {
      const step = maxDim * (0.08 + rng() * 0.12);
      const px = sx + Math.cos(angle) * step * p;
      const py = sy + Math.sin(angle) * step * p;
      pts.push([px, py]);
      angle += (rng() - 0.5) * 1.2; // Gentle curve
    }

    // Width: mostly 1-2, occasionally wider based on mtnPct
    const bigChance = mtnPct > 10 ? 0.15 : 0.05;
    const baseWidth = rng() < bigChance ? (2 + rng() * 3) : (1 + rng() * 1.5);

    lines.push({ controlPts: pts, baseWidth });
  }
  return lines;
}

function interpolateSpline(pts, step) {
  if (pts.length < 2) return pts;
  const result = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[Math.min(pts.length - 1, i + 1)];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let t = 0; t < 1; t += 1 / (step * 5)) {
      result.push(catmullRom(p0, p1, p2, p3, t));
    }
  }
  result.push(pts[pts.length - 1]);
  return result;
}

function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return [
    0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
    0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
  ];
}

function distToPolyline(px, py, pts) {
  let min = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distToSegment(px, py, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    if (d < min) min = d;
  }
  return min;
}

function nearestParamOnPolyline(px, py, pts) {
  let minD = Infinity, param = 0, totalLen = 0;
  const lens = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0], dy = pts[i + 1][1] - pts[i][1];
    lens.push(Math.sqrt(dx * dx + dy * dy));
    totalLen += lens[i];
  }
  let cumLen = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distToSegment(px, py, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    if (d < minD) { minD = d; param = (cumLen + lens[i] * 0.5) / totalLen; }
    cumLen += lens[i];
  }
  return param;
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.sqrt((px - ax) ** 2 + (py - ay) ** 2);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.sqrt((px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2);
}

function fillIsolatedPlains(s, W, H) {
  // BFS from edges to find connected plain/forest areas. Isolated ones → mountain
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = s.cells[y][x].terrain;
    if (t !== 'plain' && t !== 'forest') continue;
    // Quick check: is this surrounded by mountains?
    let trapped = true;
    const queue = [[x, y]], visited = new Set([`${x},${y}`]);
    let escaped = false;
    while (queue.length && !escaped) {
      const [cx, cy] = queue.shift();
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) { escaped = true; break; }
        const nk = `${nx},${ny}`;
        if (visited.has(nk)) continue;
        const nt = s.cells[ny][nx].terrain;
        if (nt === 'plain' || nt === 'forest' || nt === 'river') {
          visited.add(nk);
          if (visited.size > 20) { escaped = true; break; } // Large enough = not trapped
          queue.push([nx, ny]);
        } else if (nt === 'sea') { escaped = true; break; }
      }
    }
    if (!escaped && visited.size <= 3) {
      for (const k of visited) {
        const [fx, fy] = k.split(',').map(Number);
        s.cells[fy][fx].terrain = 'mountain';
      }
    }
  }
}

function mountainWidthGuard(s, W, H, mtnPct, rng) {
  const maxRun = mtnPct > 20 ? 10 : (mtnPct > 10 ? 8 : 6);
  // Horizontal
  for (let y = 0; y < H; y++) {
    let run = 0;
    for (let x = 0; x < W; x++) {
      if (s.cells[y][x].terrain === 'mountain') { run++; if (run > maxRun) s.cells[y][x].terrain = 'plain'; }
      else run = 0;
    }
  }
  // Vertical
  for (let x = 0; x < W; x++) {
    let run = 0;
    for (let y = 0; y < H; y++) {
      if (s.cells[y][x].terrain === 'mountain') { run++; if (run > maxRun) s.cells[y][x].terrain = 'plain'; }
      else run = 0;
    }
  }
}

function genRivers(s, elev, W, H, count, rng) {
  const sources = [];
  for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++)
    if (s.cells[y][x].terrain === 'mountain') sources.push([x, y]);
  if (!sources.length) return;

  for (let r = 0; r < count; r++) {
    const [sx, sy] = sources[Math.floor(rng() * sources.length)];
    let cx = sx, cy = sy;
    const visited = new Set(), path = [];
    for (let step = 0; step < W + H; step++) {
      const key = `${cx},${cy}`;
      if (visited.has(key)) break;
      visited.add(key);
      if (s.cells[cy][cx].terrain === 'sea') break;
      path.push([cx, cy]);
      let bestE = elev[cy * W + cx], bx = -1, by = -1;
      const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
      for (let i = dirs.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [dirs[i], dirs[j]] = [dirs[j], dirs[i]]; }
      for (const [dx, dy] of dirs) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        const ne = elev[ny * W + nx];
        if (ne < bestE || (ne === bestE && rng() < 0.3)) { bestE = ne; bx = nx; by = ny; }
      }
      // Meander in plains
      if (bx >= 0 && s.cells[cy][cx].terrain !== 'mountain') {
        const mOff = (rng() - 0.5) * 2;
        const perpX = -(by - cy), perpY = bx - cx;
        const mx = bx + Math.round(perpX * mOff * 0.3), my = by + Math.round(perpY * mOff * 0.3);
        if (mx >= 0 && mx < W && my >= 0 && my < H && s.cells[my][mx].terrain !== 'sea' && s.cells[my][mx].terrain !== 'mountain') {
          bx = mx; by = my;
        }
      }
      if (bx < 0) break;
      cx = bx; cy = by;
    }
    if (path.length >= 5) {
      for (let i = 1; i < path.length; i++) {
        const [px, py] = path[i];
        const t = s.cells[py][px].terrain;
        if (t === 'plain' || t === 'forest') {
          s.cells[py][px].terrain = 'river';
          // Occasionally 2-wide
          if (rng() < 0.15 && i > 2) {
            const dx = path[i][0] - path[i - 1][0], dy = path[i][1] - path[i - 1][1];
            const px2 = px + (dy !== 0 ? 1 : 0), py2 = py + (dx !== 0 ? 1 : 0);
            if (px2 >= 0 && px2 < W && py2 >= 0 && py2 < H) {
              const t2 = s.cells[py2][px2].terrain;
              if (t2 === 'plain' || t2 === 'forest') s.cells[py2][px2].terrain = 'river';
            }
          }
        }
      }
    }
  }
}

function fixInlandSea(s, W, H) {
  // BFS from map edges to find ocean-connected sea. Everything else → plain (or small lake)
  const ocean = new Uint8Array(W * H);
  const queue = [];
  for (let x = 0; x < W; x++) {
    if (s.cells[0][x].terrain === 'sea') { queue.push([x, 0]); ocean[x] = 1; }
    if (s.cells[H - 1][x].terrain === 'sea') { queue.push([x, H - 1]); ocean[(H - 1) * W + x] = 1; }
  }
  for (let y = 0; y < H; y++) {
    if (s.cells[y][0].terrain === 'sea') { queue.push([0, y]); ocean[y * W] = 1; }
    if (s.cells[y][W - 1].terrain === 'sea') { queue.push([W - 1, y]); ocean[y * W + W - 1] = 1; }
  }
  while (queue.length) {
    const [cx, cy] = queue.shift();
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      if (ocean[ny * W + nx] || s.cells[ny][nx].terrain !== 'sea') continue;
      ocean[ny * W + nx] = 1;
      queue.push([nx, ny]);
    }
  }
  // Remove inland seas (keep small lakes ≤ 20 tiles)
  const checked = new Set();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (s.cells[y][x].terrain !== 'sea' || ocean[y * W + x]) continue;
    const k = `${x},${y}`;
    if (checked.has(k)) continue;
    // BFS to find inland sea size
    const region = [], q = [[x, y]], v = new Set([k]);
    while (q.length) {
      const [cx, cy] = q.shift();
      region.push([cx, cy]);
      checked.add(`${cx},${cy}`);
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const nx = cx + dx, ny = cy + dy, nk = `${nx},${ny}`;
        if (nx < 0 || nx >= W || ny < 0 || ny >= H || v.has(nk)) continue;
        if (s.cells[ny][nx].terrain === 'sea' && !ocean[ny * W + nx]) { v.add(nk); q.push([nx, ny]); }
      }
    }
    if (region.length > 20) {
      // Too big for a lake → convert to plain
      for (const [rx, ry] of region) s.cells[ry][rx].terrain = 'plain';
    }
    // ≤ 20 tiles: keep as lake (sea)
  }
}

// === Preview (exported for gen screen) ===
export function generatePreview(W, H, params) {
  const { shape, seaPct, mountainPct, forestDensity, riverDensity, seed } = params;
  const rng = makeRng(seed);
  const octs = buildOctaves(W, H);
  const elev = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = 0;
    for (const o of octs) v += o.a * vNoise(x / o.s, y / o.s, seed + octs.indexOf(o) * 1000);
    v *= shapeMask(x, y, W, H, shape, seed);
    v *= edgeFade(x, y, W, H, shape);
    elev[y * W + x] = v;
  }
  const sorted = Float32Array.from(elev).sort();
  const seaT = sorted[Math.floor(sorted.length * seaPct / 100)] || -999;

  // Simplified ridge detection for preview
  const ridgeLines = generateRidgeLines(W, H, shape, mountainPct, rng);
  const mtnScore = new Float32Array(W * H);
  for (const line of ridgeLines) {
    const pts = interpolateSpline(line.controlPts, 2);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (elev[y * W + x] <= seaT) continue;
      const d = distToPolyline(x, y, pts);
      if (d < line.baseWidth * 1.5) mtnScore[y * W + x] = Math.max(mtnScore[y * W + x], 1 - d / (line.baseWidth * 1.5));
    }
  }

  const landScores = [];
  for (let i = 0; i < W * H; i++) if (elev[i] > seaT && mtnScore[i] > 0) landScores.push(mtnScore[i]);
  landScores.sort((a, b) => a - b);
  let tLand = 0;
  for (let i = 0; i < W * H; i++) if (elev[i] > seaT) tLand++;
  const tMtn = Math.floor(tLand * mountainPct / 100);
  const mtnT2 = landScores.length > tMtn ? landScores[landScores.length - tMtn] : 0;

  // Humidity for forest
  const fMap = { 'なし': 999, '小': 0.85, '中': 0.65, '大': 0.40 };
  const humid = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = 0;
    for (let o = 0; o < 5; o++) v += octs[o].a * vNoise(x / octs[o].s, y / octs[o].s, seed + 5000 + o * 1000);
    humid[y * W + x] = v;
  }
  const hS = [];
  for (let i = 0; i < W * H; i++) if (elev[i] > seaT && mtnScore[i] < mtnT2) hS.push(humid[i]);
  hS.sort((a, b) => a - b);
  const fPct = fMap[forestDensity] || 999;
  const fT = hS[Math.floor(hS.length * fPct)] || 999;

  // Simple rivers for preview
  const riverSet = new Set();
  if (riverDensity !== 'なし') {
    const rMap = { '小': 0.04, '中': 0.1, '大': 0.2 };
    const numR = Math.max(1, Math.round(Math.sqrt(W * H) * (rMap[riverDensity] || 0)));
    const mtnTiles = [];
    for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++)
      if (elev[y * W + x] > seaT && mtnScore[y * W + x] >= mtnT2) mtnTiles.push([x, y]);
    for (let r = 0; r < numR && mtnTiles.length; r++) {
      let [cx, cy] = mtnTiles[Math.floor(rng() * mtnTiles.length)];
      const visited = new Set();
      for (let step = 0; step < W + H; step++) {
        const k = `${cx},${cy}`;
        if (visited.has(k) || elev[cy * W + cx] <= seaT) break;
        visited.add(k);
        riverSet.add(k);
        let bE = elev[cy * W + cx], bx = -1, by = -1;
        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
          if (elev[ny * W + nx] < bE) { bE = elev[ny * W + nx]; bx = nx; by = ny; }
        }
        if (bx < 0) break;
        cx = bx; cy = by;
      }
    }
  }

  // Render to ImageData
  const img = new ImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const e = elev[y * W + x];
    let r, g, b;
    if (e <= seaT) { r = 26; g = 58; b = 90; }
    else if (mtnScore[y * W + x] >= mtnT2 && mtnScore[y * W + x] > 0.1) { r = 122; g = 122; b = 122; }
    else if (riverSet.has(`${x},${y}`)) { r = 74; g = 143; b = 181; }
    else if (humid[y * W + x] >= fT) { r = 45; g = 90; b = 39; }
    else { r = 143; g = 188; b = 143; }
    img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
  }
  return img;
}

// === Utility ===
function buildOctaves(W, H) {
  const m = Math.max(W, H);
  return [{ s: m * .5, a: .4 }, { s: m * .25, a: .25 }, { s: m * .12, a: .15 }, { s: m * .06, a: .1 }, { s: m * .03, a: .05 }, { s: m * .015, a: .03 }, { s: m * .007, a: .02 }];
}

function edgeFade(x, y, W, H, shape) {
  const fadeMap = { '群島': 3, 'パンゲア': 8, '大陸': 5, '内海': 5, '大陸+島': 4, 'フラクタル': 2 };
  const fd = fadeMap[shape] || 5;
  const d = Math.min(x, y, W - 1 - x, H - 1 - y) / fd;
  const t = Math.max(0, Math.min(1, d));
  return t * t * (3 - 2 * t);
}

function shapeMask(x, y, w, h, shape, seed) {
  const nx = x / w - .5, ny = y / h - .5, dist = Math.sqrt(nx * nx + ny * ny) * 2;
  const warp = vNoise(x / (w * .3), y / (h * .3), seed + 9999) * .3;
  switch (shape) {
    case '大陸': return Math.max(0, 1.2 - (dist + warp) * 1.5);
    case '群島': return .6 + warp * .8;
    case 'パンゲア': return Math.max(0, 1.5 - (dist + warp * .5) * 1.2);
    case '内海': return Math.max(0, 1 - Math.abs(dist - .35) * 3 + warp * .5);
    case '大陸+島': return Math.max(0, 1 - (dist + warp * .3) * 1.3) + warp * .4;
    case 'フラクタル': return .5 + warp * 1.2;
    default: return 1;
  }
}

function ridgeNoise(x, y, seed) {
  let v = vNoise(x, y, seed);
  v = 1 - Math.abs(v * 2 - 1);
  return v * v;
}

function vNoise(x, y, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  return lerp(lerp(hash(x0, y0, seed), hash(x0 + 1, y0, seed), sx), lerp(hash(x0, y0 + 1, seed), hash(x0 + 1, y0 + 1, seed), sx), sy);
}
function hash(x, y, s) { let h = s + x * 374761393 + y * 668265263; h = (h ^ (h >> 13)) * 1274126177; h = h ^ (h >> 16); return (h & 0x7fffffff) / 0x7fffffff; }
function lerp(a, b, t) { return a + (b - a) * t; }
function makeRng(s) { s = s || 12345; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; }
