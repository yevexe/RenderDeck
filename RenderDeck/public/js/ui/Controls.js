// CONTROLS.JS - UI Controls Management
// Handles both original controls and new MeshPhysicalMaterial controls from Setting 3

import { log } from '../utils/logger.js';
import { STANDARD_ENVIRONMENTS } from '../config.js';
import { generateEnvPreview } from '../core/SceneLoader.js';

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

export class CompactColorPicker {
  static active = null;

  constructor({ pickerEl, hexEl, swatchEl, wrapInput, onLiveChange, onCommitChange }) {
    this.pickerEl = pickerEl;
    this.hexEl = hexEl;
    this.swatchEl = swatchEl;
    this.wrapInput = wrapInput;
    this.onLiveChange = onLiveChange;
    this.onCommitChange = onCommitChange;
    this.mode = 'square';
    this.isOpen = false;
    this.isDragging = false;
    this.dragTarget = null;
    this.renderScale = Math.min(3, Math.max(1.5, window.devicePixelRatio || 1));
    this.selectedCollectionIndex = 0;
    this.selectedSwatchRef = null;
    this.lastSelectionType = 'collection';
    this.pendingNewCollection = false;
    this.pendingCollectionRenameIndex = null;
    this.dragPayload = null;
    this.skipPresetAnimationOnce = false;
    this.swatchCollections = [
      { id: 'recent', title: 'Recent', open: true, swatches: [] },
      ...COLOR_SWATCH_GROUPS.map((group, groupIndex) => ({
        id: `swatch-group-${groupIndex + 1}`,
        title: group.title,
        open: false,
        swatches: generateSwatchColors(group.anchors, 72).map((hex, swatchIndex) => ({
          id: `swatch-${groupIndex + 1}-${swatchIndex + 1}`,
          hex,
          name: `${group.title} ${swatchIndex + 1}`,
        })),
      })),
    ];
    this.state = {
      hex: '#ffffff',
      rgb: { r: 255, g: 255, b: 255 },
      hsv: { h: 0, s: 0, v: 100 },
      cmyk: { c: 0, m: 0, y: 0, k: 0 },
    };

    this._build();
    this.setMode('square');
    this._bindLauncher();
    this.setColor(this.hexEl?.value || this.pickerEl?.value || '#ffffff', { emit: false });
  }

  _build() {
    this.panelEl = document.createElement('div');
    this.panelEl.className = 'compact-color-picker';
    this.panelEl.hidden = true;

    this.titleEl = document.createElement('div');
    this.titleEl.className = 'compact-color-picker__section-title';
    this.titleEl.textContent = 'Color Picker';

    this.toggleRowEl = document.createElement('div');
    this.toggleRowEl.className = 'compact-color-picker__mode';
    this.squareModeBtn = this._makeModeButton('Square', 'square');
    this.circleModeBtn = this._makeModeButton('Circle', 'circle');
    this.toggleRowEl.append(this.squareModeBtn, this.circleModeBtn);

    this.canvasWrapEl = document.createElement('div');
    this.canvasWrapEl.className = 'compact-color-picker__canvas-wrap';

    this.canvasEl = document.createElement('canvas');
    this.canvasEl.className = 'compact-color-picker__canvas';

    this.sliderEl = document.createElement('canvas');
    this.sliderEl.className = 'compact-color-picker__slider';

    this.sliderLabelEl = document.createElement('div');
    this.sliderLabelEl.className = 'compact-color-picker__slider-label';

    this.canvasWrapEl.append(this.canvasEl, this.sliderEl, this.sliderLabelEl);

    this.fieldsEl = document.createElement('div');
    this.fieldsEl.className = 'compact-color-picker__fields';
    this.rgbInputs = this._buildFieldGroup('RGB', ['R', 'G', 'B'], 0, 255, 1, ['r', 'g', 'b']);
    this.hsvInputs = this._buildFieldGroup('HSB', ['H', 'S', 'B'], [0, 0, 0], [360, 100, 100], [1, 1, 1], ['h', 's', 'v']);
    this.cmykInputs = this._buildFieldGroup('CMYK', ['C', 'M', 'Y', 'K'], 0, 100, 1, ['c', 'm', 'y', 'k']);

    this.footerEl = document.createElement('div');
    this.footerEl.className = 'compact-color-picker__footer';

    this.previewSwatchEl = document.createElement('button');
    this.previewSwatchEl.type = 'button';
    this.previewSwatchEl.className = 'compact-color-picker__preview-swatch';
    this.previewSwatchEl.setAttribute('aria-label', 'Current color swatch');
    this.previewSwatchEl.draggable = true;

    this.copyHexBtn = document.createElement('button');
    this.copyHexBtn.type = 'button';
    this.copyHexBtn.className = 'compact-color-picker__footer-btn';
    this.copyHexBtn.setAttribute('aria-label', 'Copy hex value');
    this.copyHexBtn.title = 'Copy hex value';
    this.copyHexBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 11 11" fill="none"><rect x="3.5" y="0.5" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.1"/><path d="M0.5 3.5H2.5V10.5H9.5V8.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    this.previewHexEl = document.createElement('input');
    this.previewHexEl.type = 'text';
    this.previewHexEl.maxLength = 7;
    this.previewHexEl.spellcheck = false;
    this.previewHexEl.className = 'value-input value-input-hex compact-color-picker__hex';

    this.footerEl.append(this.previewSwatchEl, this.copyHexBtn, this.previewHexEl);
    this.fieldsEl.append(this.rgbInputs.group, this.hsvInputs.group, this.cmykInputs.group);

    this.swatchesTitleEl = document.createElement('div');
    this.swatchesTitleEl.className = 'compact-color-picker__section-title compact-color-picker__section-title--swatches';
    this.swatchesTitleEl.textContent = 'Swatches';
    this.swatchesHeaderEl = document.createElement('div');
    this.swatchesHeaderEl.className = 'compact-color-picker__header-row';
    this.swatchesMenuBtn = document.createElement('button');
    this.swatchesMenuBtn.type = 'button';
    this.swatchesMenuBtn.className = 'compact-color-picker__menu-btn';
    this.swatchesMenuBtn.setAttribute('aria-label', 'Swatches menu');
    this.swatchesMenuBtn.title = 'Swatches menu';
    this.swatchesMenuBtn.innerHTML = '<span></span><span></span><span></span>';
    this.swatchesMenuEl = document.createElement('div');
    this.swatchesMenuEl.className = 'compact-color-picker__menu';
    this.swatchesMenuEl.hidden = true;

    this.loadStandardSwatchesBtn = document.createElement('button');
    this.loadStandardSwatchesBtn.type = 'button';
    this.loadStandardSwatchesBtn.className = 'compact-color-picker__menu-item';
    this.loadStandardSwatchesBtn.textContent = 'Load Standard Swatches';
    this.loadStandardSwatchesBtn.setAttribute('aria-label', 'Load Standard Swatches');
    this.loadStandardSwatchesBtn.title = 'Load Standard Swatches';
    this.swatchesMenuEl.appendChild(this.loadStandardSwatchesBtn);
    this.swatchesHeaderEl.append(this.swatchesTitleEl, this.swatchesMenuBtn, this.swatchesMenuEl);

    this.swatchPanelEl = this._buildPresetSwatches();

    this.panelEl.append(this.titleEl, this.toggleRowEl, this.canvasWrapEl, this.fieldsEl, this.footerEl, this.swatchesHeaderEl, this.swatchPanelEl);
    document.body.appendChild(this.panelEl);
    this._configureCanvasResolution();
    this._bindPanelEvents();
  }

  _buildPresetSwatches() {
    const panel = document.createElement('div');
    panel.className = 'compact-color-picker__presets';
    this.swatchActionsEl = document.createElement('div');
    this.swatchActionsEl.className = 'compact-color-picker__presets-actions';

    this.addCollectionBtn = document.createElement('button');
    this.addCollectionBtn.type = 'button';
    this.addCollectionBtn.className = 'compact-color-picker__presets-action';
    this.addCollectionBtn.textContent = '+';

    this.renameSwatchesBtn = document.createElement('button');
    this.renameSwatchesBtn.type = 'button';
    this.renameSwatchesBtn.className = 'compact-color-picker__presets-action';
    this.renameSwatchesBtn.textContent = '✎';
    this.renameSwatchesBtn.setAttribute('aria-label', 'Rename');
    this.renameSwatchesBtn.title = 'Rename';

    this.removeCollectionBtn = document.createElement('button');
    this.removeCollectionBtn.type = 'button';
    this.removeCollectionBtn.className = 'compact-color-picker__presets-action';
    this.removeCollectionBtn.textContent = '🗑';

    this.swatchActionsEl.append(this.addCollectionBtn, this.renameSwatchesBtn, this.removeCollectionBtn);

    this.swatchScrollEl = document.createElement('div');
    this.swatchScrollEl.className = 'compact-color-picker__presets-scroll';

    this.swatchRenameFormEl = document.createElement('div');
    this.swatchRenameFormEl.className = 'compact-color-picker__swatch-rename';
    this.swatchRenameFormEl.hidden = true;

    const renameField = document.createElement('div');
    renameField.className = 'compact-color-picker__swatch-rename-field';

    this.swatchRenameInputEl = document.createElement('input');
    this.swatchRenameInputEl.type = 'text';
    this.swatchRenameInputEl.className = 'compact-color-picker__swatch-rename-input';
    this.swatchRenameInputEl.autocomplete = 'off';
    this.swatchRenameInputEl.spellcheck = false;

    this.swatchRenameClearEl = document.createElement('button');
    this.swatchRenameClearEl.type = 'button';
    this.swatchRenameClearEl.className = 'compact-color-picker__swatch-rename-clear';
    this.swatchRenameClearEl.innerHTML = '<svg width="7" height="7" viewBox="0 0 8 8" fill="none"><line x1="1" y1="1" x2="7" y2="7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="7" y1="1" x2="1" y2="7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

    this.swatchRenameConfirmEl = document.createElement('button');
    this.swatchRenameConfirmEl.type = 'button';
    this.swatchRenameConfirmEl.className = 'compact-color-picker__swatch-rename-confirm';
    this.swatchRenameConfirmEl.innerHTML = '<svg width="12" height="9" viewBox="0 0 13 10" fill="none"><polyline points="1,5 5,9 12,1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    renameField.append(this.swatchRenameInputEl, this.swatchRenameClearEl);
    this.swatchRenameFormEl.append(renameField, this.swatchRenameConfirmEl);

    panel.append(this.swatchScrollEl, this.swatchRenameFormEl, this.swatchActionsEl);

    this.addCollectionBtn.addEventListener('click', () => this._addSwatchCollection());
    this.loadStandardSwatchesBtn.addEventListener('click', () => this._loadStandardSwatchCollections());
    this.renameSwatchesBtn.addEventListener('click', () => this._renameSelectedSwatchTarget());
    this.removeCollectionBtn.addEventListener('click', () => this._removeSelectedSwatchTarget());
    this.removeCollectionBtn.addEventListener('dragover', (evt) => {
      if (!this.dragPayload) return;
      evt.preventDefault();
      evt.dataTransfer.dropEffect = 'move';
      this.removeCollectionBtn.classList.add('is-drop-target');
    });
    this.removeCollectionBtn.addEventListener('dragleave', () => {
      this.removeCollectionBtn.classList.remove('is-drop-target');
    });
    this.removeCollectionBtn.addEventListener('drop', (evt) => {
      if (!this.dragPayload) return;
      evt.preventDefault();
      this.removeCollectionBtn.classList.remove('is-drop-target');
      if (this.dragPayload.type === 'swatch') {
        this._deleteSwatchByRef(this.dragPayload.collectionIndex, this.dragPayload.swatchId);
      } else if (this.dragPayload.type === 'collection') {
        this._removeSelectedSwatchCollection(this.dragPayload.collectionIndex);
      }
      this.dragPayload = null;
      this._clearDropIndicators();
    });
    this.swatchRenameClearEl.addEventListener('click', () => {
      this.swatchRenameInputEl.value = '';
      this.swatchRenameInputEl.focus();
    });
    this.swatchRenameConfirmEl.addEventListener('click', () => this._commitSwatchRename());
    this.swatchRenameInputEl.addEventListener('keydown', (evt) => {
      if (evt.key === 'Enter') this._commitSwatchRename();
      if (evt.key === 'Escape') this._closeSwatchRename();
    });
    document.addEventListener('mousedown', (evt) => {
      if (this.swatchRenameFormEl.hidden) return;
      if (this.swatchRenameFormEl.contains(evt.target) || this.renameSwatchesBtn?.contains(evt.target)) return;
      if (!this.swatchRenameInputEl.value.trim()) {
        this._closeSwatchRename();
      }
    });
    this.swatchesMenuBtn.addEventListener('click', (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      const open = !this.swatchesMenuEl.hidden;
      this.swatchesMenuEl.hidden = open;
      this.swatchesMenuBtn.classList.toggle('is-open', !open);
    });
    document.addEventListener('mousedown', (evt) => {
      if (this.swatchesMenuEl.hidden) return;
      if (this.swatchesHeaderEl.contains(evt.target)) return;
      this.swatchesMenuEl.hidden = true;
      this.swatchesMenuBtn.classList.remove('is-open');
    });
    this.loadStandardSwatchesBtn.addEventListener('click', () => {
      this.swatchesMenuEl.hidden = true;
      this.swatchesMenuBtn.classList.remove('is-open');
    });

    this._renderSwatchCollections();
    return panel;
  }

