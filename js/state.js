let _state = null;
let _listeners = [];

export function initState(width, height) {
  const cells = [];
  for (let y = 0; y < height; y++) {
    const row = [];
    for (let x = 0; x < width; x++) {
      row.push({ terrain: 'plain', territoryId: null });
    }
    cells.push(row);
  }
  _state = {
    mapWidth: width,
    mapHeight: height,
    cells,
    territories: new Map(),
    players: new Map(),
    currentSlot: 0,
    slotName: '',
    settings: { soundcloudUrl: '' },
    // UI state (not saved)
    ui: {
      mode: 'normal', // 'normal' | 'terrain' | 'creation' | 'invasion'
      selectedTerrain: null,
      brushSize: 1,
      selectedTerritoryId: null,
      selectedPlayerId: null,
      viewLevel: 0,
      showLabels: false,
      creationSelectedCells: new Set(), // "x,y" strings
      invasionTargetId: null,
      editorPanelCollapsed: false,
      activeTab: 'territory',
    }
  };
  notify();
  return _state;
}

export function getState() { return _state; }

export function setState(partial) {
  Object.assign(_state, partial);
  notify();
}

export function setUI(partial) {
  Object.assign(_state.ui, partial);
  notify();
}

export function subscribe(fn) {
  _listeners.push(fn);
  return () => { _listeners = _listeners.filter(l => l !== fn); };
}

function notify() {
  for (const fn of _listeners) fn(_state);
}

export function loadFromData(data) {
  initState(data.mapWidth, data.mapHeight);
  // Decompress cells
  if (data.cells) {
    let idx = 0;
    for (const [terrain, territoryId, count] of data.cells) {
      for (let i = 0; i < count; i++) {
        const y = Math.floor(idx / data.mapWidth);
        const x = idx % data.mapWidth;
        if (y < data.mapHeight && x < data.mapWidth) {
          _state.cells[y][x] = { terrain, territoryId };
        }
        idx++;
      }
    }
  }
  // Load territories
  _state.territories = new Map();
  if (data.territories) {
    for (const t of data.territories) {
      _state.territories.set(t.id, t);
    }
  }
  // Load players
  _state.players = new Map();
  if (data.players) {
    for (const p of data.players) {
      _state.players.set(p.id, p);
    }
  }
  _state.slotName = data.slotName || '';
  _state.settings = data.settings || { soundcloudUrl: '' };
  _state.currentSlot = data.currentSlot ?? 0;
  notify();
}

export function exportData() {
  const s = _state;
  // RLE compress cells
  const compressed = [];
  let prev = null;
  let count = 0;
  for (let y = 0; y < s.mapHeight; y++) {
    for (let x = 0; x < s.mapWidth; x++) {
      const c = s.cells[y][x];
      const key = `${c.terrain}|${c.territoryId}`;
      if (key === prev) {
        count++;
      } else {
        if (prev !== null) {
          const [t, tid] = prev.split('|');
          compressed.push([t, tid === 'null' ? null : tid, count]);
        }
        prev = key;
        count = 1;
      }
    }
  }
  if (prev !== null) {
    const [t, tid] = prev.split('|');
    compressed.push([t, tid === 'null' ? null : tid, count]);
  }

  return {
    version: 1,
    slotName: s.slotName,
    currentSlot: s.currentSlot,
    mapWidth: s.mapWidth,
    mapHeight: s.mapHeight,
    cells: compressed,
    territories: Array.from(s.territories.values()),
    players: Array.from(s.players.values()),
    settings: s.settings,
  };
}

export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
