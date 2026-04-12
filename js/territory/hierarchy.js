import { getState } from '../state.js';
import { getColorHex, UNASSIGNED_COLOR } from '../constants.js';

export function getDisplayColor(territoryId, viewLevel) {
  const state = getState();
  const t = findDisplayTerritory(territoryId, viewLevel);
  if (!t) return UNASSIGNED_COLOR;
  return getColorHex(t.color.hue, t.color.shade);
}

export function findDisplayTerritory(territoryId, viewLevel) {
  const state = getState();
  let t = state.territories.get(territoryId);
  if (!t) return null;
  if (t.rank <= viewLevel) return t;
  const visited = new Set();
  let cur = t;
  while (cur) {
    if (visited.has(cur.id)) break;
    visited.add(cur.id);
    if (cur.rank <= viewLevel) return cur;
    if (!cur.parentId) break;
    cur = state.territories.get(cur.parentId);
  }
  return cur || t;
}

/**
 * Depth-based border: find the shallowest depth at which two tiles diverge.
 * Depth = number of ancestors from root (root=1, child=2, grandchild=3...).
 * Returns { depth, visible } where visible = true only if the divergence
 * is at or above the current view level's corresponding display territories.
 */
export function findBorderInfo(tid1, tid2, state, viewLevel) {
  if (tid1 === tid2) return null;

  // Get full ancestry chains
  const chain1 = getAncestryList(tid1, state); // [root, ..., self]
  const chain2 = getAncestryList(tid2, state);

  // Find shallowest divergence depth
  let divergeDepth = 1;
  const minLen = Math.min(chain1.length, chain2.length);
  for (let i = 0; i < minLen; i++) {
    if (chain1[i] !== chain2[i]) { divergeDepth = i + 1; break; }
    if (i === minLen - 1) { divergeDepth = minLen + 1; }
  }
  if (chain1.length !== chain2.length && divergeDepth > minLen) {
    divergeDepth = minLen + 1;
  }

  // Determine display territories at current view level
  const dt1 = findDisplayTerritory(tid1, viewLevel);
  const dt2 = findDisplayTerritory(tid2, viewLevel);

  // Border visible only if display territories differ
  const visible = (!dt1 && !dt2) ? false :
                  (!dt1 || !dt2) ? true :
                  dt1.id !== dt2.id;

  return { depth: divergeDepth, visible };
}

/**
 * Get ancestry list from root to self: [rootId, ..., selfId]
 */
function getAncestryList(tid, state) {
  if (!tid) return [];
  const chain = [];
  const visited = new Set();
  let cur = state.territories.get(tid);
  while (cur) {
    if (visited.has(cur.id)) break;
    visited.add(cur.id);
    chain.unshift(cur.id); // prepend
    if (!cur.parentId) break;
    cur = state.territories.get(cur.parentId);
  }
  return chain;
}

export function getChildren(territoryId, state) {
  const children = [];
  for (const t of state.territories.values()) {
    if (t.parentId === territoryId) children.push(t);
  }
  children.sort((a, b) => (a.order || 0) - (b.order || 0));
  return children;
}

export function getRoots(state) {
  const roots = [];
  for (const t of state.territories.values()) {
    if (!t.parentId) roots.push(t);
  }
  roots.sort((a, b) => (a.order || 0) - (b.order || 0));
  return roots;
}

export function isValidParent(territory, newParentId, state) {
  if (!newParentId) return true;
  const parent = state.territories.get(newParentId);
  if (!parent) return false;
  if (parent.rank >= territory.rank) return false;
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

export function countCells(territoryId, state) {
  let c = 0;
  for (let y = 0; y < state.mapHeight; y++)
    for (let x = 0; x < state.mapWidth; x++)
      if (state.cells[y][x].territoryId === territoryId) c++;
  return c;
}
