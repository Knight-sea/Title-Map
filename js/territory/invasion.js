import { getState } from '../state.js';
import { TERRAINS } from '../constants.js';
import { checkEnclaves } from '../map/enclave.js';

/**
 * Handle invasion click. Works with cells after lock.
 */
export function invasionClick(x, y, button) {
  const state = getState();
  const targetId = state.ui.invasionTargetId;
  if (!targetId) return null;
  if (x < 0 || x >= state.mapWidth || y < 0 || y >= state.mapHeight) return null;

  const cell = state.cells[y][x];
  const terrain = TERRAINS[cell.terrain];
  if (!terrain.canOwn && !cell.cellId) return null;

  const changes = [];

  if (state.locked && cell.cellId) {
    // Cell-based: affect all tiles of this cell
    const cellId = cell.cellId;
    const firstTile = cell;

    if (button === 0 && firstTile.territoryId !== targetId) {
      // Add entire cell
      for (let cy = 0; cy < state.mapHeight; cy++) {
        for (let cx = 0; cx < state.mapWidth; cx++) {
          if (state.cells[cy][cx].cellId === cellId && state.cells[cy][cx].territoryId !== targetId) {
            changes.push({ x: cx, y: cy, prevTerritoryId: state.cells[cy][cx].territoryId });
            state.cells[cy][cx].territoryId = targetId;
          }
        }
      }
    } else if (button === 2 && firstTile.territoryId === targetId) {
      // Remove entire cell
      for (let cy = 0; cy < state.mapHeight; cy++) {
        for (let cx = 0; cx < state.mapWidth; cx++) {
          if (state.cells[cy][cx].cellId === cellId && state.cells[cy][cx].territoryId === targetId) {
            changes.push({ x: cx, y: cy, prevTerritoryId: targetId });
            state.cells[cy][cx].territoryId = null;
          }
        }
      }
    }
  } else {
    // Tile-based (pre-lock)
    if (!terrain.canOwn) return null;
    if (button === 0 && cell.territoryId !== targetId) {
      changes.push({ x, y, prevTerritoryId: cell.territoryId });
      cell.territoryId = targetId;
    } else if (button === 2 && cell.territoryId === targetId) {
      changes.push({ x, y, prevTerritoryId: targetId });
      cell.territoryId = null;
    }
  }

  if (changes.length > 0) {
    const enc = checkEnclaves(changes);
    changes.push(...enc);
  }
  return changes.length > 0 ? changes : null;
}