  _renderSwatchCollections() {
    if (!this.swatchScrollEl) return;
    this.swatchScrollEl.innerHTML = '';

    this.swatchCollections.forEach((group, index) => {
      const section = document.createElement('div');
      section.className = 'compact-color-picker__presets-section';
      if (group.open) section.classList.add('is-open');
      if (index === this.selectedCollectionIndex) section.classList.add('is-selected');

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'compact-color-picker__presets-toggle';
      toggle.setAttribute('aria-expanded', group.open ? 'true' : 'false');
      toggle.innerHTML = `<span class="compact-color-picker__presets-title-row"><span class="compact-color-picker__presets-title">${group.title}</span>${group.id !== 'recent' ? '<span class="compact-color-picker__presets-rename-icon" aria-hidden="true"><svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M8.5 1.5a1.414 1.414 0 012 2L4.5 9.5 2 10.5l1-2.5L8.5 1.5z" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg></span>' : ''}</span><span class="compact-color-picker__presets-chevron"></span>`;
      if (group.id !== 'recent') {
        toggle.draggable = true;
        toggle.addEventListener('dragstart', (evt) => {
          this.dragPayload = {
            type: 'collection',
            collectionIndex: index,
          };
          section.classList.add('is-dragging');
          evt.dataTransfer.effectAllowed = 'move';
          evt.dataTransfer.setData('text/plain', group.title);
        });
        toggle.addEventListener('dragend', () => {
          section.classList.remove('is-dragging');
          this.dragPayload = null;
          this.removeCollectionBtn.classList.remove('is-drop-target');
          this._clearCollectionDropIndicators();
        });
      }

      const content = document.createElement('div');
      content.className = 'compact-color-picker__presets-content';

      const grid = document.createElement('div');
      grid.className = 'compact-color-picker__presets-grid';
      grid.dataset.collectionIndex = String(index);
      grid.addEventListener('dragover', (evt) => {
        if (!this.dragPayload) return;
        if (this.dragPayload.type === 'collection') return; // handled at section level
        evt.preventDefault();
        evt.dataTransfer.dropEffect = this.dragPayload.type === 'current' ? 'copy' : 'move';
        this._markDropTarget(grid, group.swatches.length);
      });
      grid.addEventListener('dragleave', (evt) => {
        if (!grid.contains(evt.relatedTarget)) this._clearDropIndicators();
      });
      grid.addEventListener('drop', (evt) => {
        if (!this.dragPayload) return;
        if (this.dragPayload.type === 'collection') return;
        evt.preventDefault();
        this._handleSwatchDrop(index, group.swatches.length);
      });

      group.swatches.forEach((swatch) => {
        const swatchBtn = document.createElement('button');
        swatchBtn.type = 'button';
        swatchBtn.className = 'compact-color-picker__preset-swatch';
        swatchBtn.dataset.collectionIndex = String(index);
        swatchBtn.dataset.swatchId = swatch.id;
        swatchBtn.setAttribute('aria-label', swatch.name);
        swatchBtn.title = swatch.name;
        swatchBtn.style.background = swatch.hex;
        swatchBtn.draggable = true;
        if (this.selectedSwatchRef?.collectionIndex === index && this.selectedSwatchRef?.swatchId === swatch.id) {
          swatchBtn.classList.add('is-selected');
        }
        swatchBtn.addEventListener('click', () => {
          this.selectedCollectionIndex = index;
          this.selectedSwatchRef = { collectionIndex: index, swatchId: swatch.id };
          this.lastSelectionType = 'swatch';
          this.setColor(swatch.hex, { commit: true });
          this._syncRenderedSwatchSelection();
        });
        swatchBtn.addEventListener('dblclick', (evt) => {
          evt.preventDefault();
          evt.stopPropagation();
          this.selectedCollectionIndex = index;
          this.selectedSwatchRef = { collectionIndex: index, swatchId: swatch.id };
          this.lastSelectionType = 'swatch';
          this._openSwatchRename(index, swatch.id);
        });
        swatchBtn.addEventListener('dragstart', (evt) => {
          this.dragPayload = {
            type: 'swatch',
            collectionIndex: index,
            swatchId: swatch.id,
          };
          swatchBtn.classList.add('is-dragging');
          evt.dataTransfer.effectAllowed = 'move';
          evt.dataTransfer.setData('text/plain', swatch.hex);
        });
        swatchBtn.addEventListener('dragend', () => {
          swatchBtn.classList.remove('is-dragging');
          this.dragPayload = null;
          this._clearDropIndicators();
        });
        swatchBtn.addEventListener('dragover', (evt) => {
          if (!this.dragPayload) return;
          if (this.dragPayload.type === 'collection') return;
          evt.preventDefault();
          evt.stopPropagation();
          evt.dataTransfer.dropEffect = this.dragPayload.type === 'current' ? 'copy' : 'move';
          const rect = swatchBtn.getBoundingClientRect();
          const insertBefore = evt.clientX < rect.left + (rect.width / 2);
          const baseIndex = group.swatches.findIndex(entry => entry.id === swatch.id);
          this._markDropTarget(grid, baseIndex + (insertBefore ? 0 : 1));
        });
        swatchBtn.addEventListener('drop', (evt) => {
          if (!this.dragPayload) return;
          if (this.dragPayload.type === 'collection') return;
          evt.preventDefault();
          evt.stopPropagation();
          const rect = swatchBtn.getBoundingClientRect();
          const insertBefore = evt.clientX < rect.left + (rect.width / 2);
          const baseIndex = group.swatches.findIndex(entry => entry.id === swatch.id);
          this._handleSwatchDrop(index, baseIndex + (insertBefore ? 0 : 1));
        });
        grid.appendChild(swatchBtn);
      });

      content.appendChild(grid);
      section.append(toggle, content);
      this.swatchScrollEl.appendChild(section);

      const setOpen = (open, animate = false) => {
        group.open = open;
        section.classList.toggle('is-open', open);
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        section.classList.toggle('is-static', !animate);

        if (!animate) {
          content.style.maxHeight = open ? 'none' : '0px';
          return;
        }

        if (open) {
          content.style.maxHeight = '0px';
          requestAnimationFrame(() => {
            content.style.maxHeight = `${content.scrollHeight}px`;
          });
        } else {
          if (content.style.maxHeight === 'none') {
            content.style.maxHeight = `${content.scrollHeight}px`;
          }
          requestAnimationFrame(() => {
            content.style.maxHeight = '0px';
          });
        }
      };

      const startInlineRename = () => {
        if (section.querySelector('.compact-color-picker__presets-rename-form')) return;
        const titleSpan = toggle.querySelector('.compact-color-picker__presets-title');
        if (!titleSpan) return;
        const renameIcon = toggle.querySelector('.compact-color-picker__presets-rename-icon');
        const oldName = group.title;

        // Hide the title and rename icon — keeps toggle layout/chevron stable
        titleSpan.style.visibility = 'hidden';
        if (renameIcon) renameIcon.style.visibility = 'hidden';

        const form = document.createElement('div');
        form.className = 'compact-color-picker__presets-rename-form';

        const field = document.createElement('div');
        field.className = 'compact-color-picker__presets-rename-field';

        const input = document.createElement('input');
        input.type = 'text';
        input.value = oldName;
        input.className = 'compact-color-picker__presets-rename-input';
        input.autocomplete = 'off';
        input.spellcheck = false;

        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'compact-color-picker__presets-rename-clear';
        clearBtn.tabIndex = -1;
        clearBtn.setAttribute('aria-label', 'Clear');
        clearBtn.innerHTML = '<svg width="6" height="6" viewBox="0 0 8 8" fill="none"><line x1="1" y1="1" x2="7" y2="7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="7" y1="1" x2="1" y2="7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

        const confirmBtn = document.createElement('button');
        confirmBtn.type = 'button';
        confirmBtn.className = 'compact-color-picker__presets-rename-confirm';
        confirmBtn.setAttribute('aria-label', 'Confirm rename');
        confirmBtn.innerHTML = '<svg width="11" height="8" viewBox="0 0 13 10" fill="none"><polyline points="1,5 5,9 12,1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

        field.append(input, clearBtn);
        form.append(field, confirmBtn);

        // Append to section (a plain div with position:relative), NOT to the
        // toggle button — inputs inside <button> elements can't receive normal
        // cursor-placement clicks in most browsers.
        // Position the form to pixel-match the toggle's bounds.
        section.appendChild(form);
        const top = toggle.offsetTop + 2;
        const height = toggle.offsetHeight - 4;
        form.style.top = `${top}px`;
        form.style.height = `${height}px`;

        // Defer focus+select until after the dblclick's own mouseup fires,
        // otherwise the browser clears the selection immediately.
        setTimeout(() => { input.focus(); input.select(); }, 0);

        let committed = false;
        const restore = () => {
          titleSpan.style.visibility = '';
          if (renameIcon) renameIcon.style.visibility = '';
          form.remove();
        };
        const commit = () => {
          if (committed) return;
          committed = true;
          const newName = input.value.trim();
          if (newName) {
            group.title = newName;
            this._renderSwatchCollections();
          } else {
            restore();
          }
        };
        const cancel = () => {
          if (committed) return;
          committed = true;
          restore();
        };

        input.addEventListener('blur', () => setTimeout(commit, 120));
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') { e.preventDefault(); cancel(); }
        });
        clearBtn.addEventListener('mousedown', (e) => e.preventDefault());
        clearBtn.addEventListener('click', () => { input.value = ''; input.focus(); });
        confirmBtn.addEventListener('mousedown', (e) => e.preventDefault());
        confirmBtn.addEventListener('click', () => commit());
      };

      toggle.addEventListener('click', (evt) => {
        if (section.querySelector('.compact-color-picker__presets-rename-form')) return;
        if (group.id !== 'recent' && evt.target.closest('.compact-color-picker__presets-rename-icon')) {
          this.selectedCollectionIndex = index;
          this.lastSelectionType = 'collection';
          this.selectedSwatchRef = null;
          this._syncRenderedSwatchSelection();
          startInlineRename();
          return;
        }
        this.selectedCollectionIndex = index;
        this.lastSelectionType = 'collection';
        this.selectedSwatchRef = null;
        this._syncRenderedSwatchSelection();
        setOpen(!group.open, true);
      });

      content.addEventListener('transitionend', () => {
        if (group.open) {
          content.style.maxHeight = 'none';
        }
      });

      setOpen(group.open, false);

      // Collection-level drag-over / drop for reordering collections
      section.addEventListener('dragover', (evt) => {
        if (!this.dragPayload || this.dragPayload.type !== 'collection') return;
        if (this.dragPayload.collectionIndex === index) return;
        evt.preventDefault();
        evt.dataTransfer.dropEffect = 'move';
        const rect = section.getBoundingClientRect();
        const insertBefore = evt.clientY < rect.top + rect.height / 2;
        this._clearCollectionDropIndicators();
        section.classList.add(insertBefore ? 'is-collection-drop-before' : 'is-collection-drop-after');
      });
      section.addEventListener('dragleave', (evt) => {
        if (this.dragPayload?.type !== 'collection') return;
        if (!section.contains(evt.relatedTarget)) {
          section.classList.remove('is-collection-drop-before', 'is-collection-drop-after');
        }
      });
      section.addEventListener('drop', (evt) => {
        if (!this.dragPayload || this.dragPayload.type !== 'collection') return;
        evt.preventDefault();
        const sourceIndex = this.dragPayload.collectionIndex;
        const rect = section.getBoundingClientRect();
        const insertBefore = evt.clientY < rect.top + rect.height / 2;
        const rawTarget = insertBefore ? index : index + 1;
        this._handleCollectionReorder(sourceIndex, rawTarget);
      });
    });

    const selectedIsRecent = this.swatchCollections[this.selectedCollectionIndex]?.id === 'recent';
    const cannotDelete = this.swatchCollections.length <= 1 ||
      (this.lastSelectionType !== 'swatch' && selectedIsRecent);
    if (this.removeCollectionBtn) this.removeCollectionBtn.disabled = cannotDelete;
  }

  _addSwatchCollection() {
    if (!this.pendingNewCollection) {
      this.pendingNewCollection = true;
      this.pendingCollectionRenameIndex = null;
      this.renamingSwatch = null;
      this.swatchRenameInputEl.value = `Collection ${this.swatchCollections.length + 1}`;
      this.swatchRenameInputEl.placeholder = 'Collection name...';
      this.swatchRenameFormEl.hidden = false;
      this.swatchRenameInputEl.focus();
      this.swatchRenameInputEl.select();
      return;
    }

    const nextIndex = this.swatchCollections.length + 1;
    const anchors = ['#ffffff', '#d9d9d9', '#8c8c8c', '#000000', '#ff6b6b', '#4dabf7', '#51cf66', '#ffd43b'];
    this.swatchCollections.forEach(entry => { entry.open = false; });
    const nextTitle = this.swatchRenameInputEl.value.trim() || `Collection ${nextIndex}`;
    this.swatchCollections.push({
      id: `swatch-group-${Date.now()}`,
      title: nextTitle,
      open: true,
      swatches: [],
    });
    this.selectedCollectionIndex = this.swatchCollections.length - 1;
    this.lastSelectionType = 'collection';
    this.selectedSwatchRef = null;
    this.pendingNewCollection = false;
    this._closeSwatchRename();
    this._renderSwatchCollections();
  }

  _loadStandardSwatchCollections() {
    const existing = this.swatchCollections.find(c => c.id === 'recent') || { id: 'recent', title: 'Recent', open: true, swatches: [] };
    this.swatchCollections = [
      existing,
      ...COLOR_SWATCH_GROUPS.map((group, groupIndex) => ({
        id: `swatch-group-${groupIndex + 1}`,
        title: group.title,
        open: false,
        swatches: generateSwatchColors(group.anchors, 72).map((hex, swatchIndex) => ({
          id: `swatch-${groupIndex + 1}-${swatchIndex + 1}`,
          hex,
          name: `${group.title} ${swatchIndex + 1}`,
        })),
      })),
    ];
    this.selectedCollectionIndex = 0;
    this.selectedSwatchRef = null;
    this.lastSelectionType = 'collection';
    this.pendingNewCollection = false;
    this._closeSwatchRename();
    this._renderSwatchCollections();
  }

  _removeSelectedSwatchCollection(collectionIndex = this.selectedCollectionIndex) {
    if (this.swatchCollections.length <= 1) return;
    if (this.swatchCollections[collectionIndex]?.id === 'recent') return;
    this.swatchCollections.splice(collectionIndex, 1);
    this.selectedCollectionIndex = Math.max(0, Math.min(this.selectedCollectionIndex, this.swatchCollections.length - 1));
    this.selectedSwatchRef = null;
    this.lastSelectionType = 'collection';
    this._closeSwatchRename();
    this._renderSwatchCollections();
  }

  _removeSelectedSwatchTarget() {
    if (this.lastSelectionType === 'swatch' && this.selectedSwatchRef) {
      this._deleteSwatchByRef(this.selectedSwatchRef.collectionIndex, this.selectedSwatchRef.swatchId);
      return;
    }
    this._removeSelectedSwatchCollection();
  }

  _openSwatchRename(collectionIndex, swatchId) {
    const swatch = this.swatchCollections[collectionIndex]?.swatches.find(entry => entry.id === swatchId);
    if (!swatch || !this.swatchRenameFormEl) return;
    this.renamingSwatch = { collectionIndex, swatchId };
    this.swatchRenameInputEl.value = swatch.name;
    this.swatchRenameFormEl.hidden = false;
    this.swatchRenameInputEl.focus();
    this.swatchRenameInputEl.select();
  }

  _closeSwatchRename() {
    this.renamingSwatch = null;
    this.pendingCollectionRenameIndex = null;
    if (this.pendingNewCollection) {
      this.pendingNewCollection = false;
    }
    if (this.swatchRenameFormEl) this.swatchRenameFormEl.hidden = true;
  }

  _commitSwatchRename() {
    if (this.pendingNewCollection) {
      this._addSwatchCollection();
      return;
    }
    if (this.pendingCollectionRenameIndex !== null) {
      const nextName = this.swatchRenameInputEl.value.trim();
      if (nextName) this.swatchCollections[this.pendingCollectionRenameIndex].title = nextName;
      this._closeSwatchRename();
      this._renderSwatchCollections();
      return;
    }
    if (!this.renamingSwatch) return;
    const { collectionIndex, swatchId } = this.renamingSwatch;
    const swatch = this.swatchCollections[collectionIndex]?.swatches.find(entry => entry.id === swatchId);
    const nextName = this.swatchRenameInputEl.value.trim();
    if (swatch && nextName) swatch.name = nextName;
    this._closeSwatchRename();
    this._renderSwatchCollections();
  }

  _renameSelectedSwatchTarget() {
    if (this.lastSelectionType === 'swatch' && this.selectedSwatchRef) {
      this._openSwatchRename(this.selectedSwatchRef.collectionIndex, this.selectedSwatchRef.swatchId);
      return;
    }
    if (this.swatchCollections[this.selectedCollectionIndex]?.id === 'recent') return;
    this.pendingNewCollection = false;
    this.pendingCollectionRenameIndex = this.selectedCollectionIndex;
    this.renamingSwatch = null;
    this.swatchRenameInputEl.value = this.swatchCollections[this.selectedCollectionIndex]?.title || '';
    this.swatchRenameInputEl.placeholder = 'Collection name...';
    this.swatchRenameFormEl.hidden = false;
    this.swatchRenameInputEl.focus();
    this.swatchRenameInputEl.select();
  }

  _deleteSwatchByRef(collectionIndex, swatchId) {
    const collection = this.swatchCollections[collectionIndex];
    if (!collection) return;
    collection.swatches = collection.swatches.filter(entry => entry.id !== swatchId);
    if (this.selectedSwatchRef?.collectionIndex === collectionIndex && this.selectedSwatchRef?.swatchId === swatchId) {
      this.selectedSwatchRef = null;
      this.lastSelectionType = 'collection';
    }
    this._renderSwatchCollections();
  }

  _addRecentColor(hex) {
    const recentCollection = this.swatchCollections.find(c => c.id === 'recent');
    if (!recentCollection) return;
    const recentIdx = this.swatchCollections.indexOf(recentCollection);
    const existingIndex = recentCollection.swatches.findIndex(s => s.hex === hex);
    if (existingIndex >= 0) {
      // Don't reorder when the click came from within the Recent collection itself
      const fromRecent = this.lastSelectionType === 'swatch' && this.selectedSwatchRef?.collectionIndex === recentIdx;
      if (!fromRecent) {
        const [existing] = recentCollection.swatches.splice(existingIndex, 1);
        recentCollection.swatches.unshift(existing);
      }
    } else {
      recentCollection.swatches.unshift({ id: `recent-${Date.now()}`, hex, name: hex });
      if (recentCollection.swatches.length > 24) recentCollection.swatches.length = 24;
    }
    this._refreshRecentGrid(recentIdx);
  }

  // Lightweight re-render for the Recent collection grid only.
  // Avoids a full _renderSwatchCollections() which rebuilds 500+ DOM nodes.
  _refreshRecentGrid(recentIdx) {
    if (!this.swatchScrollEl) return;
    const recentCollection = this.swatchCollections[recentIdx];
    if (!recentCollection) return;

    // Find the rendered section by position in the scroll container
    const sections = this.swatchScrollEl.querySelectorAll('.compact-color-picker__presets-section');
    const section = sections[recentIdx];
    if (!section) { this._renderSwatchCollections(); return; }

    const grid = section.querySelector('.compact-color-picker__presets-grid');
    if (!grid) { this._renderSwatchCollections(); return; }

    // Rebuild only the Recent grid's swatch buttons
    grid.innerHTML = '';
    recentCollection.swatches.forEach((swatch) => {
      const swatchBtn = document.createElement('button');
      swatchBtn.type = 'button';
      swatchBtn.className = 'compact-color-picker__preset-swatch';
      swatchBtn.dataset.collectionIndex = String(recentIdx);
      swatchBtn.dataset.swatchId = swatch.id;
      swatchBtn.setAttribute('aria-label', swatch.name);
      swatchBtn.title = swatch.name;
      swatchBtn.style.background = swatch.hex;
      swatchBtn.draggable = true;
      if (this.selectedSwatchRef?.collectionIndex === recentIdx && this.selectedSwatchRef?.swatchId === swatch.id) {
        swatchBtn.classList.add('is-selected');
      }
      swatchBtn.addEventListener('click', () => {
        this.selectedCollectionIndex = recentIdx;
        this.selectedSwatchRef = { collectionIndex: recentIdx, swatchId: swatch.id };
        this.lastSelectionType = 'swatch';
        this.setColor(swatch.hex, { commit: true });
        this._syncRenderedSwatchSelection();
      });
      swatchBtn.addEventListener('dblclick', (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        this.selectedCollectionIndex = recentIdx;
        this.selectedSwatchRef = { collectionIndex: recentIdx, swatchId: swatch.id };
        this.lastSelectionType = 'swatch';
        this._openSwatchRename(recentIdx, swatch.id);
      });
      swatchBtn.addEventListener('dragstart', (evt) => {
        this.dragPayload = { type: 'swatch', collectionIndex: recentIdx, swatchId: swatch.id };
        swatchBtn.classList.add('is-dragging');
        evt.dataTransfer.effectAllowed = 'move';
        evt.dataTransfer.setData('text/plain', swatch.hex);
      });
      swatchBtn.addEventListener('dragend', () => {
        swatchBtn.classList.remove('is-dragging');
        this.dragPayload = null;
        this._clearDropIndicators();
      });
      swatchBtn.addEventListener('dragover', (evt) => {
        if (!this.dragPayload || this.dragPayload.type === 'collection') return;
        evt.preventDefault();
        evt.stopPropagation();
        evt.dataTransfer.dropEffect = this.dragPayload.type === 'current' ? 'copy' : 'move';
        const rect = swatchBtn.getBoundingClientRect();
        const insertBefore = evt.clientX < rect.left + (rect.width / 2);
        const baseIndex = recentCollection.swatches.findIndex(e => e.id === swatch.id);
        this._markDropTarget(grid, baseIndex + (insertBefore ? 0 : 1));
      });
      swatchBtn.addEventListener('drop', (evt) => {
        if (!this.dragPayload || this.dragPayload.type === 'collection') return;
        evt.preventDefault();
        evt.stopPropagation();
        const rect = swatchBtn.getBoundingClientRect();
        const insertBefore = evt.clientX < rect.left + (rect.width / 2);
        const baseIndex = recentCollection.swatches.findIndex(e => e.id === swatch.id);
        this._handleSwatchDrop(recentIdx, baseIndex + (insertBefore ? 0 : 1));
      });
      grid.appendChild(swatchBtn);
    });

    // Keep the content height consistent (open/closed state is unchanged)
    if (recentCollection.open) {
      const content = section.querySelector('.compact-color-picker__presets-content');
      if (content) content.style.maxHeight = 'none';
    }
  }

  _clearCollectionDropIndicators() {
    this.swatchScrollEl?.querySelectorAll('.compact-color-picker__presets-section').forEach(s => {
      s.classList.remove('is-collection-drop-before', 'is-collection-drop-after');
    });
  }

  _handleCollectionReorder(sourceIndex, targetIndex) {
    if (sourceIndex < 1) return; // Recent can't be moved
    targetIndex = Math.max(1, targetIndex); // Never before Recent
    if (sourceIndex === targetIndex || sourceIndex + 1 === targetIndex) {
      this._clearCollectionDropIndicators();
      return;
    }
    const [moved] = this.swatchCollections.splice(sourceIndex, 1);
    let insertAt = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
    insertAt = Math.max(1, insertAt);
    this.swatchCollections.splice(insertAt, 0, moved);
    this.selectedCollectionIndex = insertAt;
    this.lastSelectionType = 'collection';
    this.dragPayload = null;
    this._clearCollectionDropIndicators();
    this._renderSwatchCollections();
  }

  _markDropTarget(grid, index) {
    this._clearDropIndicators();
    grid.classList.add('is-drop-target');
    const children = [...grid.children];
    const markerIndex = Math.max(0, Math.min(index, children.length));
    if (markerIndex < children.length) {
      children[markerIndex].classList.add('is-drop-before');
    } else if (children.length > 0) {
      children[children.length - 1].classList.add('is-drop-after');
    } else {
      grid.classList.add('is-drop-empty');
    }
  }

  _clearDropIndicators() {
    this.swatchScrollEl?.querySelectorAll('.compact-color-picker__presets-grid').forEach(grid => {
      grid.classList.remove('is-drop-target', 'is-drop-empty');
    });
    this.swatchScrollEl?.querySelectorAll('.compact-color-picker__preset-swatch').forEach(swatch => {
      swatch.classList.remove('is-drop-before', 'is-drop-after');
    });
  }

  _syncRenderedSwatchSelection() {
    this.swatchScrollEl?.querySelectorAll('.compact-color-picker__presets-section').forEach((section, index) => {
      section.classList.toggle('is-selected', index === this.selectedCollectionIndex);
    });
    this.swatchScrollEl?.querySelectorAll('.compact-color-picker__preset-swatch').forEach(swatchEl => {
      const collectionIndex = Number(swatchEl.dataset.collectionIndex);
      const swatchId = swatchEl.dataset.swatchId;
      const selected = this.selectedSwatchRef
        && collectionIndex === this.selectedSwatchRef.collectionIndex
        && swatchId === this.selectedSwatchRef.swatchId;
      swatchEl.classList.toggle('is-selected', !!selected);
    });
  }

  _handleSwatchDrop(targetCollectionIndex, targetIndex) {
    if (!this.dragPayload) return;
    const targetCollection = this.swatchCollections[targetCollectionIndex];
    if (!targetCollection) return;

    if (this.dragPayload.type === 'current') {
      targetCollection.swatches.splice(targetIndex, 0, {
        id: `swatch-current-${Date.now()}`,
        hex: this.dragPayload.hex,
        name: this.dragPayload.name,
      });
    } else if (this.dragPayload.type === 'swatch') {
      const sourceCollection = this.swatchCollections[this.dragPayload.collectionIndex];
      if (!sourceCollection) return;
      const sourceIndex = sourceCollection.swatches.findIndex(entry => entry.id === this.dragPayload.swatchId);
      if (sourceIndex < 0) return;
      const [moved] = sourceCollection.swatches.splice(sourceIndex, 1);
      if (!moved) return;

      let insertIndex = targetIndex;
      if (sourceCollection === targetCollection && sourceIndex < targetIndex) {
        insertIndex -= 1;
      }
      targetCollection.swatches.splice(Math.max(0, insertIndex), 0, moved);
    }

    this.dragPayload = null;
    this._clearDropIndicators();
    this._renderSwatchCollections();
  }

  _configureCanvasResolution() {
    const panelWidth = this.panelEl.clientWidth || 252;
    const innerWidth = Math.max(180, panelWidth - 20);
    this.canvasEl.style.width = `${innerWidth}px`;
    this.canvasEl.style.height = `${innerWidth}px`;
    this.sliderEl.style.width = `${innerWidth}px`;
    this.sliderEl.style.height = `${COLOR_SLIDER_HEIGHT}px`;

    this.canvasEl.width = Math.round(innerWidth * this.renderScale);
    this.canvasEl.height = Math.round(innerWidth * this.renderScale);
    this.sliderEl.width = Math.round(innerWidth * this.renderScale);
    this.sliderEl.height = Math.round(COLOR_SLIDER_HEIGHT * this.renderScale);
  }

  _makeModeButton(label, mode) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'compact-color-picker__mode-btn';
    button.dataset.mode = mode;
    button.textContent = label;
    button.addEventListener('click', () => this.setMode(mode));
    return button;
  }

  _buildFieldGroup(title, labels, min, max, step, keys) {
    const group = document.createElement('div');
    group.className = 'compact-color-picker__group';

    const titleEl = document.createElement('div');
    titleEl.className = 'compact-color-picker__group-title';
    titleEl.textContent = title;
    group.appendChild(titleEl);

    const rows = {};
    labels.forEach((label, index) => {
      const row = document.createElement('label');
      row.className = 'compact-color-picker__field';

      const labelEl = document.createElement('span');
      labelEl.className = 'compact-color-picker__field-label';
      labelEl.textContent = label;

      const input = document.createElement('input');
      input.type = 'number';
      input.inputMode = 'decimal';
      input.className = 'value-input compact-color-picker__field-input';
      input.min = Array.isArray(min) ? min[index] : min;
      input.max = Array.isArray(max) ? max[index] : max;
      input.step = Array.isArray(step) ? step[index] : step;
      input.dataset.channel = keys[index];

      row.append(labelEl, input);
      group.appendChild(row);
      this.wrapInput?.(input);
      rows[keys[index]] = input;
    });

    return { group, rows };
  }

  _bindLauncher() {
    if (!this.pickerEl) return;
    this.pickerEl.type = 'button';
    this.pickerEl.value = '';
    this.pickerEl.textContent = '';
    this.pickerEl.removeAttribute('value');
    this.pickerEl.setAttribute('aria-label', 'Open color picker');
    this.pickerEl.classList.add('colorPicker--launcher');
    this.pickerEl.addEventListener('click', (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      this.isOpen ? this.close() : this.open();
    });
    if (this.swatchEl && this.swatchEl !== this.pickerEl) {
      this.swatchEl.addEventListener('click', (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        this.isOpen ? this.close() : this.open();
      });
    }
  }

  _bindPanelEvents() {
    this.previewHexEl.addEventListener('change', () => {
      const normalized = this._normalizeHex(this.previewHexEl.value);
      if (normalized) this.setColor(normalized, { commit: true });
      else this.previewHexEl.value = this.state.hex;
    });

    this.copyHexBtn?.addEventListener('click', () => {
      navigator.clipboard?.writeText(this.state.hex);
    });
    this.previewSwatchEl.addEventListener('dragstart', (evt) => {
      this.dragPayload = {
        type: 'current',
        hex: this.state.hex,
        name: 'Current Color',
      };
      this.previewSwatchEl.classList.add('is-dragging');
      evt.dataTransfer.effectAllowed = 'copy';
      evt.dataTransfer.setData('text/plain', this.state.hex);
    });
    this.previewSwatchEl.addEventListener('dragend', () => {
      this.previewSwatchEl.classList.remove('is-dragging');
      this.dragPayload = null;
      this._clearDropIndicators?.();
    });

    this._bindGroupInputs(this.rgbInputs.rows, 'rgb');
    this._bindGroupInputs(this.hsvInputs.rows, 'hsv');
    this._bindGroupInputs(this.cmykInputs.rows, 'cmyk');
    this._bindCanvasDrag(this.canvasEl, 'canvas');
    this._bindCanvasDrag(this.sliderEl, 'slider');

    document.addEventListener('mousedown', (evt) => {
      if (!this.isOpen) return;
      if (this.panelEl.contains(evt.target) || this.pickerEl.contains(evt.target)) return;
      this.close();
    });

    document.addEventListener('keydown', (evt) => {
      if (this.isOpen && evt.key === 'Escape') this.close();
    });

    window.addEventListener('resize', () => this.isOpen && this._positionPanel());
    window.addEventListener('scroll', () => this.isOpen && this._positionPanel(), true);
  }

  _bindGroupInputs(rows, mode) {
    Object.values(rows).forEach(input => {
      input.addEventListener('input', () => this._applyFieldValues(mode, false));
      input.addEventListener('change', () => this._applyFieldValues(mode, true));
    });
  }

  _applyFieldValues(mode, commit) {
    if (mode === 'rgb') {
      this._setStateFromRgb({
        r: clamp(parseFloat(this.rgbInputs.rows.r.value) || 0, 0, 255),
        g: clamp(parseFloat(this.rgbInputs.rows.g.value) || 0, 0, 255),
        b: clamp(parseFloat(this.rgbInputs.rows.b.value) || 0, 0, 255),
      }, { commit });
      return;
    }

    if (mode === 'hsv') {
      this._setStateFromHsv({
        h: clamp(parseFloat(this.hsvInputs.rows.h.value) || 0, 0, 360),
        s: clamp(parseFloat(this.hsvInputs.rows.s.value) || 0, 0, 100),
        v: clamp(parseFloat(this.hsvInputs.rows.v.value) || 0, 0, 100),
      }, { commit });
      return;
    }

    this._setStateFromRgb(cmykToRgb({
      c: clamp(parseFloat(this.cmykInputs.rows.c.value) || 0, 0, 100),
      m: clamp(parseFloat(this.cmykInputs.rows.m.value) || 0, 0, 100),
      y: clamp(parseFloat(this.cmykInputs.rows.y.value) || 0, 0, 100),
      k: clamp(parseFloat(this.cmykInputs.rows.k.value) || 0, 0, 100),
    }), { commit });
  }

  _bindCanvasDrag(element, target) {
    element.addEventListener('pointerdown', (evt) => {
      evt.preventDefault();
      this.dragTarget = target;
      this.isDragging = true;
      element.setPointerCapture(evt.pointerId);
      this._handlePointer(evt, target, false);
    });

    element.addEventListener('pointermove', (evt) => {
      if (this.isDragging && this.dragTarget === target) this._handlePointer(evt, target, false);
    });

    element.addEventListener('pointerup', (evt) => {
      if (!this.isDragging || this.dragTarget !== target) return;
      this._handlePointer(evt, target, true);
      this.isDragging = false;
      this.dragTarget = null;
      element.releasePointerCapture(evt.pointerId);
    });
  }

  _handlePointer(evt, target, commit) {
    const pos = pointerPosition(evt, target === 'canvas' ? this.canvasEl : this.sliderEl);
    const hsv = { ...this.state.hsv };

    if (target === 'canvas') {
      if (this.mode === 'square') {
        hsv.s = (pos.x / pos.width) * 100;
        hsv.v = (1 - pos.y / pos.height) * 100;
      } else {
        const cx = pos.width / 2;
        const cy = pos.height / 2;
        const dx = pos.x - cx;
        const dy = pos.y - cy;
        const radius = Math.min(pos.width, pos.height) / 2;
        const distance = clamp(Math.sqrt(dx * dx + dy * dy), 0, radius);
        hsv.h = ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360;
        hsv.s = (distance / radius) * 100;
      }
    } else if (this.mode === 'square') {
      hsv.h = (pos.x / pos.width) * 360;
    } else {
      hsv.v = (pos.x / pos.width) * 100;
    }

    this._setStateFromHsv(hsv, { commit });
  }

  _normalizeHex(value) {
    const normalized = String(value || '').trim();
    const withHash = normalized.startsWith('#') ? normalized : `#${normalized}`;
    return /^#[0-9a-fA-F]{6}$/.test(withHash) ? withHash.toLowerCase() : null;
  }

  open() {
    if (CompactColorPicker.active && CompactColorPicker.active !== this) CompactColorPicker.active.close();
    CompactColorPicker.active = this;
    this.isOpen = true;
    this.panelEl.hidden = false;
    this._configureCanvasResolution();
    this._positionPanel();
    this.render();
  }

  close() {
    if (CompactColorPicker.active === this) CompactColorPicker.active = null;
    this.isOpen = false;
    this.panelEl.hidden = true;
  }

  setMode(mode) {
    this.mode = mode;
    this.squareModeBtn.classList.toggle('is-active', mode === 'square');
    this.circleModeBtn.classList.toggle('is-active', mode === 'circle');
    this.canvasEl.classList.toggle('is-round', mode === 'circle');
    this.render();
  }

  setColor(hex, options = {}) {
    const normalized = this._normalizeHex(hex);
    if (!normalized) return;
    const rgb = hexToRgb(normalized);
    if (rgb) this._setStateFromRgb(rgb, options);
  }

  _setStateFromRgb(rgb, { emit = true, commit = false } = {}) {
    const normalizedRgb = {
      r: clamp(Math.round(rgb.r), 0, 255),
      g: clamp(Math.round(rgb.g), 0, 255),
      b: clamp(Math.round(rgb.b), 0, 255),
    };
    this.state.rgb = normalizedRgb;
    this.state.hex = rgbToHex(normalizedRgb);
    this.state.hsv = rgbToHsv(normalizedRgb);
    this.state.cmyk = rgbToCmyk(normalizedRgb);
    this._syncUI(emit, commit);
  }

  _setStateFromHsv(hsv, { emit = true, commit = false } = {}) {
    this.state.hsv = {
      h: clamp(hsv.h, 0, 360),
      s: clamp(hsv.s, 0, 100),
      v: clamp(hsv.v, 0, 100),
    };
    this.state.rgb = hsvToRgb(this.state.hsv);
    this.state.hex = rgbToHex(this.state.rgb);
    this.state.cmyk = rgbToCmyk(this.state.rgb);
    this._syncUI(emit, commit);
  }

  _syncUI(emit, commit) {
    const { hex, rgb, hsv, cmyk } = this.state;
    this.pickerEl.value = '';
    this.pickerEl.textContent = '';
    this.pickerEl.removeAttribute('value');
    this.pickerEl.style.setProperty('--picker-color', hex);
    this.hexEl.value = hex;
    if (this.swatchEl) this.swatchEl.style.background = hex;
    this.previewSwatchEl.style.background = hex;
    this.previewHexEl.value = hex;

    this.rgbInputs.rows.r.value = Math.round(rgb.r);
    this.rgbInputs.rows.g.value = Math.round(rgb.g);
    this.rgbInputs.rows.b.value = Math.round(rgb.b);
    this.hsvInputs.rows.h.value = Math.round(hsv.h);
    this.hsvInputs.rows.s.value = Math.round(hsv.s);
    this.hsvInputs.rows.v.value = Math.round(hsv.v);
    this.cmykInputs.rows.c.value = Math.round(cmyk.c);
    this.cmykInputs.rows.m.value = Math.round(cmyk.m);
    this.cmykInputs.rows.y.value = Math.round(cmyk.y);
    this.cmykInputs.rows.k.value = Math.round(cmyk.k);

    this.render();
    if (emit) this.onLiveChange?.(hex);
    if (commit) {
      this.onCommitChange?.(hex);
      this._addRecentColor(hex);
    }
  }

  _positionPanel() {
    const anchorEl = this.swatchEl || this.pickerEl;
    const rect = anchorEl.getBoundingClientRect();
    const panelWidth = this.panelEl.offsetWidth || 252;
    const panelHeight = this.panelEl.offsetHeight || 362;
    let left = rect.right - panelWidth;
    let top = rect.bottom + 8;

    if (left + panelWidth > window.innerWidth - 8) left = window.innerWidth - panelWidth - 8;
    if (top + panelHeight > window.innerHeight - 8) top = rect.top - panelHeight - 8;
    if (top < 8) top = 8;
    if (left < 8) left = 8;

    this.panelEl.style.left = `${Math.round(left)}px`;
    this.panelEl.style.top = `${Math.round(top)}px`;
  }

  render() {
    const ctx = this.canvasEl.getContext('2d');
    const sliderCtx = this.sliderEl.getContext('2d');
    const { hsv } = this.state;
    if (!ctx || !sliderCtx) return;
    ctx.imageSmoothingEnabled = true;
    sliderCtx.imageSmoothingEnabled = true;
    ctx.clearRect(0, 0, this.canvasEl.width, this.canvasEl.height);
    sliderCtx.clearRect(0, 0, this.sliderEl.width, this.sliderEl.height);

    if (this.mode === 'square') {
      this._drawSquare(ctx, hsv);
      this._drawHueSlider(sliderCtx);
      this.sliderLabelEl.textContent = 'Hue';
    } else {
      this._drawWheel(ctx, hsv);
      this._drawValueSlider(sliderCtx, hsv);
      this.sliderLabelEl.textContent = 'Brightness';
    }
  }

  _drawSquare(ctx, hsv) {
    const { width, height } = this.canvasEl;
    ctx.fillStyle = `hsl(${hsv.h}, 100%, 50%)`;
    ctx.fillRect(0, 0, width, height);

    const whiteGradient = ctx.createLinearGradient(0, 0, width, 0);
    whiteGradient.addColorStop(0, '#fff');
    whiteGradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = whiteGradient;
    ctx.fillRect(0, 0, width, height);

    const blackGradient = ctx.createLinearGradient(0, 0, 0, height);
    blackGradient.addColorStop(0, 'rgba(0,0,0,0)');
    blackGradient.addColorStop(1, '#000');
    ctx.fillStyle = blackGradient;
    ctx.fillRect(0, 0, width, height);

    const x = (hsv.s / 100) * width;
    const y = height - (hsv.v / 100) * height;
    this._drawCrosshair(ctx, x, y);
  }

  _drawWheel(ctx, hsv) {
    const { width, height } = this.canvasEl;
    const image = ctx.createImageData(width, height);
    // Firefox can show a faint clipped gap when the wheel stops exactly at the
    // masked circle edge, so we intentionally overdraw a little past the clip.
    const cx = (width - 1) / 2;
    const cy = (height - 1) / 2;
    const radius = (Math.min(width, height) / 2) + (this.renderScale * 2);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const index = (y * width + x) * 4;
        if (distance > radius) {
          image.data[index + 3] = 0;
          continue;
        }
        const saturation = (distance / radius) * 100;
        const hue = ((Math.atan2(dy, dx) / TWO_PI) * 360 + 360) % 360;
        const rgb = hsvToRgb({ h: hue, s: saturation, v: hsv.v });
        image.data[index] = rgb.r;
        image.data[index + 1] = rgb.g;
        image.data[index + 2] = rgb.b;
        image.data[index + 3] = 255;
      }
    }

    ctx.putImageData(image, 0, 0);
    const angle = (hsv.h / 180) * Math.PI;
    const distance = (hsv.s / 100) * radius;
    this._drawCrosshair(ctx, cx + Math.cos(angle) * distance, cy + Math.sin(angle) * distance);
  }

  _drawHueSlider(ctx) {
    const gradient = ctx.createLinearGradient(0, 0, this.sliderEl.width, 0);
    [
      [0, '#ff0000'],
      [1 / 6, '#ffff00'],
      [2 / 6, '#00ff00'],
      [3 / 6, '#00ffff'],
      [4 / 6, '#0000ff'],
      [5 / 6, '#ff00ff'],
      [1, '#ff0000'],
    ].forEach(([stop, color]) => gradient.addColorStop(stop, color));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.sliderEl.width, this.sliderEl.height);
    this._drawSliderMarker(ctx, (this.state.hsv.h / 360) * this.sliderEl.width);
  }

  _drawValueSlider(ctx, hsv) {
    const gradient = ctx.createLinearGradient(0, 0, this.sliderEl.width, 0);
    gradient.addColorStop(0, '#000');
    gradient.addColorStop(1, rgbToHex(hsvToRgb({ h: hsv.h, s: hsv.s, v: 100 })));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.sliderEl.width, this.sliderEl.height);
    this._drawSliderMarker(ctx, (hsv.v / 100) * this.sliderEl.width);
  }

  _drawSliderMarker(ctx, x) {
    const scale = this.renderScale;
    ctx.save();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2 * scale;
    ctx.beginPath();
    ctx.moveTo(x, 1 * scale);
    ctx.lineTo(x, this.sliderEl.height - (1 * scale));
    ctx.stroke();
    ctx.restore();
  }

  _drawCrosshair(ctx, x, y) {
    const scale = this.renderScale;
    ctx.save();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2 * scale;
    ctx.beginPath();
    ctx.arc(x, y, 6 * scale, 0, TWO_PI);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 1 * scale;
    ctx.beginPath();
    ctx.arc(x, y, 8 * scale, 0, TWO_PI);
    ctx.stroke();
    ctx.restore();
  }
}

