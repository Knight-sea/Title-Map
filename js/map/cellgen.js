import { getState, generateId } from '../state.js';
import { TERRAINS } from '../constants.js';

// ============================================================
//  コンパクト形状セル自動生成
//
//  UIサイズ: 2,4,6,8,10,14,18,24,30
//  許容誤差: +1 (最大 targetSize+1 マス)
//  理想ブロック比:
//    2 → 1×2   4 → 2×2   6 → 2×3   8 → 2×4
//   10 → 3×3  14 → 3×5  18 → 3×6  24 → 4×6  30 → 5×6
//  最大アスペクト比 2.2:1 を超えないよう細長いセルを補正
// ============================================================

// 理想ブロック (W, H) テーブル（アスペクト比の参考に使う）
const IDEAL_SHAPES = {
   2: [1,2],  4: [2,2],  6: [2,3],   8: [2,4],
  10: [3,3], 14: [3,5], 18: [3,6],  24: [4,6], 30: [5,6],
};
const MAX_ASPECT = 2.2;

export function autoGenerateCells(cellSize) {
  const s  = getState();
  const W  = s.mapWidth, H = s.mapHeight;

  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) s.cells[y][x].cellId = null;
  s.cellRegions.clear();

  // ──────────────────────────────────────────
  // 1. 所有可能タイルを列挙（海・山を除外）
  // ──────────────────────────────────────────
  const ownable   = new Uint8Array(W * H);
  const ownTiles  = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (TERRAINS[s.cells[y][x].terrain].canOwn) {
      ownable[y * W + x] = 1;
      ownTiles.push([x, y]);
    }
  }
  if (!ownTiles.length) return;

  // ──────────────────────────────────────────
  // 2. ポアソン円板サンプリングでシード配置
  //    最小間隔 = sqrt(cellSize) × 0.8
  // ──────────────────────────────────────────
  const spacing   = Math.max(1, Math.sqrt(cellSize) * 0.8);
  const numSeeds  = Math.max(1, Math.round(ownTiles.length / cellSize));
  const seeds     = poissonSeeds(ownTiles, ownable, W, H, numSeeds, spacing);
  if (!seeds.length) return;

  // セルID生成
  const seedIds = seeds.map(() => { const id = generateId(); s.cellRegions.set(id, {id}); return id; });

  // ──────────────────────────────────────────
  // 3. 並行BFS Voronoi（Manhattan距離）
  // ──────────────────────────────────────────
  const asgn = new Int32Array(W * H).fill(-1);
  const dist  = new Int32Array(W * H).fill(2147483647);
  const q     = []; let qi = 0;

  for (let si = 0; si < seeds.length; si++) {
    const [sx, sy] = seeds[si];
    const i = sy * W + sx;
    dist[i] = 0; asgn[i] = si; q.push(i);
  }
  while (qi < q.length) {
    const i = q[qi++]; const x = i % W, y = (i - x) / W;
    const d = dist[i], si = asgn[i];
    for (const [dx, dy] of DIRS4) {
      const nx = x+dx, ny = y+dy;
      if (nx<0||nx>=W||ny<0||ny>=H) continue;
      const ni = ny*W+nx;
      if (!ownable[ni]||dist[ni]<=d+1) continue;
      dist[ni]=d+1; asgn[ni]=si; q.push(ni);
    }
  }

  // Stateに書き込み
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y*W+x;
    if (ownable[i] && asgn[i]>=0) s.cells[y][x].cellId = seedIds[asgn[i]];
  }

  // ──────────────────────────────────────────
  // 4. サイズマップ作成
  // ──────────────────────────────────────────
  const sizeMap = buildSizeMap(s, W, H);

  // ──────────────────────────────────────────
  // 5. 細長いセルを補正（アスペクト比 > MAX_ASPECT を修正）
  // ──────────────────────────────────────────
  fixElongated(s, W, H, sizeMap, cellSize);

  // ──────────────────────────────────────────
  // 6. 小さすぎるセルを吸収（< cellSize - 1）
  // ──────────────────────────────────────────
  const minSize = Math.max(2, cellSize - 1);
  absorbTiny(s, W, H, sizeMap, minSize);

  // ──────────────────────────────────────────
  // 7. 未割当マスを隣接セルに吸収
  // ──────────────────────────────────────────
  absorbUnassigned(s, W, H, ownable);

  cleanup(s, W, H);
}

