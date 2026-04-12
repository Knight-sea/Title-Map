import { initState, getState, setUI, generateId } from './state.js';
import { Camera } from './canvas/camera.js';
import { Renderer } from './canvas/renderer.js';
import { TERRAINS } from './constants.js';
import { paintTerrain } from './map/terrain.js';
import { checkEnclaves } from './map/enclave.js';
import { createTerritory } from './territory/territory.js';
import { invasionClick } from './territory/invasion.js';
import { pushUndo, undo, snapshotTerritories } from './undo.js';
import { saveToSlot, loadFromSlot, getSlotInfo, exportJSON, importJSON, deleteSlot } from './save.js';
import { createPlayer } from './player.js';
import { initColorPicker } from './ui/color-picker.js';
import { renderTree, renderPlayerList, initTreeDrop } from './ui/tree.js';
import { renderEditor } from './ui/editor-panel.js';
import { initBGM, loadSoundCloud } from './bgm.js';

let camera, renderer, currentSlot = 0, inited = false;

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ===== Slot =====
function buildSlots() {
  const g = document.getElementById('slot-grid'); g.innerHTML = '';
  for (let i = 0; i < 16; i++) {
    const c = document.createElement('div'); c.className = 'slot-card';
    const info = getSlotInfo(i);
    if (info) {
      c.innerHTML = `<div class="slot-name">${esc(info.name)}</div><div class="slot-info">${info.size} / ${info.territories}領地</div>`;
      c.onclick = () => { currentSlot = i; loadFromSlot(i); startEditor(); };
      c.oncontextmenu = (e) => { e.preventDefault(); if (confirm(`「${info.name}」を削除？`)) { deleteSlot(i); buildSlots(); } };
    } else {
      c.classList.add('empty');
      c.innerHTML = `<div class="slot-name">空きスロット ${i+1}</div>`;
      c.onclick = () => { currentSlot = i; showScreen('size-screen'); };
    }
    g.appendChild(c);
  }
}

// ===== Size =====
function initSize() {
  const sel = document.getElementById('map-size-select');
  for (let s = 20; s <= 300; s += 20) {
    const o = document.createElement('option'); o.value = s; o.textContent = `${s} × ${s}`;
    if (s === 100) o.selected = true;
    sel.appendChild(o);
  }
  const prev = document.getElementById('size-preview');
  sel.addEventListener('change', () => { const v = +sel.value; prev.textContent = `${v} × ${v} = ${(v*v).toLocaleString()} マス`; });
  sel.dispatchEvent(new Event('change'));
  document.getElementById('size-back').onclick = () => { showScreen('slot-screen'); buildSlots(); };
  document.getElementById('size-confirm').onclick = () => {
    const sz = +sel.value; initState(sz, sz);
    const s = getState(); s.currentSlot = currentSlot; s.slotName = `マップ ${sz}×${sz}`;
    startEditor();
  };
}

// ===== Editor =====
function startEditor() {
  showScreen('editor-screen');
  requestAnimationFrame(() => {
    const canvas = document.getElementById('map-canvas');
    camera = new Camera();
    renderer = new Renderer(canvas, camera);
    renderer.resize();
    const state = getState();
    camera.fitMap(state.mapWidth, state.mapHeight, renderer.viewW, renderer.viewH);
    renderer.markDirty(); renderer.start();

    if (!inited) {
      inited = true;
      initColorPicker(); initTreeDrop(); initInput(canvas); initToolbar(); initPanelToggle(); initBGM();
      window.addEventListener('resize', () => { if (renderer) { renderer.resize(); renderer.markDirty(); } });
      window.addEventListener('territory-selected', () => { renderEditor(); renderer.markDirty(); });
      window.addEventListener('player-selected', () => renderEditor());
      window.addEventListener('state-changed', () => renderer.markDirty());
      window.addEventListener('mode-changed', () => {
        const s = getState();
        if (s.ui.mode === 'invasion') showBanner('侵略: 左=追加/奪取 右=除外 Esc=終了', 'invasion');
        renderer.markDirty();
      });
    }
    updateLockUI();
    renderTree(); renderPlayerList(); renderEditor(); updateZoom();
    if (state.settings.soundcloudUrl) loadSoundCloud(state.settings.soundcloudUrl);
  });
}

