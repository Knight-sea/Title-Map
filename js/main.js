import{initState,getState,setUI,generateId}from'./state.js';
import{Camera}from'./canvas/camera.js';
import{Renderer}from'./canvas/renderer.js';
import{TERRAINS,BRUSH_SIZES}from'./constants.js';
import{paintTerrain}from'./map/terrain.js';
import{checkEnclaves}from'./map/enclave.js';
import{generateMap,generatePreview}from'./map/mapgen.js';
import{autoGenerateCells}from'./map/cellgen.js';
import{createTerritory}from'./territory/territory.js';
import{invasionClick}from'./territory/invasion.js';
import{pushUndo,undo,snapshotTerritories}from'./undo.js';
import{saveToSlot,loadFromSlot,getSlotInfo,exportJSON,importJSON,deleteSlot}from'./save.js';
import{createPlayer}from'./player.js';
import{initColorPicker}from'./ui/color-picker.js';
import{renderTree,renderPlayerList,initTreeDrop}from'./ui/tree.js';
import{renderEditor}from'./ui/editor-panel.js';
import{initBGM,loadSoundCloud}from'./bgm.js';

let camera,renderer,currentSlot=0,inited=false,genSeed=Date.now(),genMapSize=100;

// Smooth scroll state
const keys={};
let scrollRAF=null;

function showScreen(id){document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));document.getElementById(id).classList.add('active');}

// ===== Slots =====
function buildSlots(){const g=document.getElementById('slot-grid');g.innerHTML='';for(let i=0;i<16;i++){const c=document.createElement('div');c.className='slot-card';const info=getSlotInfo(i);if(info){c.innerHTML=`<div class="slot-name">${esc(info.name)}</div><div class="slot-info">${info.size} / ${info.territories}領地</div>`;c.onclick=()=>{currentSlot=i;loadFromSlot(i);startEditor();};c.oncontextmenu=e=>{e.preventDefault();if(confirm(`「${info.name}」を削除？`)){deleteSlot(i);buildSlots();}};}else{c.classList.add('empty');c.innerHTML=`<div class="slot-name">空きスロット ${i+1}</div>`;c.onclick=()=>{currentSlot=i;showScreen('size-screen');};}g.appendChild(c);}}

// ===== Size =====
function initSize(){
  const sel=document.getElementById('map-size-select');
  for(let s=20;s<=300;s+=20){const o=document.createElement('option');o.value=s;o.textContent=`${s}×${s}`;if(s===100)o.selected=true;sel.appendChild(o);}
  const prev=document.getElementById('size-preview');
  sel.onchange=()=>{const v=+sel.value;prev.textContent=`${v} × ${v} = ${(v*v).toLocaleString()} マス`;genMapSize=v;};
  sel.dispatchEvent(new Event('change'));
  document.getElementById('size-back').onclick=()=>{showScreen('slot-screen');buildSlots();};
  document.getElementById('size-manual').onclick=()=>{const sz=+sel.value;initState(sz,sz);const s=getState();s.currentSlot=currentSlot;s.slotName=`マップ ${sz}×${sz}`;startEditor();};
  document.getElementById('size-auto').onclick=()=>{genMapSize=+sel.value;showScreen('gen-screen');genSeed=Date.now();updPreview();};
}

// ===== Generation =====
function initGen(){
  const sea=document.getElementById('gen-sea'),mtn=document.getElementById('gen-mtn');
  sea.oninput=()=>{document.getElementById('gen-sea-val').textContent=sea.value+'%';updPreview();};
  mtn.oninput=()=>{document.getElementById('gen-mtn-val').textContent=mtn.value+'%';updPreview();};
  document.getElementById('gen-shape').onchange=updPreview;
  document.getElementById('gen-forest').onchange=updPreview;
  document.getElementById('gen-river').onchange=updPreview;
  document.getElementById('gen-reseed').onclick=()=>{genSeed=Date.now();updPreview();};
  document.getElementById('gen-back').onclick=()=>showScreen('size-screen');
  document.getElementById('gen-confirm').onclick=()=>{
    const sz=genMapSize;initState(sz,sz);const s=getState();s.currentSlot=currentSlot;s.slotName=`マップ ${sz}×${sz}`;
    generateMap({width:sz,height:sz,shape:document.getElementById('gen-shape').value,seaPct:+sea.value,mountainPct:+mtn.value,forestDensity:document.getElementById('gen-forest').value,riverDensity:document.getElementById('gen-river').value,seed:genSeed});
    startEditor();};
}

