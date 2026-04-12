import { getState } from '../state.js';
import { TERRAINS } from '../constants.js';
import { checkEnclaves } from '../map/enclave.js';

/**
 * Handle invasion click. Returns undo entry or null.
 */
export function invasionClick(x, y, button) {
  const state = getState();
  const targetId = state.ui.invasionTargetId;
  if (!targetId) return null;
  if (x < 0 || x >= state.mapWidth || y < 0 || y >= state.mapHeight) return null;

  const cell = state.cells[y][x];
  const terrain = TERRAINS[cell.terrain];

  // Mountain/sea can't be directly clicked
  if (!terrain.canOwn) return null;

  const changes = [];

  if (button === 0) {
    // Left click: add to territory (from unassigned or other territory)
    if (cell.territoryId !== targetId) {
      changes.push({ x, y, prevTerritoryId: cell.territoryId });
      cell.territoryId = targetId;
    }
  } else if (button === 2) {
    // Right click: remove from own territory
    if (cell.territoryId === targetId) {
      changes.push({ x, y, prevTerritoryId: cell.territoryId });
      cell.territoryId = null;
    }
  }

  // Check enclaves after change
  if (changes.length > 0) {
    const enclaveChanges = checkEnclaves(changes);
    changes.push(...enclaveChanges);
  }

  return changes.length > 0 ? changes : null;
}
