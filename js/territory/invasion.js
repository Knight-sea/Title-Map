import { getState } from '../state.js';
import { TERRAINS } from '../constants.js';
import { checkEnclaves } from '../map/enclave.js';
export function invasionClick(x,y,button){
  const s=getState(),tid=s.ui.invasionTargetId;
  if(!tid||x<0||x>=s.mapWidth||y<0||y>=s.mapHeight)return null;
  const cell=s.cells[y][x],changes=[];
  if(s.locked&&cell.cellId){
    const cid=cell.cellId;
    if(button===0&&cell.territoryId!==tid){
      for(let cy=0;cy<s.mapHeight;cy++)for(let cx=0;cx<s.mapWidth;cx++)
        if(s.cells[cy][cx].cellId===cid&&s.cells[cy][cx].territoryId!==tid){changes.push({x:cx,y:cy,prevTerritoryId:s.cells[cy][cx].territoryId});s.cells[cy][cx].territoryId=tid;}
    }else if(button===2&&cell.territoryId===tid){
      for(let cy=0;cy<s.mapHeight;cy++)for(let cx=0;cx<s.mapWidth;cx++)
        if(s.cells[cy][cx].cellId===cid&&s.cells[cy][cx].territoryId===tid){changes.push({x:cx,y:cy,prevTerritoryId:tid});s.cells[cy][cx].territoryId=null;}
    }
  }
  if(changes.length){const enc=checkEnclaves(changes);changes.push(...enc);}
  return changes.length?changes:null;
}
