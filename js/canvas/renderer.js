import{TERRAINS,UNASSIGNED_COLOR,GRID_COLOR,TERRAIN_FLAT_COLOR,drawTerrainSymbol,getColorHex}from'../constants.js';
import{getState}from'../state.js';
import{getDisplayColor,findBorderInfo}from'../territory/hierarchy.js';
import{getPlayerTerritories}from'../player.js';

export class Renderer{
constructor(c,cam){this.canvas=c;this.ctx=c.getContext('2d');this.camera=cam;this._raf=null;this._run=false;this._dirty=true;}
resize(){const p=this.canvas.parentElement;if(!p)return;const w=p.clientWidth,h=p.clientHeight;if(!w||!h)return;const d=devicePixelRatio||1;this.canvas.width=w*d;this.canvas.height=h*d;this.canvas.style.width=w+'px';this.canvas.style.height=h+'px';this.vw=w;this.vh=h;this.dpr=d;this._dirty=true;}
get viewW(){return this.vw||0;}get viewH(){return this.vh||0;}
markDirty(){this._dirty=true;}
start(){this._run=true;const loop=()=>{if(!this._run)return;if(this._dirty){this._dirty=false;this._render();}this._raf=requestAnimationFrame(loop);};loop();}
stop(){this._run=false;if(this._raf)cancelAnimationFrame(this._raf);}

_render(){
const state=getState();if(!state)return;
const ctx=this.ctx,cam=this.camera,vw=this.vw,vh=this.vh;
ctx.setTransform(this.dpr,0,0,this.dpr,0,0);ctx.clearRect(0,0,vw,vh);
const range=cam.getVisibleRange(vw,vh,state.mapWidth,state.mapHeight),scale=cam.scale,ui=state.ui,showTC=ui.showTerrainColors;

// Build highlight set
const hlTids=new Set();
if(ui.selectedTerritoryId)hlTids.add(ui.selectedTerritoryId);
if(ui.selectedPlayerId){for(const t of getPlayerTerritories(ui.selectedPlayerId))hlTids.add(t.id);}

// Tiles
for(let y=range.y0;y<=range.y1;y++)for(let x=range.x0;x<=range.x1;x++){
const cell=state.cells[y][x],sx=(x-cam.x)*scale,sy=(y-cam.y)*scale;
let color;
if(cell.territoryId){color=getDisplayColor(cell.territoryId,ui.viewLevel);}
else if(cell.cellId&&state.locked){const tc=showTC?TERRAINS[cell.terrain].color:TERRAIN_FLAT_COLOR;ctx.fillStyle=tc;ctx.fillRect(sx,sy,scale+.5,scale+.5);if(showTC&&cell.terrain!=='plain'&&scale>16)drawTerrainSymbol(ctx,cell.terrain,sx+scale/2,sy+scale/2,scale);continue;}
else{color=(!showTC&&TERRAINS[cell.terrain].canOwn)?TERRAIN_FLAT_COLOR:TERRAINS[cell.terrain].color;}
ctx.fillStyle=color;ctx.fillRect(sx,sy,scale+.5,scale+.5);
if(cell.territoryId&&cell.terrain!=='plain'&&showTC){ctx.globalAlpha=.2;ctx.fillStyle=TERRAINS[cell.terrain].color;ctx.fillRect(sx,sy,scale+.5,scale+.5);ctx.globalAlpha=1;}
if(showTC&&cell.terrain!=='plain'&&scale>16)drawTerrainSymbol(ctx,cell.terrain,sx+scale/2,sy+scale/2,scale);}

// Grid
if(scale>8){ctx.strokeStyle=GRID_COLOR;ctx.lineWidth=.5;
for(let y=range.y0;y<=range.y1+1;y++){const sy=(y-cam.y)*scale;ctx.beginPath();ctx.moveTo((range.x0-cam.x)*scale,sy);ctx.lineTo((range.x1+1-cam.x)*scale,sy);ctx.stroke();}
for(let x=range.x0;x<=range.x1+1;x++){const sx=(x-cam.x)*scale;ctx.beginPath();ctx.moveTo(sx,(range.y0-cam.y)*scale);ctx.lineTo(sx,(range.y1+1-cam.y)*scale);ctx.stroke();}}

// Cell borders（黒で視認性向上）
if(ui.showCellBorders&&state.cellRegions.size>0&&scale>3)this._drawCB(ctx,state,range,scale);

// Territory borders
this._drawTB(ctx,state,range,scale,ui.viewLevel);

// Highlight borders for selected territory/player
if(hlTids.size>0)this._drawHL(ctx,state,range,scale,hlTids);

// Mode highlights
if(ui.mode==='creation')this._drawCR(ctx,state,range,scale);
if(ui.mode==='invasion')this._drawIN(ctx,state,range,scale);
if(ui.mode==='cell')this._drawCP(ctx,state,range,scale);

// Labels
if(ui.showLabels&&scale>10)this._drawLB(ctx,state,range,scale);
}

// セル線：黒系に変更（固定前=半透明黒、固定後=不透明黒）
_drawCB(ctx,s,range,sc){
  const cam=this.camera;
  // 固定前：破線の半透明黒　固定後：実線の黒
  ctx.strokeStyle=s.locked?'rgba(0,0,0,0.55)':'rgba(0,0,0,0.45)';
  ctx.lineWidth=sc>12?1.5:1;
  if(!s.locked)ctx.setLineDash([3,3]);
  for(let y=range.y0;y<=range.y1;y++)for(let x=range.x0;x<=range.x1;x++){
    const cid=s.cells[y][x].cellId;if(!cid)continue;
    const sx=(x-cam.x)*sc,sy=(y-cam.y)*sc;
    for(const[dx,dy,x1,y1,x2,y2]of this._dirs(sx,sy,sc)){
      const nx=x+dx,ny=y+dy;
      const nc=(nx>=0&&nx<s.mapWidth&&ny>=0&&ny<s.mapHeight)?s.cells[ny][nx].cellId:null;
      if(nc!==cid){ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();}
    }
  }
  ctx.setLineDash([]);
}

_drawTB(ctx,s,range,sc,vl){const cam=this.camera;
for(let y=range.y0;y<=range.y1;y++)for(let x=range.x0;x<=range.x1;x++){const tid=s.cells[y][x].territoryId;if(!tid)continue;const sx=(x-cam.x)*sc,sy=(y-cam.y)*sc;
for(const[dx,dy,x1,y1,x2,y2]of this._dirs(sx,sy,sc)){const nx=x+dx,ny=y+dy;const nt=(nx>=0&&nx<s.mapWidth&&ny>=0&&ny<s.mapHeight)?s.cells[ny][nx].territoryId:null;if(nt===tid)continue;const info=findBorderInfo(tid,nt,s,vl);if(!info||!info.visible)continue;
ctx.strokeStyle=`rgba(255,255,255,${Math.max(.25,.9-info.depth*.15)})`;ctx.lineWidth=Math.max(1,5-info.depth);ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();}}}

_drawHL(ctx,s,range,sc,hlTids){const cam=this.camera;
for(let y=range.y0;y<=range.y1;y++)for(let x=range.x0;x<=range.x1;x++){const tid=s.cells[y][x].territoryId;if(!tid||!hlTids.has(tid))continue;const sx=(x-cam.x)*sc,sy=(y-cam.y)*sc;
for(const[dx,dy,x1,y1,x2,y2]of this._dirs(sx,sy,sc)){const nx=x+dx,ny=y+dy;const nt=(nx>=0&&nx<s.mapWidth&&ny>=0&&ny<s.mapHeight)?s.cells[ny][nx].territoryId:null;if(nt===tid)continue;
ctx.strokeStyle='rgba(120,200,255,0.7)';ctx.lineWidth=2.5;ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();}}}

_drawCR(ctx,s,range,sc){const cam=this.camera,sel=s.ui.creationSelectedCells;
for(const cid of sel){for(let y=range.y0;y<=range.y1;y++)for(let x=range.x0;x<=range.x1;x++){if(s.cells[y][x].cellId!==cid)continue;const sx=(x-cam.x)*sc,sy=(y-cam.y)*sc;ctx.fillStyle='rgba(60,140,255,0.2)';ctx.fillRect(sx,sy,sc,sc);
for(const[dx,dy,x1,y1,x2,y2]of this._dirs(sx,sy,sc)){const nx=x+dx,ny=y+dy;const nc=(nx>=0&&nx<s.mapWidth&&ny>=0&&ny<s.mapHeight)?s.cells[ny][nx].cellId:null;if(!sel.has(nc)){ctx.strokeStyle='rgba(60,140,255,0.8)';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();}}}}}

_drawIN(ctx,s,range,sc){const cam=this.camera,tid=s.ui.invasionTargetId;
for(let y=range.y0;y<=range.y1;y++)for(let x=range.x0;x<=range.x1;x++){const c=s.cells[y][x],sx=(x-cam.x)*sc,sy=(y-cam.y)*sc;
if(!TERRAINS[c.terrain].canOwn&&!c.cellId){ctx.fillStyle='rgba(100,100,100,0.35)';ctx.fillRect(sx,sy,sc,sc);}
else if(c.territoryId===tid){ctx.strokeStyle='rgba(255,80,80,0.5)';ctx.lineWidth=1.5;ctx.strokeRect(sx+1,sy+1,sc-2,sc-2);}
else{ctx.strokeStyle='rgba(80,255,80,0.3)';ctx.lineWidth=1;ctx.strokeRect(sx+1,sy+1,sc-2,sc-2);}}}

_drawCP(ctx,s,range,sc){const cam=this.camera,cid=s.ui.currentCellId;if(!cid)return;
for(let y=range.y0;y<=range.y1;y++)for(let x=range.x0;x<=range.x1;x++){if(s.cells[y][x].cellId===cid){const sx=(x-cam.x)*sc,sy=(y-cam.y)*sc;ctx.fillStyle='rgba(255,220,60,0.15)';ctx.fillRect(sx,sy,sc,sc);}}}

_drawLB(ctx,s,range,sc){const cam=this.camera,bounds=new Map();
for(let y=range.y0;y<=range.y1;y++)for(let x=range.x0;x<=range.x1;x++){const tid=s.cells[y][x].territoryId;if(!tid)continue;if(!bounds.has(tid))bounds.set(tid,{minX:x,minY:y,maxX:x,maxY:y});const b=bounds.get(tid);if(x<b.minX)b.minX=x;if(x>b.maxX)b.maxX=x;if(y<b.minY)b.minY=y;if(y>b.maxY)b.maxY=y;}
const fs=Math.max(7,Math.min(13,sc*.35));ctx.font=`bold ${fs}px sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';
for(const[tid,b]of bounds){const t=s.territories.get(tid);if(!t||!t.name)continue;const cx=((b.minX+b.maxX+1)/2-cam.x)*sc,cy=((b.minY+b.maxY+1)/2-cam.y)*sc;ctx.fillStyle='rgba(0,0,0,0.65)';ctx.fillText(t.name,cx+1,cy+1);ctx.fillStyle='#fff';ctx.fillText(t.name,cx,cy);}}

_dirs(sx,sy,sc){return[[0,-1,sx,sy,sx+sc,sy],[0,1,sx,sy+sc,sx+sc,sy+sc],[-1,0,sx,sy,sx,sy+sc],[1,0,sx+sc,sy,sx+sc,sy+sc]];}
}
