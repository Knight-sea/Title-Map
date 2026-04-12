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
  const c = editorContent();
  if (state.ui.activeTab === 'territory' && state.ui.selectedTerritoryId) {
    renderTerritoryEditor(state.ui.selectedTerritoryId, c, state);
  } else if (state.ui.activeTab === 'player' && state.ui.selectedPlayerId) {
    renderPlayerEditor(state.ui.selectedPlayerId, c, state);
  } else {
    c.innerHTML = '<p class="editor-placeholder">領地またはプレイヤーを選択</p>';
  }
}

function renderTerritoryEditor(tid, c, state) {
  const t = state.territories.get(tid);
  if (!t) { c.innerHTML = '<p class="editor-placeholder">見つかりません</p>'; return; }
  const cells = countCells(tid, state);
  const colorHex = getColorHex(t.color.hue, t.color.shade);
  const parent = t.parentId ? state.territories.get(t.parentId) : null;
  const minRank = parent ? parent.rank + 1 : 0;

  let parentOpts = '<option value="">なし</option>';
  for (const pt of state.territories.values()) {
    if (pt.id === tid || pt.rank >= t.rank) continue;
    parentOpts += `<option value="${pt.id}" ${pt.id === t.parentId ? 'selected' : ''}>${esc(pt.name || '(名称なし)')} [${RANKS[pt.rank].name}]</option>`;
  }
  let rankOpts = '';
  for (let i = minRank; i <= 6; i++) rankOpts += `<option value="${i}" ${i === t.rank ? 'selected' : ''}>${RANKS[i].name}</option>`;
  let playerOpts = '<option value="">未割当</option>';
  for (const p of state.players.values()) playerOpts += `<option value="${p.id}" ${p.id === t.playerId ? 'selected' : ''}>${esc(p.name)}</option>`;

  c.innerHTML = `
    <div class="form-group"><label>名前</label><input type="text" id="ed-name" value="${esc(t.name || '')}"></div>
    <div class="form-row">
      <div class="form-group"><label>爵位</label><select id="ed-rank">${rankOpts}</select></div>
      <div class="form-group"><label>色</label><div class="color-picker-trigger" id="ed-color" style="background:${colorHex}"></div></div>
    </div>
    <div class="form-group"><label>親領地</label><select id="ed-parent">${parentOpts}</select></div>
    <div class="form-group"><label>プレイヤー</label><select id="ed-player">${playerOpts}</select></div>
    <div style="font-size:10px;color:var(--text-muted);margin-bottom:6px">マス数: ${cells}</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      <button class="btn btn-small btn-primary" id="ed-invade">領土を増やす</button>
      <button class="btn btn-small btn-danger" id="ed-delete">削除</button>
    </div>`;

  c.querySelector('#ed-name').addEventListener('change', (e) => {
    pushUndo({ territories: snapshotTerritories() });
    updateTerritory(tid, { name: e.target.value }); renderTree(); fire('state-changed');
  });
  c.querySelector('#ed-rank').addEventListener('change', (e) => {
    pushUndo({ territories: snapshotTerritories() });
    updateTerritory(tid, { rank: +e.target.value }); renderTree(); renderEditor(); fire('state-changed');
  });
  c.querySelector('#ed-parent').addEventListener('change', (e) => {
    const np = e.target.value || null;
    if (np && !isValidParent(state.territories.get(tid), np, state)) return;
    pushUndo({ territories: snapshotTerritories() });
    updateTerritory(tid, { parentId: np }); renderTree(); renderEditor(); fire('state-changed');
  });
  c.querySelector('#ed-player').addEventListener('change', (e) => {
    pushUndo({ territories: snapshotTerritories() });
    updateTerritory(tid, { playerId: e.target.value || null }); renderPlayerList(); fire('state-changed');
  });
  c.querySelector('#ed-color').addEventListener('click', async () => {
    const r = await openColorPicker(t.color);
    if (r) { pushUndo({ territories: snapshotTerritories() }); updateTerritory(tid, { color: r }); renderTree(); renderEditor(); fire('state-changed'); }
  });
  c.querySelector('#ed-invade').addEventListener('click', () => {
    setUI({ mode: 'invasion', invasionTargetId: tid }); fire('mode-changed');
  });
  c.querySelector('#ed-delete').addEventListener('click', () => {
    if (!confirm(`「${t.name || '(名称なし)'}」を削除？`)) return;
    pushUndo({ territories: snapshotTerritories(), changes: getAllTiles(tid, state) });
    deleteTerritory(tid); setUI({ selectedTerritoryId: null }); renderTree(); renderEditor(); fire('state-changed');
  });
}

function renderPlayerEditor(pid, c, state) {
  const p = state.players.get(pid);
  if (!p) { c.innerHTML = '<p class="editor-placeholder">見つかりません</p>'; return; }
  const colorHex = getColorHex(p.color.hue, p.color.shade);
  c.innerHTML = `
    <div class="form-group"><label>名前</label><input type="text" id="ed-pname" value="${esc(p.name || '')}"></div>
    <div class="form-row">
      <div class="form-group"><label>肩書き</label><input type="text" id="ed-ptitle" value="${esc(p.title || '')}"></div>
      <div class="form-group"><label>色</label><div class="color-picker-trigger" id="ed-pcolor" style="background:${colorHex}"></div></div>
    </div>
    <div class="form-group"><label>メモ</label><textarea id="ed-pmemo">${esc(p.memo || '')}</textarea></div>
    <button class="btn btn-small btn-danger" id="ed-pdelete">削除</button>`;

  c.querySelector('#ed-pname').addEventListener('change', (e) => { pushUndo({ players: snapshotPlayers() }); updatePlayer(pid, { name: e.target.value }); renderPlayerList(); });
  c.querySelector('#ed-ptitle').addEventListener('change', (e) => updatePlayer(pid, { title: e.target.value }));
  c.querySelector('#ed-pmemo').addEventListener('change', (e) => updatePlayer(pid, { memo: e.target.value }));
  c.querySelector('#ed-pcolor').addEventListener('click', async () => {
    const r = await openColorPicker(p.color);
    if (r) { pushUndo({ players: snapshotPlayers() }); updatePlayer(pid, { color: r }); renderPlayerList(); renderEditor(); }
  });
  c.querySelector('#ed-pdelete').addEventListener('click', () => {
    if (!confirm(`「${p.name}」を削除？`)) return;
    pushUndo({ players: snapshotPlayers(), territories: snapshotTerritories() });
    deletePlayer(pid); setUI({ selectedPlayerId: null }); renderPlayerList(); renderEditor(); fire('state-changed');
  });
}

function getAllTiles(tid, state) {
  const ch = [];
  for (let y = 0; y < state.mapHeight; y++)
    for (let x = 0; x < state.mapWidth; x++)
      if (state.cells[y][x].territoryId === tid) ch.push({ x, y, prevTerritoryId: tid });
  return ch;
}

function esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function fire(name) { window.dispatchEvent(new CustomEvent(name)); }