function updPreview(){
  const sz=Math.min(genMapSize,200);
  const params={shape:document.getElementById('gen-shape').value,seaPct:+document.getElementById('gen-sea').value,mountainPct:+document.getElementById('gen-mtn').value,forestDensity:document.getElementById('gen-forest').value,riverDensity:document.getElementById('gen-river').value,seed:genSeed};
  const img=generatePreview(sz,sz,params);
  const canvas=document.getElementById('gen-preview');canvas.width=sz;canvas.height=sz;
  canvas.getContext('2d').putImageData(img,0,0);
}

// ===== Editor =====
function startEditor(){
  showScreen('editor-screen');
  requestAnimationFrame(()=>{
    const canvas=document.getElementById('map-canvas');
    camera=new Camera();renderer=new Renderer(canvas,camera);renderer.resize();
    const s=getState();camera.fitMap(s.mapWidth,s.mapHeight,renderer.viewW,renderer.viewH);
    renderer.markDirty();renderer.start();
    if(!inited){inited=true;initColorPicker();initTreeDrop();initInput(canvas);initToolbar();initPanelToggle();initBGM();startScrollLoop();
      window.addEventListener('resize',()=>{if(renderer){renderer.resize();renderer.markDirty();}});
      window.addEventListener('territory-selected',()=>{renderEditor();renderer.markDirty();});
      window.addEventListener('player-selected',()=>{renderEditor();renderer.markDirty();});
      window.addEventListener('state-changed',()=>renderer.markDirty());
      window.addEventListener('mode-changed',()=>{const s=getState();if(s.ui.mode==='invasion'){showBanner('侵略: 左ドラッグ=追加/奪取 右クリック=除外 Esc=終了','invasion');autoCBOn();}renderer.markDirty();});
    }
    updateLockUI();syncChecks();populateBrushSizes();
    renderTree();renderPlayerList();renderEditor();updateZoom();
    if(s.settings.soundcloudUrl)loadSoundCloud(s.settings.soundcloudUrl);
  });
}

function populateBrushSizes(){const sel=document.getElementById('brush-size');sel.innerHTML='';for(const s of BRUSH_SIZES){const o=document.createElement('option');o.value=s;o.textContent=s;sel.appendChild(o);}}

// ===== Smooth Scroll =====
function startScrollLoop(){
  const speed=6;
  const loop=()=>{
    if(!camera){scrollRAF=requestAnimationFrame(loop);return;}
    let dx=0,dy=0;
    if(keys['ArrowUp']||keys['KeyW'])dy+=speed;
    if(keys['ArrowDown']||keys['KeyS'])dy-=speed;
    if(keys['ArrowLeft']||keys['KeyA'])dx+=speed;
    if(keys['ArrowRight']||keys['KeyD'])dx-=speed;
    if(dx||dy){camera.pan(dx,dy);renderer.markDirty();updateZoom();}
    scrollRAF=requestAnimationFrame(loop);
  };
  loop();
}

