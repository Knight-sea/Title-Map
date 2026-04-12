import { getState, setUI } from '../state.js';
import { RANKS, getColorHex } from '../constants.js';
import { getRoots, getChildren, isValidParent } from '../territory/hierarchy.js';
import { updateTerritory } from '../territory/territory.js';
import { countPlayerTerritories, getPlayerTerritories } from '../player.js';

const collapsed=new Set();
export function renderTree(){
  const s=getState(),c=document.getElementById('territory-tree');c.innerHTML='';
  const roots=getRoots(s),ul=document.createElement('ul');
  for(const t of roots) ul.appendChild(buildNode(t,s));
  c.appendChild(ul);
}
function buildNode(t,s){
  const li=document.createElement('li'),item=document.createElement('div');
  item.className='tree-item';if(s.ui.selectedTerritoryId===t.id)item.classList.add('selected');
  const children=getChildren(t.id,s);
  const tog=document.createElement('span');tog.className='tree-toggle';
  if(children.length){tog.textContent=collapsed.has(t.id)?'▶':'▼';tog.onclick=(e)=>{e.stopPropagation();if(collapsed.has(t.id))collapsed.delete(t.id);else collapsed.add(t.id);renderTree();};}
  else tog.textContent='·';
  item.appendChild(tog);
  const dot=document.createElement('span');dot.className='color-dot';dot.style.background=getColorHex(t.color.hue,t.color.shade);item.appendChild(dot);
  const nm=document.createElement('span');nm.textContent=t.name||'(名称なし)';nm.style.cssText='flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';item.appendChild(nm);
  const badge=document.createElement('span');badge.className='rank-badge';badge.textContent=RANKS[t.rank].name;item.appendChild(badge);
  item.onclick=()=>{setUI({selectedTerritoryId:t.id,selectedPlayerId:null,activeTab:'territory'});window.dispatchEvent(new CustomEvent('territory-selected'));renderTree();};
  item.draggable=true;
  item.ondragstart=(e)=>{e.dataTransfer.setData('text/plain',t.id);e.dataTransfer.effectAllowed='move';};
  item.ondragover=(e)=>{e.preventDefault();item.style.background='var(--bg-hover)';};
  item.ondragleave=()=>item.style.background='';
  item.ondrop=(e)=>{e.preventDefault();item.style.background='';const did=e.dataTransfer.getData('text/plain');if(did===t.id)return;const d=s.territories.get(did);if(d&&isValidParent(d,t.id,s)){updateTerritory(did,{parentId:t.id});renderTree();window.dispatchEvent(new CustomEvent('state-changed'));}};
  li.appendChild(item);
  if(children.length&&!collapsed.has(t.id)){const ul=document.createElement('ul');for(const ch of children)ul.appendChild(buildNode(ch,s));li.appendChild(ul);}
  return li;
}
export function initTreeDrop(){const c=document.getElementById('territory-tree');c.ondragover=(e)=>e.preventDefault();
  c.ondrop=(e)=>{if(e.target!==c&&e.target!==c.querySelector('ul'))return;e.preventDefault();const did=e.dataTransfer.getData('text/plain');const d=getState().territories.get(did);if(d){updateTerritory(did,{parentId:null});renderTree();window.dispatchEvent(new CustomEvent('state-changed'));}};
}
export function renderPlayerList(){
  const s=getState(),c=document.getElementById('player-list');c.innerHTML='';
  for(const p of s.players.values()){
    const card=document.createElement('div');card.className='player-card';if(s.ui.selectedPlayerId===p.id)card.classList.add('selected');
    const av=document.createElement('div');av.className='player-avatar';av.style.background=getColorHex(p.color.hue,p.color.shade);av.textContent=(p.name||'?')[0];card.appendChild(av);
    const info=document.createElement('div');info.className='player-info';
    const nm=document.createElement('div');nm.className='player-name';nm.textContent=p.name;info.appendChild(nm);
    const cnt=document.createElement('div');cnt.className='player-count';cnt.textContent=`${countPlayerTerritories(p.id)} 領地`;info.appendChild(cnt);
    const ts=getPlayerTerritories(p.id);if(ts.length){const tl=document.createElement('div');tl.style.cssText='font-size:10px;color:var(--text-muted);margin-top:2px';tl.textContent=ts.map(t=>t.name||'(名称なし)').join(', ');info.appendChild(tl);}
    card.appendChild(info);
    card.onclick=()=>{setUI({selectedPlayerId:p.id,selectedTerritoryId:null,activeTab:'player'});window.dispatchEvent(new CustomEvent('player-selected'));renderPlayerList();};
    c.appendChild(card);
  }
}
