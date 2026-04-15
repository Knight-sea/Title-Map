import { getState } from '../state.js';

// T値: 0=sea 1=plain 2=mountain 3=forest 4=river

export function generateMap(params) {
  const { width:W, height:H, shape, seaPct, mountainPct, forestDensity, riverDensity, seed } = params;
  const s = getState();
  const { terrain } = runPipeline(W, H, shape, seaPct, mountainPct, forestDensity, riverDensity, seed, false);
  const names = ['sea','plain','mountain','forest','river'];
  for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
    s.cells[y][x].terrain = names[terrain[y*W+x]];
    s.cells[y][x].territoryId = null; s.cells[y][x].cellId = null;
  }
}

export function generatePreview(W, H, params) {
  const { shape, seaPct, mountainPct, forestDensity, riverDensity, seed } = params;
  const { terrain } = runPipeline(W, H, shape, seaPct, mountainPct, forestDensity, riverDensity, seed, true);
  const colors = [[26,58,90],[143,188,143],[122,122,122],[45,90,39],[74,143,181]];
  const img = new ImageData(W, H);
  for (let i=0;i<W*H;i++) {
    const [r,g,b]=colors[terrain[i]];
    img.data[i*4]=r; img.data[i*4+1]=g; img.data[i*4+2]=b; img.data[i*4+3]=255;
  }
  return img;
}

// ================================================================
//  Core pipeline
// ================================================================
function runPipeline(W, H, shape, seaPct, mountainPct, forestDensity, riverDensity, seed, isPreview) {
  const oct = isPreview ? 4 : 6;

  // 1. 標高マップ（ドメインワーピング付きFBM）
  const elev = buildElevation(W, H, shape, seed, oct);

  // 2. 海レベル
  const seaLevel = percentile(elev, seaPct/100);

  // 3. 初期地形
  const T = new Uint8Array(W*H);
  for (let i=0;i<W*H;i++) T[i] = elev[i]<=seaLevel ? 0 : 1;

  // 4. 山岳（勾配×標高）
  if (mountainPct>0) applyMountains(T, elev, W, H, mountainPct, seed);

  // 5. 孤立平地修正（山に囲まれた内陸平地を解消）
  fixIsolatedPlains(T, W, H);

  // 6. 内陸海を修正（海に繋がらない海タイルを平地化）
  fixInlandSea(T, W, H);

  // 7. 森林
  applyForest(T, elev, W, H, forestDensity, seaLevel, seed, isPreview);

  // 8. 川（Watershed法）
  if (riverDensity!=='なし') applyRivers(T, elev, W, H, riverDensity, seed, isPreview);

  // 9. 孤立タイル除去
  postProcess(T, W, H);

  return { terrain: T };
}

// ================================================================
//  1. 標高生成
// ================================================================
function buildElevation(W, H, shape, seed, octaves) {
  const elev = new Float32Array(W*H);
  for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
    const nx=x/W, ny=y/H;
    const wx1=fbm(nx*4+1.7,ny*4+9.2,seed,  3)*0.35;
    const wy1=fbm(nx*4+8.3,ny*4+2.8,seed+1,3)*0.35;
    const wx2=fbm(nx*8+wx1+3.1,ny*8+wy1+7.4,seed+2,2)*0.15;
    const wy2=fbm(nx*8+wx1+6.9,ny*8+wy1+1.3,seed+3,2)*0.15;
    const wX=nx+wx1+wx2, wY=ny+wy1+wy2;
    let v=fbm(wX*5,wY*5,seed+10,octaves);
    v=applyShapeMask(v,nx,ny,shape,seed);
    elev[y*W+x]=v;
  }
  return elev;
}

