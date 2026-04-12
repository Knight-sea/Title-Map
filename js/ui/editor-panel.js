import { getState, setUI } from '../state.js';
import { RANKS, getColorHex } from '../constants.js';
import { updateTerritory, deleteTerritory } from '../territory/territory.js';
import { updatePlayer, deletePlayer } from '../player.js';
import { countCells, isValidParent } from '../territory/hierarchy.js';
import { openColorPicker } from './color-picker.js';
import { pushUndo, snapshotTerritories, snapshotPlayers } from '../undo.js';
import { renderTree, renderPlayerList } from './tree.js';
const ec=()=>document.getElementById('editor-content');
export function renderEditor(){
  const s=getState(),c=ec();
  if(s.ui.activeTab==='territory'&&s.ui.selectedTerritoryId) renderTE(s.ui.selectedTerritoryId,c,s);
  else if(s.ui.activeTab==='player'&&s.ui.selectedPlayerId) renderPE(s.ui.selectedPlayerId,c,s);
  else c.innerHTML='<p class="editor-placeholder">領地またはプレイヤーを選択</p>';
}
function renderTE(tid,c,s){
  const t=s.territories.get(tid);if(!t){c.innerHTML='<p class="editor-placeholder">見つかりません</p>';return;}
  const cells=countCells(tid,s),ch=getColorHex(t.color.hue,t.color.shade);
  const parent=t.parentId?s.territories.get(t.parentId):null,minR=parent?parent.rank+1:0;
  let po='<option value="">なし</option>';for(const pt of s.territories.values()){if(pt.id===tid||pt.rank>=t.rank)continue;po+=`<option value="${pt.id}"${pt.id===t.parentId?' selected':''}>${esc(pt.name||'(名称なし)')} [${RANKS[pt.rank].name}]</option>`;}
  let ro='';for(let i=minR;i<=6;i++)ro+=`<option value="${i}"${i===t.rank?' selected':''}>${RANKS[i].name}</option>`;
  let plo='<option value="">未割当</option>';for(const p of s.players.values())plo+=`<option value="${p.id}"${p.id===t.playerId?' selected':''}>${esc(p.name)}</option>`;
  c.innerHTML=`<div class="form-group"><label>名前</label><input type="text" id="ed-name" value="${esc(t.name||'')}"></div>
<div class="form-row"><div class="form-group"><label>爵位</label><select id="ed-rank">${ro}</select></div><div class="form-group"><label>色</label><div class="color-picker-trigger" id="ed-color" style="background:${ch}"></div></div></div>
<div class="form-group"><label>親領地</label><select id="ed-parent">${po}</select></div>
<div class="form-group"><label>プレイヤー</label><select id="ed-player">${plo}</select></div>
<div style="font-size:10px;color:var(--text-muted);margin-bottom:6px">マス数: ${cells}</div>
<div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn btn-small btn-primary" id="ed-invade">領土を増やす</button><button class="btn btn-small btn-danger" id="ed-delete">削除</button></div>`;
  c.querySelector('#ed-name').onchange=e=>{pushUndo({territories:snapshotTerritories()});updateTerritory(tid,{name:e.target.value});renderTree();fire('state-changed');};
  c.querySelector('#ed-rank').onchange=e=>{pushUndo({territories:snapshotTerritories()});updateTerritory(tid,{rank:+e.target.value});renderTree();renderEditor();fire('state-changed');};
  c.querySelector('#ed-parent').onchange=e=>{const np=e.target.value||null;if(np&&!isValidParent(s.territories.get(tid),np,s))return;pushUndo({territories:snapshotTerritories()});updateTerritory(tid,{parentId:np});renderTree();renderEditor();fire('state-changed');};
  c.querySelector('#ed-player').onchange=e=>{pushUndo({territories:snapshotTerritories()});updateTerritory(tid,{playerId:e.target.value||null});renderPlayerList();fire('state-changed');};
  c.querySelector('#ed-color').onclick=async()=>{const r=await openColorPicker(t.color);if(r){pushUndo({territories:snapshotTerritories()});updateTerritory(tid,{color:r});renderTree();renderEditor();fire('state-changed');}};
  c.querySelector('#ed-invade').onclick=()=>{setUI({mode:'invasion',invasionTargetId:tid});fire('mode-changed');};
  c.querySelector('#ed-delete').onclick=()=>{if(!confirm(`「${t.name||'(名称なし)'}」を削除？`))return;pushUndo({territories:snapshotTerritories(),changes:allTiles(tid,s)});deleteTerritory(tid);setUI({selectedTerritoryId:null});renderTree();renderEditor();fire('state-changed');};
}
function renderPE(pid,c,s){
  const p=s.players.get(pid);if(!p){c.innerHTML='<p class="editor-placeholder">見つかりません</p>';return;}
  const ch=getColorHex(p.color.hue,p.color.shade);
  c.innerHTML=`<div class="form-group"><label>名前</label><input type="text" id="ed-pname" value="${esc(p.name||'')}"></div>
<div class="form-row"><div class="form-group"><label>肩書き</label><input type="text" id="ed-ptitle" value="${esc(p.title||'')}"></div><div class="form-group"><label>色</label><div class="color-picker-trigger" id="ed-pcolor" style="background:${ch}"></div></div></div>
<div class="form-group"><label>メモ</label><textarea id="ed-pmemo">${esc(p.memo||'')}</textarea></div>
<button class="btn btn-small btn-danger" id="ed-pdelete">削除</button>`;
  c.querySelector('#ed-pname').onchange=e=>{pushUndo({players:snapshotPlayers()});updatePlayer(pid,{name:e.target.value});renderPlayerList();};
  c.querySelector('#ed-ptitle').onchange=e=>updatePlayer(pid,{title:e.target.value});
  c.querySelector('#ed-pmemo').onchange=e=>updatePlayer(pid,{memo:e.target.value});
  c.querySelector('#ed-pcolor').onclick=async()=>{const r=await openColorPicker(p.color);if(r){pushUndo({players:snapshotPlayers()});updatePlayer(pid,{color:r});renderPlayerList();renderEditor();}};
  c.querySelector('#ed-pdelete').onclick=()=>{if(!confirm(`「${p.name}」を削除？`))return;pushUndo({players:snapshotPlayers(),territories:snapshotTerritories()});deletePlayer(pid);setUI({selectedPlayerId:null});renderPlayerList();renderEditor();fire('state-changed');};
}
function allTiles(tid,s){const c=[];for(let y=0;y<s.mapHeight;y++)for(let x=0;x<s.mapWidth;x++)if(s.cells[y][x].territoryId===tid)c.push({x,y,prevTerritoryId:tid});return c;}
function esc(s){return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function fire(n){window.dispatchEvent(new CustomEvent(n));}
