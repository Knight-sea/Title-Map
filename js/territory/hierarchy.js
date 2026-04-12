import { getState } from '../state.js';
import { getColorHex, UNASSIGNED_COLOR } from '../constants.js';

export function getDisplayColor(tid,viewLevel){const t=findDisplayTerritory(tid,viewLevel);if(!t)return UNASSIGNED_COLOR;return getColorHex(t.color.hue,t.color.shade);}

export function findDisplayTerritory(tid,viewLevel){
  const s=getState();let t=s.territories.get(tid);if(!t)return null;
  if(t.rank<=viewLevel)return t;
  const v=new Set();let cur=t;
  while(cur){if(v.has(cur.id))break;v.add(cur.id);if(cur.rank<=viewLevel)return cur;if(!cur.parentId)break;cur=s.territories.get(cur.parentId);}
  return cur||t;
}

export function findBorderInfo(tid1,tid2,state,viewLevel){
  if(tid1===tid2)return null;
  const c1=ancestryList(tid1,state),c2=ancestryList(tid2,state);
  let depth=1;const ml=Math.min(c1.length,c2.length);
  for(let i=0;i<ml;i++){if(c1[i]!==c2[i]){depth=i+1;break;}if(i===ml-1)depth=ml+1;}
  if(c1.length!==c2.length&&depth>ml)depth=ml+1;
  const dt1=findDisplayTerritory(tid1,viewLevel),dt2=findDisplayTerritory(tid2,viewLevel);
  const vis=(!dt1&&!dt2)?false:(!dt1||!dt2)?true:dt1.id!==dt2.id;
  return {depth,visible:vis};
}

function ancestryList(tid,state){
  if(!tid)return[];const chain=[],v=new Set();let cur=state.territories.get(tid);
  while(cur){if(v.has(cur.id))break;v.add(cur.id);chain.unshift(cur.id);if(!cur.parentId)break;cur=state.territories.get(cur.parentId);}
  return chain;
}

export function getChildren(tid,state){const r=[];for(const t of state.territories.values())if(t.parentId===tid)r.push(t);r.sort((a,b)=>(a.order||0)-(b.order||0));return r;}
export function getRoots(state){const r=[];for(const t of state.territories.values())if(!t.parentId)r.push(t);r.sort((a,b)=>(a.order||0)-(b.order||0));return r;}
export function isValidParent(t,pid,state){if(!pid)return true;const p=state.territories.get(pid);if(!p||p.rank>=t.rank)return false;const v=new Set();let c=p;while(c){if(c.id===t.id)return false;if(v.has(c.id))break;v.add(c.id);c=c.parentId?state.territories.get(c.parentId):null;}return true;}
export function countCells(tid,state){let c=0;for(let y=0;y<state.mapHeight;y++)for(let x=0;x<state.mapWidth;x++)if(state.cells[y][x].territoryId===tid)c++;return c;}