// ── Reusable custom styled dropdown with optional thumbnail support ──────────
export class CustomSelect {
  constructor(container) {
    this._container      = container;
    this._value          = '';
    this._handlers       = [];
    this._open           = false;
    this._thumbMap       = new Map(); // value → dataUrl
    this._getThumbnailFn = null;      // (name) => dataUrl | null
    this._getEnvKeyFn    = null;      // () => string  — identifies current environment
    this._lastEnvKey     = undefined; // env key at last render
    this._rerenderSeq    = 0;         // incremented to cancel stale batches
    this._items          = [];
    this._build();
  }

  _build() {
    this._container.classList.add('custom-select');

    this._trigger = document.createElement('div');
    this._trigger.className = 'custom-select__trigger';

    // Thumbnail shown in the trigger for the currently selected item
    this._triggerThumb = document.createElement('img');
    this._triggerThumb.className = 'custom-select__thumb custom-select__trigger-thumb';
    this._triggerThumb.alt = '';
    this._triggerThumb.style.display = 'none';

    this._label = document.createElement('span');
    this._label.className = 'custom-select__value';
    this._label.textContent = '— Select preset —';

    const arrow = document.createElement('span');
    arrow.className = 'custom-select__arrow';

    this._trigger.append(this._triggerThumb, this._label, arrow);

    this._dropdown = document.createElement('div');
    this._dropdown.className = 'custom-select__dropdown';

    this._container.append(this._trigger, this._dropdown);

    this._trigger.addEventListener('click', e => { e.stopPropagation(); this._toggle(); });

    // On hover: if environment has changed since last render, kick off a lazy re-render
    this._trigger.addEventListener('mouseenter', () => {
      if (!this._getThumbnailFn) return;
      const envKey = this._getEnvKeyFn?.();
      if (envKey !== this._lastEnvKey) this._scheduleRerender();
    });

    document.addEventListener('click', e => {
      if (!this._container.contains(e.target)) this._close();
    });

    this._container.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this._toggle(); }
      if (e.key === 'Escape') this._close();
    });
  }

  _toggle() { this._open ? this._close() : this._openDropdown(); }

  _openDropdown() {
    this._open = true;
    this._container.classList.add('is-open');
  }

  _close() {
    this._open = false;
    this._container.classList.remove('is-open');
  }

  _setTriggerThumb(value) {
    const url = this._thumbMap.get(value);
    if (url) {
      this._triggerThumb.src = url;
      this._triggerThumb.style.display = '';
    } else {
      this._triggerThumb.style.display = 'none';
    }
  }

  /**
   * Re-render thumbnails for the currently-visible portion first, then
   * lazily render the rest in small batches without blocking the main thread.
   */
  _scheduleRerender() {
    const token    = ++this._rerenderSeq;
    const itemEls  = [...this._dropdown.querySelectorAll('.custom-select__option')];
    if (!itemEls.length || !this._getThumbnailFn) return;

    // Approximate items visible in the 220px max-height dropdown (~32px per row)
    const VISIBLE = Math.ceil(220 / 32) + 1;

    // Render the visible portion synchronously (fast — user is about to open)
    for (let i = 0; i < Math.min(VISIBLE, itemEls.length); i++) {
      this._rerenderItem(itemEls[i]);
    }

    // Lazily render the rest in batches of 3, ~20 ms apart
    let idx = VISIBLE;
    const renderBatch = () => {
      if (token !== this._rerenderSeq) return; // superseded by a newer call
      const end = Math.min(idx + 3, itemEls.length);
      for (; idx < end; idx++) this._rerenderItem(itemEls[idx]);
      if (idx < itemEls.length) setTimeout(renderBatch, 20);
    };
    if (idx < itemEls.length) setTimeout(renderBatch, 20);

    this._lastEnvKey = this._getEnvKeyFn?.();
  }

  _rerenderItem(optEl) {
    const name    = optEl.dataset.value;
    const dataUrl = this._getThumbnailFn(name, 64); // HQ upgrade on hover
    if (!dataUrl) return;
    this._thumbMap.set(name, dataUrl);
    const img = optEl.querySelector('.custom-select__thumb');
    if (img) img.src = dataUrl;
    if (name === this._value) this._setTriggerThumb(name);
  }

  /**
   * @param {string[]} items
   * @param {(name: string) => string|null} [getThumbnail]
   * @param {() => string} [getEnvKey] — returns a key identifying current environment
   */
  populate(items, getThumbnail, getEnvKey) {
    this._items          = Array.isArray(items) ? items
                           : (items.groups || []).flatMap(g => g.items);
    this._getThumbnailFn = getThumbnail ?? null;
    this._getEnvKeyFn    = getEnvKey   ?? null;
    this._lastEnvKey     = getEnvKey?.();
    this._thumbMap.clear();
    this._dropdown.innerHTML = '';

    // Support grouped items: { groups: [{ label, items }] } or flat string[]
    const groups = Array.isArray(items)
      ? [{ label: null, items }]
      : (items.groups || []);

    groups.forEach((group, gi) => {
      if (group.label && group.items.length > 0) {
        const header = document.createElement('div');
        header.className = 'custom-select__group-label';
        header.textContent = group.label;
        this._dropdown.appendChild(header);
      }

      group.items.forEach(name => {
        const opt = document.createElement('div');
        opt.className = 'custom-select__option';
        opt.dataset.value = name;
        if (name === this._value) opt.classList.add('is-active');

        if (getThumbnail) {
          const dataUrl = getThumbnail(name, 32);
          if (dataUrl) {
            this._thumbMap.set(name, dataUrl);
            const img = document.createElement('img');
            img.className = 'custom-select__thumb';
            img.src = dataUrl;
            img.alt = '';
            opt.appendChild(img);
          }
        }

        const label = document.createElement('span');
        label.className = 'custom-select__option-label';
        label.textContent = name;
        opt.appendChild(label);

        opt.addEventListener('click', () => this._select(name));
        this._dropdown.appendChild(opt);
      });

      if (gi < groups.length - 1 && group.items.length > 0) {
        const sep = document.createElement('div');
        sep.className = 'custom-select__separator';
        this._dropdown.appendChild(sep);
      }
    });

    this._setTriggerThumb(this._value);
  }

  _select(value) {
    this._value = value;
    this._label.textContent = value;
    this._setTriggerThumb(value);
    this._dropdown.querySelectorAll('.custom-select__option').forEach(o =>
      o.classList.toggle('is-active', o.dataset.value === value)
    );
    this._close();
    this._handlers.forEach(cb => cb(value));
  }

  get value()  { return this._value; }
  set value(v) {
    if (!v) return;
    this._value = v;
    this._label.textContent = v;
    this._setTriggerThumb(v);
    this._dropdown.querySelectorAll('.custom-select__option').forEach(o =>
      o.classList.toggle('is-active', o.dataset.value === v)
    );
  }

  /** Register a value-change handler. */
  onChange(cb) { this._handlers.push(cb); }
}

