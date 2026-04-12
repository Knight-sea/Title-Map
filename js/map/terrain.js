import { getState } from '../state.js';
import { TERRAINS } from '../constants.js';

/**
 * Paint terrain at cell (cx, cy) with given brush size.
 * Returns array of changed cells [{x, y, prevTerrain}] for undo.
 */
export function paintTerrain(cx, cy, terrainType, brushSize) {
  const state = getState();
  const changes = [];
  const radius = Math.floor(brushSize / 2);

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || x >= state.mapWidth || y < 0 || y >= state.mapHeight) continue;
      const cell = state.cells[y][x];
      if (cell.terrain !== terrainType) {
        changes.push({ x, y, prevTerrain: cell.terrain, prevTerritoryId: cell.territoryId });
        cell.terrain = terrainType;
        // If painting mountain/sea, and cell was owned, might need to remove ownership
        if (!TERRAINS[terrainType].canOwn && cell.territoryId) {
          cell.territoryId = null;
        }
      }
    }
  }
  return changes;
}
