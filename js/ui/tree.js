import { getState, setUI } from '../state.js';
import { RANKS, getColorHex } from '../constants.js';
import { getRoots, getChildren, countCells, isValidParent } from '../territory/hierarchy.js';
import { updateTerritory } from '../territory/territory.js';
import { countPlayerTerritories, getPlayerTerritories } from '../player.js';

const collapsedNodes = new Set();

export function renderTree() {
  const state = getState();
  const container = document.getElementById('territory-tree');
  container.innerHTML = '';

  const roots = getRoots(state);
  // Also show territories not in any hierarchy (orphans without parent)
  const ul = document.createElement('ul');
  for (const t of roots) {
    ul.appendChild(buildTreeNode(t, state));
  }
  container.appendChild(ul);
}

function buildTreeNode(territory, state) {
  const li = document.createElement('li');
  const item = document.createElement('div');
  item.className = 'tree-item';
  if (state.ui.selectedTerritoryId === territory.id) item.classList.add('selected');

  // Toggle
  const children = getChildren(territory.id, state);
  const toggle = document.createElement('span');
  toggle.className = 'tree-toggle';
  if (children.length > 0) {
    toggle.textContent = collapsedNodes.has(territory.id) ? '▶' : '▼';
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      if (collapsedNodes.has(territory.id)) collapsedNodes.delete(territory.id);
      else collapsedNodes.add(territory.id);
      renderTree();
    });
  } else {
    toggle.textContent = '·';
  }
  item.appendChild(toggle);

  // Color dot
  const dot = document.createElement('span');
  dot.className = 'color-dot';
  dot.style.background = getColorHex(territory.color.hue, territory.color.shade);
  item.appendChild(dot);

  // Name
  const name = document.createElement('span');
  name.textContent = territory.name || '(名称なし)';
  name.style.flex = '1';
  name.style.overflow = 'hidden';
  name.style.textOverflow = 'ellipsis';
  name.style.whiteSpace = 'nowrap';
  item.appendChild(name);

  // Rank badge
  const badge = document.createElement('span');
  badge.className = 'rank-badge';
  badge.textContent = RANKS[territory.rank].name;
  item.appendChild(badge);

  // Click to select
  item.addEventListener('click', () => {
    setUI({ selectedTerritoryId: territory.id, selectedPlayerId: null, activeTab: 'territory' });
    window.dispatchEvent(new CustomEvent('territory-selected', { detail: territory.id }));
    renderTree();
  });

  // Drag & Drop
  item.draggable = true;
  item.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', territory.id);
    e.dataTransfer.effectAllowed = 'move';
  });
  item.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    item.style.background = 'var(--bg-hover)';
  });
  item.addEventListener('dragleave', () => {
    item.style.background = '';
  });
  item.addEventListener('drop', (e) => {
    e.preventDefault();
    item.style.background = '';
    const draggedId = e.dataTransfer.getData('text/plain');
    if (draggedId === territory.id) return;
    const dragged = state.territories.get(draggedId);
    if (!dragged) return;
    if (isValidParent(dragged, territory.id, state)) {
      updateTerritory(draggedId, { parentId: territory.id });
      renderTree();
      window.dispatchEvent(new CustomEvent('state-changed'));
    }
  });

  li.appendChild(item);

  // Children
  if (children.length > 0 && !collapsedNodes.has(territory.id)) {
    const childUl = document.createElement('ul');
    for (const child of children) {
      childUl.appendChild(buildTreeNode(child, state));
    }
    li.appendChild(childUl);
  }

  return li;
}

// Also allow drop on tree container to make root
export function initTreeDrop() {
  const container = document.getElementById('territory-tree');
  container.addEventListener('dragover', (e) => { e.preventDefault(); });
  container.addEventListener('drop', (e) => {
    if (e.target !== container && e.target !== container.querySelector('ul')) return;
    e.preventDefault();
    const draggedId = e.dataTransfer.getData('text/plain');
    const state = getState();
    const dragged = state.territories.get(draggedId);
    if (dragged) {
      updateTerritory(draggedId, { parentId: null });
      renderTree();
      window.dispatchEvent(new CustomEvent('state-changed'));
    }
  });
}

export function renderPlayerList() {
  const state = getState();
  const container = document.getElementById('player-list');
  container.innerHTML = '';

  for (const player of state.players.values()) {
    const card = document.createElement('div');
    card.className = 'player-card';
    if (state.ui.selectedPlayerId === player.id) card.classList.add('selected');

    const avatar = document.createElement('div');
    avatar.className = 'player-avatar';
    avatar.style.background = getColorHex(player.color.hue, player.color.shade);
    avatar.textContent = (player.name || '?')[0];
    card.appendChild(avatar);

    const info = document.createElement('div');
    info.className = 'player-info';
    const nameEl = document.createElement('div');
    nameEl.className = 'player-name';
    nameEl.textContent = player.name;
    info.appendChild(nameEl);
    const countEl = document.createElement('div');
    countEl.className = 'player-count';
    const tCount = countPlayerTerritories(player.id);
    countEl.textContent = `${tCount} 領地`;
    info.appendChild(countEl);

    // Show territory names
    const territories = getPlayerTerritories(player.id);
    if (territories.length > 0) {
      const tList = document.createElement('div');
      tList.style.fontSize = '10px';
      tList.style.color = 'var(--text-muted)';
      tList.style.marginTop = '2px';
      tList.textContent = territories.map(t => t.name || '(名称なし)').join(', ');
      info.appendChild(tList);
    }

    card.appendChild(info);

    card.addEventListener('click', () => {
      setUI({ selectedPlayerId: player.id, selectedTerritoryId: null, activeTab: 'player' });
      window.dispatchEvent(new CustomEvent('player-selected', { detail: player.id }));
      renderPlayerList();
    });

    container.appendChild(card);
  }
}
