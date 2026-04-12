import { COLOR_PALETTE } from '../constants.js';

let _resolve = null;
let _selectedIdx = -1;

const modal = () => document.getElementById('color-picker-modal');
const grid = () => document.getElementById('color-grid');
const nameEl = () => document.getElementById('color-name');

export function initColorPicker() {
  const g = grid();
  g.innerHTML = '';
  COLOR_PALETTE.forEach((c, i) => {
    const el = document.createElement('div');
    el.className = 'color-cell';
    el.style.background = c.hex;
    el.dataset.index = i;
    el.title = c.name;
    el.addEventListener('click', () => selectColor(i));
    g.appendChild(el);
  });

  document.getElementById('color-confirm').addEventListener('click', () => {
    if (_resolve && _selectedIdx >= 0) {
      const c = COLOR_PALETTE[_selectedIdx];
      _resolve({ hue: c.hue, shade: c.shade });
    }
    close();
  });
  document.getElementById('color-cancel').addEventListener('click', close);
}

function selectColor(idx) {
  _selectedIdx = idx;
  grid().querySelectorAll('.color-cell').forEach((el, i) => {
    el.classList.toggle('selected', i === idx);
  });
  nameEl().textContent = COLOR_PALETTE[idx].name;
}

function close() {
  modal().hidden = true;
  _resolve = null;
}

/**
 * Open the color picker and return a promise that resolves to {hue, shade} or null.
 */
export function openColorPicker(currentColor) {
  modal().hidden = false;
  _selectedIdx = -1;
  if (currentColor) {
    const idx = currentColor.hue * 5 + currentColor.shade;
    selectColor(idx);
  }
  return new Promise(resolve => { _resolve = resolve; });
}