export class ControlsManager {
  constructor(callbacks) {
    this.callbacks = callbacks;
    this.elements = {};
    this.colorPickers = new Map();
    this.initialize();
  }

  initialize() {
    this.elements = {
      // Setting 1 - Scene setup
      objectSelect: document.getElementById('object-select'),
      sceneSelect: document.getElementById('environment-select'),   // maps to HDR env

      // Setting 2 - Design editor (UV overlay)
      textureImageUpload: document.getElementById('texture-image-upload'),
      resetTextureBtn: document.getElementById('reset-texture-btn'),
      designPosXSlider: document.getElementById('design-posx-slider'),
      designPosXInput: document.getElementById('design-posx-input'),
      designPosYSlider: document.getElementById('design-posy-slider'),
      designPosYInput: document.getElementById('design-posy-input'),
      designWidthSlider: document.getElementById('design-width-slider'),
      designWidthInput: document.getElementById('design-width-input'),
      designHeightSlider: document.getElementById('design-height-slider'),
      designHeightInput: document.getElementById('design-height-input'),
      designRotationSlider: document.getElementById('design-rotation-slider'),
      designRotationInput: document.getElementById('design-rotation-input'),

      // Setting 3 - Material
      materialSelect: document.getElementById('material-select'),
      objectSelectMaterialTab: document.getElementById('object-select-materialtab'),
      objectPartSelect: document.getElementById('object-part-select'),
      materialBasicSection: document.getElementById('material-basic-toggle'),
      materialBasicContent: document.getElementById('material-basic-content'),
      materialAdvancedSection: document.getElementById('material-advanced-toggle'),
      materialAdvancedContent: document.getElementById('material-advanced-content'),

      // Base
      basecolorPicker: document.getElementById('basecolor-picker'),
      basecolorHex: document.getElementById('basecolor-hex'),
      metalnessSlider: document.getElementById('metalness-slider'),
      metalnessInput: document.getElementById('metalness-input'),
      roughnessSlider: document.getElementById('roughness-slider'),
      roughnessInput: document.getElementById('roughness-input'),

      // Specular
      speccolorPicker: document.getElementById('speccolor-picker'),
      speccolorHex: document.getElementById('speccolor-hex'),
      specintSlider: document.getElementById('specint-slider'),
      specintInput: document.getElementById('specint-input'),

      // Clearcoat
      clearcoatSlider: document.getElementById('clearcoat-slider'),
      clearcoatInput: document.getElementById('clearcoat-input'),
      clearcoatroughSlider: document.getElementById('clearcoatrough-slider'),
      clearcoatroughInput: document.getElementById('clearcoatrough-input'),

      // Opacity
      opacitySlider: document.getElementById('opacity-slider'),
      opacityInput: document.getElementById('opacity-input'),

      // Transmission
      transmissionSlider: document.getElementById('transmission-slider'),
      transmissionInput: document.getElementById('transmission-input'),
      iorSlider: document.getElementById('ior-slider'),
      iorInput: document.getElementById('ior-input'),
      thicknessSlider: document.getElementById('thickness-slider'),
      thicknessInput: document.getElementById('thickness-input'),
      attdistSlider: document.getElementById('attdist-slider'),
      attdistInput: document.getElementById('attdist-input'),
      attcolorPicker: document.getElementById('attcolor-picker'),
      attcolorHex: document.getElementById('attcolor-hex'),

      // Sheen
      sheencolorPicker: document.getElementById('sheencolor-picker'),
      sheencolorHex: document.getElementById('sheencolor-hex'),
      sheenroughSlider: document.getElementById('sheenrough-slider'),
      sheenroughInput: document.getElementById('sheenrough-input'),

      // Emissive
      emissivecolorPicker: document.getElementById('emissivecolor-picker'),
      emissiveHex: document.getElementById('emissive-hex'),
      emissiveintSlider: document.getElementById('emissiveint-slider'),
      emissiveintInput: document.getElementById('emissiveint-input'),

      // Env map intensity
      envintSlider: document.getElementById('envint-slider'),
      envintInput: document.getElementById('envint-input'),

      // Anisotropy
      anisotropySlider: document.getElementById('anisotropy-slider'),
      anisotropyInput: document.getElementById('anisotropy-input'),
      anisotropyRotationSlider: document.getElementById('anisotropy-rotation-slider'),
      anisotropyRotationInput: document.getElementById('anisotropy-rotation-input'),

      // Iridescence
      iridescenceSlider: document.getElementById('iridescence-slider'),
      iridescenceInput: document.getElementById('iridescence-input'),
      iridescenceIorSlider: document.getElementById('iridescence-ior-slider'),
      iridescenceIorInput: document.getElementById('iridescence-ior-input'),
      iridescenceThicknessMinSlider: document.getElementById('iridescence-thickness-min-slider'),
      iridescenceThicknessMinInput: document.getElementById('iridescence-thickness-min-input'),
      iridescenceThicknessMaxSlider: document.getElementById('iridescence-thickness-max-slider'),
      iridescenceThicknessMaxInput: document.getElementById('iridescence-thickness-max-input'),

      // Dispersion
      dispersionSlider: document.getElementById('dispersion-slider'),
      dispersionInput: document.getElementById('dispersion-input'),

      // Reflectivity
      reflectivitySlider: document.getElementById('reflectivity-slider'),
      reflectivityInput: document.getElementById('reflectivity-input'),

      // Sheen intensity (explicit)
      sheenSlider: document.getElementById('sheen-slider'),
      sheenInput: document.getElementById('sheen-input'),

      // Normal scale
      normalScaleSlider: document.getElementById('normal-scale-slider'),
      normalScaleInput: document.getElementById('normal-scale-input'),

      // Old model management buttons (kept for compatibility)
      uploadModelBtn: document.getElementById('upload-model-btn'),
      modelFileInput: document.getElementById('model-file-input'),
      exportBtn: document.getElementById('export-btn'),
      importBtn: document.getElementById('import-btn'),
      fileInput: document.getElementById('file-input'),
      clearCustomBtn: document.getElementById('clear-custom-btn'),
      modelSelect: document.getElementById('model-select'),

      // Grid settings popup
      gridSettingsBtn:       document.getElementById('tf-grid-settings'),
      gridSettingsPopup:     document.getElementById('grid-settings-popup'),
      gridSizeSlider:        document.getElementById('grid-size-slider'),
      gridSizeInput:         document.getElementById('grid-size-input'),
      gridDivisionsSlider:   document.getElementById('grid-divisions-slider'),
      gridDivisionsInput:    document.getElementById('grid-divisions-input'),
      gridSubsSlider:        document.getElementById('grid-subdivisions-slider'),
      gridSubsInput:         document.getElementById('grid-subdivisions-input'),
    };

    const missing = Object.entries(this.elements)
      .filter(([, el]) => !el)
      .map(([name]) => name);
    if (missing.length > 0) {
      log(`⚠️ Missing UI elements: ${missing.join(', ')}`);
    }

    this.initColorSwatches();
    this.enhanceValueInputs();
    this.setupEventListeners();
    this._setupChannelPickers();
    this.initMaterialSections();
    this.initGridSettings();

    // Custom material preset dropdown (replaces native <select>)
    if (this.elements.materialSelect) {
      this._matSelect = new CustomSelect(this.elements.materialSelect);
      this._matSelect.onChange(value => {
        this.callbacks.onMaterialChange?.(value);
        this.callbacks.onMaterialPropertyCommit?.();
      });
    }
  }

