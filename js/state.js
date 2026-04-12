let _state = null, _listeners = [];

export function initState(w, h) {
  const cells = [];
  for (let y=0;y<h;y++) { const row=[]; for (let x=0;x<w;x++) row.push({terrain:'plain',territoryId:null,cellId:null}); cells.push(row); }
  _state = {
    mapWidth:w, mapHeight:h, cells,
    territories: new Map(), players: new Map(), cellRegions: new Map(),
    locked: false, currentSlot:0, slotName:'', settings:{soundcloudUrl:''},
    ui: {
      mode:'normal', selectedTerrain:null, brushSize:1,
      selectedTerritoryId:null, selectedPlayerId:null, viewLevel:0,
      showLabels:false, showCellBorders:false, showTerrainColors:true,
      cellBordersWasOff:false,
      creationSelectedCells:new Set(), invasionTargetId:null,
      activeTab:'territory', currentCellId:null,
    }
  };
  notify(); return _state;
}
export function getState() { return _state; }
export function setState(p) { Object.assign(_state,p); notify(); }
export function setUI(p) { Object.assign(_state.ui,p); notify(); }
export function subscribe(fn) { _listeners.push(fn); return ()=>{_listeners=_listeners.filter(l=>l!==fn);}; }
function notify() { for (const fn of _listeners) fn(_state); }

export function loadFromData(data) {
  initState(data.mapWidth, data.mapHeight);
  if (data.cells) { let idx=0; for (const [t,tid,cid,count] of data.cells) { for (let i=0;i<count;i++) { const y=Math.floor(idx/data.mapWidth),x=idx%data.mapWidth; if(y<data.mapHeight&&x<data.mapWidth) _state.cells[y][x]={terrain:t,territoryId:tid,cellId:cid}; idx++; } } }
  _state.territories=new Map(); if(data.territories) for(const t of data.territories) _state.territories.set(t.id,t);
  _state.players=new Map(); if(data.players) for(const p of data.players) _state.players.set(p.id,p);
  _state.cellRegions=new Map(); if(data.cellRegions) for(const c of data.cellRegions) _state.cellRegions.set(c.id,c);
  _state.locked=data.locked||false; _state.slotName=data.slotName||''; _state.settings=data.settings||{soundcloudUrl:''}; _state.currentSlot=data.currentSlot??0;
  notify();
}

export function exportData() {
  const s=_state, compressed=[];
  let prev=null,count=0;
  for(let y=0;y<s.mapHeight;y++) for(let x=0;x<s.mapWidth;x++) {
    const c=s.cells[y][x], key=`${c.terrain}|${c.territoryId}|${c.cellId}`;
    if(key===prev) count++; else { if(prev!==null){const[t,tid,cid]=prev.split('|');compressed.push([t,tid==='null'?null:tid,cid==='null'?null:cid,count]);} prev=key;count=1; }
  }
  if(prev!==null){const[t,tid,cid]=prev.split('|');compressed.push([t,tid==='null'?null:tid,cid==='null'?null:cid,count]);}
  return { version:2, slotName:s.slotName, currentSlot:s.currentSlot, mapWidth:s.mapWidth, mapHeight:s.mapHeight, cells:compressed, territories:Array.from(s.territories.values()), players:Array.from(s.players.values()), cellRegions:Array.from(s.cellRegions.values()), locked:s.locked, settings:s.settings };
}

export function generateId() { return Date.now().toString(36)+Math.random().toString(36).slice(2,8); }
