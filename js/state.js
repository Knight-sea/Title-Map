let _s=null,_l=[];
export function initState(w,h){const cells=[];for(let y=0;y<h;y++){const r=[];for(let x=0;x<w;x++)r.push({terrain:'plain',territoryId:null,cellId:null});cells.push(r);}
_s={mapWidth:w,mapHeight:h,cells,territories:new Map(),players:new Map(),cellRegions:new Map(),locked:false,currentSlot:0,slotName:'',settings:{soundcloudUrl:''},
ui:{mode:'normal',selectedTerrain:null,brushSize:1,selectedTerritoryId:null,selectedPlayerId:null,viewLevel:0,showLabels:false,showCellBorders:false,showTerrainColors:true,cellBordersWasOff:false,creationSelectedCells:new Set(),invasionTargetId:null,activeTab:'territory',currentCellId:null}};
notify();return _s;}
export function getState(){return _s;}
export function setState(p){Object.assign(_s,p);notify();}
export function setUI(p){Object.assign(_s.ui,p);notify();}
export function subscribe(fn){_l.push(fn);return()=>{_l=_l.filter(x=>x!==fn);};}
function notify(){for(const fn of _l)fn(_s);}
export function loadFromData(d){initState(d.mapWidth,d.mapHeight);
if(d.cells){let i=0;for(const[t,tid,cid,count]of d.cells)for(let j=0;j<count;j++){const y=Math.floor(i/d.mapWidth),x=i%d.mapWidth;if(y<d.mapHeight&&x<d.mapWidth)_s.cells[y][x]={terrain:t,territoryId:tid,cellId:cid};i++;}}
_s.territories=new Map();if(d.territories)for(const t of d.territories)_s.territories.set(t.id,t);
_s.players=new Map();if(d.players)for(const p of d.players)_s.players.set(p.id,p);
_s.cellRegions=new Map();if(d.cellRegions)for(const c of d.cellRegions)_s.cellRegions.set(c.id,c);
_s.locked=d.locked||false;_s.slotName=d.slotName||'';_s.settings=d.settings||{soundcloudUrl:''};_s.currentSlot=d.currentSlot??0;notify();}
export function exportData(){const s=_s,c=[];let p=null,n=0;
for(let y=0;y<s.mapHeight;y++)for(let x=0;x<s.mapWidth;x++){const cl=s.cells[y][x],k=`${cl.terrain}|${cl.territoryId}|${cl.cellId}`;if(k===p)n++;else{if(p!==null){const[t,tid,cid]=p.split('|');c.push([t,tid==='null'?null:tid,cid==='null'?null:cid,n]);}p=k;n=1;}}
if(p!==null){const[t,tid,cid]=p.split('|');c.push([t,tid==='null'?null:tid,cid==='null'?null:cid,n]);}
return{version:2,slotName:s.slotName,currentSlot:s.currentSlot,mapWidth:s.mapWidth,mapHeight:s.mapHeight,cells:c,territories:Array.from(s.territories.values()),players:Array.from(s.players.values()),cellRegions:Array.from(s.cellRegions.values()),locked:s.locked,settings:s.settings};}
export function generateId(){return Date.now().toString(36)+Math.random().toString(36).slice(2,8);}
