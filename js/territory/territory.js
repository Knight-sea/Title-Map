import { getState, generateId } from '../state.js';

export function createTerritory(name, rank, parentId, color, cells) {
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

  // Assign cells
  for (const key of cells) {
    const [x, y] = key.split(',').map(Number);
    if (y >= 0 && y < state.mapHeight && x >= 0 && x < state.mapWidth) {
      state.cells[y][x].territoryId = id;
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
  // Remove cell assignments
  for (let y = 0; y < state.mapHeight; y++) {
    for (let x = 0; x < state.mapWidth; x++) {
      if (state.cells[y][x].territoryId === id) {
        state.cells[y][x].territoryId = null;
      }
    }
  }
  // Re-parent children to null
  for (const t of state.territories.values()) {
    if (t.parentId === id) t.parentId = null;
  }
  state.territories.delete(id);
}

export function addCellToTerritory(territoryId, x, y) {
  const state = getState();
  if (x < 0 || x >= state.mapWidth || y < 0 || y >= state.mapHeight) return;
  state.cells[y][x].territoryId = territoryId;
}

export function removeCellFromTerritory(territoryId, x, y) {
  const state = getState();
  if (x < 0 || x >= state.mapWidth || y < 0 || y >= state.mapHeight) return;
  if (state.cells[y][x].territoryId === territoryId) {
    state.cells[y][x].territoryId = null;
  }
}
