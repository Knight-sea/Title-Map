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

// ===== Screen Management =====
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ===== Slot Screen =====
function initSlotScreen() {
  const grid = document.getElementById('slot-grid');
  grid.innerHTML = '';
  for (let i = 0; i < 16; i++) {
    const card = document.createElement('div');
    card.className = 'slot-card';
    const info = getSlotInfo(i);
    if (info) {
      card.innerHTML = `
        <div class="slot-name">${escHtml(info.name)}</div>
        <div class="slot-info">${info.size} / ${info.territories}領地</div>
      `;
      card.addEventListener('click', () => {
        currentSlot = i;
        const data = loadFromSlot(i);
        if (data) {
          startEditor();
        }
      });
      // Right-click to delete
      card.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (confirm(`スロット「${info.name}」を削除しますか？`)) {
          deleteSlot(i);
          initSlotScreen();
        }
      });
    } else {
      card.classList.add('empty');
      card.innerHTML = `<div class="slot-name">空きスロット ${i + 1}</div>`;
      card.addEventListener('click', () => {
        currentSlot = i;
        showScreen('size-screen');
      });
    }
    grid.appendChild(card);
  }

  // Import
  document.getElementById('import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      await importJSON(file);
      startEditor();
    } catch (err) {
      alert('インポート失敗: ' + err.message);
    }
    e.target.value = '';
  });
}

// ===== Size Screen =====
function initSizeScreen() {
  const select = document.getElementById('map-size-select');
  select.innerHTML = '';
  for (let s = 20; s <= 300; s += 20) {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = `${s} × ${s}`;
    if (s === 100) opt.selected = true;
    select.appendChild(opt);
  }
  const preview = document.getElementById('size-preview');
  select.addEventListener('change', () => {
    const v = parseInt(select.value);
    preview.textContent = `${v} × ${v} = ${(v * v).toLocaleString()} マス`;
  });
  select.dispatchEvent(new Event('change'));

  document.getElementById('size-back').addEventListener('click', () => {
    showScreen('slot-screen');
    initSlotScreen();
  });

  document.getElementById('size-confirm').addEventListener('click', () => {
    const size = parseInt(select.value);
    initState(size, size);
    const state = getState();
    state.currentSlot = currentSlot;
    state.slotName = `マップ ${size}×${size}`;
    startEditor();
  });
}

// ===== Editor =====
function startEditor() {
  showScreen('editor-screen');
  const state = getState();

  // Init canvas
  const tCanvas = document.getElementById('canvas-terrain');
  const oCanvas = document.getElementById('canvas-overlay');
  camera = new Camera();
  renderer = new Renderer(tCanvas, oCanvas, camera);
  renderer.resize();
  camera.fitMap(state.mapWidth, state.mapHeight, tCanvas.clientWidth, tCanvas.clientHeight);
  renderer.start();

  // Init UI
  initColorPicker();
  initTreeDrop();
  renderTree();
  renderPlayerList();
  renderEditor();
  initInputHandlers();
  initToolbar();
  initPanelDivider();
  updateZoomDisplay();

  if (state.settings.soundcloudUrl) {
    loadSoundCloud(state.settings.soundcloudUrl);
  }

  window.addEventListener('resize', () => {
    renderer.resize();
    renderer.markDirty();
  });
}

