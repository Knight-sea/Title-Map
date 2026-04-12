import { getState, generateId } from './state.js';
export function createPlayer(name,title,color,memo){const s=getState(),id=generateId();const p={id,name:name||'新しいプレイヤー',title:title||'',color:color||{hue:0,shade:2},memo:memo||''};s.players.set(id,p);return p;}
export function updatePlayer(id,u){const p=getState().players.get(id);if(p)Object.assign(p,u);}
export function deletePlayer(id){const s=getState();for(const t of s.territories.values())if(t.playerId===id)t.playerId=null;s.players.delete(id);}
export function getPlayerTerritories(pid){const r=[];for(const t of getState().territories.values())if(t.playerId===pid)r.push(t);return r;}
export function countPlayerTerritories(pid){return getPlayerTerritories(pid).length;}