// ===== Input =====
function initInput(canvas) {
  let panning = false, lx = 0, ly = 0;
  let painting = false; // long-press continuous paint
  let spaceDown = false;

  canvas.addEventListener('mousedown', (e) => {
    const s = getState();
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const cell = camera.screenToCell(mx, my);

    if (e.button === 0) {
      if (s.ui.mode === 'terrain') {
        terrainPaint(cell.x, cell.y);
        painting = true; // continuous paint on hold
      } else if (s.ui.mode === 'cell') {
        cellPaint(cell.x, cell.y);
        painting = true;
      } else if (s.ui.mode === 'creation') {
        creationClick(cell.x, cell.y);
      } else if (s.ui.mode === 'invasion') {
        doInvasion(cell.x, cell.y, 0);
      } else {
        panning = true; lx = e.clientX; ly = e.clientY;
      }
    } else if (e.button === 2) {
      e.preventDefault();
      if (s.ui.mode === 'creation') creationRightClick(cell.x, cell.y);
      else if (s.ui.mode === 'invasion') doInvasion(cell.x, cell.y, 2);
      else if (s.ui.mode === 'cell') cellErase(cell.x, cell.y);
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    if (panning) {
      camera.pan(e.clientX - lx, e.clientY - ly);
      lx = e.clientX; ly = e.clientY;
      renderer.markDirty(); updateZoom();
    } else if (painting) {
      const r = canvas.getBoundingClientRect();
      const cell = camera.screenToCell(e.clientX - r.left, e.clientY - r.top);
      const s = getState();
      if (s.ui.mode === 'terrain') terrainPaint(cell.x, cell.y);
      else if (s.ui.mode === 'cell') cellPaint(cell.x, cell.y);
    }
  });

  window.addEventListener('mouseup', () => { panning = false; painting = false; });
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    camera.zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY);
    renderer.markDirty(); updateZoom();
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
    const s = getState();
    if (e.key === ' ') { e.preventDefault(); spaceDown = true; }
    if (e.key === 'Escape') {
      if (s.ui.mode === 'creation') { setUI({ mode: 'normal', creationSelectedCells: new Set() }); removeBanner(); renderer.markDirty(); }
      else if (s.ui.mode === 'invasion') { setUI({ mode: 'normal', invasionTargetId: null }); removeBanner(); renderer.markDirty(); }
      else if (s.ui.mode === 'terrain') deselectBrush();
      else if (s.ui.mode === 'cell') { setUI({ mode: 'normal', currentCellId: null }); removeBanner(); renderer.markDirty(); }
    }
    const amt = 40;
    if (e.key === 'ArrowUp') { camera.pan(0, amt); renderer.markDirty(); }
    if (e.key === 'ArrowDown') { camera.pan(0, -amt); renderer.markDirty(); }
    if (e.key === 'ArrowLeft') { camera.pan(amt, 0); renderer.markDirty(); }
    if (e.key === 'ArrowRight') { camera.pan(-amt, 0); renderer.markDirty(); }
    if (e.ctrlKey && e.key === 'z') { e.preventDefault(); doUndo(); }
    if (e.ctrlKey && e.key === '0') { e.preventDefault(); camera.fitMap(s.mapWidth, s.mapHeight, renderer.viewW, renderer.viewH); renderer.markDirty(); updateZoom(); }
    if (e.ctrlKey && e.key === 's') { e.preventDefault(); quickSave(); }
  });
  window.addEventListener('keyup', (e) => { if (e.key === ' ') spaceDown = false; });
}

// ===== Terrain =====
function terrainPaint(cx, cy) {
  const s = getState();
  if (!s.ui.selectedTerrain || s.locked) return;
  const ch = paintTerrain(cx, cy, s.ui.selectedTerrain, s.ui.brushSize);
  if (ch.length) { pushUndo({ changes: ch }); checkEnclaves(ch); renderer.markDirty(); }
}

