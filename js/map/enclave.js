import { getState } from '../state.js';
import { TERRAINS } from '../constants.js';
export function checkEnclaves(changedCells){
  const s=getState(),changes=[],checked=new Set(),seeds=new Set();
  for(const{x,y}of changedCells) for(const[dx,dy]of[[0,-1],[0,1],[-1,0],[1,0]]){
    const nx=x+dx,ny=y+dy;
    if(nx<0||nx>=s.mapWidth||ny<0||ny>=s.mapHeight)continue;
    const c=s.cells[ny][nx];if(!TERRAINS[c.terrain].canOwn&&!c.territoryId)seeds.add(`${nx},${ny}`);
  }
  for(const sk of seeds){
    if(checked.has(sk))continue;
    const[sx,sy]=sk.split(',').map(Number),region=[],queue=[[sx,sy]],visited=new Set([sk]);
    let surr=null,edge=false,mixed=false;
    while(queue.length){
      const[cx,cy]=queue.shift();region.push({x:cx,y:cy});checked.add(`${cx},${cy}`);
      for(const[dx,dy]of[[0,-1],[0,1],[-1,0],[1,0]]){
        const nx=cx+dx,ny=cy+dy,nk=`${nx},${ny}`;
        if(nx<0||nx>=s.mapWidth||ny<0||ny>=s.mapHeight){edge=true;continue;}
        const n=s.cells[ny][nx];
        if(!TERRAINS[n.terrain].canOwn&&!n.territoryId){if(!visited.has(nk)){visited.add(nk);queue.push([nx,ny]);}}
        else if(n.territoryId){if(surr===null)surr=n.territoryId;else if(surr!==n.territoryId)mixed=true;}
        else edge=true;
      }
    }
    if(!edge&&!mixed&&surr)for(const{x,y}of region){changes.push({x,y,prevTerritoryId:s.cells[y][x].territoryId});s.cells[y][x].territoryId=surr;}
  }
  return changes;
}