  // ─── Color swatch init ────────────────────────────────────────
  initColorSwatches() {
    const pairs = [
      ['basecolorPicker', 'basecolorSwatch', 'basecolorHex'],
      ['speccolorPicker', 'speccolorSwatch', 'speccolorHex'],
      ['attcolorPicker', 'attcolorSwatch', 'attcolorHex'],
      ['sheencolorPicker', 'sheencolorSwatch', 'sheencolorHex'],
      ['emissivecolorPicker', 'emissiveSwatch', 'emissiveHex'],
    ];
    pairs.forEach(([pickerKey, swatchKey, hexKey]) => {
      const picker = this.elements[pickerKey];
      const swatch = this.elements[swatchKey] || this._ensureColorSwatch(picker, swatchKey);
      const hex = this.elements[hexKey];
      if (picker && swatch) {
        swatch.style.backgroundColor = picker.value;
      }
      if (hex && picker) hex.value = picker.value;
    });
  }

  _ensureColorSwatch(picker, swatchKey) {
    if (!picker) return null;
    const field = picker.parentElement?.querySelector('.color-field');
    if (!field) return null;

    field.insertBefore(picker, field.firstChild);
    this.elements[swatchKey] = picker;
    return picker;
  }

  initMaterialSections() {
    this._bindMaterialSection(this.elements.materialBasicSection, this.elements.materialBasicContent, true);
    this._bindMaterialSection(this.elements.materialAdvancedSection, this.elements.materialAdvancedContent, false);
  }

