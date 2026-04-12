// Map generation: Value Noise + shape masks + rivers
import { getState } from '../state.js';

export function generateMap(params) {
  const { width, height, shape, seaPct, mountainPct, forestDensity, riverDensity, seed } = params;
  const s = getState();
  const rng = makeRng(seed);

  // 1. Generate elevation with multi-octave value noise
  const elev = new Float32Array(width * height);
  const octaves = [
    { scale: Math.max(width, height) * 0.5, amp: 0.4 },
    { scale: Math.max(width, height) * 0.25, amp: 0.25 },
    { scale: Math.max(width, height) * 0.12, amp: 0.15 },
    { scale: Math.max(width, height) * 0.06, amp: 0.1 },
    { scale: Math.max(width, height) * 0.03, amp: 0.05 },
    { scale: Math.max(width, height) * 0.015, amp: 0.03 },
    { scale: Math.max(width, height) * 0.007, amp: 0.02 },
  ];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let v = 0;
      for (let o = 0; o < octaves.length; o++) {
        v += octaves[o].amp * valueNoise(x / octaves[o].scale, y / octaves[o].scale, seed + o * 1000, rng);
      }
      // Apply shape mask
      v *= shapeMask(x, y, width, height, shape, rng, seed);
      elev[y * width + x] = v;
    }
  }

  // 2. Determine thresholds via percentile
  const sorted = Float32Array.from(elev).sort();
  const seaThresh = sorted[Math.floor(sorted.length * seaPct / 100)] || -999;
  const mtnThresh = sorted[Math.floor(sorted.length * (100 - mountainPct) / 100)] || 999;

  // 3. Humidity map for forests
  const humid = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let v = 0;
      for (let o = 0; o < 5; o++) {
        v += octaves[o].amp * valueNoise(x / octaves[o].scale, y / octaves[o].scale, seed + 5000 + o * 1000, rng);
      }
      humid[y * width + x] = v;
    }
  }
  const forestThreshMap = { 'なし': 999, '小': 0.85, '中': 0.65, '大': 0.40 };
  const forestPct = forestThreshMap[forestDensity] || 999;
  const humidSorted = Float32Array.from(humid).sort();
  const forestThresh = humidSorted[Math.floor(humidSorted.length * forestPct)] || 999;

  // 4. Assign terrain
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const e = elev[y * width + x];
      const h = humid[y * width + x];
      let terrain = 'plain';
      if (e <= seaThresh) terrain = 'sea';
      else if (e >= mtnThresh) terrain = 'mountain';
      else if (h >= forestThresh && terrain === 'plain') terrain = 'forest';
      s.cells[y][x].terrain = terrain;
      s.cells[y][x].territoryId = null;
      s.cells[y][x].cellId = null;
    }
  }

  // 5. Rivers
  const riverCountMap = { 'なし': 0, '小': 0.03, '中': 0.08, '大': 0.15 };
  const riverFrac = riverCountMap[riverDensity] || 0;
  const numRivers = Math.max(0, Math.round(Math.sqrt(width * height) * riverFrac));
  generateRivers(s, elev, width, height, numRivers, rng);

  // 6. Post-process: remove isolated tiles
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const t = s.cells[y][x].terrain;
        if (t === 'river') continue;
        let same = 0, total = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          total++;
          if (s.cells[y + dy][x + dx].terrain === t) same++;
        }
        if (same <= 1) {
          // Replace with most common neighbor
          const counts = {};
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nt = s.cells[y + dy][x + dx].terrain;
            if (nt !== 'river') counts[nt] = (counts[nt] || 0) + 1;
          }
          let best = t, bestC = 0;
          for (const [k, v] of Object.entries(counts)) if (v > bestC) { best = k; bestC = v; }
          s.cells[y][x].terrain = best;
        }
      }
    }
  }
}

function generateRivers(s, elev, w, h, count, rng) {
  // Find mountain/high tiles as sources
  const sources = [];
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
    if (s.cells[y][x].terrain === 'mountain') sources.push([x, y]);
  }
  if (!sources.length) return;

  for (let r = 0; r < count; r++) {
    const [sx, sy] = sources[Math.floor(rng() * sources.length)];
    let cx = sx, cy = sy;
    const visited = new Set();
    const path = [];
    for (let step = 0; step < w + h; step++) {
      const key = `${cx},${cy}`;
      if (visited.has(key)) break;
      visited.add(key);
      if (s.cells[cy][cx].terrain === 'sea') break;
      path.push([cx, cy]);

      // Find lowest neighbor
      let bestE = elev[cy * w + cx], bx = -1, by = -1;
      const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
      // Shuffle dirs for variety
      for (let i = dirs.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [dirs[i], dirs[j]] = [dirs[j], dirs[i]]; }
      for (const [dx, dy] of dirs) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const ne = elev[ny * w + nx];
        if (ne < bestE || (ne === bestE && rng() < 0.3)) { bestE = ne; bx = nx; by = ny; }
      }
      if (bx < 0) break;
      cx = bx; cy = by;
    }
    // Apply path (skip first tile = mountain source)
    if (path.length > 2) {
      for (let i = 1; i < path.length; i++) {
        const [px, py] = path[i];
        if (s.cells[py][px].terrain === 'plain' || s.cells[py][px].terrain === 'forest') {
          s.cells[py][px].terrain = 'river';
        }
      }
    }
  }
}

// Shape mask functions
function shapeMask(x, y, w, h, shape, rng, seed) {
  const nx = x / w - 0.5, ny = y / h - 0.5; // -0.5 to 0.5
  const dist = Math.sqrt(nx * nx + ny * ny) * 2; // 0 to ~1.4
  const warp = valueNoise(x / (w * 0.3), y / (h * 0.3), seed + 9999, rng) * 0.3;

  switch (shape) {
    case '大陸': return Math.max(0, 1.2 - (dist + warp) * 1.5);
    case '群島': return 0.6 + warp * 0.8;
    case 'パンゲア': return Math.max(0, 1.5 - (dist + warp * 0.5) * 1.2);
    case '内海': {
      const ring = Math.abs(dist - 0.35);
      return Math.max(0, 1.0 - ring * 3.0 + warp * 0.5);
    }
    case '大陸+島': return Math.max(0, 1.0 - (dist + warp * 0.3) * 1.3) + warp * 0.4;
    case 'フラクタル': return 0.5 + warp * 1.2;
    default: return 1;
  }
}

// Value noise
function valueNoise(x, y, seed, rng) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const n00 = hash(x0, y0, seed), n10 = hash(x0 + 1, y0, seed);
  const n01 = hash(x0, y0 + 1, seed), n11 = hash(x0 + 1, y0 + 1, seed);
  return lerp(lerp(n00, n10, sx), lerp(n01, n11, sx), sy);
}

function hash(x, y, seed) {
  let h = seed + x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  h = h ^ (h >> 16);
  return (h & 0x7fffffff) / 0x7fffffff;
}

function lerp(a, b, t) { return a + (b - a) * t; }

function makeRng(seed) {
  let s = seed || 12345;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}
