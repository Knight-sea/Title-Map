import { COLOR_PALETTE, HUE_NAMES, SHADE_LEVELS, getColorHex } from '../constants.js';

let _resolve = null;
let _selHue = -1;
let _selShade = 2; // default middle

const modal = () => document.getElementById('color-picker-modal');

export function initColorPicker() {
  // Build hue buttons
  const hueContainer = document.getElementById('cp-hues');
  hueContainer.innerHTML = '';
  for (let h = 0; h < 25; h++) {
    const btn = document.createElement('div');
    btn.className = 'cp-hue-btn';
    btn.style.background = getColorHex(h, 2); // middle shade as preview
    btn.dataset.hue = h;
    const name = document.createElement('span');
    name.className = 'cp-hue-name';
    name.textContent = HUE_NAMES[h];
    btn.appendChild(name);
    btn.addEventListener('click', () => selectHue(h));
    hueContainer.appendChild(btn);
  }

  // Build shade buttons (initially empty, populated on hue select)
  document.getElementById('color-confirm').addEventListener('click', () => {
    if (_resolve && _selHue >= 0) {
      _resolve({ hue: _selHue, shade: _selShade });
    }
    close();
  });
  document.getElementById('color-cancel').addEventListener('click', close);
}

function selectHue(h) {
  _selHue = h;
  document.querySelectorAll('.cp-hue-btn').forEach((el, i) => el.classList.toggle('selected', i === h));
  buildShades(h);
  updatePreview();
}

function buildShades(h) {
  const container = document.getElementById('cp-shades');
  container.innerHTML = '';
  for (let s = 0; s < 5; s++) {
    const btn = document.createElement('div');
    btn.className = 'cp-shade-btn';
    if (s === _selShade) btn.classList.add('selected');
    btn.style.background = getColorHex(h, s);
    const label = SHADE_LEVELS[s];
    btn.textContent = label >= 0 ? `+${label}` : `${label}`;
    btn.addEventListener('click', () => {
      _selShade = s;
      container.querySelectorAll('.cp-shade-btn').forEach((el, i) => el.classList.toggle('selected', i === s));
      updatePreview();
    });
    container.appendChild(btn);
  }
}

function updatePreview() {
  if (_selHue < 0) return;
  const hex = getColorHex(_selHue, _selShade);
  document.getElementById('cp-preview').style.background = hex;
  const sl = SHADE_LEVELS[_selShade];
  document.getElementById('cp-name').textContent = `${HUE_NAMES[_selHue]} ${sl >= 0 ? '+' : ''}${sl}`;
}

function close() {
  modal().hidden = true;
  _resolve = null;
}

export function openColorPicker(currentColor) {
  modal().hidden = false;
  _selHue = currentColor ? currentColor.hue : -1;
  _selShade = currentColor ? currentColor.shade : 2;
  // Highlight current
  document.querySelectorAll('.cp-hue-btn').forEach((el, i) => el.classList.toggle('selected', i === _selHue));
  if (_selHue >= 0) {
    buildShades(_selHue);
    updatePreview();
  } else {
    document.getElementById('cp-shades').innerHTML = '';
    document.getElementById('cp-preview').style.background = 'transparent';
    document.getElementById('cp-name').textContent = '-';
  }
  return new Promise(resolve => { _resolve = resolve; });
}
