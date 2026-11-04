import * as IDBStorage from '../../storage/indexedDBStorage.js';
import { EXTRACTOR_IMAGE_KEY } from '../../storage/storageKeys.js';
import { fileDataURL, loadDesignImage } from '../../utils/imageAssets.js';
import { log } from '../../utils/logger.js';
import { scheduleAppSetting, setAppBlobSetting, getAppSetting } from '../../storage/SettingsStorage.js';
import {
  COLOR_CANVAS_SIZE, COLOR_SLIDER_HEIGHT, TWO_PI, COLOR_SWATCH_GROUPS, clamp,
  rgbToHex, hexToRgb, rgbToHsv, hsvToRgb, rgbToCmyk, cmykToRgb,
  rgbToLab, labToRgb, pointerPosition, generateSwatchColors,
} from './colorMath.js';

export class CompactColorPicker {
  static active = null;
  static _extractorPickers = new Set();
  static _extractorBlob = null;
  static _extractorPreferences = { count: 24, noise: 0 };
  static _activeFolderTab = 'color-picker-panel';
  static setActiveFolderTab(target) {
    this._activeFolderTab = target;
    for (const picker of this._extractorPickers) {
      picker.titleEl.querySelectorAll('.folder-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.target === target));
      [picker.colorPickerPanel, picker.extractorPanel].forEach(panel => {
        panel.style.display = panel.id === target ? '' : 'none';
      });
    }
  }
  static getExtractorPreferences() { return { ...this._extractorPreferences }; }
  static setExtractorPreferences(preferences) {
    this._extractorPreferences = { ...this._extractorPreferences, ...preferences };
    for (const picker of this._extractorPickers) {
      picker.extractorCountSlider.value = picker.extractorCountField.value = this._extractorPreferences.count;
      picker.extractorNoiseSlider.value = picker.extractorNoiseField.value = this._extractorPreferences.noise;
    }
  }
  static async restoreExtractorImage() {
    const blob = await IDBStorage.get('blobs', EXTRACTOR_IMAGE_KEY);
    if (blob) {
      this._extractorBlob = new File([blob], getAppSetting('colorExtractorFileName') || blob.name || 'Image', { type: blob.type });
      await Promise.all([...this._extractorPickers].map(picker => picker._loadExtractorImage(this._extractorBlob, false)));
    }
  }


  // Swatch collections are shared by every picker instance and stored in
  // settings/app.swatchCollections. Nothing is written until the stored value
  // has been loaded (setSharedCollections), so defaults never overwrite it.
  static _sharedCollections = null;
  static _swatchesLoaded = false;
  static _savedJSON = null;
  static _swatchVersion = 0; // bumped on every change; other pickers re-render on open

  static setSharedCollections(saved) {
    if (Array.isArray(saved) && saved.length) CompactColorPicker._sharedCollections = saved;
    CompactColorPicker._savedJSON = JSON.stringify(CompactColorPicker._sharedCollections);
    CompactColorPicker._swatchVersion++;
    CompactColorPicker._swatchesLoaded = true;
  }

  get swatchCollections() { return CompactColorPicker._sharedCollections; }
  set swatchCollections(value) { CompactColorPicker._sharedCollections = value; }

  constructor({ pickerEl, hexEl, swatchEl, wrapInput, onLiveChange, onCommitChange }) {
    this.pickerEl = pickerEl;
    this.hexEl = hexEl;
    this.swatchEl = swatchEl;
    this.wrapInput = wrapInput;
    this.onLiveChange = onLiveChange;
    this.onCommitChange = onCommitChange;
    this.mode = 'square';
    this.harmonyMode = 'none';
    this._harmonyHit = false;
    this.isOpen = false;
    this.isDragging = false;
    this.dragTarget = null;
    this.renderScale = Math.min(3, Math.max(1.5, window.devicePixelRatio || 1));
    this.selectedCollectionIndex = 0;
    this.selectedSwatchRef = null;
    this.lastSelectionType = 'collection';
    this.selectedSwatchKeys = new Set();
    this.selectedCollectionIds = new Set();
    this._anchorSwatchInfo = null;
    this._anchorCollectionId = null;
    this.pendingNewCollection = false;
    this.pendingCollectionRenameIndex = null;
    this.dragPayload = null;
    this.skipPresetAnimationOnce = false;
    const defaultCollections = [
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
    if (!CompactColorPicker._sharedCollections) CompactColorPicker._sharedCollections = defaultCollections;
    this._renderedSwatchVersion = CompactColorPicker._swatchVersion;
    this.state = {
      hex: '#ffffff',
      rgb: { r: 255, g: 255, b: 255 },
      hsv: { h: 0, s: 0, v: 100 },
      cmyk: { c: 0, m: 0, y: 0, k: 0 },
    };

    this._build();
    this._buildArrow();
    this.setMode('circle');
    this._bindLauncher();
    this.setColor(this.hexEl?.value || this.pickerEl?.value || '#ffffff', { emit: false });
  }

  _build() {
    this.panelEl = document.createElement('div');
    this.panelEl.className = 'compact-color-picker';
    this.panelEl.hidden = true;

    this.titleEl = document.createElement('div');
    this.titleEl.className = 'folder-tabs-bar';
    this.titleEl.innerHTML = `
      <button class="folder-tab active" data-target="color-picker-panel">
        <h4>Color Picker</h4>
      </button>
      <button class="folder-tab" data-target="color-extractor-panel">
        <h4>Color Extractor</h4>
      </button>
    `;

    this.toggleRowEl = document.createElement('div');
    this.toggleRowEl.className = 'compact-color-picker__mode';
    this.circleModeBtn = this._makeModeButton('Circle', 'circle');
    this.squareModeBtn = this._makeModeButton('Square', 'square');
    this.toggleRowEl.append(this.circleModeBtn, this.squareModeBtn);

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
    this.swatchesMenuBtn.className = 'burger-btn';
    this.swatchesMenuBtn.setAttribute('aria-label', 'Swatches menu');
    this.swatchesMenuBtn.title = 'Swatches menu';
    this.swatchesMenuBtn.innerHTML = '<span></span><span></span><span></span>';
    this.swatchesMenuEl = document.createElement('div');
    this.swatchesMenuEl.className = 'dropdown-menu';
    this.swatchesMenuEl.hidden = true;

    this.loadStandardSwatchesBtn = document.createElement('button');
    this.loadStandardSwatchesBtn.type = 'button';
    this.loadStandardSwatchesBtn.className = 'dropdown-menu-item';
    this.loadStandardSwatchesBtn.textContent = 'Load Standard Swatches';
    this.loadStandardSwatchesBtn.setAttribute('aria-label', 'Load Standard Swatches');
    this.loadStandardSwatchesBtn.title = 'Load Standard Swatches';
    this.swatchesMenuEl.appendChild(this.loadStandardSwatchesBtn);
    this.swatchesHeaderEl.append(this.swatchesTitleEl, this.swatchesMenuBtn, this.swatchesMenuEl);

    this.swatchPanelEl = this._buildPresetSwatches();

    this.harmonySectionEl = document.createElement('div');
    this.harmonySectionEl.className = 'compact-color-picker__harmony-section';

    const harmonyTitle = document.createElement('div');
    harmonyTitle.className = 'compact-color-picker__harmony-title';
    harmonyTitle.textContent = 'Harmony';

    this.harmonyRowEl = document.createElement('div');
    this.harmonyRowEl.className = 'compact-color-picker__harmony-row';
    this.harmonyBtns = {};
    [
      { label: 'None',        mode: 'none' },
      { label: 'Complement',  mode: 'complementary' },
      { label: 'Split Comp',  mode: 'split-comp' },
      { label: 'Analogous',   mode: 'analogous' },
      { label: 'Triadic',     mode: 'triadic' },
      { label: 'Tetradic',    mode: 'tetradic' },
      { label: 'Square',      mode: 'square' },
    ].forEach(({ label, mode }) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'compact-color-picker__harmony-btn';
      btn.textContent = label;
      btn.dataset.harmonyMode = mode;
      if (mode === 'none') btn.classList.add('is-active');
      this.harmonyBtns[mode] = btn;
      this.harmonyRowEl.appendChild(btn);
    });
    this.harmonySectionEl.append(harmonyTitle, this.harmonyRowEl);

    this.colorPickerPanel = document.createElement('div');
    this.colorPickerPanel.className = 'folder-panel';
    this.colorPickerPanel.id = 'color-picker-panel';
    this.colorPickerPanel.append(this.toggleRowEl, this.canvasWrapEl, this.harmonySectionEl, this.fieldsEl);

    this.extractorPanel = document.createElement('div');
    this.extractorPanel.className = 'folder-panel';
    this.extractorPanel.id = 'color-extractor-panel';
    this.extractorPanel.style.display = 'none';

    this.extractorPreviewEl = document.createElement('div');
    this.extractorPreviewEl.className = 'compact-color-picker__extractor-preview';
    this.extractorPreviewImgEl = document.createElement('img');
    this.extractorPreviewImgEl.className = 'compact-color-picker__extractor-img';
    this.extractorPreviewImgEl.alt = '';
    this.extractorPreviewImgEl.style.display = 'none';
    this.extractorPreviewTextEl = document.createElement('p');
    this.extractorPreviewTextEl.className = 'hint';
    this.extractorPreviewTextEl.textContent = 'Upload an image to preview and extract colors';

    this.uploadImageBtn = document.createElement('button');
    this.uploadImageBtn.type = 'button';
    this.uploadImageBtn.className = 'compact-color-picker__extractor-upload-btn button-medium';
    this.uploadImageBtn.textContent = 'Upload Image';
    this.uploadImageBtn.addEventListener('click', () => this.extractorFileInput.click());

    this.extractorAcceptedEl = document.createElement('div');
    this.extractorAcceptedEl.className = 'hint';
    this.extractorAcceptedEl.textContent = 'Supports JPG, PNG, WebP, GIF';

    this.extractorPreviewEl.append(this.extractorPreviewImgEl, this.extractorPreviewTextEl, this.uploadImageBtn, this.extractorAcceptedEl);

    this.extractorFileInput = document.createElement('input');
    this.extractorFileInput.type = 'file';
    this.extractorFileInput.accept = 'image/jpeg,image/png,image/webp,image/gif';
    this.extractorFileInput.style.display = 'none';

    this.extractorSlidersEl = document.createElement('div');
    this.extractorSlidersEl.className = 'compact-color-picker__extractor-sliders';

    const countRow = document.createElement('div');
    countRow.className = 'control-row';
    const countName = document.createElement('p');
    countName.className = 'control-label';
    countName.textContent = 'Swatches';
    this.extractorCountSlider = document.createElement('input');
    this.extractorCountSlider.type = 'range';
    this.extractorCountSlider.className = 'slider';
    this.extractorCountSlider.min = '1';
    this.extractorCountSlider.max = '32';
    this.extractorCountSlider.value = '24';
    this.extractorCountField = document.createElement('input');
    this.extractorCountField.type = 'number';
    this.extractorCountField.className = 'value-input';
    this.extractorCountField.min = '1';
    this.extractorCountField.max = '32';
    this.extractorCountField.value = '24';
    this.extractorCountSlider.addEventListener('input', () => {
      this.extractorCountField.value = this.extractorCountSlider.value;
    });
    this.extractorCountField.addEventListener('input', () => {
      const v = clamp(parseInt(this.extractorCountField.value, 10) || 1, 1, 32);
      this.extractorCountSlider.value = v;
    });
    this.extractorCountField.addEventListener('blur', () => {
      const v = clamp(parseInt(this.extractorCountField.value, 10) || 1, 1, 32);
      this.extractorCountField.value = v;
      this.extractorCountSlider.value = v;
    });
    countRow.append(countName, this.extractorCountSlider, this.extractorCountField);

    const noiseRow = document.createElement('div');
    noiseRow.className = 'control-row';
    const noiseName = document.createElement('p');
    noiseName.className = 'control-label';
    noiseName.textContent = 'Noise %';
    this.extractorNoiseSlider = document.createElement('input');
    this.extractorNoiseSlider.type = 'range';
    this.extractorNoiseSlider.className = 'slider';
    this.extractorNoiseSlider.min = '0';
    this.extractorNoiseSlider.max = '100';
    this.extractorNoiseSlider.value = '0';
    this.extractorNoiseField = document.createElement('input');
    this.extractorNoiseField.type = 'number';
    this.extractorNoiseField.className = 'value-input';
    this.extractorNoiseField.min = '0';
    this.extractorNoiseField.max = '100';
    this.extractorNoiseField.step = '0.01';
    this.extractorNoiseField.value = '0.00';
    this.extractorNoiseSlider.addEventListener('input', () => {
      this.extractorNoiseField.value = parseFloat(this.extractorNoiseSlider.value).toFixed(2);
    });
    this.extractorNoiseField.addEventListener('input', () => {
      const v = clamp(parseFloat(this.extractorNoiseField.value) || 0, 0, 100);
      this.extractorNoiseSlider.value = v;
    });
    this.extractorNoiseField.addEventListener('blur', () => {
      const v = clamp(parseFloat(this.extractorNoiseField.value) || 0, 0, 100);
      this.extractorNoiseField.value = v.toFixed(2);
      this.extractorNoiseSlider.value = v;
    });
    noiseRow.append(noiseName, this.extractorNoiseSlider, this.extractorNoiseField);

    this.extractorSlidersEl.append(countRow, noiseRow);
    CompactColorPicker._extractorPickers.add(this);
    if (CompactColorPicker._extractorBlob) void this._loadExtractorImage(CompactColorPicker._extractorBlob, false);
    CompactColorPicker.setExtractorPreferences(CompactColorPicker.getExtractorPreferences());
    for (const input of [this.extractorCountSlider, this.extractorCountField, this.extractorNoiseSlider, this.extractorNoiseField]) {
      input.addEventListener('input', () => {
        CompactColorPicker.setExtractorPreferences({ count: Number(this.extractorCountSlider.value), noise: Number(this.extractorNoiseSlider.value) });
        document.dispatchEvent(new CustomEvent('extractor-preferences-changed'));
      });
    }


    this.extractorActionsEl = document.createElement('div');
    this.extractorActionsEl.className = 'compact-color-picker__extractor-actions';
    const extractorAlgorithms = [
      { label: 'Most Common',          algo: 'most-common' },
      { label: 'Least Common',         algo: 'least-common' },
      { label: 'Darkest',              algo: 'darkest' },
      { label: 'Lightest',             algo: 'lightest' },
      { label: 'Vibrant Colors',       algo: 'vibrant' },
      { label: 'Muted Colors',         algo: 'muted' },
      { label: 'MMCQ',                 algo: 'mmcq' },
      { label: 'Median Cut',           algo: 'median-cut' },
      { label: 'K-Means Clustering',   algo: 'kmeans' },
      { label: 'Histogram Peaks',      algo: 'histogram' },
      { label: 'Weighted Regions',     algo: 'weighted-regions' },
      { label: 'Perceptual (LAB)',      algo: 'lab-kmeans' },
    ];
    extractorAlgorithms.forEach(({ label, algo }) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'compact-color-picker__extractor-action button-medium';
      button.textContent = label;
      button.dataset.algo = algo;
      this.extractorActionsEl.append(button);
    });

    this.extractorResultsEl = document.createElement('div');
    this.extractorResultsEl.className = 'compact-color-picker__extractor-results';
    this.extractorResultsEl.style.display = 'none';

    this.extractorPanel.append(
      this.extractorPreviewEl,
      this.extractorSlidersEl,
      this.extractorFileInput,
      this.extractorActionsEl,
      this.extractorResultsEl,
    );

    this.panelEl.append(this.titleEl, this.colorPickerPanel, this.extractorPanel, this.footerEl, this.swatchesHeaderEl, this.swatchPanelEl);
    document.body.appendChild(this.panelEl);
    this._configureCanvasResolution();
    this._bindPanelEvents();

    this.titleEl.querySelectorAll('.folder-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        CompactColorPicker.setActiveFolderTab(tab.dataset.target);
      });
    });
    CompactColorPicker.setActiveFolderTab(CompactColorPicker._activeFolderTab);
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
    this.removeCollectionBtn.addEventListener('click', () => {
      if (this.selectedSwatchKeys.size > 0 || this.selectedCollectionIds.size > 0) {
        this._deleteSelected();
      } else {
        this._removeSelectedSwatchTarget();
      }
    });
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
      if (this.dragPayload.type === 'multi-swatch' || this.dragPayload.type === 'multi-collection') {
        this._deleteSelected();
      } else if (this.dragPayload.type === 'swatch') {
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
      if (this.selectedCollectionIds.has(group.id)) section.classList.add('is-multi-selected');

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'compact-color-picker__presets-toggle';
      toggle.setAttribute('aria-expanded', group.open ? 'true' : 'false');
      toggle.innerHTML = `<span class="compact-color-picker__presets-title-row"><span class="compact-color-picker__presets-title">${group.title}</span>${group.id !== 'recent' ? '<span class="compact-color-picker__presets-rename-icon" aria-hidden="true"><svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M8.5 1.5a1.414 1.414 0 012 2L4.5 9.5 2 10.5l1-2.5L8.5 1.5z" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg></span>' : ''}</span><span class="compact-color-picker__presets-chevron"></span>`;
      if (group.id !== 'recent') {
        toggle.draggable = true;
        toggle.addEventListener('dragstart', (evt) => {
          if (this.selectedCollectionIds.has(group.id) && this.selectedCollectionIds.size > 1) {
            this.dragPayload = { type: 'multi-collection', ids: [...this.selectedCollectionIds] };
            evt.dataTransfer.effectAllowed = 'move';
            evt.dataTransfer.setData('text/plain', `${this.selectedCollectionIds.size} collections`);
          } else {
            this.dragPayload = { type: 'collection', collectionIndex: index };
            evt.dataTransfer.effectAllowed = 'move';
            evt.dataTransfer.setData('text/plain', group.title);
          }
          section.classList.add('is-dragging');
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
      grid.style.gridTemplateColumns = group.id === 'recent'
        ? 'repeat(8, 1fr)'
        : `repeat(${Math.min(Math.max(group.swatches.length, 1), 8)}, 1fr)`;
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
        swatchBtn.addEventListener('click', (evt) => {
          const key = `${group.id}~~${swatch.id}`;
          if (evt.shiftKey && this._anchorSwatchInfo?.groupId === group.id) {
            const anchorIdx = group.swatches.findIndex(s => s.id === this._anchorSwatchInfo.swatchId);
            const thisIdx = group.swatches.findIndex(s => s.id === swatch.id);
            if (anchorIdx >= 0 && thisIdx >= 0) {
              const [lo, hi] = anchorIdx < thisIdx ? [anchorIdx, thisIdx] : [thisIdx, anchorIdx];
              this.selectedSwatchKeys.clear();
              this.selectedCollectionIds.clear();
              for (let i = lo; i <= hi; i++) {
                this.selectedSwatchKeys.add(`${group.id}~~${group.swatches[i].id}`);
              }
              this._renderSwatchCollections();
              return;
            }
          }
          this._clearMultiSelect();
          this._anchorSwatchInfo = { groupId: group.id, swatchId: swatch.id };
          this.selectedCollectionIndex = index;
          this.selectedSwatchRef = { collectionIndex: index, swatchId: swatch.id };
          this.lastSelectionType = 'swatch';
          this.setColor(swatch.hex, { commit: true });
          this._syncRenderedSwatchSelection();
        });
        if (this.selectedSwatchKeys.has(`${group.id}~~${swatch.id}`)) swatchBtn.classList.add('is-multi-selected');
        swatchBtn.addEventListener('dblclick', (evt) => {
          evt.preventDefault();
          evt.stopPropagation();
          this.selectedCollectionIndex = index;
          this.selectedSwatchRef = { collectionIndex: index, swatchId: swatch.id };
          this.lastSelectionType = 'swatch';
          this._openSwatchRename(index, swatch.id);
        });
        swatchBtn.addEventListener('dragstart', (evt) => {
          const key = `${group.id}~~${swatch.id}`;
          if (this.selectedSwatchKeys.has(key) && this.selectedSwatchKeys.size > 1) {
            const items = [];
            this.swatchCollections.forEach((col, ci) => {
              col.swatches.forEach(sw => {
                if (this.selectedSwatchKeys.has(`${col.id}~~${sw.id}`)) items.push({ collectionIndex: ci, swatchId: sw.id });
              });
            });
            this.dragPayload = { type: 'multi-swatch', items };
            evt.dataTransfer.effectAllowed = 'move';
            evt.dataTransfer.setData('text/plain', `${items.length} swatches`);
          } else {
            this.dragPayload = { type: 'swatch', collectionIndex: index, swatchId: swatch.id };
            evt.dataTransfer.effectAllowed = 'move';
            evt.dataTransfer.setData('text/plain', swatch.hex);
          }
          swatchBtn.classList.add('is-dragging');
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
        if (evt.shiftKey && group.id !== 'recent' && this._anchorCollectionId) {
          const anchorIdx = this.swatchCollections.findIndex(c => c.id === this._anchorCollectionId);
          const [lo, hi] = anchorIdx < index ? [anchorIdx, index] : [index, anchorIdx];
          this.selectedCollectionIds.clear();
          this.selectedSwatchKeys.clear();
          for (let i = lo; i <= hi; i++) {
            if (this.swatchCollections[i].id !== 'recent') this.selectedCollectionIds.add(this.swatchCollections[i].id);
          }
          this._renderSwatchCollections();
          return;
        }
        this._clearMultiSelect();
        this._anchorCollectionId = group.id !== 'recent' ? group.id : null;
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
        if (!this.dragPayload || (this.dragPayload.type !== 'collection' && this.dragPayload.type !== 'multi-collection')) return;
        if (this.dragPayload.type === 'collection' && this.dragPayload.collectionIndex === index) return;
        evt.preventDefault();
        evt.dataTransfer.dropEffect = 'move';
        const rect = section.getBoundingClientRect();
        const y = evt.clientY - rect.top;
        const height = rect.height;
        let insertBefore;
        if (y < height * 0.45) {
          insertBefore = true;
        } else if (y > height * 0.55) {
          insertBefore = false;
        } else {
          this._clearCollectionDropIndicators();
          return;
        }
        this._clearCollectionDropIndicators();
        section.classList.add(insertBefore ? 'is-collection-drop-before' : 'is-collection-drop-after');
      });
      section.addEventListener('dragleave', (evt) => {
        if (this.dragPayload?.type !== 'collection' && this.dragPayload?.type !== 'multi-collection') return;
        if (!section.contains(evt.relatedTarget)) {
          section.classList.remove('is-collection-drop-before', 'is-collection-drop-after');
        }
      });
      section.addEventListener('drop', (evt) => {
        if (!this.dragPayload) return;
        evt.preventDefault();
        const rect = section.getBoundingClientRect();
        const insertBefore = evt.clientY < rect.top + rect.height / 2;
        const rawTarget = insertBefore ? index : index + 1;
        if (this.dragPayload.type === 'collection') {
          const sourceIndex = this.dragPayload.collectionIndex;
          this._handleCollectionReorder(sourceIndex, rawTarget);
        } else if (this.dragPayload.type === 'multi-collection') {
          this._handleMultiCollectionReorder(rawTarget);
        }
      });
    });

    const selectedIsRecent = this.swatchCollections[this.selectedCollectionIndex]?.id === 'recent';
    const cannotDelete = this.swatchCollections.length <= 1 ||
      (this.lastSelectionType !== 'swatch' && selectedIsRecent);
    if (this.removeCollectionBtn) this.removeCollectionBtn.disabled = cannotDelete;
    this._saveCollections();
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

  _clearMultiSelect() {
    this.selectedSwatchKeys.clear();
    this.selectedCollectionIds.clear();
    this._anchorSwatchInfo = null;
    this._anchorCollectionId = null;
  }

  _deleteSelected() {
    if (this.selectedSwatchKeys.size > 0) {
      this.selectedSwatchKeys.forEach(key => {
        const sep = key.indexOf('~~');
        const groupId = key.slice(0, sep), swatchId = key.slice(sep + 2);
        const col = this.swatchCollections.find(c => c.id === groupId);
        if (!col) return;
        const idx = col.swatches.findIndex(s => s.id === swatchId);
        if (idx >= 0) col.swatches.splice(idx, 1);
      });
      this._clearMultiSelect();
      this._renderSwatchCollections();
      return;
    }
    if (this.selectedCollectionIds.size > 0) {
      this.swatchCollections = this.swatchCollections.filter(c => c.id === 'recent' || !this.selectedCollectionIds.has(c.id));
      this._clearMultiSelect();
      this.selectedCollectionIndex = Math.max(0, Math.min(this.selectedCollectionIndex, this.swatchCollections.length - 1));
      this._renderSwatchCollections();
    }
  }

  _handleMultiCollectionReorder(rawTarget) {
    const ids = this.dragPayload.ids;
    let adjustedTarget = rawTarget;
    this.swatchCollections.forEach((c, i) => { if (i < rawTarget && ids.includes(c.id)) adjustedTarget--; });
    const moving = this.swatchCollections.filter(c => ids.includes(c.id));
    this.swatchCollections = this.swatchCollections.filter(c => !ids.includes(c.id));
    const insertAt = Math.max(1, adjustedTarget);
    this.swatchCollections.splice(insertAt, 0, ...moving);
    this._clearMultiSelect();
    this.dragPayload = null;
    this._clearCollectionDropIndicators();
    this._renderSwatchCollections();
  }

  _addHarmonyColorsToRecent() {
    if (this.harmonyMode === 'none') return;
    const { hsv } = this.state;
    const offsets = this._harmonyOffsets(this.harmonyMode);
    offsets.forEach(offset => {
      const hh = ((hsv.h + offset) % 360 + 360) % 360;
      this._addRecentColor(rgbToHex(hsvToRgb({ h: hh, s: hsv.s, v: hsv.v })));
    });
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
    grid.style.gridTemplateColumns = 'repeat(8, 1fr)';
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
    this._saveCollections();
  }

  _saveCollections() {
    if (!CompactColorPicker._swatchesLoaded) return; // stored collections not loaded yet
    const json = JSON.stringify(this.swatchCollections);
    if (json === CompactColorPicker._savedJSON) return;
    CompactColorPicker._savedJSON = json;
    CompactColorPicker._swatchVersion++;
    this._renderedSwatchVersion = CompactColorPicker._swatchVersion;
    scheduleAppSetting('swatchCollections', JSON.parse(json));
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
      const group = this.swatchCollections[index];
      section.classList.toggle('is-selected', index === this.selectedCollectionIndex && this.selectedCollectionIds.size === 0);
      section.classList.toggle('is-multi-selected', !!(group && this.selectedCollectionIds.has(group.id)));
    });
    this.swatchScrollEl?.querySelectorAll('.compact-color-picker__preset-swatch').forEach(swatchEl => {
      const ci = Number(swatchEl.dataset.collectionIndex);
      const sid = swatchEl.dataset.swatchId;
      const group = this.swatchCollections[ci];
      const key = group ? `${group.id}~~${sid}` : null;
      const singleSelected = this.selectedSwatchRef && ci === this.selectedSwatchRef.collectionIndex && sid === this.selectedSwatchRef.swatchId && this.selectedSwatchKeys.size === 0;
      swatchEl.classList.toggle('is-selected', !!singleSelected);
      swatchEl.classList.toggle('is-multi-selected', !!(key && this.selectedSwatchKeys.has(key)));
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
    } else if (this.dragPayload.type === 'multi-swatch') {
      const items = this.dragPayload.items;
      const movedSwatches = items.map(({ collectionIndex: ci, swatchId: sid }) =>
        this.swatchCollections[ci]?.swatches.find(s => s.id === sid)
      ).filter(Boolean);
      let insertIdx = targetIndex;
      items.forEach(({ collectionIndex: ci, swatchId: sid }) => {
        if (ci !== targetCollectionIndex) return;
        const idx = this.swatchCollections[ci]?.swatches.findIndex(s => s.id === sid) ?? -1;
        if (idx >= 0 && idx < insertIdx) insertIdx--;
      });
      const byCol = new Map();
      items.forEach(({ collectionIndex: ci, swatchId: sid }) => {
        if (!byCol.has(ci)) byCol.set(ci, []);
        byCol.get(ci).push(sid);
      });
      byCol.forEach((ids, ci) => {
        const col = this.swatchCollections[ci];
        if (!col) return;
        const indices = ids.map(id => col.swatches.findIndex(s => s.id === id)).filter(i => i >= 0).sort((a, b) => b - a);
        indices.forEach(i => col.swatches.splice(i, 1));
      });
      targetCollection.swatches.splice(Math.max(0, Math.min(insertIdx, targetCollection.swatches.length)), 0, ...movedSwatches);
      this._clearMultiSelect();
    }

    this.dragPayload = null;
    this._clearDropIndicators();
    this._renderSwatchCollections();
  }

  _configureCanvasResolution() {
    const panelWidth = this.canvasWrapEl.clientWidth || 252;
    const innerWidth = Math.max(180, panelWidth);
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
    Object.values(this.harmonyBtns).forEach(btn => {
      btn.addEventListener('click', () => {
        this.harmonyMode = btn.dataset.harmonyMode;
        Object.values(this.harmonyBtns).forEach(b => b.classList.toggle('is-active', b === btn));
        this.render();
      });
    });

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
    this._bindExtractorEvents();

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
    this._bindKeyboardEvents();
  }

  _bindKeyboardEvents() {
    document.addEventListener('keydown', (evt) => {
      if (!this.panelEl?.isConnected) return;
      if (evt.target.tagName === 'INPUT' || evt.target.tagName === 'TEXTAREA') return;
      if (evt.key === 'Delete' || evt.key === 'Backspace') {
        if (this.selectedSwatchKeys.size > 0 || this.selectedCollectionIds.size > 0) {
          evt.preventDefault();
          this._deleteSelected();
        }
      }
    });
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
      if (target === 'canvas' && this.mode === 'circle' && this.harmonyMode !== 'none') {
        const pos = pointerPosition(evt, this.canvasEl);
        const hitIdx = this._harmonyHitTest(pos);
        if (hitIdx > 0) {
          this._harmonyHit = true;
          const hh = ((this.state.hsv.h + this._harmonyOffsets(this.harmonyMode)[hitIdx]) % 360 + 360) % 360;
          this._setStateFromHsv({ ...this.state.hsv, h: hh }, { commit: false });
          return;
        }
      }
      this._harmonyHit = false;
      this._handlePointer(evt, target, false);
    });

    element.addEventListener('pointermove', (evt) => {
      if (!this.isDragging || this.dragTarget !== target || this._harmonyHit) return;
      this._handlePointer(evt, target, false);
    });

    element.addEventListener('pointerup', (evt) => {
      if (!this.isDragging || this.dragTarget !== target) return;
      if (this._harmonyHit) {
        this._setStateFromHsv(this.state.hsv, { commit: true });
      } else {
        this._handlePointer(evt, target, true);
      }
      this._harmonyHit = false;
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

  _buildArrow() {
    this._arrowWrap = document.createElement('div');
    this._arrowWrap.className = 'picker-arrow-wrap';
    const inner = document.createElement('div');
    inner.className = 'picker-arrow';
    this._arrowWrap.appendChild(inner);
    document.body.appendChild(this._arrowWrap);
  }

  _positionArrow() {
    if (!this.isOpen || !this._arrowWrap) return;
    const anchorEl   = this.swatchEl || this.pickerEl;
    const swatchRect = anchorEl.getBoundingClientRect();
    const panelRect  = this.panelEl.getBoundingClientRect();
    const WRAP_W = 12, WRAP_H = 22;
    const swatchCenterY = swatchRect.top + swatchRect.height / 2;

    let wrapLeft, side;
    if (panelRect.right <= swatchRect.left + 4) {
      wrapLeft = panelRect.right - 1;
      side = 'arrow-right';
    } else {
      wrapLeft = panelRect.left - WRAP_W + 1;
      side = 'arrow-left';
    }
    const wrapTop = Math.min(
      Math.max(swatchCenterY - WRAP_H / 2, panelRect.top + 12),
      panelRect.bottom - 12 - WRAP_H
    );
    this._arrowWrap.className     = `picker-arrow-wrap ${side}`;
    this._arrowWrap.style.left    = `${Math.round(wrapLeft)}px`;
    this._arrowWrap.style.top     = `${Math.round(wrapTop)}px`;
    this._arrowWrap.style.display = 'block';
  }

  open() {
    if (CompactColorPicker.active && CompactColorPicker.active !== this) CompactColorPicker.active.close();
    CompactColorPicker.active = this;
    this.isOpen = true;
    // Another picker (or the startup load) changed the shared swatches — rebuild ours
    if (this._renderedSwatchVersion !== CompactColorPicker._swatchVersion) {
      this._renderedSwatchVersion = CompactColorPicker._swatchVersion;
      this.selectedCollectionIndex = Math.min(this.selectedCollectionIndex, this.swatchCollections.length - 1);
      this.selectedSwatchRef = null;
      this._renderSwatchCollections();
    }
    this.panelEl.hidden = false;
    this._configureCanvasResolution();
    this._positionPanel();
    this.render();
    this._positionArrow();
  }

  close() {
    if (CompactColorPicker.active === this) CompactColorPicker.active = null;
    this.isOpen = false;
    this.panelEl.hidden = true;
    if (this._arrowWrap) this._arrowWrap.style.display = 'none';
  }

  setMode(mode) {
    this.mode = mode;
    this.squareModeBtn.classList.toggle('is-active', mode === 'square');
    this.circleModeBtn.classList.toggle('is-active', mode === 'circle');
    this.canvasEl.classList.toggle('is-round', mode === 'circle');
    this.harmonySectionEl.style.display = mode === 'circle' ? '' : 'none';
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
      if (this.mode === 'circle' && this.harmonyMode !== 'none') {
        this._addHarmonyColorsToRecent();
      } else {
        this._addRecentColor(hex);
      }
    }
  }

  _positionPanel() {
    const anchorEl = this.swatchEl || this.pickerEl;
    const rect = anchorEl.getBoundingClientRect();
    const panelWidth = this.panelEl.offsetWidth || 252;
    const panelHeight = this.panelEl.offsetHeight || 362;

    // Prefer opening to the left of the anchor; fall back to the right if too close to edge.
    let left = rect.left - panelWidth - 10;
    if (left < 8) left = rect.right + 10;
    if (left + panelWidth > window.innerWidth - 8) left = window.innerWidth - panelWidth - 8;

    // Vertically align top with anchor; push up if it clips the bottom.
    let top = rect.top;
    if (top + panelHeight > window.innerHeight - 8) top = window.innerHeight - panelHeight - 8;
    if (top < 8) top = 8;

    this.panelEl.style.left = `${Math.round(left)}px`;
    this.panelEl.style.top = `${Math.round(top)}px`;
    this._positionArrow();
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

    const visualRadius = Math.min(width, height) / 2;
    const primaryAngle = (hsv.h / 180) * Math.PI;
    const primaryDist = (hsv.s / 100) * visualRadius;
    const px = cx + Math.cos(primaryAngle) * primaryDist;
    const py = cy + Math.sin(primaryAngle) * primaryDist;

    if (this.harmonyMode !== 'none') {
      const offsets = this._harmonyOffsets(this.harmonyMode);
      const handles = offsets.map(offset => {
        const hh = ((hsv.h + offset) % 360 + 360) % 360;
        const angle = (hh / 180) * Math.PI;
        const dist = (hsv.s / 100) * visualRadius;
        return { x: cx + Math.cos(angle) * dist, y: cy + Math.sin(angle) * dist, hh };
      });

      ctx.save();
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 1.5 * this.renderScale;
      ctx.setLineDash([3 * this.renderScale, 3 * this.renderScale]);
      handles.forEach((h, i) => {
        if (i === 0) return;
        ctx.beginPath();
        ctx.moveTo(handles[0].x, handles[0].y);
        ctx.lineTo(h.x, h.y);
        ctx.stroke();
      });
      ctx.restore();

      handles.forEach((h, i) => {
        if (i === 0) return;
        const harmonyHex = rgbToHex(hsvToRgb({ h: h.hh, s: hsv.s, v: hsv.v }));
        this._drawHarmonyHandle(ctx, h.x, h.y, harmonyHex, this.renderScale);
      });
    }

    this._drawCrosshair(ctx, px, py);
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

  _harmonyOffsets(mode) {
    switch (mode) {
      case 'complementary': return [0, 180];
      case 'split-comp':    return [0, 150, 210];
      case 'analogous':     return [0, -30, 30];
      case 'triadic':       return [0, 120, 240];
      case 'tetradic':      return [0, 60, 180, 240];
      case 'square':        return [0, 90, 180, 270];
      default:              return [0];
    }
  }

  _harmonyHitTest(pos) {
    if (this.harmonyMode === 'none') return -1;
    const offsets = this._harmonyOffsets(this.harmonyMode);
    const cx = pos.width / 2;
    const cy = pos.height / 2;
    const radius = Math.min(pos.width, pos.height) / 2;
    for (let i = 1; i < offsets.length; i++) {
      const hh = ((this.state.hsv.h + offsets[i]) % 360 + 360) % 360;
      const angle = (hh / 180) * Math.PI;
      const dist = (this.state.hsv.s / 100) * radius;
      const hx = cx + Math.cos(angle) * dist;
      const hy = cy + Math.sin(angle) * dist;
      if (Math.sqrt((pos.x - hx) ** 2 + (pos.y - hy) ** 2) <= 14) return i;
    }
    return -1;
  }

  _drawHarmonyHandle(ctx, x, y, hex, scale) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, 6 * scale, 0, TWO_PI);
    ctx.fillStyle = hex;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5 * scale;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1 * scale;
    ctx.beginPath();
    ctx.arc(x, y, 8 * scale, 0, TWO_PI);
    ctx.stroke();
    ctx.restore();
  }

  // ── Color Extractor ─────────────────────────────────────────────────────────

  _bindExtractorEvents() {
    this.extractorFileInput.addEventListener('change', (evt) => {
      const file = evt.target.files?.[0];
      if (file) this._loadExtractorImage(file);
      evt.target.value = '';
    });

    const preview = this.extractorPreviewEl;
    let dragCounter = 0;

    preview.addEventListener('dragenter', (evt) => {
      evt.preventDefault();
      dragCounter++;
      preview.classList.add('drag-over');
    });

    preview.addEventListener('dragleave', () => {
      dragCounter--;
      if (dragCounter === 0) preview.classList.remove('drag-over');
    });

    preview.addEventListener('dragover', (evt) => {
      evt.preventDefault();
    });

    preview.addEventListener('drop', (evt) => {
      evt.preventDefault();
      dragCounter = 0;
      preview.classList.remove('drag-over');
      const file = evt.dataTransfer.files?.[0];
      if (file && /\.(png|jpe?g|svg|webp|gif)$/i.test(file.name)) this._loadExtractorImage(file);
    });

    this.extractorActionsEl.querySelectorAll('[data-algo]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!this._extractorPixels?.length) return;
        this._runExtractor(btn.dataset.algo);
      });
    });
  }

  async _loadExtractorImage(file, persist = true) {
    try {
      const original = await fileDataURL(file);
      const image = await loadDesignImage(original);
      const scale = Math.min(1, 300 / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0, width, height);
      const data = context.getImageData(0, 0, width, height).data;
      if (persist) {
        await setAppBlobSetting('colorExtractorFileName', file.name || 'Image', EXTRACTOR_IMAGE_KEY, file);
        CompactColorPicker._extractorBlob = file;
        for (const picker of CompactColorPicker._extractorPickers) if (picker !== this) void picker._loadExtractorImage(file, false);
      }
      this._extractorFilename = (file.name || 'Image').replace(/\.[^.]+$/, '');
      this.extractorPreviewImgEl.src = image.src;
      this.extractorPreviewImgEl.style.display = '';
      this.extractorPreviewTextEl.style.display = 'none';
      this._extractorWidth = width;
      this._extractorHeight = height;
      this._extractorRawData = data;
      this._extractorPixels = [];
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] >= 128) this._extractorPixels.push({ r: data[i], g: data[i + 1], b: data[i + 2] });
      }
      this.extractorResultsEl.style.display = 'none';
      this.extractorResultsEl.innerHTML = '';
    } catch (err) { log(`Could not save color extractor image: ${err.message}`, true); }
  }

  _runExtractor(algo) {
    const pixels = this._extractorPixels;
    if (!pixels?.length) return;
    const count = parseInt(this.extractorCountSlider.value, 10);
    const noise = clamp(parseFloat(this.extractorNoiseField.value) || 0, 0, 100) / 100;
    let colors;
    switch (algo) {
      case 'most-common':      colors = this._extractMostCommon(pixels, count, noise); break;
      case 'least-common':     colors = this._extractLeastCommon(pixels, count, noise); break;
      case 'darkest':          colors = this._extractDarkest(pixels, count, noise); break;
      case 'lightest':         colors = this._extractLightest(pixels, count, noise); break;
      case 'kmeans':           colors = this._extractKMeans(pixels, count, 20, noise); break;
      case 'median-cut':       colors = this._extractMedianCut(pixels, count, noise); break;
      case 'mmcq':             colors = this._extractMMCQ(pixels, count, noise); break;
      case 'histogram':        colors = this._extractHistogram(pixels, count, noise); break;
      case 'weighted-regions': colors = this._extractWeightedRegions(count, noise); break;
      case 'vibrant':          colors = this._extractVibrant(pixels, count, noise); break;
      case 'muted':            colors = this._extractMuted(pixels, count, noise); break;
      case 'lab-kmeans':       colors = this._extractLabKMeans(pixels, count, 20, noise); break;
      default: return;
    }
    this._showExtractorResults(colors);
  }

  _showExtractorResults(colors) {
    const count = parseInt(this.extractorCountSlider.value, 10);
    const el = this.extractorResultsEl;
    el.innerHTML = '';
    el.style.display = '';

    if (colors.length < count) {
      const msg = document.createElement('p');
      msg.className = 'compact-color-picker__extractor-limit-msg';
      msg.textContent = 'algorithm cannot detect more color swatches';
      el.appendChild(msg);
    }

    const swatchRow = document.createElement('div');
    swatchRow.className = 'compact-color-picker__extractor-swatches';
    swatchRow.style.gridTemplateColumns = `repeat(${Math.min(colors.length, 8)}, 1fr)`;

    colors.forEach(hex => {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'compact-color-picker__extractor-swatch';
      swatch.style.background = hex;
      swatch.title = hex;
      swatch.addEventListener('click', () => { this.setColor(hex, { commit: true }); this._addRecentColor(hex); });
      swatchRow.appendChild(swatch);
    });

    const addAllBtn = document.createElement('button');
    addAllBtn.type = 'button';
    addAllBtn.className = 'compact-color-picker__extractor-add-all button-medium';
    addAllBtn.textContent = 'Add All to Collection';
    addAllBtn.addEventListener('click', () => {
      const noiseRaw = clamp(parseFloat(this.extractorNoiseField.value) || 0, 0, 100);
      const noiseStr = noiseRaw % 1 === 0 ? String(noiseRaw) : noiseRaw.toFixed(2).replace('.', 'p');
      const title = `${this._extractorFilename || 'image'}-S${count}-N${noiseStr}`;
      this.swatchCollections.forEach(c => { c.open = false; });
      this.swatchCollections.push({
        id: `swatch-ext-${Date.now()}`,
        title,
        open: true,
        swatches: colors.map(hex => ({ id: `swatch-ext-${Date.now()}-${Math.random().toString(36).slice(2)}`, hex, name: hex })),
      });
      this.selectedCollectionIndex = this.swatchCollections.length - 1;
      this.lastSelectionType = 'collection';
      this.selectedSwatchRef = null;
      this._renderSwatchCollections();
    });

    el.append(swatchRow, addAllBtn);
  }

  // ── Shared helpers ──────────────────────────────────────────────────────────

  _sampleN(pixels, n, noise = 0) {
    if (pixels.length <= n) return pixels;
    const step = pixels.length / n;
    const out = [];
    for (let i = 0; i < n; i++) {
      const jitter = noise > 0 ? (Math.random() - 0.5) * noise * step : 0;
      out.push(pixels[Math.min(pixels.length - 1, Math.max(0, Math.floor(i * step + jitter)))]);
    }
    return out;
  }

  _colorDistSq(a, b) {
    const dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b;
    return dr * dr + dg * dg + db * db;
  }

  _deduplicateColors(hexList, count, threshold = 30) {
    const result = [];
    const threshSq = threshold * threshold;
    for (const hex of hexList) {
      if (result.length >= count) break;
      const rgb = hexToRgb(hex);
      if (!rgb) continue;
      if (!result.some(({ rgb: c }) => this._colorDistSq(rgb, c) < threshSq)) {
        result.push({ hex, rgb });
      }
    }
    return result.map(({ hex }) => hex);
  }

  _boxRange(box) {
    let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;
    for (const { r, g, b } of box) {
      if (r < rMin) rMin = r; if (r > rMax) rMax = r;
      if (g < gMin) gMin = g; if (g > gMax) gMax = g;
      if (b < bMin) bMin = b; if (b > bMax) bMax = b;
    }
    const rRange = rMax - rMin, gRange = gMax - gMin, bRange = bMax - bMin;
    const max = Math.max(rRange, gRange, bRange);
    const channel = max === rRange ? 'r' : max === gRange ? 'g' : 'b';
    return { max, channel };
  }

  _splitBox(box, noise = 0) {
    const { channel } = this._boxRange(box);
    const sorted = [...box].sort((a, b) => a[channel] - b[channel]);
    const jitter = noise > 0 ? Math.round((Math.random() - 0.5) * noise * sorted.length * 0.3) : 0;
    const mid = Math.max(1, Math.min(sorted.length - 1, Math.floor(sorted.length / 2) + jitter));
    return [sorted.slice(0, mid), sorted.slice(mid)];
  }

  // ── Algorithms ──────────────────────────────────────────────────────────────

  _extractMostCommon(pixels, count, noise = 0) {
    const freq = new Map();
    for (const { r, g, b } of pixels) {
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      freq.set(key, (freq.get(key) || 0) + 1);
    }
    let sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);
    if (noise > 0) {
      const poolSize = Math.min(sorted.length, Math.ceil(count * (1 + noise * 3)));
      sorted = sorted.slice(0, poolSize).sort(() => Math.random() - 0.5);
    }
    const candidates = sorted.map(([key]) => {
      const r = ((key >> 10) & 31) << 3;
      const g = ((key >> 5) & 31) << 3;
      const b = (key & 31) << 3;
      return rgbToHex({ r, g, b });
    });
    return this._deduplicateColors(candidates, count);
  }

  _extractLeastCommon(pixels, count, noise = 0) {
    const freq = new Map();
    for (const { r, g, b } of pixels) {
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      freq.set(key, (freq.get(key) || 0) + 1);
    }
    let sorted = [...freq.entries()].sort((a, b) => a[1] - b[1]);
    if (noise > 0) {
      const poolSize = Math.min(sorted.length, Math.ceil(count * (1 + noise * 3)));
      sorted = sorted.slice(0, poolSize).sort(() => Math.random() - 0.5);
    }
    const candidates = sorted.map(([key]) => {
      const r = ((key >> 10) & 31) << 3;
      const g = ((key >> 5) & 31) << 3;
      const b = (key & 31) << 3;
      return rgbToHex({ r, g, b });
    });
    return this._deduplicateColors(candidates, count);
  }

  _extractByLuminance(pixels, count, asc, noise = 0) {
    const lums = pixels.map(p => {
      const base = 0.2126 * p.r + 0.7152 * p.g + 0.0722 * p.b;
      return noise > 0 ? base + (Math.random() - 0.5) * noise * 40 : base;
    });
    const indices = Array.from({ length: pixels.length }, (_, i) => i);
    indices.sort((a, b) => asc ? lums[a] - lums[b] : lums[b] - lums[a]);
    return this._deduplicateColors(indices.map(i => rgbToHex(pixels[i])), count);
  }

  _extractDarkest(pixels, count, noise = 0)  { return this._extractByLuminance(pixels, count, true, noise);  }
  _extractLightest(pixels, count, noise = 0) { return this._extractByLuminance(pixels, count, false, noise); }

  _extractKMeans(pixels, count, maxIter = 20, noise = 0) {
    const sample = this._sampleN(pixels, 3000, noise);
    const initPool = noise > 0 ? [...sample].sort(() => Math.random() - 0.5) : sample;
    let centroids = this._sampleN(initPool, count).map(p => ({ r: p.r, g: p.g, b: p.b }));

    for (let iter = 0; iter < maxIter; iter++) {
      const sums = Array.from({ length: count }, () => ({ r: 0, g: 0, b: 0, n: 0 }));
      for (const px of sample) {
        let best = 0, bestDist = Infinity;
        for (let c = 0; c < centroids.length; c++) {
          const d = this._colorDistSq(px, centroids[c]);
          if (d < bestDist) { bestDist = d; best = c; }
        }
        sums[best].r += px.r; sums[best].g += px.g; sums[best].b += px.b; sums[best].n++;
      }
      let moved = false;
      for (let c = 0; c < count; c++) {
        if (sums[c].n === 0) continue;
        const next = { r: sums[c].r / sums[c].n, g: sums[c].g / sums[c].n, b: sums[c].b / sums[c].n };
        if (this._colorDistSq(next, centroids[c]) > 1) moved = true;
        centroids[c] = next;
      }
      if (!moved) break;
    }

    return this._deduplicateColors(centroids.map(c => rgbToHex({ r: Math.round(c.r), g: Math.round(c.g), b: Math.round(c.b) })), count);
  }

  _extractMedianCut(pixels, count, noise = 0) {
    const sample = this._sampleN(pixels, 5000, noise);
    let boxes = [sample];

    while (boxes.length < count) {
      let bestBox = 0, bestRange = -1;
      for (let i = 0; i < boxes.length; i++) {
        const { max } = this._boxRange(boxes[i]);
        if (max > bestRange) { bestRange = max; bestBox = i; }
      }
      const [left, right] = this._splitBox(boxes[bestBox], noise);
      if (!left.length || !right.length) break;
      boxes.splice(bestBox, 1, left, right);
    }

    return boxes.map(box => {
      const n = box.length;
      const r = Math.round(box.reduce((s, p) => s + p.r, 0) / n);
      const g = Math.round(box.reduce((s, p) => s + p.g, 0) / n);
      const b = Math.round(box.reduce((s, p) => s + p.b, 0) / n);
      return rgbToHex({ r, g, b });
    });
  }

  _extractMMCQ(pixels, count, noise = 0) {
    const sample = this._sampleN(pixels, 5000, noise);
    let boxes = [[sample, this._boxRange(sample)]];

    while (boxes.length < count) {
      boxes.sort(([aBox, aR], [bBox, bR]) => bBox.length * bR.max - aBox.length * aR.max);
      const [topBox] = boxes[0];
      const [left, right] = this._splitBox(topBox, noise);
      if (!left.length || !right.length) break;
      boxes.splice(0, 1, [left, this._boxRange(left)], [right, this._boxRange(right)]);
    }

    return boxes.map(([box, { channel }]) => {
      const sorted = [...box].sort((a, b) => a[channel] - b[channel]);
      return rgbToHex(sorted[Math.floor(sorted.length / 2)]);
    });
  }

  _extractHistogram(pixels, count, noise = 0) {
    const BITS = 4;
    const LEVELS = 1 << BITS;
    const freq = new Uint32Array(LEVELS * LEVELS * LEVELS);

    for (const { r, g, b } of pixels) {
      freq[((r >> (8 - BITS)) * LEVELS + (g >> (8 - BITS))) * LEVELS + (b >> (8 - BITS))]++;
    }

    const indices = [];
    for (let i = 0; i < freq.length; i++) {
      if (freq[i] > 0) indices.push(i);
    }
    indices.sort((a, b) => freq[b] - freq[a]);

    if (noise > 0) {
      const poolSize = Math.min(indices.length, Math.ceil(count * (1 + noise * 4)));
      for (let i = poolSize - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = indices[i]; indices[i] = indices[j]; indices[j] = tmp;
      }
      indices.length = poolSize;
    }

    const results = [];
    const taken = [];
    const scale = 255 / (LEVELS - 1);
    const binGapSq = 9;

    for (const idx of indices) {
      if (results.length >= count) break;
      const ri = (idx >> (BITS * 2)) & (LEVELS - 1);
      const gi = (idx >> BITS) & (LEVELS - 1);
      const bi = idx & (LEVELS - 1);
      const tooClose = taken.some(([pr, pg, pb]) => {
        const dr = ri - pr, dg = gi - pg, db = bi - pb;
        return dr * dr + dg * dg + db * db < binGapSq;
      });
      if (tooClose) continue;
      taken.push([ri, gi, bi]);
      results.push(rgbToHex({ r: Math.round(ri * scale), g: Math.round(gi * scale), b: Math.round(bi * scale) }));
    }

    return results;
  }

  _extractWeightedRegions(count, noise = 0) {
    const data = this._extractorRawData;
    const W = this._extractorWidth;
    const H = this._extractorHeight;
    if (!data || !W || !H) return [];

    const GRID = Math.ceil(Math.sqrt(count * 2));
    const cellW = W / GRID;
    const cellH = H / GRID;

    const cx = W / 2 + (noise > 0 ? (Math.random() - 0.5) * noise * W * 0.3 : 0);
    const cy = H / 2 + (noise > 0 ? (Math.random() - 0.5) * noise * H * 0.3 : 0);
    const maxDistSq = cx * cx + cy * cy;

    const cells = Array.from({ length: GRID * GRID }, () => ({ r: 0, g: 0, b: 0, w: 0 }));

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = (y * W + x) * 4;
        if (data[idx + 3] < 128) continue;
        const ci = Math.min(GRID - 1, Math.floor(x / cellW));
        const cj = Math.min(GRID - 1, Math.floor(y / cellH));
        const dx = x - cx, dy = y - cy;
        const weight = 1 - (dx * dx + dy * dy) / maxDistSq;
        const cell = cells[cj * GRID + ci];
        cell.r += data[idx] * weight;
        cell.g += data[idx + 1] * weight;
        cell.b += data[idx + 2] * weight;
        cell.w += weight;
      }
    }

    const candidates = cells
      .filter(c => c.w > 0)
      .sort((a, b) => b.w - a.w)
      .map(c => rgbToHex({ r: Math.round(c.r / c.w), g: Math.round(c.g / c.w), b: Math.round(c.b / c.w) }));

    return this._deduplicateColors(candidates, count);
  }

  _filterHSV(pixels, sPred, vMin, vMax) {
    return pixels.filter(({ r, g, b }) => {
      const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255;
      const s = max === 0 ? 0 : (max - min) / max;
      return sPred(s) && max > vMin && max < vMax;
    });
  }

  _extractVibrant(pixels, count, noise = 0) {
    const filtered = this._filterHSV(pixels, s => s > 0.35, 0.25, 0.97);
    if (filtered.length < count) return this._extractKMeans(pixels, count, 20, noise);
    return this._extractKMeans(filtered, count, 20, noise);
  }

  _extractMuted(pixels, count, noise = 0) {
    const filtered = this._filterHSV(pixels, s => s < 0.4, 0.2, 0.92);
    if (filtered.length < count) return this._extractKMeans(pixels, count, 20, noise);
    return this._extractKMeans(filtered, count, 20, noise);
  }

  _extractLabKMeans(pixels, count, maxIter = 20, noise = 0) {
    const sample = this._sampleN(pixels, 3000, noise).map(p => rgbToLab(p));
    const initPool = noise > 0 ? [...sample].sort(() => Math.random() - 0.5) : sample;
    let centroids = this._sampleN(initPool, count).map(s => ({ ...s }));

    for (let iter = 0; iter < maxIter; iter++) {
      const sums = Array.from({ length: count }, () => ({ L: 0, a: 0, b: 0, n: 0 }));
      for (const lab of sample) {
        let best = 0, bestDist = Infinity;
        for (let c = 0; c < centroids.length; c++) {
          const dL = lab.L - centroids[c].L, da = lab.a - centroids[c].a, db = lab.b - centroids[c].b;
          const d = dL * dL + da * da + db * db;
          if (d < bestDist) { bestDist = d; best = c; }
        }
        sums[best].L += lab.L; sums[best].a += lab.a; sums[best].b += lab.b; sums[best].n++;
      }
      let moved = false;
      for (let c = 0; c < count; c++) {
        if (sums[c].n === 0) continue;
        const next = { L: sums[c].L / sums[c].n, a: sums[c].a / sums[c].n, b: sums[c].b / sums[c].n };
        const dL = next.L - centroids[c].L, da = next.a - centroids[c].a, db = next.b - centroids[c].b;
        if (dL * dL + da * da + db * db > 0.5) moved = true;
        centroids[c] = next;
      }
      if (!moved) break;
    }

    return this._deduplicateColors(centroids.map(lab => rgbToHex(labToRgb(lab))), count);
  }
}

