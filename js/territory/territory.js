import { getState, generateId } from '../state.js';
export function createTerritory(name,rank,parentId,color,cellIds){
  const s=getState(),id=generateId();
  const t={id,name,rank,parentId:parentId||null,playerId:null,color:color||{hue:0,shade:2},order:s.territories.size};
  s.territories.set(id,t);
  // cellIds are cell region IDs (locked mode only)
  for(const cid of cellIds)
    for(let y=0;y<s.mapHeight;y++) for(let x=0;x<s.mapWidth;x++)
      if(s.cells[y][x].cellId===cid) s.cells[y][x].territoryId=id;
  return t;
}
export function updateTerritory(id,u){const t=getState().territories.get(id);if(t)Object.assign(t,u);}
export function deleteTerritory(id){const s=getState();for(let y=0;y<s.mapHeight;y++)for(let x=0;x<s.mapWidth;x++)if(s.cells[y][x].territoryId===id)s.cells[y][x].territoryId=null;for(const t of s.territories.values())if(t.parentId===id)t.parentId=null;s.territories.delete(id);}