// ===== Input =====
function initInput(canvas){
  let panning=false,lx=0,ly=0,painting=false,dragMode=null;

  canvas.addEventListener('mousedown',e=>{
    const s=getState(),r=canvas.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top,cell=camera.screenToCell(mx,my);

    // Right/middle = always pan (except creation right-click = deselect, invasion right = remove)
    if(e.button===2){e.preventDefault();
      if(s.ui.mode==='creation'){creationRight(cell.x,cell.y);dragMode='remove';painting=true;return;}
      if(s.ui.mode==='invasion'){doInvasion(cell.x,cell.y,2);dragMode='remove';painting=true;return;}
      if(s.ui.mode==='cell'){cellErase(cell.x,cell.y);painting=true;return;}
      panning=true;lx=e.clientX;ly=e.clientY;canvas.style.cursor='grabbing';return;}
    if(e.button===1){e.preventDefault();panning=true;lx=e.clientX;ly=e.clientY;canvas.style.cursor='grabbing';return;}

    // Left
    if(e.button===0){
      if(s.ui.mode==='terrain'){terrainPaint(cell.x,cell.y);painting=true;}
      else if(s.ui.mode==='cell'){cellPaint(cell.x,cell.y);painting=true;}
      else if(s.ui.mode==='creation'){const cid=getCellAt(cell.x,cell.y);if(cid){dragMode=s.ui.creationSelectedCells.has(cid)?'remove':'add';if(dragMode==='add')crAdd(cid);else crRem(cid);}painting=true;}
      else if(s.ui.mode==='invasion'){doInvasion(cell.x,cell.y,0);dragMode='add';painting=true;}
      else{panning=true;lx=e.clientX;ly=e.clientY;canvas.style.cursor='grabbing';}
    }
  });

  canvas.addEventListener('mousemove',e=>{
    if(panning){camera.pan(e.clientX-lx,e.clientY-ly);lx=e.clientX;ly=e.clientY;renderer.markDirty();updateZoom();}
    else if(painting){
      const r=canvas.getBoundingClientRect(),cell=camera.screenToCell(e.clientX-r.left,e.clientY-r.top),s=getState();
      if(s.ui.mode==='terrain')terrainPaint(cell.x,cell.y);
      else if(s.ui.mode==='cell'){if(e.buttons===1)cellPaint(cell.x,cell.y);else if(e.buttons===2)cellErase(cell.x,cell.y);}
      else if(s.ui.mode==='creation'){const cid=getCellAt(cell.x,cell.y);if(cid){if(dragMode==='add')crAdd(cid);else crRem(cid);}}
      else if(s.ui.mode==='invasion'){if(dragMode==='add')doInvasion(cell.x,cell.y,0);else doInvasion(cell.x,cell.y,2);}
    }
  });

  window.addEventListener('mouseup',()=>{panning=false;painting=false;dragMode=null;canvas.style.cursor='';});
  canvas.addEventListener('contextmenu',e=>e.preventDefault());
  canvas.addEventListener('wheel',e=>{e.preventDefault();camera.zoomCenter(e.deltaY,renderer.viewW,renderer.viewH);renderer.markDirty();updateZoom();},{passive:false});

  window.addEventListener('keydown',e=>{
    keys[e.code]=true;
    if(['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName))return;
    const s=getState();

    if(e.key==='Escape'){
      if(s.ui.mode==='creation'){setUI({mode:'normal',creationSelectedCells:new Set()});removeBanner();autoCBRestore();renderer.markDirty();}
      else if(s.ui.mode==='invasion'){setUI({mode:'normal',invasionTargetId:null});removeBanner();autoCBRestore();renderer.markDirty();}
      else if(s.ui.mode==='terrain')deselectBrush();
      else if(s.ui.mode==='cell'){setUI({mode:'normal',currentCellId:null});removeBanner();renderer.markDirty();document.getElementById('btn-cell-mode').classList.remove('active');}
    }
    if(e.key==='Enter'&&s.ui.mode==='creation'){e.preventDefault();confirmCreation();}
    if(e.key===' '&&s.ui.mode==='cell'){e.preventDefault();nextCell();}

    if(e.ctrlKey&&e.key==='z'){e.preventDefault();doUndo();}
    if(e.ctrlKey&&e.key==='0'){e.preventDefault();camera.fitMap(s.mapWidth,s.mapHeight,renderer.viewW,renderer.viewH);renderer.markDirty();updateZoom();}
    if(e.ctrlKey&&e.key==='s'){e.preventDefault();quickSave();}

    if(!e.ctrlKey&&!e.metaKey){
      if(e.key==='n'||e.key==='N'){e.preventDefault();enterCreation();}
      if(e.key==='c'||e.key==='C'){e.preventDefault();toggleCellMode();}
      if(e.key==='l'||e.key==='L'){e.preventDefault();toggleLock();}
      if(e.key==='t'||e.key==='T'){e.preventDefault();const v=!s.ui.showTerrainColors;setUI({showTerrainColors:v});document.getElementById('toggle-terrain-colors').checked=v;renderer.markDirty();}
      if(e.key==='b'||e.key==='B'){e.preventDefault();const v=!s.ui.showCellBorders;setUI({showCellBorders:v});document.getElementById('toggle-cell-borders').checked=v;renderer.markDirty();}
      const tK={'1':'plain','2':'forest','3':'river','4':'mountain','5':'sea'};
      if(tK[e.key]&&!s.locked){const t=tK[e.key];document.querySelectorAll('.brush-btn').forEach(b=>b.classList.remove('active'));document.querySelector(`.brush-btn[data-terrain="${t}"]`)?.classList.add('active');setUI({mode:'terrain',selectedTerrain:t});}
      if(e.key==='['||e.key===']'){const cur=BRUSH_SIZES.indexOf(s.ui.brushSize);const next=e.key==='['?Math.max(0,cur-1):Math.min(BRUSH_SIZES.length-1,cur+1);setUI({brushSize:BRUSH_SIZES[next]});document.getElementById('brush-size').value=BRUSH_SIZES[next];}
      if(e.key==='Tab'){e.preventDefault();const nt=s.ui.activeTab==='territory'?'player':'territory';document.querySelectorAll('.tab-btn[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===nt));document.querySelectorAll('.tab-content').forEach(c=>c.classList.remove('active'));document.getElementById(nt+'-tab').classList.add('active');setUI({activeTab:nt});renderEditor();}
    }
  });
  window.addEventListener('keyup',e=>{keys[e.code]=false;});
}

function getCellAt(x,y){const s=getState();if(x<0||x>=s.mapWidth||y<0||y>=s.mapHeight)return null;return s.cells[y][x].cellId;}

// ===== Terrain =====
function terrainPaint(cx,cy){const s=getState();if(!s.ui.selectedTerrain||s.locked)return;const ch=paintTerrain(cx,cy,s.ui.selectedTerrain,s.ui.brushSize);if(ch.length){pushUndo({changes:ch});checkEnclaves(ch);renderer.markDirty();}}

// ===== Cell =====
function cellPaint(cx,cy){const s=getState();if(s.locked||cx<0||cx>=s.mapWidth||cy<0||cy>=s.mapHeight)return;const cid=s.ui.currentCellId;if(!cid||s.cells[cy][cx].cellId===cid)return;s.cells[cy][cx].cellId=cid;renderer.markDirty();}
function cellErase(cx,cy){const s=getState();if(s.locked||cx<0||cx>=s.mapWidth||cy<0||cy>=s.mapHeight)return;s.cells[cy][cx].cellId=null;renderer.markDirty();}

function toggleCellMode(){const s=getState();if(s.ui.mode==='cell'){setUI({mode:'normal',currentCellId:null});removeBanner();document.getElementById('btn-cell-mode').classList.remove('active');renderer.markDirty();}else enterCellMode();}
function enterCellMode(){const s=getState();if(s.locked)return;const id=generateId();s.cellRegions.set(id,{id});setUI({mode:'cell',currentCellId:id,showCellBorders:true});syncChecks();showBanner('セル塗り: 左=塗る 右=消す Space=次のセル Esc=終了','cell');document.getElementById('btn-cell-mode').classList.add('active');renderer.markDirty();}
function nextCell(){const s=getState();if(s.locked||s.ui.mode!=='cell')return;const id=generateId();s.cellRegions.set(id,{id});setUI({currentCellId:id});showToast('次のセル開始');renderer.markDirty();}

function doAutoCell(){const s=getState();if(s.locked)return;const sz=+document.getElementById('auto-cell-size').value;if(!confirm(`セルサイズ ${sz} で自動生成します。`))return;autoGenerateCells(sz);setUI({showCellBorders:true});syncChecks();renderer.markDirty();}

// ===== Lock =====
function toggleLock(){const s=getState();if(s.locked){if(!confirm('固定を解除しますか？'))return;s.locked=false;}else{let uc=0;for(let y=0;y<s.mapHeight;y++)for(let x=0;x<s.mapWidth;x++){const c=s.cells[y][x];if(!c.cellId&&TERRAINS[c.terrain].canOwn)uc++;}if(uc>0&&!confirm(`${uc}マスがセル未割当です。固定しますか？`))return;s.locked=true;setUI({mode:'normal',selectedTerrain:null,currentCellId:null});deselectBrush();removeBanner();document.getElementById('btn-cell-mode').classList.remove('active');}updateLockUI();renderer.markDirty();}
function updateLockUI(){const s=getState(),btn=document.getElementById('btn-lock'),tg=document.getElementById('terrain-group'),cg=document.getElementById('cell-group');if(s.locked){btn.textContent='🔓 固定中';btn.classList.add('locked');tg.classList.add('hidden');cg.classList.add('hidden');}else{btn.textContent='🔒 固定';btn.classList.remove('locked');tg.classList.remove('hidden');cg.classList.remove('hidden');}}

// ===== Cell border auto =====
function autoCBOn(){const ui=getState().ui;if(!ui.showCellBorders){setUI({showCellBorders:true,cellBordersWasOff:true});syncChecks();}}
function autoCBRestore(){const ui=getState().ui;if(ui.cellBordersWasOff){setUI({showCellBorders:false,cellBordersWasOff:false});syncChecks();}}
function syncChecks(){document.getElementById('toggle-cell-borders').checked=getState().ui.showCellBorders;document.getElementById('toggle-terrain-colors').checked=getState().ui.showTerrainColors;}

// ===== Creation =====
function crAdd(cid){if(!cid)return;const s=getState(),sel=new Set(s.ui.creationSelectedCells);if(!sel.has(cid)){sel.add(cid);setUI({creationSelectedCells:sel});renderer.markDirty();}}
function crRem(cid){if(!cid)return;const s=getState(),sel=new Set(s.ui.creationSelectedCells);if(sel.has(cid)){sel.delete(cid);setUI({creationSelectedCells:sel});renderer.markDirty();}}
function creationRight(x,y){const cid=getCellAt(x,y);if(cid)crRem(cid);}

function enterCreation(){const s=getState();if(!s.locked){alert('先にセルを固定してください。');return;}setUI({mode:'creation',creationSelectedCells:new Set()});autoCBOn();showBanner('','creation');
const banner=document.querySelector('.mode-banner');if(banner){banner.innerHTML='領地作成: 左ドラッグ=セル選択 右=解除 Enter=作成 Esc=キャンセル';const btns=document.createElement('div');btns.style.cssText='margin-top:5px;display:flex;gap:6px;justify-content:center;pointer-events:auto';btns.innerHTML='<button class="btn btn-small btn-primary" id="creation-confirm">作成 (Enter)</button><button class="btn btn-small btn-secondary" id="creation-cancel">キャンセル</button>';banner.appendChild(btns);banner.style.pointerEvents='auto';document.getElementById('creation-confirm').onclick=confirmCreation;document.getElementById('creation-cancel').onclick=()=>{setUI({mode:'normal',creationSelectedCells:new Set()});removeBanner();autoCBRestore();renderer.markDirty();};}renderer.markDirty();}

function confirmCreation(){const s=getState(),sel=s.ui.creationSelectedCells;if(!sel.size){alert('セルを選択してください');return;}const changes=[];for(const cid of sel)for(let y=0;y<s.mapHeight;y++)for(let x=0;x<s.mapWidth;x++)if(s.cells[y][x].cellId===cid)changes.push({x,y,prevTerritoryId:s.cells[y][x].territoryId});pushUndo({territories:snapshotTerritories(),changes});const t=createTerritory('',6,null,{hue:Math.floor(Math.random()*20),shade:2},sel);setUI({mode:'normal',creationSelectedCells:new Set(),selectedTerritoryId:t.id,activeTab:'territory'});removeBanner();autoCBRestore();openEditorPanel();renderTree();renderEditor();renderer.markDirty();setTimeout(()=>{const el=document.getElementById('ed-name');if(el)el.focus();},60);}

// ===== Invasion =====
function doInvasion(x,y,btn){const ch=invasionClick(x,y,btn);if(ch){pushUndo({changes:ch});renderTree();renderEditor();renderer.markDirty();}}
function doUndo(){if(undo()){renderTree();renderPlayerList();renderEditor();renderer.markDirty();}}

// ===== Toolbar =====
function initToolbar(){
  document.querySelectorAll('.brush-btn').forEach(btn=>{btn.onclick=()=>{const t=btn.dataset.terrain;if(getState().ui.selectedTerrain===t){deselectBrush();return;}document.querySelectorAll('.brush-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');setUI({mode:'terrain',selectedTerrain:t});};});
  document.getElementById('brush-size').onchange=e=>setUI({brushSize:+e.target.value});
  document.getElementById('btn-save').onclick=openSaveModal;
  document.getElementById('btn-undo').onclick=doUndo;
  document.getElementById('btn-cell-mode').onclick=toggleCellMode;
  document.getElementById('btn-auto-cell').onclick=doAutoCell;
  document.getElementById('btn-lock').onclick=toggleLock;
  document.getElementById('btn-settings').onclick=()=>{document.getElementById('soundcloud-url').value=getState().settings.soundcloudUrl||'';document.getElementById('settings-modal').hidden=false;};
  document.getElementById('settings-cancel').onclick=()=>document.getElementById('settings-modal').hidden=true;
  document.getElementById('settings-save').onclick=()=>{const url=document.getElementById('soundcloud-url').value.trim();getState().settings.soundcloudUrl=url;if(url)loadSoundCloud(url);document.getElementById('settings-modal').hidden=true;};
  document.querySelectorAll('.tab-btn[data-tab]').forEach(btn=>{btn.onclick=()=>{document.querySelectorAll('.tab-btn[data-tab]').forEach(b=>b.classList.remove('active'));btn.classList.add('active');document.querySelectorAll('.tab-content').forEach(c=>c.classList.remove('active'));document.getElementById(btn.dataset.tab+'-tab').classList.add('active');setUI({activeTab:btn.dataset.tab});renderEditor();};});
  document.getElementById('btn-new-territory').onclick=enterCreation;
  document.getElementById('btn-new-player').onclick=()=>{const p=createPlayer('新しいプレイヤー','',{hue:Math.floor(Math.random()*20),shade:2},'');setUI({selectedPlayerId:p.id,selectedTerritoryId:null,activeTab:'player'});renderPlayerList();renderEditor();openEditorPanel();};
  document.getElementById('view-level').onchange=e=>{setUI({viewLevel:+e.target.value});renderer.markDirty();};
  document.getElementById('toggle-labels').onchange=e=>{setUI({showLabels:e.target.checked});renderer.markDirty();};
  document.getElementById('toggle-cell-borders').onchange=e=>{setUI({showCellBorders:e.target.checked});renderer.markDirty();};
  document.getElementById('toggle-terrain-colors').onchange=e=>{setUI({showTerrainColors:e.target.checked});renderer.markDirty();};
  document.getElementById('btn-help').onclick=()=>document.getElementById('help-modal').hidden=false;
  document.getElementById('help-close').onclick=()=>document.getElementById('help-modal').hidden=true;
  document.getElementById('save-cancel').onclick=()=>document.getElementById('save-modal').hidden=true;
  document.getElementById('save-confirm').onclick=()=>{const s=getState();s.slotName=document.getElementById('save-slot-name').value||s.slotName;saveToSlot(s.currentSlot);document.getElementById('save-modal').hidden=true;};
  document.getElementById('save-export').onclick=()=>{const s=getState();s.slotName=document.getElementById('save-slot-name').value||s.slotName;exportJSON();};
  document.getElementById('import-file').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{await importJSON(f);startEditor();}catch(err){alert('インポート失敗: '+err.message);}e.target.value='';};
}

function deselectBrush(){document.querySelectorAll('.brush-btn').forEach(b=>b.classList.remove('active'));setUI({mode:'normal',selectedTerrain:null});}

// ===== Panel =====
function initPanelToggle(){const tog=document.getElementById('divider-toggle'),panel=document.getElementById('editor-panel');tog.onclick=()=>{const col=panel.classList.contains('collapsed');panel.classList.toggle('collapsed');tog.textContent=col?'▼ 編集パネル':'▲ 編集パネル';};}
function openEditorPanel(){document.getElementById('editor-panel').classList.remove('collapsed');document.getElementById('divider-toggle').textContent='▼ 編集パネル';}

// ===== Helpers =====
function showBanner(t,cls){removeBanner();const b=document.createElement('div');b.className=`mode-banner ${cls||''}`;b.textContent=t;document.getElementById('canvas-container').appendChild(b);}
function removeBanner(){document.querySelectorAll('.mode-banner').forEach(b=>b.remove());}
function showToast(msg){const t=document.createElement('div');t.className='toast';t.textContent=msg;document.getElementById('canvas-container').appendChild(t);setTimeout(()=>t.remove(),1500);}
function updateZoom(){const el=document.getElementById('zoom-display');if(el&&camera)el.textContent=Math.round(camera.zoom*100)+'%';}
function quickSave(){saveToSlot(getState().currentSlot);}
function openSaveModal(){document.getElementById('save-slot-name').value=getState().slotName||'';document.getElementById('save-modal').hidden=false;}
function esc(s){return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

document.addEventListener('DOMContentLoaded',()=>{buildSlots();initSize();initGen();showScreen('slot-screen');});
