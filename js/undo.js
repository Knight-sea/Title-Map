import { getState } from './state.js';
const MAX=10, stack=[];
export function pushUndo(e){stack.push(e);if(stack.length>MAX)stack.shift();}
export function undo(){if(!stack.length)return false;const e=stack.pop(),s=getState();
  if(e.changes)for(const c of e.changes){const cell=s.cells[c.y][c.x];if(c.prevTerrain!==undefined)cell.terrain=c.prevTerrain;if(c.prevTerritoryId!==undefined)cell.territoryId=c.prevTerritoryId;}
  if(e.territories){s.territories.clear();for(const t of e.territories)s.territories.set(t.id,t);}
  if(e.players){s.players.clear();for(const p of e.players)s.players.set(p.id,p);}
  return true;}
export function canUndo(){return stack.length>0;}
export function clearUndo(){stack.length=0;}
export function snapshotTerritories(){return Array.from(getState().territories.values()).map(t=>({...t,color:{...t.color}}));}
export function snapshotPlayers(){return Array.from(getState().players.values()).map(p=>({...p,color:{...p.color}}));}