// ──────────────────────────────────────────────────────────────
//  ポアソン円板サンプリング
// ──────────────────────────────────────────────────────────────
function poissonSeeds(tiles, ownable, W, H, numSeeds, spacing) {
  // Fisher-Yatesシャッフル
  const arr = tiles.slice();
  for (let i = arr.length-1; i>0; i--) {
    const j = Math.floor(Math.random()*(i+1));
    [arr[i],arr[j]] = [arr[j],arr[i]];
  }
  const seeds = []; const sp2 = spacing*spacing;
  for (const [x,y] of arr) {
    if (seeds.length >= numSeeds) break;
    let ok = true;
    for (const [sx,sy] of seeds) {
      const dx=x-sx,dy=y-sy;
      if (dx*dx+dy*dy < sp2) {ok=false;break;}
    }
    if (ok) seeds.push([x,y]);
  }
  // 不足補充（間引きなし）
  if (seeds.length < Math.ceil(numSeeds*0.6)) {
    for (const [x,y] of arr) {
      if (seeds.length>=numSeeds) break;
      if (!seeds.some(([sx,sy])=>sx===x&&sy===y)) seeds.push([x,y]);
    }
  }
  return seeds;
}

// ──────────────────────────────────────────────────────────────
//  細長セル補正
//  MAX_ASPECT を超えるセルの「先端タイル」を隣接セルへ移管
// ──────────────────────────────────────────────────────────────
function fixElongated(s, W, H, sizeMap, targetSize) {
  let changed = true, iter = 0;
  while (changed && iter++ < 30) {
    changed = false;

    // バウンディングボックス計算
    const box = new Map();
    for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
      const cid = s.cells[y][x].cellId; if (!cid) continue;
      if (!box.has(cid)) box.set(cid,{minX:x,maxX:x,minY:y,maxY:y,cx:0,cy:0,n:0});
      const b=box.get(cid);
      if(x<b.minX)b.minX=x; if(x>b.maxX)b.maxX=x;
      if(y<b.minY)b.minY=y; if(y>b.maxY)b.maxY=y;
      b.cx+=x; b.cy+=y; b.n++;
    }

    for (const [id, b] of box) {
      b.cx/=b.n; b.cy/=b.n;
      const bw=b.maxX-b.minX+1, bh=b.maxY-b.minY+1;
      const ratio=Math.max(bw,bh)/Math.max(1,Math.min(bw,bh));
      if (ratio <= MAX_ASPECT) continue;

      const elongH = bw > bh; // true=水平方向に細長い

      // 端のタイルを候補として選ぶ
      // 重心から最も遠い方向の端
      const tipX = elongH ? (b.cx < (b.minX+b.maxX)/2 ? b.maxX : b.minX) : -1;
      const tipY = !elongH ? (b.cy < (b.minY+b.maxY)/2 ? b.maxY : b.minY) : -1;

      let bestTile=null, bestDist=-1;
      let bestNbr=null, bestNbrSize=-1;

      for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
        if (s.cells[y][x].cellId !== id) continue;
        const atTip = elongH ? (x===tipX) : (y===tipY);
        if (!atTip) continue;

        // 境界タイルか確認
        let nbr=null, nbrSz=-1;
        for (const [dx,dy] of DIRS4) {
          const nx=x+dx,ny=y+dy;
          if (nx<0||nx>=W||ny<0||ny>=H) continue;
          const nc=s.cells[ny][nx].cellId;
          if (nc&&nc!==id) {
            const ns=sizeMap.get(nc)||0;
            if (ns>nbrSz) {nbrSz=ns;nbr=nc;}
          }
        }
        if (!nbr) continue;

        // 移管してもセルが切断されないか簡易確認（連結性保証）
        if (!wouldDisconnect(s, W, H, id, x, y)) {
          const dd=Math.abs(x-b.cx)+Math.abs(y-b.cy);
          if (dd>bestDist) {bestDist=dd;bestTile=[x,y];bestNbr=nbr;bestNbrSize=nbrSz;}
        }
      }

      if (bestTile && bestNbr) {
        const [tx,ty]=bestTile;
        s.cells[ty][tx].cellId=bestNbr;
        sizeMap.set(bestNbr,(sizeMap.get(bestNbr)||0)+1);
        sizeMap.set(id,(sizeMap.get(id)||0)-1);
        changed=true;
      }
    }
  }
}

