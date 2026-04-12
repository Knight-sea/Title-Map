import { getState, generateId } from '../state.js';

/**
 * Create territory from selected cell IDs (after lock) or tile keys (before lock).
 * cellIds: Set of cellId strings
 */
export function createTerritory(name, rank, parentId, color, cellIds) {
  const state = getState();
  const id = generateId();
  const territory = {
    id, name, rank,
    parentId: parentId || null,
    playerId: null,
    color: color || { hue: 0, shade: 2 },
    order: state.territories.size,
  };
  state.territories.set(id, territory);

  // Assign all tiles belonging to these cellIds
  if (state.locked) {
    for (const cellId of cellIds) {
      for (let y = 0; y < state.mapHeight; y++) {
        for (let x = 0; x < state.mapWidth; x++) {
          if (state.cells[y][x].cellId === cellId) {
            state.cells[y][x].territoryId = id;
          }
        }
      }
    }
  } else {
    // Pre-lock: cellIds are "x,y" tile keys
    for (const key of cellIds) {
      const [x, y] = key.split(',').map(Number);
      if (y >= 0 && y < state.mapHeight && x >= 0 && x < state.mapWidth) {
        state.cells[y][x].territoryId = id;
      }
    }
  }
  return territory;
}

export function updateTerritory(id, updates) {
  const state = getState();
  const t = state.territories.get(id);
  if (!t) return;
  Object.assign(t, updates);
}

export function deleteTerritory(id) {
  const state = getState();
  for (let y = 0; y < state.mapHeight; y++) {
    for (let x = 0; x < state.mapWidth; x++) {
      if (state.cells[y][x].territoryId === id) state.cells[y][x].territoryId = null;
    }
  }
  for (const t of state.territories.values()) {
    if (t.parentId === id) t.parentId = null;
  }
  state.territories.delete(id);
}
