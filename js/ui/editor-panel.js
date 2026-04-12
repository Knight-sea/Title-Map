import { getState, setUI } from '../state.js';
import { RANKS, getColorHex } from '../constants.js';
import { updateTerritory, deleteTerritory } from '../territory/territory.js';
import { updatePlayer, deletePlayer } from '../player.js';
import { countCells, isValidParent } from '../territory/hierarchy.js';
import { openColorPicker } from './color-picker.js';
import { pushUndo, snapshotTerritories, snapshotPlayers } from '../undo.js';
import { renderTree, renderPlayerList } from './tree.js';

const editorContent = () => document.getElementById('editor-content');

export function renderEditor() {
  const state = getState();
  const container = editorContent();

  if (state.ui.activeTab === 'territory' && state.ui.selectedTerritoryId) {
    renderTerritoryEditor(state.ui.selectedTerritoryId, container, state);
  } else if (state.ui.activeTab === 'player' && state.ui.selectedPlayerId) {
    renderPlayerEditor(state.ui.selectedPlayerId, container, state);
  } else {
    container.innerHTML = '<p class="editor-placeholder">領地またはプレイヤーを選択してください</p>';
  }
}

function renderTerritoryEditor(tid, container, state) {
  const t = state.territories.get(tid);
  if (!t) {
    container.innerHTML = '<p class="editor-placeholder">領地が見つかりません</p>';
    return;
  }

  const cells = countCells(tid, state);
  const colorHex = getColorHex(t.color.hue, t.color.shade);

  // Build parent options
  let parentOptions = '<option value="">なし (ルート)</option>';
  for (const pt of state.territories.values()) {
    if (pt.id === tid) continue;
    if (pt.rank >= t.rank) continue; // parent must be higher rank
    const sel = pt.id === t.parentId ? 'selected' : '';
    parentOptions += `<option value="${pt.id}" ${sel}>${pt.name || '(名称なし)'} [${RANKS[pt.rank].name}]</option>`;
  }

  // Build rank options (if has parent, only ranks below parent)
  const parent = t.parentId ? state.territories.get(t.parentId) : null;
  const minRank = parent ? parent.rank + 1 : 0;
  let rankOptions = '';
  for (let i = minRank; i <= 6; i++) {
    const sel = i === t.rank ? 'selected' : '';
    rankOptions += `<option value="${i}" ${sel}>${RANKS[i].name}</option>`;
  }

  // Build player options
  let playerOptions = '<option value="">未割当</option>';
  for (const p of state.players.values()) {
    const sel = p.id === t.playerId ? 'selected' : '';
    playerOptions += `<option value="${p.id}" ${sel}>${p.name}</option>`;
  }

  container.innerHTML = `
    <div class="form-group">
      <label>名前</label>
      <input type="text" id="ed-name" value="${escHtml(t.name || '')}">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>爵位</label>
        <select id="ed-rank">${rankOptions}</select>
      </div>
      <div class="form-group">
        <label>色</label>
        <div class="color-picker-trigger" id="ed-color" style="background:${colorHex}"></div>
      </div>
    </div>
    <div class="form-group">
      <label>親領地</label>
      <select id="ed-parent">${parentOptions}</select>
    </div>
    <div class="form-group">
      <label>プレイヤー</label>
      <select id="ed-player">${playerOptions}</select>
    </div>
    <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">
      マス数: ${cells}
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      <button class="btn btn-small btn-primary" id="ed-invade">領土を増やす</button>
      <button class="btn btn-small btn-danger" id="ed-delete">削除</button>
    </div>
  `;

  // Bind events
  const nameEl = container.querySelector('#ed-name');
  nameEl.addEventListener('change', () => {
    pushUndo({ territories: snapshotTerritories() });
    updateTerritory(tid, { name: nameEl.value });
    renderTree();
    window.dispatchEvent(new CustomEvent('state-changed'));
  });

  container.querySelector('#ed-rank').addEventListener('change', (e) => {
    pushUndo({ territories: snapshotTerritories() });
    updateTerritory(tid, { rank: parseInt(e.target.value) });
    renderTree();
    renderEditor();
    window.dispatchEvent(new CustomEvent('state-changed'));
  });

  container.querySelector('#ed-parent').addEventListener('change', (e) => {
    const newParent = e.target.value || null;
    const terr = state.territories.get(tid);
    if (newParent && !isValidParent(terr, newParent, state)) return;
    pushUndo({ territories: snapshotTerritories() });
    updateTerritory(tid, { parentId: newParent });
    renderTree();
    renderEditor();
    window.dispatchEvent(new CustomEvent('state-changed'));
  });

  container.querySelector('#ed-player').addEventListener('change', (e) => {
    pushUndo({ territories: snapshotTerritories() });
    updateTerritory(tid, { playerId: e.target.value || null });
    renderPlayerList();
    window.dispatchEvent(new CustomEvent('state-changed'));
  });

  container.querySelector('#ed-color').addEventListener('click', async () => {
    const result = await openColorPicker(t.color);
    if (result) {
      pushUndo({ territories: snapshotTerritories() });
      updateTerritory(tid, { color: result });
      renderTree();
      renderEditor();
      window.dispatchEvent(new CustomEvent('state-changed'));
    }
  });

  container.querySelector('#ed-invade').addEventListener('click', () => {
    setUI({ mode: 'invasion', invasionTargetId: tid });
    window.dispatchEvent(new CustomEvent('mode-changed'));
  });

  container.querySelector('#ed-delete').addEventListener('click', () => {
    if (!confirm(`「${t.name || '(名称なし)'}」を削除しますか？`)) return;
    pushUndo({ territories: snapshotTerritories(), changes: getAllCellsForTerritory(tid, state) });
    deleteTerritory(tid);
    setUI({ selectedTerritoryId: null });
    renderTree();
    renderEditor();
    window.dispatchEvent(new CustomEvent('state-changed'));
  });
}

