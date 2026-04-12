import { initState, getState, setUI, loadFromData } from './state.js';
import { Camera } from './canvas/camera.js';
import { Renderer } from './canvas/renderer.js';
import { TERRAINS, RANKS } from './constants.js';
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

let camera, renderer;
let currentSlot = 0;
let initialized = false;

// ===== Screen =====
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ===== Slot Screen =====
function buildSlotScreen() {
  const grid = document.getElementById('slot-grid');
  grid.innerHTML = '';
  for (let i = 0; i < 16; i++) {
    const card = document.createElement('div');
    card.className = 'slot-card';
    const info = getSlotInfo(i);
    if (info) {
      card.innerHTML = `<div class="slot-name">${esc(info.name)}</div><div class="slot-info">${info.size} / ${info.territories}領地</div>`;
      card.addEventListener('click', () => { currentSlot = i; loadFromSlot(i); startEditor(); });
      card.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (confirm(`スロット「${info.name}」を削除しますか？`)) { deleteSlot(i); buildSlotScreen(); }
      });
    } else {
      card.classList.add('empty');
      card.innerHTML = `<div class="slot-name">空きスロット ${i + 1}</div>`;
      card.addEventListener('click', () => { currentSlot = i; showScreen('size-screen'); });
    }
    grid.appendChild(card);
  }
}

// ===== Size Screen =====
function initSizeScreen() {
  const sel = document.getElementById('map-size-select');
  for (let s = 20; s <= 300; s += 20) {
    const o = document.createElement('option');
    o.value = s; o.textContent = `${s} × ${s}`;
    if (s === 100) o.selected = true;
    sel.appendChild(o);
  }
  const prev = document.getElementById('size-preview');
  sel.addEventListener('change', () => {
    const v = +sel.value;
    prev.textContent = `${v} × ${v} = ${(v*v).toLocaleString()} マス`;
  });
  sel.dispatchEvent(new Event('change'));

  document.getElementById('size-back').addEventListener('click', () => { showScreen('slot-screen'); buildSlotScreen(); });
  document.getElementById('size-confirm').addEventListener('click', () => {
    const sz = +sel.value;
    initState(sz, sz);
    const s = getState();
    s.currentSlot = currentSlot;
    s.slotName = `マップ ${sz}×${sz}`;
    startEditor();
  });
}

// ===== Start Editor =====
function startEditor() {
  showScreen('editor-screen');

  // Wait a frame so container has layout dimensions
  requestAnimationFrame(() => {
    const canvas = document.getElementById('map-canvas');
    camera = new Camera();
    renderer = new Renderer(canvas, camera);
    renderer.resize();

    const state = getState();
    camera.fitMap(state.mapWidth, state.mapHeight, renderer.viewW, renderer.viewH);
    renderer.markDirty();
    renderer.start();

    if (!initialized) {
      initialized = true;
      initColorPicker();
      initTreeDrop();
      initInput(canvas);
      initToolbar();
      initPanelToggle();
      initBGM();

      window.addEventListener('resize', () => {
        if (renderer) { renderer.resize(); renderer.markDirty(); }
      });

      window.addEventListener('territory-selected', () => { renderEditor(); renderer.markDirty(); });
      window.addEventListener('player-selected', () => renderEditor());
      window.addEventListener('state-changed', () => renderer.markDirty());
      window.addEventListener('mode-changed', () => {
        const s = getState();
        if (s.ui.mode === 'invasion') showBanner('侵略モード: 左=追加/奪取 右=除外 Esc=終了', 'invasion');
        renderer.markDirty();
      });
    }

    renderTree();
    renderPlayerList();
    renderEditor();
    updateZoom();

    if (state.settings.soundcloudUrl) loadSoundCloud(state.settings.soundcloudUrl);
  });
}

