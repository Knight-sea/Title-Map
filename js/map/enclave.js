import { getState } from '../state.js';
import { TERRAINS } from '../constants.js';

/**
 * After territory changes, check if any mountain/sea cells are fully
 * enclosed by a single territory. If so, assign them to that territory.
 * Returns array of changes for undo.
 */
export function checkEnclaves(changedCells) {
  const state = getState();
  const changes = [];
  const checked = new Set();

  // Collect mountain/sea neighbors of changed cells
  const seeds = new Set();
  for (const { x, y } of changedCells) {
    for (const [dx, dy] of [[0,-1],[0,1],[-1,0],[1,0]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= state.mapWidth || ny < 0 || ny >= state.mapHeight) continue;
      const cell = state.cells[ny][nx];
      if (!TERRAINS[cell.terrain].canOwn && !cell.territoryId) {
        seeds.add(`${nx},${ny}`);
      }
    }
  }

  for (const seedKey of seeds) {
    if (checked.has(seedKey)) continue;

    const [sx, sy] = seedKey.split(',').map(Number);
    // Flood fill to find connected mountain/sea region
    const region = [];
    const queue = [[sx, sy]];
    const visited = new Set();
    visited.add(seedKey);
    let surroundingTerritory = null;
    let touchesEdge = false;
    let mixedTerritories = false;

    while (queue.length > 0) {
      const [cx, cy] = queue.shift();
      const cell = state.cells[cy][cx];
      region.push({ x: cx, y: cy });
      checked.add(`${cx},${cy}`);

      for (const [dx, dy] of [[0,-1],[0,1],[-1,0],[1,0]]) {
        const nx = cx + dx;
        const ny = cy + dy;
        const nk = `${nx},${ny}`;

        if (nx < 0 || nx >= state.mapWidth || ny < 0 || ny >= state.mapHeight) {
          touchesEdge = true;
          continue;
        }

        const neighbor = state.cells[ny][nx];

        if (!TERRAINS[neighbor.terrain].canOwn && !neighbor.territoryId) {
          // Same type, continue flood
          if (!visited.has(nk)) {
            visited.add(nk);
            queue.push([nx, ny]);
          }
        } else if (neighbor.territoryId) {
          // Owned cell - track which territory
          if (surroundingTerritory === null) {
            surroundingTerritory = neighbor.territoryId;
          } else if (surroundingTerritory !== neighbor.territoryId) {
            mixedTerritories = true;
          }
        } else {
          // Unowned non-mountain/sea - counts as edge
          touchesEdge = true;
        }
      }
    }

    // Only absorb if fully surrounded by one territory and not touching edge
    if (!touchesEdge && !mixedTerritories && surroundingTerritory) {
      for (const { x, y } of region) {
        changes.push({ x, y, prevTerritoryId: state.cells[y][x].territoryId });
        state.cells[y][x].territoryId = surroundingTerritory;
      }
    }
  }

  return changes;
}
