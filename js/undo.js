import { getState } from './state.js';

const MAX_UNDO = 10;
const undoStack = [];

/**
 * Push an undo entry.
 * entry: { type, changes: [{x, y, prevTerrain?, prevTerritoryId?}], territories?, players? }
 */
export function pushUndo(entry) {
  undoStack.push(entry);
  if (undoStack.length > MAX_UNDO) undoStack.shift();
}

export function undo() {
  if (undoStack.length === 0) return false;
  const entry = undoStack.pop();
  const state = getState();

  if (entry.changes) {
    for (const c of entry.changes) {
      const cell = state.cells[c.y][c.x];
      if (c.prevTerrain !== undefined) cell.terrain = c.prevTerrain;
      if (c.prevTerritoryId !== undefined) cell.territoryId = c.prevTerritoryId;
    }
  }

  if (entry.territories) {
    state.territories.clear();
    for (const t of entry.territories) state.territories.set(t.id, t);
  }

  if (entry.players) {
    state.players.clear();
    for (const p of entry.players) state.players.set(p.id, p);
  }

  return true;
}

export function canUndo() { return undoStack.length > 0; }

export function clearUndo() { undoStack.length = 0; }

/** Snapshot territories for undo */
export function snapshotTerritories() {
  const state = getState();
  return Array.from(state.territories.values()).map(t => ({ ...t, color: { ...t.color } }));
}

export function snapshotPlayers() {
  const state = getState();
  return Array.from(state.players.values()).map(p => ({ ...p, color: { ...p.color } }));
}
