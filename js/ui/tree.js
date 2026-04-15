import{getState,setUI}from'../state.js';
import{RANKS,getColorHex}from'../constants.js';
import{getRoots,getChildren,isValidParent,reorderSiblings,reorderSiblingsAppend}from'../territory/hierarchy.js';
import{updateTerritory}from'../territory/territory.js';
import{countPlayerTerritories,getPlayerTerritories}from'../player.js';

const collapsed=new Set();
const playerExpanded=new Set();

export function renderTree(){
  const s=getState(),c=document.getElementById('territory-tree');
  c.innerHTML='';
  const roots=getRoots(s),ul=document.createElement('ul');
  for(const t of roots)ul.appendChild(buildNode(t,s));
  c.appendChild(ul);

  // ルートリスト末尾へのドロップ
  c.ondragover=e=>e.preventDefault();
  c.ondrop=e=>{
    if(e.target!==c&&!isDirectChildOf(e.target,c))return;
    e.preventDefault();
    const did=e.dataTransfer.getData('text/plain');
    const d=getState().territories.get(did);
    if(!d)return;
    if((d.parentId??null)===null)reorderSiblingsAppend(did,getState());
    else updateTerritory(did,{parentId:null});
    renderTree();fire('state-changed');};
}

function isDirectChildOf(el,parent){
  return el.parentElement===parent||el.parentElement?.parentElement===parent;
}

function buildNode(t,s){
  const li=document.createElement('li');li.style.position='relative';

  // ────────────────────────────
  //  前挿入バー（アイテムの上）
  // ────────────────────────────
  const bar=document.createElement('div');
  bar.className='tree-drop-bar';
  bar.dataset.tid=t.id;

  bar.addEventListener('dragover',e=>{
    e.preventDefault();e.stopPropagation();
    bar.classList.add('active');
  });
  bar.addEventListener('dragleave',()=>bar.classList.remove('active'));
  bar.addEventListener('drop',e=>{
    e.preventDefault();e.stopPropagation();
    bar.classList.remove('active');
    const did=e.dataTransfer.getData('text/plain');
    if(!did||did===t.id)return;
    const d=s.territories.get(did);if(!d)return;
    // 同一親なら並べ替え、違う親なら親変更＋位置設定
    if((d.parentId??null)===(t.parentId??null)){
      reorderSiblings(did,t.id,s);
    } else {
      updateTerritory(did,{parentId:t.parentId??null});
      reorderSiblings(did,t.id,getState());
    }
    renderTree();fire('state-changed');
  });

  // ────────────────────────────
  //  アイテム本体
  // ────────────────────────────
  const item=document.createElement('div');
  item.className='tree-item';
  if(s.ui.selectedTerritoryId===t.id)item.classList.add('selected');

  const children=getChildren(t.id,s);
  const tog=document.createElement('span');tog.className='tree-toggle';
  if(children.length){
    tog.textContent=collapsed.has(t.id)?'▶':'▼';
    tog.onclick=e=>{e.stopPropagation();collapsed.has(t.id)?collapsed.delete(t.id):collapsed.add(t.id);renderTree();};
  } else tog.textContent='·';
  item.appendChild(tog);

  const dot=document.createElement('span');dot.className='color-dot';dot.style.background=getColorHex(t.color.hue,t.color.shade);item.appendChild(dot);
  const nm=document.createElement('span');nm.textContent=t.name||'(名称なし)';nm.style.cssText='flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';item.appendChild(nm);
  const badge=document.createElement('span');badge.className='rank-badge';badge.textContent=RANKS[t.rank].name;item.appendChild(badge);

  item.onclick=()=>{
    setUI({selectedTerritoryId:t.id,selectedPlayerId:null,activeTab:'territory'});
    fire('territory-selected');renderTree();};

  // ドラッグ開始
  item.draggable=true;
  item.ondragstart=e=>{
    e.dataTransfer.setData('text/plain',t.id);
    e.dataTransfer.effectAllowed='move';
    e.stopPropagation();
    setTimeout(()=>item.classList.add('dragging'),0);
  };
  item.ondragend=()=>item.classList.remove('dragging');

  // アイテム本体へのドロップ → 「子にする」
  item.ondragover=e=>{e.preventDefault();e.stopPropagation();item.classList.add('drop-target');};
  item.ondragleave=()=>item.classList.remove('drop-target');
  item.ondrop=e=>{
    e.preventDefault();e.stopPropagation();item.classList.remove('drop-target');
    const did=e.dataTransfer.getData('text/plain');
    if(!did||did===t.id)return;
    const d=s.territories.get(did);
    if(d&&isValidParent(d,t.id,s)){updateTerritory(did,{parentId:t.id});renderTree();fire('state-changed');}
  };

  li.appendChild(bar);
  li.appendChild(item);

  if(children.length&&!collapsed.has(t.id)){
    const ul=document.createElement('ul');
    for(const ch of children)ul.appendChild(buildNode(ch,s));
    li.appendChild(ul);
  }
  return li;
}

export function initTreeDrop(){/* renderTree内で処理 */}

export function renderPlayerList(){
  const s=getState(),c=document.getElementById('player-list');c.innerHTML='';
  for(const p of s.players.values()){
    const card=document.createElement('div');card.className='player-card';
    if(s.ui.selectedPlayerId===p.id)card.classList.add('selected');
    const av=document.createElement('div');av.className='player-avatar';
    av.style.background=getColorHex(p.color.hue,p.color.shade);
    av.textContent=(p.name||'?')[0];card.appendChild(av);
    const info=document.createElement('div');info.className='player-info';
    const row=document.createElement('div');row.style.cssText='display:flex;align-items:center;gap:4px';
    const nm=document.createElement('span');nm.className='player-name';nm.textContent=p.name;row.appendChild(nm);
    const cnt=document.createElement('span');cnt.className='player-count';cnt.textContent=`(${countPlayerTerritories(p.id)})`;row.appendChild(cnt);
    info.appendChild(row);
    if(playerExpanded.has(p.id)){
      const ts=getPlayerTerritories(p.id);
      if(ts.length>0){
        const tl=document.createElement('div');tl.style.cssText='font-size:10px;color:var(--text-muted);margin-top:2px;padding-left:4px';
        tl.textContent=ts.map(t=>t.name||'(名称なし)').join(', ');info.appendChild(tl);}}
    card.appendChild(info);
    card.onclick=()=>{
      if(s.ui.selectedPlayerId===p.id){if(playerExpanded.has(p.id))playerExpanded.delete(p.id);else playerExpanded.add(p.id);}
      else{playerExpanded.clear();playerExpanded.add(p.id);}
      setUI({selectedPlayerId:p.id,selectedTerritoryId:null,activeTab:'player'});
      fire('player-selected');renderPlayerList();};
    c.appendChild(card);}
}

export function scrollToTerritory(){
  requestAnimationFrame(()=>{
    const el=document.querySelector('.tree-item.selected');
    if(el)el.scrollIntoView({block:'nearest',behavior:'smooth'});});
}

function fire(n){window.dispatchEvent(new CustomEvent(n));}