// ===== Input =====
function initInput(canvas) {
  let panning = false, lastX = 0, lastY = 0;
  let spaceDown = false, dragging = false;

  canvas.addEventListener('mousedown', (e) => {
    const state = getState();
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const cell = camera.screenToCell(mx, my);

    if (e.button === 0) {
      if (state.ui.mode === 'terrain') {
        terrainPaint(cell.x, cell.y);
        if (spaceDown) dragging = true;
      } else if (state.ui.mode === 'creation') {
        toggleCreation(cell.x, cell.y);
      } else if (state.ui.mode === 'invasion') {
        doInvasion(cell.x, cell.y, 0);
      } else {
        panning = true; lastX = e.clientX; lastY = e.clientY;
      }
    } else if (e.button === 2) {
      e.preventDefault();
      if (state.ui.mode === 'creation') removeCreation(cell.x, cell.y);
      else if (state.ui.mode === 'invasion') doInvasion(cell.x, cell.y, 2);
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    if (panning) {
      camera.pan(e.clientX - lastX, e.clientY - lastY);
      lastX = e.clientX; lastY = e.clientY;
      renderer.markDirty(); updateZoom();
    } else if (dragging && getState().ui.mode === 'terrain') {
      const r = canvas.getBoundingClientRect();
      const cell = camera.screenToCell(e.clientX - r.left, e.clientY - r.top);
      terrainPaint(cell.x, cell.y);
    }
  });

  window.addEventListener('mouseup', () => { panning = false; dragging = false; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    camera.zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY);
    renderer.markDirty(); updateZoom();
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
    const state = getState();

    if (e.key === ' ') { e.preventDefault(); spaceDown = true; }
    if (e.key === 'Escape') {
      if (state.ui.mode === 'creation') { setUI({ mode: 'normal', creationSelectedCells: new Set() }); removeBanner(); renderer.markDirty(); }
      else if (state.ui.mode === 'invasion') { setUI({ mode: 'normal', invasionTargetId: null }); removeBanner(); renderer.markDirty(); }
      else if (state.ui.mode === 'terrain') deselectBrush();
    }

    const amt = 40;
    if (e.key === 'ArrowUp') { camera.pan(0, amt); renderer.markDirty(); }
    if (e.key === 'ArrowDown') { camera.pan(0, -amt); renderer.markDirty(); }
    if (e.key === 'ArrowLeft') { camera.pan(amt, 0); renderer.markDirty(); }
    if (e.key === 'ArrowRight') { camera.pan(-amt, 0); renderer.markDirty(); }

    if (e.ctrlKey && e.key === 'z') { e.preventDefault(); doUndo(); }
    if (e.ctrlKey && e.key === '0') {
      e.preventDefault();
      camera.fitMap(state.mapWidth, state.mapHeight, renderer.viewW, renderer.viewH);
      renderer.markDirty(); updateZoom();
    }
    if (e.ctrlKey && e.key === 's') { e.preventDefault(); quickSave(); }
  });

  window.addEventListener('keyup', (e) => {
    if (e.key === ' ') { spaceDown = false; dragging = false; }
  });
}

function terrainPaint(cx, cy) {
  const s = getState();
  if (!s.ui.selectedTerrain) return;
  const changes = paintTerrain(cx, cy, s.ui.selectedTerrain, s.ui.brushSize);
  if (changes.length) {
    pushUndo({ changes });
    checkEnclaves(changes);
    renderer.markDirty();
  }
}

function toggleCreation(x, y) {
  const s = getState();
  if (x < 0 || x >= s.mapWidth || y < 0 || y >= s.mapHeight) return;
  const k = `${x},${y}`;
  const c = new Set(s.ui.creationSelectedCells);
  if (c.has(k)) c.delete(k); else c.add(k);
  setUI({ creationSelectedCells: c });
  renderer.markDirty();
}

function removeCreation(x, y) {
  const s = getState();
  const k = `${x},${y}`;
  const c = new Set(s.ui.creationSelectedCells);
  c.delete(k);
  setUI({ creationSelectedCells: c });
  renderer.markDirty();
}

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
    btn.addEventListener('click', () => {
      const t = btn.dataset.terrain;
      if (getState().ui.selectedTerrain === t) { deselectBrush(); return; }
      document.querySelectorAll('.brush-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setUI({ mode: 'terrain', selectedTerrain: t });
    });
  });

  document.getElementById('brush-size').addEventListener('change', (e) => setUI({ brushSize: +e.target.value }));
  document.getElementById('btn-save').addEventListener('click', openSaveModal);
  document.getElementById('btn-undo').addEventListener('click', doUndo);

  // Settings
  document.getElementById('btn-settings').addEventListener('click', () => {
    document.getElementById('soundcloud-url').value = getState().settings.soundcloudUrl || '';
    document.getElementById('settings-modal').hidden = false;
  });
  document.getElementById('settings-cancel').addEventListener('click', () => document.getElementById('settings-modal').hidden = true);
  document.getElementById('settings-save').addEventListener('click', () => {
    const url = document.getElementById('soundcloud-url').value.trim();
    getState().settings.soundcloudUrl = url;
    if (url) loadSoundCloud(url);
    document.getElementById('settings-modal').hidden = true;
  });

  // Tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      document.getElementById(tab + '-tab').classList.add('active');
      setUI({ activeTab: tab });
      renderEditor();
    });
  });

  // New territory
  document.getElementById('btn-new-territory').addEventListener('click', enterCreationMode);

  // New player
  document.getElementById('btn-new-player').addEventListener('click', () => {
    const p = createPlayer('新しいプレイヤー', '', { hue: Math.floor(Math.random() * 20), shade: 2 }, '');
    setUI({ selectedPlayerId: p.id, selectedTerritoryId: null, activeTab: 'player' });
    renderPlayerList(); renderEditor();
    // Open editor panel if collapsed
    openEditorPanel();
  });

  // View level
  document.getElementById('view-level').addEventListener('change', (e) => {
    setUI({ viewLevel: +e.target.value }); renderer.markDirty();
  });

  // Labels toggle
  document.getElementById('toggle-labels').addEventListener('change', (e) => {
    setUI({ showLabels: e.target.checked }); renderer.markDirty();
  });

  // Save modal
  document.getElementById('save-cancel').addEventListener('click', () => document.getElementById('save-modal').hidden = true);
  document.getElementById('save-confirm').addEventListener('click', () => {
    const s = getState();
    s.slotName = document.getElementById('save-slot-name').value || s.slotName;
    saveToSlot(s.currentSlot);
    document.getElementById('save-modal').hidden = true;
  });
  document.getElementById('save-export').addEventListener('click', () => {
    const s = getState();
    s.slotName = document.getElementById('save-slot-name').value || s.slotName;
    exportJSON();
  });

  // Import (on slot screen, already wired but re-wire safely)
  document.getElementById('import-file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try { await importJSON(f); startEditor(); } catch (err) { alert('インポート失敗: ' + err.message); }
    e.target.value = '';
  });
}