// ===== Input Handling =====
function initInputHandlers() {
  const container = document.getElementById('canvas-container');
  const overlay = document.getElementById('canvas-overlay');
  let isPanning = false;
  let lastX = 0, lastY = 0;
  let spaceDown = false;
  let isDragging = false;

  // Mouse down
  overlay.addEventListener('mousedown', (e) => {
    const state = getState();
    const rect = overlay.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const cell = camera.screenToCell(mx, my);

    if (e.button === 0) {
      if (state.ui.mode === 'terrain') {
        if (spaceDown) {
          isDragging = true;
          doTerrainPaint(cell.x, cell.y);
        } else {
          doTerrainPaint(cell.x, cell.y);
        }
      } else if (state.ui.mode === 'creation') {
        toggleCreationCell(cell.x, cell.y);
      } else if (state.ui.mode === 'invasion') {
        doInvasion(cell.x, cell.y, 0);
      } else {
        // Normal: start pan
        isPanning = true;
        lastX = e.clientX;
        lastY = e.clientY;
      }
    } else if (e.button === 2) {
      e.preventDefault();
      if (state.ui.mode === 'creation') {
        removeCreationCell(cell.x, cell.y);
      } else if (state.ui.mode === 'invasion') {
        doInvasion(cell.x, cell.y, 2);
      }
    }
  });

  // Mouse move
  overlay.addEventListener('mousemove', (e) => {
    if (isPanning) {
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      camera.pan(dx, dy);
      lastX = e.clientX;
      lastY = e.clientY;
      renderer.markDirty();
      updateZoomDisplay();
    } else if (isDragging && getState().ui.mode === 'terrain') {
      const rect = overlay.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const cell = camera.screenToCell(mx, my);
      doTerrainPaint(cell.x, cell.y);
    }
  });

  // Mouse up
  window.addEventListener('mouseup', () => {
    isPanning = false;
    isDragging = false;
  });

  // Context menu
  overlay.addEventListener('contextmenu', (e) => e.preventDefault());

  // Wheel zoom
  overlay.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = overlay.getBoundingClientRect();
    camera.zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY);
    renderer.markDirty();
    updateZoomDisplay();
  }, { passive: false });

  // Keyboard
  window.addEventListener('keydown', (e) => {
    const state = getState();
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

    if (e.key === ' ') {
      e.preventDefault();
      spaceDown = true;
    }
    if (e.key === 'Escape') {
      if (state.ui.mode === 'creation') {
        setUI({ mode: 'normal', creationSelectedCells: new Set() });
        removeBanner();
        renderer.markDirty();
      } else if (state.ui.mode === 'invasion') {
        setUI({ mode: 'normal', invasionTargetId: null });
        removeBanner();
        renderer.markDirty();
      } else if (state.ui.mode === 'terrain') {
        deselectBrush();
      }
    }

    // Arrow keys for scrolling
    const scrollAmt = 40;
    if (e.key === 'ArrowUp') { camera.pan(0, scrollAmt); renderer.markDirty(); }
    if (e.key === 'ArrowDown') { camera.pan(0, -scrollAmt); renderer.markDirty(); }
    if (e.key === 'ArrowLeft') { camera.pan(scrollAmt, 0); renderer.markDirty(); }
    if (e.key === 'ArrowRight') { camera.pan(-scrollAmt, 0); renderer.markDirty(); }

    // Ctrl+Z undo
    if (e.ctrlKey && e.key === 'z') {
      e.preventDefault();
      if (undo()) {
        renderTree();
        renderPlayerList();
        renderEditor();
        renderer.markDirty();
      }
    }

    // Ctrl+0 fit
    if (e.ctrlKey && e.key === '0') {
      e.preventDefault();
      const state = getState();
      camera.fitMap(state.mapWidth, state.mapHeight,
        document.getElementById('canvas-terrain').clientWidth,
        document.getElementById('canvas-terrain').clientHeight);
      renderer.markDirty();
      updateZoomDisplay();
    }

    // Ctrl+S save
    if (e.ctrlKey && e.key === 's') {
      e.preventDefault();
      quickSave();
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.key === ' ') {
      spaceDown = false;
      isDragging = false;
    }
  });
}

// ===== Terrain Paint =====
function doTerrainPaint(cx, cy) {
  const state = getState();
  if (!state.ui.selectedTerrain) return;
  const changes = paintTerrain(cx, cy, state.ui.selectedTerrain, state.ui.brushSize);
  if (changes.length > 0) {
    pushUndo({ changes });
    // Check enclaves after terrain change
    const enclaveChanges = checkEnclaves(changes);
    if (enclaveChanges.length > 0) {
      // Append to same undo? For simplicity, separate
    }
    renderer.markDirty();
  }
}

// ===== Creation Mode =====
function toggleCreationCell(x, y) {
  const state = getState();
  if (x < 0 || x >= state.mapWidth || y < 0 || y >= state.mapHeight) return;
  const key = `${x},${y}`;
  const cells = new Set(state.ui.creationSelectedCells);
  if (cells.has(key)) cells.delete(key);
  else cells.add(key);
  setUI({ creationSelectedCells: cells });
  renderer.markDirty();
}

