const COLOR_CANVAS_SIZE = 168;
const COLOR_SLIDER_HEIGHT = 16;
const TWO_PI = Math.PI * 2;
const COLOR_SWATCH_GROUPS = [
  {
    title: 'Neutrals',
    open: true,
    anchors: ['#ffffff', '#f2f2f2', '#d9d9d9', '#bfbfbf', '#8c8c8c', '#595959', '#262626', '#000000']
  },
  {
    title: 'Warm',
    open: true,
    anchors: ['#fff7ed', '#fed7aa', '#fb923c', '#ea580c', '#9a3412', '#fee2e2', '#f87171', '#dc2626']
  },
  {
    title: 'Cool',
    open: true,
    anchors: ['#f0f9ff', '#bae6fd', '#38bdf8', '#0284c7', '#0c4a6e', '#cffafe', '#67e8f9', '#0891b2']
  },
  {
    title: 'Vivid',
    open: true,
    anchors: ['#ff1744', '#ff9100', '#ffea00', '#00e676', '#00b0ff', '#651fff', '#d500f9', '#00c853']
  },
  {
    title: 'Earth',
    open: true,
    anchors: ['#f5efe6', '#d6c2a1', '#b08968', '#7f5539', '#5e503f', '#87986a', '#a5a58d', '#d8d8c8']
  },
  {
    title: 'Pastel',
    open: true,
    anchors: ['#ffd6e0', '#ffafcc', '#bde0fe', '#a2d2ff', '#caffbf', '#fdffb6', '#e4c1f9', '#d0f4de']
  }
];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function componentToHex(value) {
  return clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0');
}

function rgbToHex({ r, g, b }) {
  return `#${componentToHex(r)}${componentToHex(g)}${componentToHex(b)}`;
}

function hexToRgb(hex) {
  const normalized = String(hex || '').trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null;
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  };
}

function rgbToHsv({ r, g, b }) {
  const rn = clamp(r, 0, 255) / 255;
  const gn = clamp(g, 0, 255) / 255;
  const bn = clamp(b, 0, 255) / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let h = 0;

  if (delta !== 0) {
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  const s = max === 0 ? 0 : delta / max;
  return { h, s: s * 100, v: max * 100 };
}

function hsvToRgb({ h, s, v }) {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp(s, 0, 100) / 100;
  const val = clamp(v, 0, 100) / 100;
  const c = val * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = val - c;
  let r1 = 0, g1 = 0, b1 = 0;

  if (hue < 60)      { r1 = c; g1 = x; }
  else if (hue < 120){ r1 = x; g1 = c; }
  else if (hue < 180){ g1 = c; b1 = x; }
  else if (hue < 240){ g1 = x; b1 = c; }
  else if (hue < 300){ r1 = x; b1 = c; }
  else               { r1 = c; b1 = x; }

  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
}

function rgbToCmyk({ r, g, b }) {
  const rn = clamp(r, 0, 255) / 255;
  const gn = clamp(g, 0, 255) / 255;
  const bn = clamp(b, 0, 255) / 255;
  const k = 1 - Math.max(rn, gn, bn);
  if (k >= 1) return { c: 0, m: 0, y: 0, k: 100 };
  return {
    c: ((1 - rn - k) / (1 - k)) * 100,
    m: ((1 - gn - k) / (1 - k)) * 100,
    y: ((1 - bn - k) / (1 - k)) * 100,
    k: k * 100,
  };
}

function cmykToRgb({ c, m, y, k }) {
  const cn = clamp(c, 0, 100) / 100;
  const mn = clamp(m, 0, 100) / 100;
  const yn = clamp(y, 0, 100) / 100;
  const kn = clamp(k, 0, 100) / 100;
  return {
    r: Math.round(255 * (1 - cn) * (1 - kn)),
    g: Math.round(255 * (1 - mn) * (1 - kn)),
    b: Math.round(255 * (1 - yn) * (1 - kn)),
  };
}

function rgbToLab({ r, g, b }) {
  const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lr = lin(r), lg = lin(g), lb = lin(b);
  const x = lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375;
  const y = lr * 0.2126729 + lg * 0.7151522 + lb * 0.0721750;
  const z = lr * 0.0193339 + lg * 0.1191920 + lb * 0.9503041;
  const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const fy = f(y); // Y white-point = 1, no normalisation needed
  return { L: 116 * fy - 16, a: 500 * (f(x / 0.95047) - fy), b: 200 * (fy - f(z / 1.08883)) };
}

function labToRgb({ L, a, b }) {
  const fy = (L + 16) / 116;
  const f3 = t => t > 0.206897 ? t * t * t : (t - 16 / 116) / 7.787;
  const x = f3(a / 500 + fy) * 0.95047;
  const y = f3(fy);
  const z = f3(fy - b / 200) * 1.08883;
  const delin = c => { c = Math.max(0, Math.min(1, c)); return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; };
  return {
    r: Math.round(delin(x * 3.2404542 - y * 1.5371385 - z * 0.4985314) * 255),
    g: Math.round(delin(-x * 0.9692660 + y * 1.8760108 + z * 0.0415560) * 255),
    b: Math.round(delin(x * 0.0556434 - y * 0.2040259 + z * 1.0572252) * 255),
  };
}

function pointerPosition(evt, element) {
  const rect = element.getBoundingClientRect();
  return {
    x: clamp(evt.clientX - rect.left, 0, rect.width),
    y: clamp(evt.clientY - rect.top, 0, rect.height),
    width: rect.width,
    height: rect.height,
  };
}

function lerp(a, b, t) {
  return a + ((b - a) * t);
}

function generateSwatchColors(anchors, count = 64) {
  const rgbAnchors = anchors.map(hex => hexToRgb(hex)).filter(Boolean);
  if (rgbAnchors.length === 0) return [];
  if (rgbAnchors.length === 1) return Array.from({ length: count }, () => rgbToHex(rgbAnchors[0]));

  return Array.from({ length: count }, (_, index) => {
    const t = count === 1 ? 0 : index / (count - 1);
    const scaled = t * (rgbAnchors.length - 1);
    const low = Math.floor(scaled);
    const high = Math.min(rgbAnchors.length - 1, low + 1);
    const mix = scaled - low;
    const start = rgbAnchors[low];
    const end = rgbAnchors[high];
    return rgbToHex({
      r: Math.round(lerp(start.r, end.r, mix)),
      g: Math.round(lerp(start.g, end.g, mix)),
      b: Math.round(lerp(start.b, end.b, mix)),
    });
  });
}


export {
  COLOR_CANVAS_SIZE, COLOR_SLIDER_HEIGHT, TWO_PI, COLOR_SWATCH_GROUPS,
  clamp, componentToHex, rgbToHex, hexToRgb, rgbToHsv, hsvToRgb,
  rgbToCmyk, cmykToRgb, rgbToLab, labToRgb, pointerPosition, lerp, generateSwatchColors,
};
