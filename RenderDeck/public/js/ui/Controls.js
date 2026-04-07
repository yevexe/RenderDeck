// CONTROLS.JS - UI Controls Management
// Handles both original controls and new MeshPhysicalMaterial controls from Setting 3

import { log } from '../utils/logger.js';

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

    this.setupEventListeners();
    this.initColorSwatches();
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
      const swatch = this.elements[swatchKey];
      const hex = this.elements[hexKey];
      if (picker && swatch) {
        swatch.style.backgroundColor = picker.value;
        swatch.style.width = '16px';
        swatch.style.height = '16px';
        swatch.style.display = 'inline-block';
        swatch.style.borderRadius = '3px';
        swatch.style.border = '1px solid #555';
        swatch.style.marginRight = '4px';
      }
      if (hex && picker) hex.value = picker.value;
    });
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

  _bindMaterialSection(toggleEl, contentEl, openByDefault) {
    if (!toggleEl || !contentEl) return;
    const sectionEl = toggleEl.closest('.material-section');
    const setExpanded = (expanded) => {
      toggleEl.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      if (sectionEl) sectionEl.classList.toggle('is-open', expanded);
      contentEl.style.maxHeight = expanded ? `${contentEl.scrollHeight}px` : '0px';
    };

    setExpanded(openByDefault);
    requestAnimationFrame(() => setExpanded(openByDefault));
    window.addEventListener('resize', () => {
      if (toggleEl.getAttribute('aria-expanded') === 'true') {
        contentEl.style.maxHeight = `${contentEl.scrollHeight}px`;
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
    const sync = (hex) => {
      if (pickerEl) pickerEl.value = hex;
      if (hexEl) hexEl.value = hex;
      if (swatchEl) swatchEl.style.backgroundColor = hex;
      if (callback) callback(hex);
    };
    if (pickerEl) {
      pickerEl.addEventListener('input', () => sync(pickerEl.value));
    }
    if (hexEl) {
      hexEl.addEventListener('change', () => {
        const raw = hexEl.value.trim();
        const normalized = raw.startsWith('#') ? raw : '#' + raw;
        if (/^#[0-9a-fA-F]{6}$/.test(normalized)) {
          sync(normalized);
        }
      });
    }
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
    // Keep placeholder
    const placeholder = Array.from(sel.options).find(o => o.disabled);
    sel.innerHTML = '';
    if (placeholder) sel.appendChild(placeholder);
    sceneNames.forEach(name => {
      const o = document.createElement('option');
      o.value = name; o.textContent = name;
      sel.appendChild(o);
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
      if (picker) picker.value = hexStr;
      if (hex) hex.value = hexStr;
      if (swatch) swatch.style.backgroundColor = hexStr;
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