function applyShapeMask(v, nx, ny, shape, seed) {
  const cx=nx-0.5, cy=ny-0.5;
  const dist=Math.sqrt(cx*cx+cy*cy)*2;
  const cN=fbm(nx*6+2.1,ny*6+5.3,seed+99,3)*0.45;
  let mask;
  switch(shape){
    case '大陸':   mask=Math.max(0.05,1.1-(dist+cN*0.5)*1.5); break;
    case 'パンゲア': mask=Math.max(0.05,1.4-(dist+cN*0.3)*1.1); break;
    case '群島':   mask=0.35+cN*1.1; break;
    case '内海':
      // 外周リングが陸、中央が海 — 端はしっかり陸
      mask=Math.max(0.05,0.9-Math.abs(dist-0.5)*2.8+cN*0.6);
      break;
    case '大陸+島':
      { const cont=Math.max(0,1.0-(dist+cN*0.2)*1.4);
        const isle=Math.max(0,cN*0.9-0.25);
        mask=Math.max(cont,isle); }
      break;
    case 'フラクタル': mask=0.25+cN*1.5; break;
    case '地球':   mask=buildEarthMask(nx,ny,seed,cN); break;
    default: mask=1;
  }
  return v*0.5+v*mask*0.5+(mask-0.5)*0.3;
}

// ================================================================
//  地球モード：4大陸＋島嶼群
//  外縁は海（edgeFadeを強めにかける）
// ================================================================
function buildEarthMask(nx, ny, seed, cN) {
  // 4大陸の中心（正規化座標）と形状パラメータ
  const continents = [
    // [cx, cy, scaleX, scaleY, rotation_ish]
    [0.18, 0.30, 1.4, 1.0, seed+1001],  // 北米
    [0.62, 0.28, 1.8, 0.9, seed+1002],  // ユーラシア
    [0.26, 0.68, 1.0, 1.5, seed+1003],  // 南米
    [0.68, 0.62, 1.2, 1.3, seed+1004],  // アフリカ
  ];
  // 中規模島：2〜3個
  const islands = [
    [0.82, 0.45, seed+2001],  // 東南アジア/太平洋
    [0.44, 0.50, seed+2002],  // 大西洋
    [0.88, 0.72, seed+2003],  // オーストラリア風
  ];

  let val = 0;

  for (const [cx, cy, sx, sy, s2] of continents) {
    // 楕円距離 + ドメインワープ
    const dx = (nx-cx)*sx*2.2;
    const dy = (ny-cy)*sy*2.2;
    const warp = fbm(nx*5+cx*8,ny*5+cy*8,s2,3)*0.45;
    const d = Math.sqrt(dx*dx+dy*dy) - warp;
    val = Math.max(val, Math.max(0, 1.05-d*2.2));
  }

  for (const [cx, cy, s2] of islands) {
    const dx = (nx-cx)*3.5;
    const dy = (ny-cy)*3.5;
    const warp = fbm(nx*7+cx*10,ny*7+cy*10,s2,3)*0.35;
    const d = Math.sqrt(dx*dx+dy*dy) - warp;
    val = Math.max(val, Math.max(0, 0.75-d*3.5));
  }

  // 外縁フェード（端を必ず海に）
  const edgeX = Math.min(nx, 1-nx)*10;
  const edgeY = Math.min(ny, 1-ny)*10;
  const edgeFade = Math.max(0, Math.min(1, Math.min(edgeX, edgeY)));

  return val * edgeFade;
}

// ================================================================
//  2. 山岳（勾配×標高スコア）
// ================================================================
function applyMountains(T, elev, W, H, mountainPct, seed) {
  const grad = new Float32Array(W*H);
  for (let y=1;y<H-1;y++) for (let x=1;x<W-1;x++) {
    if(T[y*W+x]===0) continue;
    const gx=(elev[y*W+(x+1)]-elev[y*W+(x-1)])*0.5;
    const gy=(elev[(y+1)*W+x]-elev[(y-1)*W+x])*0.5;
    grad[y*W+x]=Math.sqrt(gx*gx+gy*gy);
  }
  const score=new Float32Array(W*H);
  for (let i=0;i<W*H;i++) {
    if(T[i]===0) continue;
    score[i]=Math.max(0,elev[i])*grad[i];
  }
  const ls=[]; let tl=0;
  for (let i=0;i<W*H;i++) { if(T[i]!==0){tl++;if(score[i]>0)ls.push(score[i]);} }
  ls.sort((a,b)=>a-b);
  const tgt=Math.floor(tl*mountainPct/100);
  const thresh=ls.length>0?ls[Math.max(0,ls.length-tgt)]:Infinity;
  for (let i=0;i<W*H;i++) if(T[i]!==0&&score[i]>=thresh&&score[i]>0)T[i]=2;
  smoothMountains(T,W,H);
}