  // ─── Grid settings popup ──────────────────────────────────────
  initGridSettings() {
    const el = this.elements;
    if (!el.gridSettingsBtn || !el.gridSettingsPopup) return;

    // Popup open / close
    el.gridSettingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = el.gridSettingsPopup.style.display !== 'none';
      el.gridSettingsPopup.style.display = open ? 'none' : 'block';
      el.gridSettingsBtn.classList.toggle('tf-btn--active', !open);
    });

    document.addEventListener('click', (e) => {
      if (!el.gridSettingsPopup.contains(e.target) && e.target !== el.gridSettingsBtn) {
        el.gridSettingsPopup.style.display = 'none';
        el.gridSettingsBtn.classList.remove('tf-btn--active');
      }
    });

    // Slider ↔ input sync — calls onGridChange on every change
    this.linkSliderInput(el.gridSizeSlider,      el.gridSizeInput,    (v) => this.callbacks.onGridChange?.('size',        Math.max(1, Math.round(v))));
    this.linkSliderInput(el.gridDivisionsSlider,  el.gridDivisionsInput, (v) => this.callbacks.onGridChange?.('divisions',  Math.max(1, Math.round(v))));
    this.linkSliderInput(el.gridSubsSlider,       el.gridSubsInput,    (v) => this.callbacks.onGridChange?.('subdivisions', Math.max(0, Math.round(v))));
  }

  enhanceValueInputs() {
    document.querySelectorAll('.value-input[type="number"]').forEach(input => this.wrapValueInput(input));
  }

  wrapValueInput(input) {
    if (!input || input.dataset.hasSpinner === 'true') return;

    const wrapper = document.createElement('div');
    wrapper.className = 'value-input-wrap';
    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);

    const arrows = document.createElement('div');
    arrows.className = 'value-input-arrows';

    const incBtn = document.createElement('button');
    incBtn.type = 'button';
    incBtn.className = 'value-input-arrow';
    incBtn.innerHTML = '<svg viewBox="0 0 8 6" aria-hidden="true"><path d="M1 5L4 1L7 5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    const decBtn = document.createElement('button');
    decBtn.type = 'button';
    decBtn.className = 'value-input-arrow';
    decBtn.innerHTML = '<svg viewBox="0 0 8 6" aria-hidden="true"><path d="M1 1L4 5L7 1" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    const nudge = (direction) => {
      const current = parseFloat(input.value || '0') || 0;
      const step = parseFloat(input.step || '1') || 1;
      const min = input.min !== '' ? parseFloat(input.min) : -Infinity;
      const max = input.max !== '' ? parseFloat(input.max) : Infinity;
      const next = clamp(current + (direction * step), min, max);
      input.value = Number.isInteger(step) ? String(Math.round(next)) : String(Number(next.toFixed(4)));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.focus({ preventScroll: true });
    };

    incBtn.addEventListener('click', () => nudge(1));
    decBtn.addEventListener('click', () => nudge(-1));

    arrows.append(incBtn, decBtn);
    wrapper.appendChild(arrows);
    input.dataset.hasSpinner = 'true';
  }

  _bindMaterialSection(toggleEl, contentEl, openByDefault) {
    if (!toggleEl || !contentEl) return;
    const sectionEl = toggleEl.closest('.material-section');
    const setExpanded = (expanded, immediate = false) => {
      toggleEl.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      if (sectionEl) sectionEl.classList.toggle('is-open', expanded);
      if (expanded) {
        if (immediate) {
          contentEl.style.maxHeight = 'none';
        } else {
          contentEl.style.maxHeight = `${contentEl.scrollHeight}px`;
        }
      } else if (immediate) {
        contentEl.style.maxHeight = '0px';
      } else {
        if (contentEl.style.maxHeight === 'none') {
          contentEl.style.maxHeight = `${contentEl.scrollHeight}px`;
        }
        requestAnimationFrame(() => { contentEl.style.maxHeight = '0px'; });
      }
    };

    setExpanded(openByDefault, true);
    requestAnimationFrame(() => {
      if (toggleEl.getAttribute('aria-expanded') === 'true') {
        contentEl.style.maxHeight = 'none';
      }
    });
    contentEl.addEventListener('transitionend', () => {
      if (toggleEl.getAttribute('aria-expanded') === 'true') {
        contentEl.style.maxHeight = 'none';
      }
    });
    window.addEventListener('resize', () => {
      if (toggleEl.getAttribute('aria-expanded') === 'true') {
        contentEl.style.maxHeight = 'none';
      }
    });
    toggleEl.addEventListener('click', () => {
      const expanded = toggleEl.getAttribute('aria-expanded') === 'true';
      setExpanded(!expanded);
    });
  }

  // ─── Helper: sync slider ↔ number input ──────────────────────
  linkSliderInput(sliderEl, inputEl, callback) {
    if (!sliderEl || !inputEl) return;
    sliderEl.addEventListener('input', () => {
      const v = parseFloat(sliderEl.value);
      inputEl.value = v;
      if (callback) callback(v);
    });
    inputEl.addEventListener('input', () => {
      const v = parseFloat(inputEl.value);
      if (!isNaN(v)) {
        sliderEl.value = v;
        if (callback) callback(v);
      }
    });
  }

  // ─── Helper: sync color picker ↔ hex input + swatch ─────────
  linkColorPicker(pickerEl, hexEl, swatchEl, callback) {
    if (!pickerEl || !hexEl) return;

    const sync = (hex, commit = false) => {
      pickerEl.value = '';
      pickerEl.textContent = '';
      pickerEl.removeAttribute('value');
      pickerEl.style.setProperty('--picker-color', hex);
      hexEl.value = hex;
      if (swatchEl) swatchEl.style.backgroundColor = hex;
      callback?.(hex);
      if (commit) pickerEl.dispatchEvent(new Event('change', { bubbles: true }));
    };

    const control = new CompactColorPicker({
      pickerEl,
      hexEl,
      swatchEl,
      wrapInput: (input) => this.wrapValueInput(input),
      onLiveChange: (hex) => sync(hex, false),
      onCommitChange: (hex) => sync(hex, true),
    });

    this.colorPickers.set(pickerEl.id, control);
    pickerEl._compactColorPicker = control;

    hexEl.addEventListener('change', () => {
      const raw = hexEl.value.trim();
      const normalized = raw.startsWith('#') ? raw : `#${raw}`;
      if (/^#[0-9a-fA-F]{6}$/.test(normalized)) {
        control.setColor(normalized, { commit: true });
      } else {
        hexEl.value = pickerEl.value;
      }
    });
  }

  setupEventListeners() {
    const cb = this.callbacks;
    const el = this.elements;

    // ── Scene / env ──────────────────────────────────────────────
    if (el.sceneSelect) {
      el.sceneSelect.addEventListener('change', e => cb.onSceneChange?.(e.target.value));
    }

    // ── Model select (legacy panel) ──────────────────────────────
    if (el.modelSelect) {
      el.modelSelect.addEventListener('change', e => cb.onModelChange?.(e.target.value));
    }
    // Setting 1 object select mirrors model select
    if (el.objectSelect) {
      el.objectSelect.addEventListener('change', e => cb.onModelChange?.(e.target.value));
    }

    // ── Material preset — handled by CustomSelect (see initialize()) ─

    // ── Part selector (for multi-mesh models)
    if (el.objectPartSelect) {
      el.objectPartSelect.addEventListener('change', e => cb.onPartChange?.(e.target.value));
    }

    // ──────────────────────────────────────────────────────────────
    // BASE COLOR
    this.linkColorPicker(
      el.basecolorPicker, el.basecolorHex, el.basecolorSwatch,
      (hex) => cb.onMaterialPropertyChange?.('color', hex)
    );

    // METALNESS
    this.linkSliderInput(el.metalnessSlider, el.metalnessInput,
      v => cb.onMaterialPropertyChange?.('metalness', v));

    // ROUGHNESS
    this.linkSliderInput(el.roughnessSlider, el.roughnessInput,
      v => cb.onMaterialPropertyChange?.('roughness', v));

    // ──────────────────────────────────────────────────────────────
    // SPECULAR
    this.linkColorPicker(
      el.speccolorPicker, el.speccolorHex, el.speccolorSwatch,
      (hex) => cb.onMaterialPropertyChange?.('specularColor', hex)
    );
    this.linkSliderInput(el.specintSlider, el.specintInput,
      v => cb.onMaterialPropertyChange?.('specularIntensity', v));

    // ──────────────────────────────────────────────────────────────
    // CLEARCOAT
    this.linkSliderInput(el.clearcoatSlider, el.clearcoatInput,
      v => cb.onMaterialPropertyChange?.('clearcoat', v));
    this.linkSliderInput(el.clearcoatroughSlider, el.clearcoatroughInput,
      v => cb.onMaterialPropertyChange?.('clearcoatRoughness', v));

    // ──────────────────────────────────────────────────────────────
    // OPACITY
    this.linkSliderInput(el.opacitySlider, el.opacityInput, (v) => {
      cb.onMaterialPropertyChange?.('opacity', v);
      // transparency flag handled in main.js
    });

    // ──────────────────────────────────────────────────────────────
    // TRANSMISSION
    this.linkSliderInput(el.transmissionSlider, el.transmissionInput,
      v => cb.onMaterialPropertyChange?.('transmission', v));
    this.linkSliderInput(el.iorSlider, el.iorInput,
      v => cb.onMaterialPropertyChange?.('ior', v));
    this.linkSliderInput(el.thicknessSlider, el.thicknessInput,
      v => cb.onMaterialPropertyChange?.('thickness', v));

    // Attenuation distance
    this.linkSliderInput(el.attdistSlider, el.attdistInput,
      v => cb.onMaterialPropertyChange?.('attenuationDistance', v === 0 ? Infinity : v));

    // Attenuation color
    this.linkColorPicker(
      el.attcolorPicker, el.attcolorHex, el.attcolorSwatch,
      (hex) => cb.onMaterialPropertyChange?.('attenuationColor', hex)
    );

    // ──────────────────────────────────────────────────────────────
    // SHEEN
    this.linkColorPicker(
      el.sheencolorPicker, el.sheencolorHex, el.sheencolorSwatch,
      (hex) => {
        // Setting sheen color implicitly enables sheen
        cb.onMaterialPropertyChange?.('sheenColor', hex);
        cb.onMaterialPropertyChange?.('sheen', 1.0);
      }
    );
    this.linkSliderInput(el.sheenroughSlider, el.sheenroughInput,
      v => cb.onMaterialPropertyChange?.('sheenRoughness', v));

    // ──────────────────────────────────────────────────────────────
    // EMISSIVE
    this.linkColorPicker(
      el.emissivecolorPicker, el.emissiveHex, el.emissiveSwatch,
      (hex) => cb.onMaterialPropertyChange?.('emissive', hex)
    );
    this.linkSliderInput(el.emissiveintSlider, el.emissiveintInput,
      v => cb.onMaterialPropertyChange?.('emissiveIntensity', v));

    // ──────────────────────────────────────────────────────────────
    // ENV MAP INTENSITY
    this.linkSliderInput(el.envintSlider, el.envintInput,
      v => cb.onMaterialPropertyChange?.('envMapIntensity', v));

    // ──────────────────────────────────────────────────────────────
    // ANISOTROPY
    this.linkSliderInput(el.anisotropySlider, el.anisotropyInput,
      v => cb.onMaterialPropertyChange?.('anisotropy', v));
    this.linkSliderInput(el.anisotropyRotationSlider, el.anisotropyRotationInput,
      v => cb.onMaterialPropertyChange?.('anisotropyRotation', v));

    // ──────────────────────────────────────────────────────────────
    // IRIDESCENCE
    this.linkSliderInput(el.iridescenceSlider, el.iridescenceInput,
      v => cb.onMaterialPropertyChange?.('iridescence', v));
    this.linkSliderInput(el.iridescenceIorSlider, el.iridescenceIorInput,
      v => cb.onMaterialPropertyChange?.('iridescenceIOR', v));
    // Thickness range — both sliders write the full [min, max] array
    const _syncIridescenceRange = () => {
      const min = parseFloat(el.iridescenceThicknessMinInput?.value ?? 100);
      const max = parseFloat(el.iridescenceThicknessMaxInput?.value ?? 400);
      cb.onMaterialPropertyChange?.('iridescenceThicknessRange', [min, max]);
    };
    this.linkSliderInput(el.iridescenceThicknessMinSlider, el.iridescenceThicknessMinInput, _syncIridescenceRange);
    this.linkSliderInput(el.iridescenceThicknessMaxSlider, el.iridescenceThicknessMaxInput, _syncIridescenceRange);

    // ──────────────────────────────────────────────────────────────
    // DISPERSION
    this.linkSliderInput(el.dispersionSlider, el.dispersionInput,
      v => cb.onMaterialPropertyChange?.('dispersion', v));

    // ──────────────────────────────────────────────────────────────
    // REFLECTIVITY
    this.linkSliderInput(el.reflectivitySlider, el.reflectivityInput,
      v => cb.onMaterialPropertyChange?.('reflectivity', v));

    // ──────────────────────────────────────────────────────────────
    // SHEEN (intensity — explicit slider)
    this.linkSliderInput(el.sheenSlider, el.sheenInput,
      v => cb.onMaterialPropertyChange?.('sheen', v));

    // ──────────────────────────────────────────────────────────────
    // NORMAL SCALE
    this.linkSliderInput(el.normalScaleSlider, el.normalScaleInput,
      v => cb.onMaterialPropertyChange?.('normalScale', v));

    // ──────────────────────────────────────────────────────────────
    // MATERIAL PROPERTY COMMIT — fires onMaterialPropertyCommit after slider release
    // or color picker commit. Used for history snapshots (no live-preview impact).
    {
      const matSliders = [
        el.metalnessSlider, el.roughnessSlider, el.specintSlider,
        el.clearcoatSlider, el.clearcoatroughSlider, el.opacitySlider,
        el.transmissionSlider, el.iorSlider, el.thicknessSlider,
        el.attdistSlider, el.sheenroughSlider, el.emissiveintSlider, el.envintSlider,
        el.anisotropySlider, el.anisotropyRotationSlider,
        el.iridescenceSlider, el.iridescenceIorSlider,
        el.iridescenceThicknessMinSlider, el.iridescenceThicknessMaxSlider,
        el.dispersionSlider, el.reflectivitySlider, el.sheenSlider,
      ];
      const matInputs = [
        el.metalnessInput, el.roughnessInput, el.specintInput,
        el.clearcoatroughInput, el.opacityInput, el.transmissionInput,
        el.iorInput, el.thicknessInput, el.attdistInput, el.sheenroughInput,
        el.emissiveintInput, el.envintInput,
        el.anisotropyInput, el.anisotropyRotationInput,
        el.iridescenceInput, el.iridescenceIorInput,
        el.iridescenceThicknessMinInput, el.iridescenceThicknessMaxInput,
        el.dispersionInput, el.reflectivityInput, el.sheenInput,
      ];
      const matColors = [
        el.basecolorPicker, el.speccolorPicker, el.attcolorPicker,
        el.sheencolorPicker, el.emissivecolorPicker,
      ];
      const commit = () => cb.onMaterialPropertyCommit?.();
      matSliders.forEach(s => s?.addEventListener('change', commit));
      matInputs.forEach(i => i?.addEventListener('change', commit));
      matColors.forEach(c => c?.addEventListener('change', commit));
      // material preset commit is handled inside _matSelect.onChange()
    }

    // ──────────────────────────────────────────────────────────────
    // DESIGN EDITOR (Setting 2)
    // UVEditor._setupInlineUI() directly owns image upload, canvas drag,
    // and transform sliders. Controls.js only wires open + reset.
    if (el.resetTextureBtn) {
      el.resetTextureBtn.addEventListener('click', () => cb.onResetTexture?.());
    }

    // ──────────────────────────────────────────────────────────────
    // OLD MODEL MANAGEMENT BUTTONS (kept for compatibility)
    if (el.uploadModelBtn) {
      el.uploadModelBtn.addEventListener('click', () => el.modelFileInput?.click());
    }
    if (el.modelFileInput) {
      el.modelFileInput.addEventListener('change', e => {
        const files = e.target.files;
        if (files?.length > 0) cb.onUploadModel?.(files);
        e.target.value = '';
      });
    }
    if (el.exportBtn) {
      el.exportBtn.addEventListener('click', () => cb.onExport?.());
    }
    if (el.importBtn) {
      el.importBtn.addEventListener('click', () => el.fileInput?.click());
    }
    if (el.fileInput) {
      el.fileInput.addEventListener('change', e => {
        const files = e.target.files;
        if (files?.length > 0) cb.onImport?.(files);
        e.target.value = '';
      });
    }
    if (el.clearCustomBtn) {
      el.clearCustomBtn.addEventListener('click', () => cb.onClearCustom?.());
    }
  }

  // ─── Channel texture pickers ─────────────────────────────────
  // Inserts a 22×22 canvas thumbnail (inside a wrapper) before each channel anchor.
  // Click thumbnail → open file picker. Click × button → clear texture.
  _setupChannelPickers() {
    // [mapKey, insertBeforeElementId]
    const CHANNELS = [
      ['map',                    'map-channel-anchor'],
      ['normalMap',              'normalMap-channel-anchor'],
      ['roughnessMap',           'roughnessMap-channel-anchor'],
      ['metalnessMap',           'metalnessMap-channel-anchor'],
      ['aoMap',                  'aoMap-channel-anchor'],
      ['bumpMap',                'bumpMap-channel-anchor'],
      ['displacementMap',        'displacementMap-channel-anchor'],
      ['specularColorMap',       'specularColorMap-channel-anchor'],
      ['specularIntensityMap',   'specularIntensityMap-channel-anchor'],
      ['clearcoatMap',           'clearcoatMap-channel-anchor'],
      ['clearcoatRoughnessMap',  'clearcoatRoughnessMap-channel-anchor'],
      ['clearcoatNormalMap',     'clearcoatNormalMap-channel-anchor'],
      ['alphaMap',               'alphaMap-channel-anchor'],
      ['transmissionMap',        'transmissionMap-channel-anchor'],
      ['thicknessMap',           'thicknessMap-channel-anchor'],
      ['sheenColorMap',          'sheenColorMap-channel-anchor'],
      ['sheenRoughnessMap',      'sheenRoughnessMap-channel-anchor'],
      ['emissiveMap',            'emissiveMap-channel-anchor'],
      ['anisotropyMap',          'anisotropyMap-channel-anchor'],
      ['iridescenceMap',         'iridescenceMap-channel-anchor'],
      ['iridescenceThicknessMap','iridescenceThicknessMap-channel-anchor'],
    ];

    CHANNELS.forEach(([mapKey, refId]) => {
      const refEl = document.getElementById(refId);
      if (!refEl || !refEl.parentElement) return;

      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = '.png,.jpg,.jpeg,.webp';
      fileInput.style.display = 'none';
      document.body.appendChild(fileInput);

      // Wrapper holds canvas + clear button
      const wrapper = document.createElement('div');
      wrapper.className = 'channel-tex-wrapper';

      const thumb = document.createElement('canvas');
      thumb.className = 'channel-tex-thumb';
      thumb.width = 22; thumb.height = 22;
      thumb.title = 'Click to upload texture';

      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'channel-tex-clear';
      clearBtn.title = 'Remove texture';
      clearBtn.innerHTML = '<svg width="6" height="6" viewBox="0 0 6 6" fill="none"><line x1="1" y1="1" x2="5" y2="5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="5" y1="1" x2="1" y2="5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

      thumb.addEventListener('click', () => fileInput.click());
      clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.callbacks.onChannelTextureClear?.(mapKey);
      });
      fileInput.addEventListener('change', e => {
        if (e.target.files[0]) this.callbacks.onChannelTextureUpload?.(mapKey, e.target.files[0]);
        e.target.value = '';
      });

      wrapper.append(thumb, clearBtn);
      refEl.parentElement.insertBefore(wrapper, refEl);
      this.elements[`texThumb_${mapKey}`] = thumb;

      // Initial empty state
      this._drawChannelThumb(thumb, null);
    });
  }

  /** Draw a texture preview into a channel thumbnail canvas, or show empty state.
   *  source can be a THREE.Texture or a data URL string. */
  _drawChannelThumb(canvas, source) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const wrapper = canvas.parentElement?.classList.contains('channel-tex-wrapper')
      ? canvas.parentElement : null;

    if (typeof source === 'string') {
      // Data URL — draw via an Image element
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        wrapper?.classList.add('has-texture');
      };
      img.src = source;
      return; // async — wrapper state set on load
    }

    if (source?.image) {
      ctx.drawImage(source.image, 0, 0, canvas.width, canvas.height);
      wrapper?.classList.add('has-texture');
    } else {
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = '#555'; ctx.lineWidth = 1;
      const m = canvas.width / 2;
      ctx.beginPath();
      ctx.moveTo(m, 4); ctx.lineTo(m, canvas.height - 4);
      ctx.moveTo(4, m); ctx.lineTo(canvas.width - 4, m);
      ctx.stroke();
      wrapper?.classList.remove('has-texture');
    }
  }

  // ─── Public methods ───────────────────────────────────────────

  /**
   * Populate the model/object dropdown (Setting 1 + legacy panel)
   */
  updateModelSelect(categories) {
    [this.elements.objectSelect, this.elements.modelSelect,
     this.elements.objectSelectMaterialTab].forEach(sel => {
      if (!sel) return;
      sel.innerHTML = ''; // always rebuild from scratch

      // if there are no models at all, show a single placeholder option
      if (!categories.builtin?.length && !categories.custom?.length && !categories.uploaded?.length) {
        const o = document.createElement('option');
        o.value = '';
        o.textContent = '-- no models available --';
        o.disabled = true;
        o.selected = true;
        sel.appendChild(o);
        return;
      }

      if (categories.builtin?.length) {
        const g = document.createElement('optgroup');
        g.label = 'Built-in Models';
        categories.builtin.forEach(name => {
          const o = document.createElement('option');
          o.value = name; o.textContent = name;
          g.appendChild(o);
        });
        sel.appendChild(g);
      }
      if (categories.custom?.length) {
        const g = document.createElement('optgroup');
        g.label = 'Custom Models';
        categories.custom.forEach(name => {
          const o = document.createElement('option');
          o.value = name; o.textContent = name;
          g.appendChild(o);
        });
        sel.appendChild(g);
      }
      if (categories.uploaded?.length) {
        const g = document.createElement('optgroup');
        g.label = 'Uploaded Models';
        categories.uploaded.forEach(name => {
          const o = document.createElement('option');
          o.value = name; o.textContent = name;
          g.appendChild(o);
        });
        sel.appendChild(g);
      }
    });
  }

  /**
   * Populate the scene/environment dropdown (Setting 1)
   */
  updateSceneSelect(sceneNames) {
    const sel = this.elements.sceneSelect;
    if (!sel) return;

    // Keep placeholder options in sync
    const placeholder = Array.from(sel.options).find(o => o.disabled);
    sel.innerHTML = '';
    if (placeholder) sel.appendChild(placeholder);
    sceneNames.forEach(name => {
      const o = document.createElement('option');
      o.value = name; o.textContent = name;
      sel.appendChild(o);
    });

    // Build the card grid
    const grid = document.getElementById('env-preset-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const previewMap = Object.fromEntries(
      STANDARD_ENVIRONMENTS.map(e => [e.label, e.preview])
    );

    sceneNames.forEach(name => {
      const card = document.createElement('div');
      card.className = 'bg-preset-card';
      card.dataset.value = name;

      const circle = document.createElement('div');
      circle.className = 'bg-preset-circle';
      circle.style.background = previewMap[name] ?? '#2a2a2a';

      const label = document.createElement('span');
      label.className = 'bg-preset-label';
      label.textContent = name;

      card.append(circle, label);
      card.addEventListener('click', () => {
        sel.value = name;
        sel.dispatchEvent(new Event('change'));
        syncEnvCards(name);
      });
      grid.appendChild(card);

      // Asynchronously render the HDR onto a sphere and swap in the result
      const envDef = STANDARD_ENVIRONMENTS.find(e => e.label === name);
      if (envDef) {
        generateEnvPreview(envDef.path).then(dataUrl => {
          if (dataUrl) {
            circle.style.background = `url(${dataUrl}) center/cover`;
          }
        });
      }
    });
  }

  /**
   * Populate the material preset dropdown (Setting 3).
   * @param {{ user: string[], standard: string[] }} categories
   * @param {(name: string) => string|null} [getThumbnail]
   * @param {() => string} [getEnvKey]
   */
  updateMaterialPresetSelect(categories, getThumbnail, getEnvKey) {
    if (!this._matSelect) return;
    const groups = [];
    if (categories.user?.length)     groups.push({ label: 'Custom Materials',  items: categories.user });
    if (categories.standard?.length) groups.push({ label: 'Standard Materials', items: categories.standard });
    this._matSelect.populate({ groups }, getThumbnail, getEnvKey);
  }

  /**
   * Populate the object part dropdown used when a model contains multiple meshes.
   * @param {string[]} partNames
   */
  updatePartSelect(partNames) {
    const sel = this.elements.objectPartSelect;
    if (!sel) return;
    sel.innerHTML = '';

    if (!partNames || partNames.length <= 1) {
      const o = document.createElement('option');
      o.value = '';
      o.textContent = '-- single mesh --';
      o.disabled = true;
      o.selected = true;
      sel.appendChild(o);
      sel.disabled = true;
      return;
    }

    sel.disabled = false;
    partNames.forEach(name => {
      const o = document.createElement('option');
      o.value = name;
      o.textContent = name;
      sel.appendChild(o);
    });
    // leave first part selected by default
    sel.selectedIndex = 0;
  }

  /**
   * Sync all Setting 3 controls to reflect the current material state.
   * Call this whenever a new model is loaded or a preset is applied.
   */
  syncMaterialUI(material, uploadedMaps = {}) {
    if (!material) return;
    const el = this.elements;
    const set = (slider, input, val) => {
      if (slider) slider.value = val;
      if (input) input.value = val;
    };
    const setColor = (picker, hex, swatch, color) => {
      const hexStr = '#' + color.getHexString();
      if (picker?._compactColorPicker) {
        picker._compactColorPicker.setColor(hexStr, { emit: false });
      } else {
        if (picker) picker.value = hexStr;
        if (hex) hex.value = hexStr;
        if (swatch) swatch.style.backgroundColor = hexStr;
      }
    };

    setColor(el.basecolorPicker, el.basecolorHex, el.basecolorSwatch, material.color);
    set(el.metalnessSlider, el.metalnessInput, material.metalness);
    set(el.roughnessSlider, el.roughnessInput, material.roughness);
    set(el.specintSlider, el.specintInput, material.specularIntensity);
    setColor(el.speccolorPicker, el.speccolorHex, el.speccolorSwatch, material.specularColor);
    set(el.clearcoatSlider, el.clearcoatInput, material.clearcoat);
    set(el.clearcoatroughSlider, el.clearcoatroughInput, material.clearcoatRoughness);
    set(el.opacitySlider, el.opacityInput, material.opacity);
    set(el.transmissionSlider, el.transmissionInput, material.transmission);
    set(el.iorSlider, el.iorInput, material.ior);
    set(el.thicknessSlider, el.thicknessInput, material.thickness);
    const attDist = material.attenuationDistance === Infinity ? 0 : material.attenuationDistance;
    set(el.attdistSlider, el.attdistInput, attDist);
    setColor(el.attcolorPicker, el.attcolorHex, el.attcolorSwatch, material.attenuationColor);
    setColor(el.sheencolorPicker, el.sheencolorHex, el.sheencolorSwatch, material.sheenColor);
    set(el.sheenroughSlider, el.sheenroughInput, material.sheenRoughness);
    setColor(el.emissivecolorPicker, el.emissiveHex, el.emissiveSwatch, material.emissive);
    set(el.emissiveintSlider, el.emissiveintInput, material.emissiveIntensity);
    set(el.envintSlider, el.envintInput, material.envMapIntensity);

    // Anisotropy
    set(el.anisotropySlider, el.anisotropyInput, material.anisotropy ?? 0);
    set(el.anisotropyRotationSlider, el.anisotropyRotationInput, material.anisotropyRotation ?? 0);

    // Iridescence
    set(el.iridescenceSlider, el.iridescenceInput, material.iridescence ?? 0);
    set(el.iridescenceIorSlider, el.iridescenceIorInput, material.iridescenceIOR ?? 1.3);
    if (material.iridescenceThicknessRange) {
      set(el.iridescenceThicknessMinSlider, el.iridescenceThicknessMinInput, material.iridescenceThicknessRange[0]);
      set(el.iridescenceThicknessMaxSlider, el.iridescenceThicknessMaxInput, material.iridescenceThicknessRange[1]);
    }

    // Dispersion / Reflectivity / Sheen intensity
    set(el.dispersionSlider, el.dispersionInput, material.dispersion ?? 0);
    set(el.reflectivitySlider, el.reflectivityInput, material.reflectivity ?? 0.5);
    set(el.sheenSlider, el.sheenInput, material.sheen ?? 0);

    // Normal scale (Vector2 — use x component)
    set(el.normalScaleSlider, el.normalScaleInput, material.normalScale?.x ?? 1);

    // Update channel texture thumbnails.
    // uploadedMaps (channel → data URL) takes priority so sticker PBR composites
    // and the live decal canvas don't appear in the channel slots.
    const CHANNEL_KEYS = [
      'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'bumpMap', 'displacementMap',
      'specularColorMap', 'specularIntensityMap',
      'clearcoatMap', 'clearcoatRoughnessMap', 'clearcoatNormalMap',
      'alphaMap', 'transmissionMap', 'thicknessMap',
      'sheenColorMap', 'sheenRoughnessMap', 'emissiveMap',
      'anisotropyMap', 'iridescenceMap', 'iridescenceThicknessMap',
    ];
    CHANNEL_KEYS.forEach(ch => {
      const thumb = el[`texThumb_${ch}`];
      if (!thumb) return;
      if (Object.prototype.hasOwnProperty.call(uploadedMaps, ch)) {
        // Explicit override: data URL string (user upload) or null (no upload / sticker-owned)
        this._drawChannelThumb(thumb, uploadedMaps[ch] ?? null);
      } else {
        // No override — safe to read from material (not a system-composite slot)
        this._drawChannelThumb(thumb, material[ch] ?? null);
      }
    });
  }

  /** Sync the custom material dropdown to show a preset without firing onChange. */
  setMaterialPresetValue(name) {
    if (this._matSelect) this._matSelect.value = name;
  }

  /** Read the currently selected material preset name from the dropdown. */
  getMaterialPresetValue() {
    return this._matSelect ? this._matSelect.value : 'Default — White';
  }

  setEnabled(elementName, enabled) {
    const el = this.elements[elementName];
    if (el) el.disabled = !enabled;
  }

  setVisible(elementName, visible) {
    const el = this.elements[elementName];
    if (el) el.style.display = visible ? '' : 'none';
  }
}

/**
 * Wire up tab buttons so the debug panel (Setting9) expands the sidebar
 * leftward while all other panels use the standard width.
 */
export function initObjectPropsTabs() {
  const bar = document.getElementById('obj-props-tabs-bar');
  if (!bar) return;

  const tabs   = bar.querySelectorAll('.folder-tab');
  const panels = document.querySelectorAll('.folder-panel');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const targetId = tab.dataset.target;
      panels.forEach(panel => {
        panel.style.display = panel.id === targetId ? '' : 'none';
      });
    });
  });
}

export function initDebugPanelWidth() {
  const panel = document.querySelector('.scene-settings');
  if (!panel) return;

  document.querySelectorAll('.tablinks').forEach(btn => {
    btn.addEventListener('click', () => {
      const isDebug = btn.getAttribute('onclick')?.includes('Setting9');
      panel.classList.toggle('scene-settings--wide', !!isDebug);
    });
  });
}
