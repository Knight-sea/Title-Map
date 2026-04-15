import{getState,setUI}from'../state.js';
import{RANKS,getColorHex}from'../constants.js';
import{getRoots,getChildren,isValidParent,reorderSiblings,reorderSiblingsAppend}from'../territory/hierarchy.js';
import{updateTerritory}from'../territory/territory.js';
import{countPlayerTerritories,getPlayerTerritories}from'../player.js';

const collapsed=new Set();
const playerExpanded=new Set();

// ドラッグ中のマウス位置追跡
let dragOverId=null,dragOverPos=null; // pos: 'before'|'after'|'child'

export function renderTree(){
  const s=getState(),c=document.getElementById('territory-tree');c.innerHTML='';
  const roots=getRoots(s),ul=document.createElement('ul');
  for(const t of roots)ul.appendChild(buildNode(t,s));
  c.appendChild(ul);

  // 並べ替えドロップゾーン（ルートの末尾）
  c.ondragover=e=>e.preventDefault();
  c.ondrop=e=>{
    if(e.target!==c&&e.target!==c.querySelector('ul'))return;
    e.preventDefault();
    const did=e.dataTransfer.getData('text/plain');
    const d=getState().territories.get(did);
    if(d){
      if(d.parentId===null){reorderSiblingsAppend(did,getState());}
      else{updateTerritory(did,{parentId:null});}
      renderTree();fire('state-changed');}};
}

function buildNode(t,s){
  const li=document.createElement('li');

  // ドロップ位置インジケーター（上）
  const beforeZone=document.createElement('div');
  beforeZone.className='drop-zone drop-before';
  beforeZone.dataset.tid=t.id;
  beforeZone.ondragover=e=>{e.preventDefault();e.stopPropagation();beforeZone.classList.add('active');};
  beforeZone.ondragleave=()=>beforeZone.classList.remove('active');
  beforeZone.ondrop=e=>{
    e.preventDefault();e.stopPropagation();beforeZone.classList.remove('active');
    const did=e.dataTransfer.getData('text/plain');
    if(did===t.id)return;
    const d=s.territories.get(did);if(!d)return;
    if((d.parentId??null)===(t.parentId??null)){
      // 同一親 → 並べ替え
      reorderSiblings(did,t.id,s);
    }else{
      // 異なる親 → 親変更＋順序設定
      reorderSiblings(did,t.id,s);
      updateTerritory(did,{parentId:t.parentId??null});
    }
    renderTree();fire('state-changed');};

  const item=document.createElement('div');
  item.className='tree-item';if(s.ui.selectedTerritoryId===t.id)item.classList.add('selected');
  const children=getChildren(t.id,s);
  const tog=document.createElement('span');tog.className='tree-toggle';
  if(children.length){tog.textContent=collapsed.has(t.id)?'▶':'▼';tog.onclick=e=>{e.stopPropagation();if(collapsed.has(t.id))collapsed.delete(t.id);else collapsed.add(t.id);renderTree();};}
  else tog.textContent='·';
  item.appendChild(tog);
  const dot=document.createElement('span');dot.className='color-dot';dot.style.background=getColorHex(t.color.hue,t.color.shade);item.appendChild(dot);
  const nm=document.createElement('span');nm.textContent=t.name||'(名称なし)';nm.style.cssText='flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';item.appendChild(nm);
  const badge=document.createElement('span');badge.className='rank-badge';badge.textContent=RANKS[t.rank].name;item.appendChild(badge);
  item.onclick=()=>{setUI({selectedTerritoryId:t.id,selectedPlayerId:null,activeTab:'territory'});fire('territory-selected');renderTree();};

  item.draggable=true;
  item.ondragstart=e=>{e.dataTransfer.setData('text/plain',t.id);e.dataTransfer.effectAllowed='move';e.stopPropagation();};
  // childドロップ（アイテム本体にドロップ → 子にする）
  item.ondragover=e=>{e.preventDefault();e.stopPropagation();item.style.outline='1px dashed var(--primary)';};
  item.ondragleave=()=>item.style.outline='';
  item.ondrop=e=>{
    e.preventDefault();e.stopPropagation();item.style.outline='';
    const did=e.dataTransfer.getData('text/plain');
    if(did===t.id)return;
    const d=s.territories.get(did);
    if(d&&isValidParent(d,t.id,s)){updateTerritory(did,{parentId:t.id});renderTree();fire('state-changed');}};

  li.appendChild(beforeZone);
  li.appendChild(item);
  if(children.length&&!collapsed.has(t.id)){const ul=document.createElement('ul');for(const ch of children)ul.appendChild(buildNode(ch,s));li.appendChild(ul);}
  return li;
}

export function initTreeDrop(){
  // 初期化はrenderTree内で行う
}

export function renderPlayerList(){
  const s=getState(),c=document.getElementById('player-list');c.innerHTML='';
  for(const p of s.players.values()){
    const card=document.createElement('div');card.className='player-card';
    if(s.ui.selectedPlayerId===p.id)card.classList.add('selected');
    const av=document.createElement('div');av.className='player-avatar';av.style.background=getColorHex(p.color.hue,p.color.shade);av.textContent=(p.name||'?')[0];card.appendChild(av);
    const info=document.createElement('div');info.className='player-info';
    const row=document.createElement('div');row.style.cssText='display:flex;align-items:center;gap:4px';
    const nm=document.createElement('span');nm.className='player-name';nm.textContent=p.name;row.appendChild(nm);
    const cnt=document.createElement('span');cnt.className='player-count';cnt.textContent=`(${countPlayerTerritories(p.id)})`;row.appendChild(cnt);
    info.appendChild(row);
    const isExpanded=playerExpanded.has(p.id);
    const ts=getPlayerTerritories(p.id);
    if(ts.length>0&&isExpanded){
      const tl=document.createElement('div');tl.style.cssText='font-size:10px;color:var(--text-muted);margin-top:2px;padding-left:4px';
      tl.textContent=ts.map(t=>t.name||'(名称なし)').join(', ');info.appendChild(tl);}
    card.appendChild(info);
    card.onclick=()=>{
      if(s.ui.selectedPlayerId===p.id){if(playerExpanded.has(p.id))playerExpanded.delete(p.id);else playerExpanded.add(p.id);}
      else{playerExpanded.clear();playerExpanded.add(p.id);}
      setUI({selectedPlayerId:p.id,selectedTerritoryId:null,activeTab:'player'});
      fire('player-selected');renderPlayerList();};
    c.appendChild(card);}
}

/** 指定IDのツリー項目にスクロール */
export function scrollToTerritory(tid){
  requestAnimationFrame(()=>{
    const el=document.querySelector(`.tree-item.selected`);
    if(el)el.scrollIntoView({block:'nearest',behavior:'smooth'});});
}

function fire(n){window.dispatchEvent(new CustomEvent(n));}