function smoothMountains(T,W,H){
  const tmp=new Uint8Array(T);
  for(let y=1;y<H-1;y++) for(let x=1;x<W-1;x++){
    if(T[y*W+x]!==2)continue;
    let m=0;
    for(const[dx,dy]of[[0,-1],[0,1],[-1,0],[1,0]])if(T[(y+dy)*W+(x+dx)]===2)m++;
    if(m===0)tmp[y*W+x]=1;
  }
  T.set(tmp);
}

// ================================================================
//  3. 孤立平地修正
//     山に囲まれて海に出られない平地ポケットを解消
//     小さい → 周囲の山を崩して通路を作る
//     大きい → そのまま（内陸高原として自然）
// ================================================================
function fixIsolatedPlains(T, W, H) {
  // 海 or 端から到達できる陸地タイルをBFS
  const reached = new Uint8Array(W*H);
  const q=[]; let qi=0;

  // 初期: 海タイル
  for(let i=0;i<W*H;i++) if(T[i]===0){reached[i]=1;q.push(i);}

  // BFS：山・海以外のタイルは通過可能
  while(qi<q.length){
    const i=q[qi++]; const x=i%W, y=(i-x)/W;
    for(const[dx,dy]of[[0,-1],[0,1],[-1,0],[1,0]]){
      const nx=x+dx,ny=y+dy;
      if(nx<0||nx>=W||ny<0||ny>=H)continue;
      const ni=ny*W+nx;
      if(reached[ni])continue;
      // 山以外なら到達可能扱い（山を壁として扱う）
      if(T[ni]!==2){ reached[ni]=1; q.push(ni); }
    }
  }

  // 未到達の平地・森タイル = 山に囲まれた孤立地帯
  // それらを含む連続領域を探し、サイズ別に処理
  const checked=new Uint8Array(W*H);
  for(let y=0;y<H;y++) for(let x=0;x<W;x++){
    const i=y*W+x;
    if(reached[i]||checked[i]||T[i]===0||T[i]===2)continue;

    // BFSで孤立領域を収集
    const region=[];const rq=[[x,y]];const rv=new Set([`${x},${y}`]);
    let rqi=0;
    while(rqi<rq.length){
      const[cx,cy]=rq[rqi++]; region.push([cx,cy]); checked[cy*W+cx]=1;
      for(const[dx,dy]of[[0,-1],[0,1],[-1,0],[1,0]]){
        const nx=cx+dx,ny=cy+dy; if(nx<0||nx>=W||ny<0||ny>=H)continue;
        const k=`${nx},${ny}`;
        if(rv.has(k)||reached[ny*W+nx])continue;
        if(T[ny*W+nx]!==2&&T[ny*W+nx]!==0){rv.add(k);rq.push([nx,ny]);}
      }
    }

    if(region.length<=12){
      // 小さい孤立地帯 → 周囲の山のうち、外側に通じる山を1本壊す
      // （最短の山の道を開通）
      let broken=false;
      // 領域に隣接する山タイルからBFSで外部に出るルートを探す
      const mtnStart=[];
      for(const[rx,ry]of region){
        for(const[dx,dy]of[[0,-1],[0,1],[-1,0],[1,0]]){
          const nx=rx+dx,ny=ry+dy;
          if(nx>=0&&nx<W&&ny>=0&&ny<H&&T[ny*W+nx]===2)mtnStart.push([nx,ny]);
        }
      }
      // 山タイルをBFSして外部（reached）に最短で到達できるルートを見つける
      if(mtnStart.length>0){
        const mPrev=new Map();const mq2=[...mtnStart];let mqI=0;
        const mVisit=new Set(mtnStart.map(([x,y])=>`${x},${y}`));
        let found=null;
        while(mqI<mq2.length&&!found){
          const[cx,cy]=mq2[mqI++];
          if(reached[cy*W+cx]){found=[cx,cy];break;}
          for(const[dx,dy]of[[0,-1],[0,1],[-1,0],[1,0]]){
            const nx=cx+dx,ny=cy+dy;if(nx<0||nx>=W||ny<0||ny>=H)continue;
            const k=`${nx},${ny}`;
            if(mVisit.has(k))continue;
            mVisit.add(k);
            mPrev.set(k,`${cx},${cy}`);
            if(T[ny*W+nx]===2||!reached[ny*W+nx]){mq2.push([nx,ny]);}
            else{found=[nx,ny];}
          }
        }
        // ルート上の山タイルを平地に変換（開通）
        if(found){
          let cur=`${found[0]},${found[1]}`;
          let limit=20;
          while(mPrev.has(cur)&&limit-->0){
            const[px,py]=cur.split(',').map(Number);
            if(T[py*W+px]===2)T[py*W+px]=1;
            cur=mPrev.get(cur);
          }
          broken=true;
        }
      }
      // 開通できなければ領域を平地化（そのまま残す）
    }
    // 大きい領域はそのまま（内陸高原として有効）
  }
}