// ===== Cell Painting =====
function cellPaint(cx, cy) {
  const s = getState();
  if (s.locked) return;
  if (cx < 0 || cx >= s.mapWidth || cy < 0 || cy >= s.mapHeight) return;
  const cellId = s.ui.currentCellId;
  if (!cellId) return;
  const cell = s.cells[cy][cx];
  if (cell.cellId === cellId) return; // already this cell
  // Don't paint on mountain/sea that isn't ownable? Actually cells can include anything
  const prevCellId = cell.cellId;
  cell.cellId = cellId;
  renderer.markDirty();
}

function cellErase(cx, cy) {
  const s = getState();
  if (s.locked) return;
  if (cx < 0 || cx >= s.mapWidth || cy < 0 || cy >= s.mapHeight) return;
  s.cells[cy][cx].cellId = null;
  renderer.markDirty();
}

function startNewCell() {
  const s = getState();
  if (s.locked) return;
  const id = generateId();
  // Random color
  const color = { hue: Math.floor(Math.random() * 20), shade: Math.floor(Math.random() * 5) };
  s.cellRegions.set(id, { id, color });
  setUI({ mode: 'cell', currentCellId: id });
  showBanner('セル塗り: 左=塗る 右=消す Esc=終了', 'cell');
  document.getElementById('btn-cell-paint').disabled = false;
  renderer.markDirty();
}

function resumeCellPaint() {
  const s = getState();
  if (s.locked || !s.ui.currentCellId) return;
  setUI({ mode: 'cell' });
  showBanner('セル塗り: 左=塗る 右=消す Esc=終了', 'cell');
  renderer.markDirty();
}

// ===== Lock =====
function toggleLock() {
  const s = getState();
  if (s.locked) {
    // Unlock
    if (!confirm('固定を解除しますか？領地データは保持されます。')) return;
    s.locked = false;
  } else {
    // Check all non-mountain/sea tiles have a cell
    let uncelled = 0;
    for (let y = 0; y < s.mapHeight; y++) {
      for (let x = 0; x < s.mapWidth; x++) {
        const c = s.cells[y][x];
        if (!c.cellId && TERRAINS[c.terrain].canOwn) uncelled++;
      }
    }
    if (uncelled > 0) {
      if (!confirm(`${uncelled} マスがセル未割当です。未割当マスは領地にできません。固定しますか？`)) return;
    }
    s.locked = true;
    // Exit any editing mode
    setUI({ mode: 'normal', selectedTerrain: null, currentCellId: null });
    deselectBrush();
    removeBanner();
  }
  updateLockUI();
  renderer.markDirty();
}

function updateLockUI() {
  const s = getState();
  const lockBtn = document.getElementById('btn-lock');
  const terrainGroup = document.getElementById('terrain-group');
  const cellGroup = document.getElementById('cell-group');
  if (s.locked) {
    lockBtn.textContent = '🔓 固定中';
    lockBtn.classList.add('locked');
    terrainGroup.classList.add('hidden');
    cellGroup.classList.add('hidden');
  } else {
    lockBtn.textContent = '🔒 固定';
    lockBtn.classList.remove('locked');
    terrainGroup.classList.remove('hidden');
    cellGroup.classList.remove('hidden');
  }
}

// ===== Creation =====
function creationClick(x, y) {
  const s = getState();
  if (s.locked) {
    // Cell-based: toggle cellId
    if (x < 0 || x >= s.mapWidth || y < 0 || y >= s.mapHeight) return;
    const cellId = s.cells[y][x].cellId;
    if (!cellId) return; // can't select uncelled tiles
    const sel = new Set(s.ui.creationSelectedCells);
    if (sel.has(cellId)) sel.delete(cellId); else sel.add(cellId);
    setUI({ creationSelectedCells: sel });
  } else {
    // Tile-based
    if (x < 0 || x >= s.mapWidth || y < 0 || y >= s.mapHeight) return;
    const k = `${x},${y}`;
    const sel = new Set(s.ui.creationSelectedCells);
    if (sel.has(k)) sel.delete(k); else sel.add(k);
    setUI({ creationSelectedCells: sel });
  }
  renderer.markDirty();
}

