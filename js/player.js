import { getState, generateId } from './state.js';

export function createPlayer(name, title, color, memo) {
  const state = getState();
  const id = generateId();
  const player = {
    id,
    name: name || '新しいプレイヤー',
    title: title || '',
    color: color || { hue: 0, shade: 2 },
    memo: memo || '',
  };
  state.players.set(id, player);
  return player;
}

export function updatePlayer(id, updates) {
  const state = getState();
  const p = state.players.get(id);
  if (!p) return;
  Object.assign(p, updates);
}

export function deletePlayer(id) {
  const state = getState();
  // Remove player assignment from territories
  for (const t of state.territories.values()) {
    if (t.playerId === id) t.playerId = null;
  }
  state.players.delete(id);
}

export function getPlayerTerritories(playerId) {
  const state = getState();
  const result = [];
  for (const t of state.territories.values()) {
    if (t.playerId === playerId) result.push(t);
  }
  return result;
}

export function countPlayerTerritories(playerId) {
  return getPlayerTerritories(playerId).length;
}