// ================================================================
//  4. 内陸海修正（海に繋がらない海タイルを平地に）
// ================================================================
function fixInlandSea(T, W, H) {
  const ocean=new Uint8Array(W*H);
  const q=[]; let qi=0;
  // 端の海タイルから開始
  for(let x=0;x<W;x++){
    if(T[x]===0&&!ocean[x]){ocean[x]=1;q.push(x);}
    if(T[(H-1)*W+x]===0&&!ocean[(H-1)*W+x]){ocean[(H-1)*W+x]=1;q.push((H-1)*W+x);}
  }
  for(let y=0;y<H;y++){
    if(T[y*W]===0&&!ocean[y*W]){ocean[y*W]=1;q.push(y*W);}
    if(T[y*W+W-1]===0&&!ocean[y*W+W-1]){ocean[y*W+W-1]=1;q.push(y*W+W-1);}
  }
  while(qi<q.length){
    const i=q[qi++]; const x=i%W,y=(i-x)/W;
    for(const[dx,dy]of[[0,-1],[0,1],[-1,0],[1,0]]){
      const nx=x+dx,ny=y+dy;if(nx<0||nx>=W||ny<0||ny>=H)continue;
      const ni=ny*W+nx;
      if(ocean[ni]||T[ni]!==0)continue;
      ocean[ni]=1;q.push(ni);
    }
  }
  // 内陸海→平地
  for(let i=0;i<W*H;i++) if(T[i]===0&&!ocean[i])T[i]=1;
}

// ================================================================
//  5. 森林（湿度モデル）
// ================================================================
function applyForest(T,elev,W,H,forestDensity,seaLevel,seed,isPreview){
  if(forestDensity==='なし')return;
  const densMap={'小':0.12,'中':0.28,'大':0.50};
  const tgtPct=densMap[forestDensity]||0;
  const seaDist=computeSeaDist(T,W,H);
  let maxD=0;
  for(let i=0;i<W*H;i++) if(T[i]!==0&&seaDist[i]<Infinity)maxD=Math.max(maxD,seaDist[i]);
  const moist=new Float32Array(W*H);
  for(let y=0;y<H;y++) for(let x=0;x<W;x++){
    const i=y*W+x; if(T[i]===0||T[i]===2)continue;
    const nx=x/W,ny=y/H;
    const dF=maxD>0?1-Math.min(1,seaDist[i]/maxD):0.5;
    const eF=1-Math.max(0,(elev[i]-seaLevel)/Math.max(0.01,1-seaLevel));
    const wX=fbm(nx*3+1.3,ny*3+4.7,seed+400,3)*0.3;
    const wY=fbm(nx*3+7.2,ny*3+2.1,seed+401,3)*0.3;
    const nV=fbm(nx*5+wX,ny*5+wY,seed+500,isPreview?3:4);
    moist[i]=dF*0.35+eF*0.25+nV*0.40;
  }
  const pm=[];
  for(let i=0;i<W*H;i++) if(T[i]===1)pm.push(moist[i]);
  pm.sort((a,b)=>a-b);
  const thresh=pm[Math.floor(pm.length*(1-tgtPct))]??Infinity;
  for(let i=0;i<W*H;i++) if(T[i]===1&&moist[i]>=thresh)T[i]=3;
}