function removeCreationCell(x, y) {
  const state = getState();
  const key = `${x},${y}`;
  const cells = new Set(state.ui.creationSelectedCells);
  cells.delete(key);
  setUI({ creationSelectedCells: cells });
  renderer.markDirty();
}

// ===== Invasion =====
function doInvasion(x, y, button) {
  const changes = invasionClick(x, y, button);
  if (changes) {
    pushUndo({ changes });
    renderTree();
    renderEditor();
    renderer.markDirty();
  }
}

// ===== Toolbar =====
function initToolbar() {
  // Terrain brushes
  document.querySelectorAll('.brush-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const terrain = btn.dataset.terrain;
      const state = getState();
      if (state.ui.selectedTerrain === terrain) {
        deselectBrush();
      } else {
        document.querySelectorAll('.brush-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        setUI({ mode: 'terrain', selectedTerrain: terrain });
      }
    });
  });

  // Brush size
  document.getElementById('brush-size').addEventListener('change', (e) => {
    setUI({ brushSize: parseInt(e.target.value) });
  });

  // Save
  document.getElementById('btn-save').addEventListener('click', () => {
    openSaveModal();
  });

  // Undo
  document.getElementById('btn-undo').addEventListener('click', () => {
    if (undo()) {
      renderTree();
      renderPlayerList();
      renderEditor();
      renderer.markDirty();
    }
  });

  // Settings
  document.getElementById('btn-settings').addEventListener('click', () => {
    const state = getState();
    document.getElementById('soundcloud-url').value = state.settings.soundcloudUrl || '';
    document.getElementById('settings-modal').hidden = false;
  });
  document.getElementById('settings-cancel').addEventListener('click', () => {
    document.getElementById('settings-modal').hidden = true;
  });
  document.getElementById('settings-save').addEventListener('click', () => {
    const state = getState();
    const url = document.getElementById('soundcloud-url').value.trim();
    state.settings.soundcloudUrl = url;
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

  // New territory button
  document.getElementById('btn-new-territory').addEventListener('click', () => {
    enterCreationMode();
  });

  // New player button
  document.getElementById('btn-new-player').addEventListener('click', () => {
    const p = createPlayer('新しいプレイヤー', '', { hue: Math.floor(Math.random() * 20), shade: 2 }, '');
    setUI({ selectedPlayerId: p.id, selectedTerritoryId: null, activeTab: 'player' });
    renderPlayerList();
    renderEditor();
  });

  // View level
  document.getElementById('view-level').addEventListener('change', (e) => {
    setUI({ viewLevel: parseInt(e.target.value) });
    renderer.markDirty();
  });

  // Label toggle
  document.getElementById('toggle-labels').addEventListener('change', (e) => {
    setUI({ showLabels: e.target.checked });
    renderer.markDirty();
  });

  // Save modal
  document.getElementById('save-cancel').addEventListener('click', () => {
    document.getElementById('save-modal').hidden = true;
  });
  document.getElementById('save-confirm').addEventListener('click', () => {
    const state = getState();
    state.slotName = document.getElementById('save-slot-name').value || state.slotName;
    saveToSlot(state.currentSlot);
    document.getElementById('save-modal').hidden = true;
  });
  document.getElementById('save-export').addEventListener('click', () => {
    const state = getState();
    state.slotName = document.getElementById('save-slot-name').value || state.slotName;
    exportJSON();
  });

  // Listen for custom events
  window.addEventListener('territory-selected', () => {
    renderEditor();
    renderer.markDirty();
  });
  window.addEventListener('player-selected', () => {
    renderEditor();
  });
  window.addEventListener('state-changed', () => {
    renderer.markDirty();
  });
  window.addEventListener('mode-changed', () => {
    const state = getState();
    if (state.ui.mode === 'invasion') {
      showBanner('侵略モード: 左クリック=追加/奪取, 右クリック=除外, Esc=終了', 'invasion');
    }
    renderer.markDirty();
  });

  // BGM
  initBGM();
}

function deselectBrush() {
  document.querySelectorAll('.brush-btn').forEach(b => b.classList.remove('active'));
  setUI({ mode: 'normal', selectedTerrain: null });
}

function enterCreationMode() {
  setUI({ mode: 'creation', creationSelectedCells: new Set() });
  showBanner('領地作成: 左クリック=マス選択, 右クリック=解除, Esc=キャンセル', 'creation');
  renderer.markDirty();

  // Add confirm/cancel buttons to banner
  const banner = document.querySelector('.mode-banner');
  if (banner) {
    const btns = document.createElement('div');
    btns.style.cssText = 'margin-top:6px;display:flex;gap:6px;justify-content:center;pointer-events:auto';
    btns.innerHTML = `
      <button class="btn btn-small btn-primary" id="creation-confirm">作成</button>
      <button class="btn btn-small btn-secondary" id="creation-cancel">キャンセル</button>
    `;
    banner.appendChild(btns);
    banner.style.pointerEvents = 'auto';

    document.getElementById('creation-confirm').addEventListener('click', () => {
      confirmCreation();
    });
    document.getElementById('creation-cancel').addEventListener('click', () => {
      setUI({ mode: 'normal', creationSelectedCells: new Set() });
      removeBanner();
      renderer.markDirty();
    });
  }
}

function confirmCreation() {
  const state = getState();
  const cells = state.ui.creationSelectedCells;
  if (cells.size === 0) {
    alert('マスを選択してください');
    return;
  }

  // Create territory with default values
  pushUndo({ territories: snapshotTerritories(), changes: Array.from(cells).map(k => {
    const [x, y] = k.split(',').map(Number);
    return { x, y, prevTerritoryId: state.cells[y][x].territoryId };
  })});

  const t = createTerritory(
    '',
    6, // Default: 男爵
    null,
    { hue: Math.floor(Math.random() * 20), shade: 2 },
    cells
  );

  setUI({
    mode: 'normal',
    creationSelectedCells: new Set(),
    selectedTerritoryId: t.id,
    activeTab: 'territory',
  });
  removeBanner();
  renderTree();
  renderEditor();
  renderer.markDirty();

  // Focus name input
  setTimeout(() => {
    const nameInput = document.getElementById('ed-name');
    if (nameInput) nameInput.focus();
  }, 50);
}

// ===== Panel Divider =====
function initPanelDivider() {
  const divider = document.getElementById('panel-divider');
  const toggle = document.getElementById('divider-toggle');
  const panel = document.getElementById('editor-panel');
  const treeView = document.getElementById('tree-view');
  let collapsed = false;

  toggle.addEventListener('click', () => {
    collapsed = !collapsed;
    panel.classList.toggle('collapsed', collapsed);
    toggle.textContent = collapsed ? '▲' : '▼';
  });

  // Drag resize
  let startY = 0, startH = 0;
  divider.addEventListener('mousedown', (e) => {
    if (e.target === toggle) return;
    startY = e.clientY;
    startH = panel.offsetHeight;
    const onMove = (me) => {
      const dy = startY - me.clientY;
      panel.style.height = Math.max(60, startH + dy) + 'px';
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
}

// ===== Helpers =====
function showBanner(text, cls) {
  removeBanner();
  const banner = document.createElement('div');
  banner.className = `mode-banner ${cls || ''}`;
  banner.textContent = text;
  document.getElementById('canvas-container').appendChild(banner);
}

function removeBanner() {
  document.querySelectorAll('.mode-banner').forEach(b => b.remove());
}

function updateZoomDisplay() {
  const el = document.getElementById('zoom-display');
  if (el && camera) {
    el.textContent = Math.round(camera.zoom * 100) + '%';
  }
}

function quickSave() {
  const state = getState();
  saveToSlot(state.currentSlot);
}

function openSaveModal() {
  const state = getState();
  document.getElementById('save-slot-name').value = state.slotName || '';
  document.getElementById('save-modal').hidden = false;
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => {
  initSlotScreen();
  initSizeScreen();
  showScreen('slot-screen');
});