function creationRightClick(x, y) {
  const s = getState();
  if (s.locked) {
    if (x < 0 || x >= s.mapWidth || y < 0 || y >= s.mapHeight) return;
    const cellId = s.cells[y][x].cellId;
    if (!cellId) return;
    const sel = new Set(s.ui.creationSelectedCells);
    sel.delete(cellId);
    setUI({ creationSelectedCells: sel });
  } else {
    const k = `${x},${y}`;
    const sel = new Set(s.ui.creationSelectedCells);
    sel.delete(k);
    setUI({ creationSelectedCells: sel });
  }
  renderer.markDirty();
}

function enterCreation() {
  setUI({ mode: 'creation', creationSelectedCells: new Set() });
  const s = getState();
  const msg = s.locked ? '領地作成: 左=セル選択 右=解除 Esc=キャンセル' : '領地作成: 左=マス選択 右=解除 Esc=キャンセル';
  showBanner('', 'creation');
  const banner = document.querySelector('.mode-banner');
  if (banner) {
    banner.innerHTML = msg;
    const btns = document.createElement('div');
    btns.style.cssText = 'margin-top:5px;display:flex;gap:6px;justify-content:center;pointer-events:auto';
    btns.innerHTML = '<button class="btn btn-small btn-primary" id="creation-confirm">作成</button><button class="btn btn-small btn-secondary" id="creation-cancel">キャンセル</button>';
    banner.appendChild(btns);
    banner.style.pointerEvents = 'auto';
    document.getElementById('creation-confirm').onclick = confirmCreation;
    document.getElementById('creation-cancel').onclick = () => {
      setUI({ mode: 'normal', creationSelectedCells: new Set() }); removeBanner(); renderer.markDirty();
    };
  }
  renderer.markDirty();
}

function confirmCreation() {
  const s = getState();
  const sel = s.ui.creationSelectedCells;
  if (!sel.size) { alert('選択してください'); return; }

  // Build undo changes
  const changes = [];
  if (s.locked) {
    for (const cellId of sel) {
      for (let y = 0; y < s.mapHeight; y++)
        for (let x = 0; x < s.mapWidth; x++)
          if (s.cells[y][x].cellId === cellId) changes.push({ x, y, prevTerritoryId: s.cells[y][x].territoryId });
    }
  } else {
    for (const k of sel) {
      const [x, y] = k.split(',').map(Number);
      changes.push({ x, y, prevTerritoryId: s.cells[y][x].territoryId });
    }
  }

  pushUndo({ territories: snapshotTerritories(), changes });
  const t = createTerritory('', 6, null, { hue: Math.floor(Math.random() * 20), shade: 2 }, sel);
  setUI({ mode: 'normal', creationSelectedCells: new Set(), selectedTerritoryId: t.id, activeTab: 'territory' });
  removeBanner(); openEditorPanel();
  renderTree(); renderEditor(); renderer.markDirty();
  setTimeout(() => { const el = document.getElementById('ed-name'); if (el) el.focus(); }, 60);
}

// ===== Invasion =====
function doInvasion(x, y, btn) {
  const ch = invasionClick(x, y, btn);
  if (ch) { pushUndo({ changes: ch }); renderTree(); renderEditor(); renderer.markDirty(); }
}

function doUndo() {
  if (undo()) { renderTree(); renderPlayerList(); renderEditor(); renderer.markDirty(); }
}

