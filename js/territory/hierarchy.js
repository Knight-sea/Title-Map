import { getState } from '../state.js';
import { getColorHex, UNASSIGNED_COLOR } from '../constants.js';

/**
 * Get the display color for a territory at the given view level.
 * If the territory is at or above the view level, use its own color.
 * Otherwise, walk up to find an ancestor at the view level.
 * If no ancestor at that level, use the nearest ancestor above.
 */
export function getDisplayColor(territoryId, viewLevel) {
  const state = getState();
  const territory = state.territories.get(territoryId);
  if (!territory) return UNASSIGNED_COLOR;

  // Find the territory to use for color at this view level
  const display = findDisplayTerritory(territoryId, viewLevel);
  if (!display) return UNASSIGNED_COLOR;
  return getColorHex(display.color.hue, display.color.shade);
}

/**
 * Find which territory should provide the color at a given view level.
 */
export function findDisplayTerritory(territoryId, viewLevel) {
  const state = getState();
  let t = state.territories.get(territoryId);
  if (!t) return null;

  // If territory rank <= viewLevel (same or higher than view), it IS the display
  if (t.rank <= viewLevel) return t;

  // Walk up parents to find one at or above view level
  const visited = new Set();
  let current = t;
  while (current) {
    if (visited.has(current.id)) break;
    visited.add(current.id);
    if (current.rank <= viewLevel) return current;
    if (!current.parentId) break;
    current = state.territories.get(current.parentId);
  }

  // No ancestor at view level: use the highest ancestor (or self)
  return current || t;
}

/**
 * Find the highest rank at which two territory IDs diverge in ancestry.
 * Returns rank index (0=帝国), or -1 if same at all levels.
 */
export function findBorderRank(tid1, tid2, state) {
  if (tid1 === tid2) return -1;

  const chain1 = getAncestryChain(tid1, state);
  const chain2 = getAncestryChain(tid2, state);

  // Compare from top (rank 0) downward
  for (let rank = 0; rank <= 6; rank++) {
    const a1 = chain1.get(rank);
    const a2 = chain2.get(rank);
    if (a1 !== a2) return rank;
  }
  return 6;
}

/**
 * Get ancestry chain: Map<rank, territoryId> for a territory and its ancestors.
 */
function getAncestryChain(tid, state) {
  const chain = new Map();
  if (!tid) return chain;

  const visited = new Set();
  let current = state.territories.get(tid);
  while (current) {
    if (visited.has(current.id)) break;
    visited.add(current.id);
    chain.set(current.rank, current.id);
    if (!current.parentId) break;
    current = state.territories.get(current.parentId);
  }
  return chain;
}

/**
 * Get all children of a territory.
 */
export function getChildren(territoryId, state) {
  const children = [];
  for (const t of state.territories.values()) {
    if (t.parentId === territoryId) children.push(t);
  }
  children.sort((a, b) => (a.order || 0) - (b.order || 0));
  return children;
}

/**
 * Get root territories (no parent).
 */
export function getRoots(state) {
  const roots = [];
  for (const t of state.territories.values()) {
    if (!t.parentId) roots.push(t);
  }
  roots.sort((a, b) => (a.order || 0) - (b.order || 0));
  return roots;
}

/**
 * Check if newParentId is valid for a territory (must be higher rank).
 */
export function isValidParent(territory, newParentId, state) {
  if (!newParentId) return true; // root is always valid
  const parent = state.territories.get(newParentId);
  if (!parent) return false;
  if (parent.rank >= territory.rank) return false;
  // Check not creating a cycle
  const visited = new Set();
  let cur = parent;
  while (cur) {
    if (cur.id === territory.id) return false;
    if (visited.has(cur.id)) break;
    visited.add(cur.id);
    cur = cur.parentId ? state.territories.get(cur.parentId) : null;
  }
  return true;
}

/**
 * Count cells owned by a territory.
 */
export function countCells(territoryId, state) {
  let count = 0;
  for (let y = 0; y < state.mapHeight; y++) {
    for (let x = 0; x < state.mapWidth; x++) {
      if (state.cells[y][x].territoryId === territoryId) count++;
    }
  }
  return count;
}
