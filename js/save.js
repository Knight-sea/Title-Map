import { exportData, loadFromData, getState } from './state.js';

const SLOT_PREFIX = 'territory-map-slot-';

export function saveToSlot(slotIndex) {
  const data = exportData();
  data.currentSlot = slotIndex;
  data.savedAt = new Date().toISOString();
  try {
    localStorage.setItem(SLOT_PREFIX + slotIndex, JSON.stringify(data));
    return true;
  } catch (e) {
    console.error('Save failed:', e);
    return false;
  }
}

export function loadFromSlot(slotIndex) {
  try {
    const raw = localStorage.getItem(SLOT_PREFIX + slotIndex);
    if (!raw) return null;
    const data = JSON.parse(raw);
    data.currentSlot = slotIndex;
    loadFromData(data);
    return data;
  } catch (e) {
    console.error('Load failed:', e);
    return null;
  }
}

export function deleteSlot(slotIndex) {
  localStorage.removeItem(SLOT_PREFIX + slotIndex);
}

export function getSlotInfo(slotIndex) {
  try {
    const raw = localStorage.getItem(SLOT_PREFIX + slotIndex);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return {
      name: data.slotName || `スロット ${slotIndex + 1}`,
      size: `${data.mapWidth}×${data.mapHeight}`,
      territories: data.territories?.length || 0,
      savedAt: data.savedAt || '',
    };
  } catch {
    return null;
  }
}

export function exportJSON() {
  const data = exportData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `territory-map-${data.slotName || 'export'}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function importJSON(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data.version || !data.mapWidth || !data.mapHeight) {
          reject(new Error('Invalid file format'));
          return;
        }
        loadFromData(data);
        resolve(data);
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });
}