function computeSeaDist(T,W,H){
  const dist=new Float32Array(W*H).fill(Infinity);
  const q=[]; let qi=0;
  for(let i=0;i<W*H;i++) if(T[i]===0){dist[i]=0;q.push(i);}
  while(qi<q.length){
    const i=q[qi++]; const x=i%W,y=(i-x)/W;
    for(const[dx,dy]of[[0,-1],[0,1],[-1,0],[1,0]]){
      const nx=x+dx,ny=y+dy;
      if(nx<0||nx>=W||ny<0||ny>=H)continue;
      const ni=ny*W+nx;
      if(dist[ni]>dist[i]+1){dist[ni]=dist[i]+1;q.push(ni);}
    }
  }
  return dist;
}

// ================================================================
//  6. 川（Watershed法）
// ================================================================
function applyRivers(T,elev,W,H,riverDensity,seed,isPreview){
  const filled=isPreview?elev:fillDepressions(elev,T,W,H);
  const flowDir=computeFlowDir(filled,W,H);
  const flowAcc=computeFlowAcc(flowDir,W,H);
  const densMap={'小':0.0018,'中':0.004,'大':0.009};
  const ratio=densMap[riverDensity]||0.004;
  let landCount=0;
  for(let i=0;i<W*H;i++) if(T[i]!==0)landCount++;
  const thresh=Math.max(10,Math.floor(landCount*ratio));
  for(let i=0;i<W*H;i++){
    if(T[i]!==0&&T[i]!==2&&flowAcc[i]>=thresh)T[i]=4;
  }
  // 孤立川タイルを除去
  for(let y=0;y<H;y++) for(let x=0;x<W;x++){
    const i=y*W+x; if(T[i]!==4)continue;
    let rn=0;
    for(const[dx,dy]of[[0,-1],[0,1],[-1,0],[1,0]]){
      const nx=x+dx,ny=y+dy;
      if(nx>=0&&nx<W&&ny>=0&&ny<H&&T[ny*W+nx]===4)rn++;
    }
    if(rn===0)T[i]=1;
  }
}

function fillDepressions(elev,T,W,H){
  const INF=999.0;const filled=Float32Array.from(elev);
  for(let y=0;y<H;y++) for(let x=0;x<W;x++){
    const i=y*W+x; if(T[i]===0){filled[i]=elev[i];continue;}
    let border=(x===0||x===W-1||y===0||y===H-1);
    if(!border) for(const[dx,dy]of[[0,-1],[0,1],[-1,0],[1,0]]){if(T[(y+dy)*W+(x+dx)]===0){border=true;break;}}
    filled[i]=border?elev[i]:INF;
  }
  let changed=true,iter=0;
  while(changed&&iter<60){changed=false;iter++;
    for(let y=0;y<H;y++) for(let x=0;x<W;x++){
      const i=y*W+x; if(T[i]===0)continue;
      for(const[dx,dy]of[[0,-1],[0,1],[-1,0],[1,0]]){
        const nx=x+dx,ny=y+dy;if(nx<0||nx>=W||ny<0||ny>=H)continue;
        const ni=ny*W+nx;
        const candidate=filled[ni]+0.0001;
        if(candidate<INF&&candidate<filled[i]&&candidate>elev[i]){filled[i]=candidate;changed=true;}
        else if(filled[ni]<INF&&filled[i]>filled[ni]+0.0001&&elev[i]<=filled[ni]+0.0001){filled[i]=Math.max(elev[i],filled[ni]+0.0001);changed=true;}
      }
    }
  }
  return filled;
}