function renderPlayerEditor(pid, container, state) {
  const p = state.players.get(pid);
  if (!p) {
    container.innerHTML = '<p class="editor-placeholder">プレイヤーが見つかりません</p>';
    return;
  }

  const colorHex = getColorHex(p.color.hue, p.color.shade);

  container.innerHTML = `
    <div class="form-group">
      <label>名前</label>
      <input type="text" id="ed-pname" value="${escHtml(p.name || '')}">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>肩書き</label>
        <input type="text" id="ed-ptitle" value="${escHtml(p.title || '')}">
      </div>
      <div class="form-group">
        <label>イメージ色</label>
        <div class="color-picker-trigger" id="ed-pcolor" style="background:${colorHex}"></div>
      </div>
    </div>
    <div class="form-group">
      <label>メモ</label>
      <textarea id="ed-pmemo">${escHtml(p.memo || '')}</textarea>
    </div>
    <div style="display:flex;gap:6px">
      <button class="btn btn-small btn-danger" id="ed-pdelete">削除</button>
    </div>
  `;

  container.querySelector('#ed-pname').addEventListener('change', (e) => {
    pushUndo({ players: snapshotPlayers() });
    updatePlayer(pid, { name: e.target.value });
    renderPlayerList();
  });
  container.querySelector('#ed-ptitle').addEventListener('change', (e) => {
    updatePlayer(pid, { title: e.target.value });
  });
  container.querySelector('#ed-pmemo').addEventListener('change', (e) => {
    updatePlayer(pid, { memo: e.target.value });
  });
  container.querySelector('#ed-pcolor').addEventListener('click', async () => {
    const result = await openColorPicker(p.color);
    if (result) {
      pushUndo({ players: snapshotPlayers() });
      updatePlayer(pid, { color: result });
      renderPlayerList();
      renderEditor();
    }
  });
  container.querySelector('#ed-pdelete').addEventListener('click', () => {
    if (!confirm(`「${p.name}」を削除しますか？`)) return;
    pushUndo({ players: snapshotPlayers(), territories: snapshotTerritories() });
    deletePlayer(pid);
    setUI({ selectedPlayerId: null });
    renderPlayerList();
    renderEditor();
    window.dispatchEvent(new CustomEvent('state-changed'));
  });
}

function getAllCellsForTerritory(tid, state) {
  const changes = [];
  for (let y = 0; y < state.mapHeight; y++) {
    for (let x = 0; x < state.mapWidth; x++) {
      if (state.cells[y][x].territoryId === tid) {
        changes.push({ x, y, prevTerritoryId: tid });
      }
    }
  }
  return changes;
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