// ===== Toolbar =====
function initToolbar() {
  document.querySelectorAll('.brush-btn').forEach(btn => {
    btn.onclick = () => {
      const t = btn.dataset.terrain;
      if (getState().ui.selectedTerrain === t) { deselectBrush(); return; }
      document.querySelectorAll('.brush-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setUI({ mode: 'terrain', selectedTerrain: t });
    };
  });
  document.getElementById('brush-size').onchange = (e) => setUI({ brushSize: +e.target.value });
  document.getElementById('btn-save').onclick = openSaveModal;
  document.getElementById('btn-undo').onclick = doUndo;

  // Cell buttons
  document.getElementById('btn-cell-new').onclick = startNewCell;
  document.getElementById('btn-cell-paint').onclick = resumeCellPaint;

  // Lock
  document.getElementById('btn-lock').onclick = toggleLock;

  // Settings
  document.getElementById('btn-settings').onclick = () => {
    document.getElementById('soundcloud-url').value = getState().settings.soundcloudUrl || '';
    document.getElementById('settings-modal').hidden = false;
  };
  document.getElementById('settings-cancel').onclick = () => document.getElementById('settings-modal').hidden = true;
  document.getElementById('settings-save').onclick = () => {
    const url = document.getElementById('soundcloud-url').value.trim();
    getState().settings.soundcloudUrl = url;
    if (url) loadSoundCloud(url);
    document.getElementById('settings-modal').hidden = true;
  };

  // Tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      document.getElementById(btn.dataset.tab + '-tab').classList.add('active');
      setUI({ activeTab: btn.dataset.tab }); renderEditor();
    };
  });

  document.getElementById('btn-new-territory').onclick = enterCreation;
  document.getElementById('btn-new-player').onclick = () => {
    const p = createPlayer('新しいプレイヤー', '', { hue: Math.floor(Math.random() * 20), shade: 2 }, '');
    setUI({ selectedPlayerId: p.id, selectedTerritoryId: null, activeTab: 'player' });
    renderPlayerList(); renderEditor(); openEditorPanel();
  };

  document.getElementById('view-level').onchange = (e) => { setUI({ viewLevel: +e.target.value }); renderer.markDirty(); };
  document.getElementById('toggle-labels').onchange = (e) => { setUI({ showLabels: e.target.checked }); renderer.markDirty(); };

  // Save modal
  document.getElementById('save-cancel').onclick = () => document.getElementById('save-modal').hidden = true;
  document.getElementById('save-confirm').onclick = () => {
    const s = getState(); s.slotName = document.getElementById('save-slot-name').value || s.slotName;
    saveToSlot(s.currentSlot); document.getElementById('save-modal').hidden = true;
  };
  document.getElementById('save-export').onclick = () => {
    const s = getState(); s.slotName = document.getElementById('save-slot-name').value || s.slotName; exportJSON();
  };

  document.getElementById('import-file').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { await importJSON(f); startEditor(); } catch (err) { alert('インポート失敗: ' + err.message); }
    e.target.value = '';
  };
}

function deselectBrush() {
  document.querySelectorAll('.brush-btn').forEach(b => b.classList.remove('active'));
  setUI({ mode: 'normal', selectedTerrain: null });
}

// ===== Panel =====
function initPanelToggle() {
  const toggle = document.getElementById('divider-toggle');
  const panel = document.getElementById('editor-panel');
  toggle.onclick = () => {
    const col = panel.classList.contains('collapsed');
    panel.classList.toggle('collapsed');
    toggle.textContent = col ? '▼ 編集パネル' : '▲ 編集パネル';
  };
}
function openEditorPanel() {
  document.getElementById('editor-panel').classList.remove('collapsed');
  document.getElementById('divider-toggle').textContent = '▼ 編集パネル';
}

// ===== Helpers =====
function showBanner(text, cls) {
  removeBanner();
  const b = document.createElement('div'); b.className = `mode-banner ${cls||''}`;
  b.textContent = text;
  document.getElementById('canvas-container').appendChild(b);
}
function removeBanner() { document.querySelectorAll('.mode-banner').forEach(b => b.remove()); }
function updateZoom() { const el = document.getElementById('zoom-display'); if (el && camera) el.textContent = Math.round(camera.zoom * 100) + '%'; }
function quickSave() { saveToSlot(getState().currentSlot); }
function openSaveModal() { document.getElementById('save-slot-name').value = getState().slotName || ''; document.getElementById('save-modal').hidden = false; }
function esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ===== Boot =====
document.addEventListener('DOMContentLoaded', () => { buildSlots(); initSize(); showScreen('slot-screen'); });