function deselectBrush() {
  document.querySelectorAll('.brush-btn').forEach(b => b.classList.remove('active'));
  setUI({ mode: 'normal', selectedTerrain: null });
}

// ===== Creation Mode =====
function enterCreationMode() {
  setUI({ mode: 'creation', creationSelectedCells: new Set() });
  showBanner('', 'creation');

  const banner = document.querySelector('.mode-banner');
  if (banner) {
    banner.innerHTML = '領地作成: 左クリック=選択 右クリック=解除 Esc=キャンセル';
    const btns = document.createElement('div');
    btns.style.cssText = 'margin-top:5px;display:flex;gap:6px;justify-content:center;pointer-events:auto';
    btns.innerHTML = '<button class="btn btn-small btn-primary" id="creation-confirm">作成</button><button class="btn btn-small btn-secondary" id="creation-cancel">キャンセル</button>';
    banner.appendChild(btns);
    banner.style.pointerEvents = 'auto';
    document.getElementById('creation-confirm').addEventListener('click', confirmCreation);
    document.getElementById('creation-cancel').addEventListener('click', () => {
      setUI({ mode: 'normal', creationSelectedCells: new Set() }); removeBanner(); renderer.markDirty();
    });
  }
  renderer.markDirty();
}

function confirmCreation() {
  const s = getState();
  const cells = s.ui.creationSelectedCells;
  if (!cells.size) { alert('マスを選択してください'); return; }

  pushUndo({ territories: snapshotTerritories(), changes: Array.from(cells).map(k => {
    const [x, y] = k.split(',').map(Number);
    return { x, y, prevTerritoryId: s.cells[y][x].territoryId };
  })});

  const t = createTerritory('', 6, null, { hue: Math.floor(Math.random() * 20), shade: 2 }, cells);
  setUI({ mode: 'normal', creationSelectedCells: new Set(), selectedTerritoryId: t.id, activeTab: 'territory' });
  removeBanner();
  renderTree(); renderEditor(); renderer.markDirty();
  openEditorPanel();
  setTimeout(() => { const el = document.getElementById('ed-name'); if (el) el.focus(); }, 60);
}

// ===== Editor Panel Toggle =====
function initPanelToggle() {
  const toggle = document.getElementById('divider-toggle');
  const panel = document.getElementById('editor-panel');

  toggle.addEventListener('click', () => {
    const collapsed = panel.classList.contains('collapsed');
    panel.classList.toggle('collapsed');
    toggle.textContent = collapsed ? '▼ 編集パネル' : '▲ 編集パネル';
  });
}

function openEditorPanel() {
  const panel = document.getElementById('editor-panel');
  const toggle = document.getElementById('divider-toggle');
  panel.classList.remove('collapsed');
  toggle.textContent = '▼ 編集パネル';
}

// ===== Helpers =====
function showBanner(text, cls) {
  removeBanner();
  const b = document.createElement('div');
  b.className = `mode-banner ${cls || ''}`;
  b.textContent = text;
  document.getElementById('canvas-container').appendChild(b);
}

function removeBanner() { document.querySelectorAll('.mode-banner').forEach(b => b.remove()); }

function updateZoom() {
  const el = document.getElementById('zoom-display');
  if (el && camera) el.textContent = Math.round(camera.zoom * 100) + '%';
}

function quickSave() {
  const s = getState();
  saveToSlot(s.currentSlot);
}

function openSaveModal() {
  document.getElementById('save-slot-name').value = getState().slotName || '';
  document.getElementById('save-modal').hidden = false;
}

function esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ===== Boot =====
document.addEventListener('DOMContentLoaded', () => {
  buildSlotScreen();
  initSizeScreen();
  showScreen('slot-screen');
});