function computeFlowDir(elev,W,H){
  const DIRS8=[[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1]];
  const dir=new Int8Array(W*H).fill(-1);
  for(let y=0;y<H;y++) for(let x=0;x<W;x++){
    const i=y*W+x; let minE=elev[i],best=-1;
    for(let d=0;d<8;d++){
      const[dx,dy]=DIRS8[d]; const nx=x+dx,ny=y+dy;
      if(nx<0||nx>=W||ny<0||ny>=H)continue;
      const ne=elev[ny*W+nx];
      if(ne<minE){minE=ne;best=d;}
    }
    dir[i]=best;
  }
  return dir;
}

function computeFlowAcc(flowDir,W,H){
  const DIRS8=[[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1]];
  const acc=new Int32Array(W*H).fill(1);
  const inDeg=new Int32Array(W*H);
  for(let y=0;y<H;y++) for(let x=0;x<W;x++){
    const d=flowDir[y*W+x]; if(d<0)continue;
    const[dx,dy]=DIRS8[d]; const nx=x+dx,ny=y+dy;
    if(nx>=0&&nx<W&&ny>=0&&ny<H)inDeg[ny*W+nx]++;
  }
  const q=[]; let qi=0;
  for(let i=0;i<W*H;i++) if(inDeg[i]===0)q.push(i);
  while(qi<q.length){
    const i=q[qi++]; const d=flowDir[i]; if(d<0)continue;
    const x=i%W,y=(i-x)/W;
    const[dx,dy]=DIRS8[d]; const nx=x+dx,ny=y+dy;
    if(nx<0||nx>=W||ny<0||ny>=H)continue;
    const ni=ny*W+nx; acc[ni]+=acc[i];
    if(--inDeg[ni]===0)q.push(ni);
  }
  return acc;
}

// ================================================================
//  7. 後処理（孤立タイル除去）
// ================================================================
function postProcess(T,W,H){
  const tmp=new Uint8Array(T);
  for(let pass=0;pass<2;pass++){
    for(let y=1;y<H-1;y++) for(let x=1;x<W-1;x++){
      const t=T[y*W+x]; if(t===4)continue;
      const cnt=[0,0,0,0,0];
      for(const[dx,dy]of[[0,-1],[0,1],[-1,0],[1,0],[-1,-1],[-1,1],[1,-1],[1,1]])cnt[T[(y+dy)*W+(x+dx)]]++;
      if(cnt[t]<=1){
        let best=t,bc=-1;
        for(let k=0;k<4;k++) if(cnt[k]>bc){bc=cnt[k];best=k;}
        tmp[y*W+x]=best;
      }
    }
    T.set(tmp);
  }
}

// ================================================================
//  Utility
// ================================================================
function fbm(x,y,seed,octaves){
  let v=0,amp=0.5,freq=1,tot=0;
  for(let o=0;o<octaves;o++){
    v+=vNoise(x*freq,y*freq,seed+o*137)*amp;
    tot+=amp; amp*=0.5; freq*=2.0;
  }
  return v/tot;
}
function percentile(arr,p){const s=Float32Array.from(arr).sort();return s[Math.min(s.length-1,Math.floor(s.length*p))];}
function vNoise(x,y,s){
  const x0=Math.floor(x),y0=Math.floor(y),fx=x-x0,fy=y-y0;
  const sx=fx*fx*(3-2*fx),sy=fy*fy*(3-2*fy);
  return lerp(lerp(hash(x0,y0,s),hash(x0+1,y0,s),sx),lerp(hash(x0,y0+1,s),hash(x0+1,y0+1,s),sx),sy);
}
function hash(x,y,s){let h=(s|0)+x*374761393+y*668265263;h=Math.imul(h^(h>>>13),1274126177);h=h^(h>>>16);return(h&0x7fffffff)/0x7fffffff;}
function lerp(a,b,t){return a+(b-a)*t;}