// セルから1タイルを取り除いた時に連結性が壊れるか（4方向連結）
function wouldDisconnect(s, W, H, cid, rx, ry) {
  // 周囲の同セルタイルを探し、それらが rx,ry を通らずにつながるか
  const neighbors = [];
  for (const [dx,dy] of DIRS4) {
    const nx=rx+dx,ny=ry+dy;
    if (nx<0||nx>=W||ny<0||ny>=H) continue;
    if (s.cells[ny][nx].cellId===cid) neighbors.push([nx,ny]);
  }
  if (neighbors.length<=1) return false; // 隣接が0or1なら問題なし

  // BFSで最初のneighborから他のneighborに到達できるか（rx,ryをスキップ）
  const start=neighbors[0];
  const visited=new Set([`${start[0]},${start[1]}`]);
  const q2=[start]; let qi=0;
  while (qi<q2.length) {
    const [cx,cy]=q2[qi++];
    for (const [dx,dy] of DIRS4) {
      const nx=cx+dx,ny=cy+dy;
      if (nx<0||nx>=W||ny<0||ny>=H) continue;
      if (nx===rx&&ny===ry) continue;
      const k=`${nx},${ny}`;
      if (visited.has(k)||s.cells[ny][nx].cellId!==cid) continue;
      visited.add(k); q2.push([nx,ny]);
    }
  }
  // 全neighborが到達できればdisconnectしない
  for (const [nx,ny] of neighbors.slice(1)) {
    if (!visited.has(`${nx},${ny}`)) return true;
  }
  return false;
}

// ──────────────────────────────────────────────────────────────
//  小セル吸収
// ──────────────────────────────────────────────────────────────
function absorbTiny(s, W, H, sizeMap, minSize) {
  for (let pass=0;pass<15;pass++) {
    let absorbed=false;
    for (const [id,sz] of [...sizeMap.entries()]) {
      if (sz>=minSize) continue;
      let bestNbr=null, bestSz=-1;
      for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
        if (s.cells[y][x].cellId!==id) continue;
        for (const [dx,dy] of DIRS4) {
          const nx=x+dx,ny=y+dy;
          if (nx<0||nx>=W||ny<0||ny>=H) continue;
          const nc=s.cells[ny][nx].cellId;
          if (nc&&nc!==id) {
            const ns=sizeMap.get(nc)||0;
            if (ns>bestSz) {bestSz=ns;bestNbr=nc;}
          }
        }
      }
      if (!bestNbr) continue;
      for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
        if (s.cells[y][x].cellId===id) s.cells[y][x].cellId=bestNbr;
      }
      sizeMap.set(bestNbr,(sizeMap.get(bestNbr)||0)+sz);
      sizeMap.delete(id);
      s.cellRegions.delete(id);
      absorbed=true;
    }
    if (!absorbed) break;
  }
}

// 未割当(ownable but no cellId)を隣接セルへ
function absorbUnassigned(s, W, H, ownable) {
  let changed=true;
  while (changed) {
    changed=false;
    for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
      const i=y*W+x;
      if (!ownable[i]||s.cells[y][x].cellId) continue;
      for (const [dx,dy] of DIRS4) {
        const nx=x+dx,ny=y+dy;
        if (nx<0||nx>=W||ny<0||ny>=H) continue;
        const nc=s.cells[ny][nx].cellId;
        if (nc) {s.cells[y][x].cellId=nc;changed=true;break;}
      }
    }
  }
}

function buildSizeMap(s, W, H) {
  const m=new Map();
  for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
    const c=s.cells[y][x].cellId;
    if (c) m.set(c,(m.get(c)||0)+1);
  }
  return m;
}

function cleanup(s, W, H) {
  const used=new Set();
  for (let y=0;y<H;y++) for (let x=0;x<W;x++) {const c=s.cells[y][x].cellId;if(c)used.add(c);}
  for (const id of [...s.cellRegions.keys()]) if (!used.has(id)) s.cellRegions.delete(id);
}

const DIRS4 = [[0,-1],[0,1],[-1,0],[1,0]];
