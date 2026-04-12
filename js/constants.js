// Rank definitions (0=highest)
export const RANKS = [
  { id: 0, name: '帝国', borderWidth: 4, borderColor: 'rgba(255,255,255,0.9)' },
  { id: 1, name: '王国', borderWidth: 3, borderColor: 'rgba(255,255,255,0.7)' },
  { id: 2, name: '公爵', borderWidth: 2, borderColor: 'rgba(255,255,255,0.5)' },
  { id: 3, name: '侯爵', borderWidth: 2, borderColor: 'rgba(255,255,255,0.4)' },
  { id: 4, name: '伯爵', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' },
  { id: 5, name: '子爵', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  { id: 6, name: '男爵', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' },
];

// Zoom thresholds - borders at or above this rank are hidden when zoom < threshold
export const BORDER_ZOOM_THRESHOLDS = [0, 0, 0.3, 0.4, 0.6, 0.8, 1.0];

// Terrain types
export const TERRAINS = {
  plain:    { name: '平地', color: '#8fbc8f', symbol: null, canOwn: true },
  forest:   { name: '森',   color: '#2d5a27', symbol: '🌲', canOwn: true },
  river:    { name: '川',   color: '#4a8fb5', symbol: '〜', canOwn: true },
  mountain: { name: '山',   color: '#7a7a7a', symbol: '▲', canOwn: false },
  sea:      { name: '海',   color: '#1a3a5a', symbol: '≈', canOwn: false },
};

// Color palette: 25 hues × 5 shades
export const HUE_NAMES = [
  '赤','朱','橙','黄橙','黄','黄緑','萌黄','緑','青緑',
  '水','空','青','紺','藍','紫','青紫','薄紫','桃紫','桃','薔薇',
  '茶','肌','灰','銀','墨'
];

// Base HSL values for each hue
const HUE_BASE = [
  [0,70,50],[15,75,50],[30,80,55],[40,80,55],[50,80,55],
  [75,60,45],[90,55,45],[120,50,40],[160,50,45],
  [180,55,50],[200,60,55],[220,65,50],[230,55,35],[235,50,30],
  [270,50,45],[255,45,50],[280,40,60],[320,45,55],[340,55,55],[350,60,50],
  [25,40,35],[25,40,65],[0,0,50],[0,0,68],[0,0,20]
];

export const SHADE_LEVELS = [-2, -1, 0, 1, 2];

// Generate the 125 colors
export const COLOR_PALETTE = [];
for (let h = 0; h < 25; h++) {
  for (let s = 0; s < 5; s++) {
    const [hue, sat, light] = HUE_BASE[h];
    const shadeOffset = SHADE_LEVELS[s] * 12;
    const l = Math.max(10, Math.min(90, light + shadeOffset));
    const hex = hslToHex(hue, sat, l);
    COLOR_PALETTE.push({
      hue: h, shade: s,
      name: `${HUE_NAMES[h]} ${SHADE_LEVELS[s] >= 0 ? '+' : ''}${SHADE_LEVELS[s]}`,
      hex,
      h: hue, s: sat, l
    });
  }
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = n => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export function getColorHex(hueIdx, shadeIdx) {
  return COLOR_PALETTE[hueIdx * 5 + shadeIdx]?.hex || '#888888';
}

export const UNASSIGNED_COLOR = '#3a3a3a';
export const GRID_COLOR = 'rgba(255,255,255,0.06)';

export const BRUSH_SIZES = [1, 3, 5, 7, 11, 15, 21, 31, 51];
