import { CompactColorPicker } from '../widgets/CompactColorPicker.js';
import { CustomSelect } from '../widgets/CustomSelect.js';
import { clamp } from '../widgets/colorMath.js';
import { log } from '../../utils/logger.js';

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
      materialExpertSection: document.getElementById('material-expert-toggle'),
      materialExpertContent: document.getElementById('material-expert-content'),

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
      displacementScaleSlider: document.getElementById('displacement-scale-slider'),
      displacementScaleInput: document.getElementById('displacement-scale-input'),
      displacementBiasSlider: document.getElementById('displacement-bias-slider'),
      displacementBiasInput: document.getElementById('displacement-bias-input'),

      // Old model management buttons (kept for compatibility)
      uploadModelBtn: document.getElementById('upload-model-btn'),
      modelFileInput: document.getElementById('model-file-input'),
      exportBtn: document.getElementById('export-btn'),
      importBtn: document.getElementById('import-btn'),
      fileInput: document.getElementById('file-input'),
      clearCustomBtn: document.getElementById('clear-custom-btn'),
      restoreStandardBtn: document.getElementById('restore-standard-btn'),
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
      .filter(([name, el]) => !el && name !== 'uploadModelBtn')
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
      // Assigning can load another object's file, so the commit waits for it
      this._matSelect.onChange(async value => {
        await this.callbacks.onMaterialChange?.(value);
        this.callbacks.onMaterialPropertyCommit?.();
      });
    }

    // Custom object selector dropdown
    if (this.elements.objectSelect) {
      this._objSelect = new CustomSelect(this.elements.objectSelect);
      this._objSelect._label.textContent = '— Select object —';
      this._objSelect.onChange(value => this.callbacks.onModelChange?.(value));
      // Forward element.value ↔ CustomSelect.value so main.js sel.value = name keeps working
      const _el = this.elements.objectSelect;
      const _cs = this._objSelect;
      Object.defineProperty(_el, 'value', {
        get: ()  => _cs.value,
        set: (v) => { _cs.value = v; },
        configurable: true,
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
    this._bindMaterialSection(this.elements.materialExpertSection, this.elements.materialExpertContent, false);
  }

  // ─── Grid settings popup ──────────────────────────────────────
  initGridSettings() {
    const el = this.elements;
    if (!el.gridSettingsBtn || !el.gridSettingsPopup) return;

    function closeToolbarPopups() {
      document.querySelectorAll('.toolbar-popup').forEach(p => { p.style.display = 'none'; });
      document.getElementById('tf-grid-settings')?.classList.remove('tf-btn--active');
      document.getElementById('tf-dim-settings')?.classList.remove('tf-btn--active');
      document.getElementById('tf-snap-settings')?.classList.remove('tf-btn--active');
    }

    // Popup open / close
    el.gridSettingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = el.gridSettingsPopup.style.display !== 'none';
      closeToolbarPopups();
      if (!open) {
        el.gridSettingsPopup.style.display = 'block';
        el.gridSettingsBtn.classList.add('tf-btn--active');
      }
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

    // ── Model select (legacy panel) ──────────────────────────────
    if (el.modelSelect) {
      el.modelSelect.addEventListener('change', e => cb.onModelChange?.(e.target.value));
    }
    // Setting 1 object select — wired via _objSelect.onChange() in initialize()

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
    // DISPLACEMENT SCALE / BIAS
    this.linkSliderInput(el.displacementScaleSlider, el.displacementScaleInput,
      v => cb.onMaterialPropertyChange?.('displacementScale', v));
    this.linkSliderInput(el.displacementBiasSlider, el.displacementBiasInput,
      v => cb.onMaterialPropertyChange?.('displacementBias', v));

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
        el.displacementScaleSlider, el.displacementBiasSlider,
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
        el.displacementScaleInput, el.displacementBiasInput,
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
    // and transform sliders. ControlsManager.js only wires open + reset.
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
    if (el.restoreStandardBtn) {
      el.restoreStandardBtn.addEventListener('click', () => cb.onRestoreStandard?.());
    }

    // Object-tab burger menu toggle
    const objMenuBtn = document.getElementById('object-select-menu-btn');
    const objMenuEl  = document.getElementById('object-select-menu');
    if (objMenuBtn && objMenuEl) {
      objMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = !objMenuEl.hidden;
        objMenuEl.hidden = open;
        objMenuBtn.classList.toggle('is-open', !open);
      });
      document.addEventListener('mousedown', (e) => {
        if (objMenuEl.hidden) return;
        if (objMenuBtn.contains(e.target) || objMenuEl.contains(e.target)) return;
        objMenuEl.hidden = true;
        objMenuBtn.classList.remove('is-open');
      });
      objMenuEl.querySelectorAll('.dropdown-menu-item').forEach(item => {
        item.addEventListener('click', () => {
          objMenuEl.hidden = true;
          objMenuBtn.classList.remove('is-open');
        });
      });
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

      thumb.addEventListener('click', () => {
        if (wrapper.classList.contains('has-texture') && thumb._previewImg) {
          this._showChannelTexPreview(thumb, mapKey);
        } else {
          fileInput.click();
        }
      });
      clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this._texPreviewPopup) this._texPreviewPopup.hidden = true;
        if (this._texPreviewArrow) this._texPreviewArrow.style.display = 'none';
        this.callbacks.onChannelTextureClear?.(mapKey);
      });
      fileInput.addEventListener('change', e => {
        if (e.target.files[0]) this.callbacks.onChannelTextureUpload?.(mapKey, e.target.files[0]);
        e.target.value = '';
      });

      // ── Drag-and-drop between channel slots ──────────────────────
      thumb.draggable = true;
      thumb.addEventListener('dragstart', (e) => {
        if (!wrapper.classList.contains('has-texture')) { e.preventDefault(); return; }
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('application/rd-channel', mapKey);
        // setTimeout so the browser captures the drag image before opacity kicks in
        setTimeout(() => wrapper.classList.add('drag-source'), 0);
      });
      thumb.addEventListener('dragend', () => {
        wrapper.classList.remove('drag-source');
        document.querySelectorAll('.channel-tex-wrapper.drag-over')
          .forEach(el => el.classList.remove('drag-over'));
      });

      wrapper.addEventListener('dragover', (e) => {
        if (!e.dataTransfer.types.includes('application/rd-channel')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        wrapper.classList.add('drag-over');
      });
      wrapper.addEventListener('dragleave', (e) => {
        if (!wrapper.contains(e.relatedTarget)) wrapper.classList.remove('drag-over');
      });
      wrapper.addEventListener('drop', (e) => {
        e.preventDefault();
        wrapper.classList.remove('drag-over');
        const fromChannel = e.dataTransfer.getData('application/rd-channel');
        if (!fromChannel || fromChannel === mapKey) return;
        this.callbacks.onChannelTextureMove?.(fromChannel, mapKey);
      });

      wrapper.append(thumb, clearBtn);
      refEl.parentElement.insertBefore(wrapper, refEl);
      this.elements[`texThumb_${mapKey}`] = thumb;

      // GLTF packs roughness (G), metalness (B), and AO (R) into one ORM texture.
      // Store which channel to extract so thumbnails show greyscale instead of the raw color.
      const PACKED = { roughnessMap: 'g', metalnessMap: 'b', aoMap: 'r' };
      if (PACKED[mapKey]) thumb.dataset.channelHint = PACKED[mapKey];

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
    const W = canvas.width, H = canvas.height;

    const drawEmpty = () => {
      canvas._previewImg = null;
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = '#555'; ctx.lineWidth = 1;
      const m = W / 2;
      ctx.beginPath();
      ctx.moveTo(m, 4); ctx.lineTo(m, H - 4);
      ctx.moveTo(4, m); ctx.lineTo(W - 4, m);
      ctx.stroke();
      wrapper?.classList.remove('has-texture');
    };

    // Draw an image element (HTMLImageElement, ImageBitmap, HTMLCanvasElement, etc.).
    // If canvas.dataset.channelHint is set ('r'|'g'|'b'), extract that channel as greyscale
    // so GLTF packed ORM textures show the correct single-channel preview.
    const drawImg = (img) => {
      canvas._previewImg = img; // stored so preview popup can display full-size
      const channelHint = canvas.dataset?.channelHint;
      try {
        if (channelHint) {
          const tmp = document.createElement('canvas');
          tmp.width = W; tmp.height = H;
          const tc = tmp.getContext('2d');
          tc.drawImage(img, 0, 0, W, H);
          const id = tc.getImageData(0, 0, W, H);
          const d = id.data;
          const ci = { r: 0, g: 1, b: 2 }[channelHint] ?? 0;
          for (let i = 0; i < d.length; i += 4) {
            const v = d[i + ci];
            d[i] = d[i + 1] = d[i + 2] = v;
            d[i + 3] = 255;
          }
          ctx.putImageData(id, 0, 0);
        } else {
          ctx.drawImage(img, 0, 0, W, H);
        }
        wrapper?.classList.add('has-texture');
      } catch {
        // image not drawable (CompressedTexture, DataTexture, etc.) — show empty
        drawEmpty();
      }
    };

    if (typeof source === 'string') {
      // Data URL — async load
      const img = new Image();
      img.onload = () => { ctx.clearRect(0, 0, W, H); drawImg(img); };
      img.onerror = () => drawEmpty();
      img.src = source;
      return;
    }

    const img = source?.image ?? null;
    if (img) drawImg(img); else drawEmpty();
  }

  /** Show a floating preview popup for a channel texture thumbnail. */
  _showChannelTexPreview(thumbEl, mapKey) {
    const NAMES = {
      map: 'Base Color', normalMap: 'Normal', roughnessMap: 'Roughness',
      metalnessMap: 'Metalness', aoMap: 'Ambient Occlusion', bumpMap: 'Bump',
      displacementMap: 'Displacement', specularColorMap: 'Specular Color',
      specularIntensityMap: 'Specular Intensity', clearcoatMap: 'Clearcoat',
      clearcoatRoughnessMap: 'Clearcoat Roughness', clearcoatNormalMap: 'Clearcoat Normal',
      alphaMap: 'Alpha', transmissionMap: 'Transmission', thicknessMap: 'Thickness',
      sheenColorMap: 'Sheen Color', sheenRoughnessMap: 'Sheen Roughness',
      emissiveMap: 'Emissive', anisotropyMap: 'Anisotropy',
      iridescenceMap: 'Iridescence', iridescenceThicknessMap: 'Iridescence Thickness',
    };

    // Build popup once, reuse for all channels
    if (!this._texPreviewPopup) {
      const popup = document.createElement('div');
      popup.className = 'channel-tex-preview-popup';
      popup.hidden = true;

      const title = document.createElement('div');
      title.className = 'channel-tex-preview-popup__title';

      const previewCanvas = document.createElement('canvas');
      previewCanvas.className = 'channel-tex-preview-popup__canvas';
      previewCanvas.width = 160;
      previewCanvas.height = 160;

      popup.append(title, previewCanvas);
      document.body.appendChild(popup);

      this._texPreviewPopup       = popup;
      this._texPreviewPopupTitle  = title;
      this._texPreviewPopupCanvas = previewCanvas;

      // Arrow connector (same style as color picker arrow)
      const arrowWrap = document.createElement('div');
      arrowWrap.className = 'picker-arrow-wrap';
      arrowWrap.style.display = 'none';
      const arrowInner = document.createElement('div');
      arrowInner.className = 'picker-arrow';
      arrowWrap.appendChild(arrowInner);
      document.body.appendChild(arrowWrap);
      this._texPreviewArrow = arrowWrap;

      // Close on outside click or Escape
      document.addEventListener('mousedown', (e) => {
        if (!this._texPreviewPopup.hidden &&
            !this._texPreviewPopup.contains(e.target) &&
            e.target !== this._texPreviewAnchor) {
          this._texPreviewPopup.hidden = true;
          this._texPreviewArrow.style.display = 'none';
        }
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          this._texPreviewPopup.hidden = true;
          this._texPreviewArrow.style.display = 'none';
        }
      });
    }

    this._texPreviewAnchor = thumbEl;
    this._texPreviewPopupTitle.textContent = NAMES[mapKey] ?? mapKey;

    // Draw the image into the preview canvas, applying channel extraction if needed.
    // Uses object-fit:contain logic so the image is never squished.
    const previewCanvas = this._texPreviewPopupCanvas;
    const ctx = previewCanvas.getContext('2d');
    const CW = previewCanvas.width, CH = previewCanvas.height;
    ctx.clearRect(0, 0, CW, CH);
    const img = thumbEl._previewImg;
    if (img) {
      const channelHint = thumbEl.dataset?.channelHint;
      // Compute contain-fit dimensions
      const iw = img.naturalWidth || img.width || CW;
      const ih = img.naturalHeight || img.height || CH;
      const scale = Math.min(CW / iw, CH / ih);
      const dw = iw * scale, dh = ih * scale;
      const dx = (CW - dw) / 2,  dy = (CH - dh) / 2;
      try {
        if (channelHint) {
          ctx.drawImage(img, dx, dy, dw, dh);
          const id = ctx.getImageData(0, 0, CW, CH);
          const d = id.data;
          const ci = { r: 0, g: 1, b: 2 }[channelHint] ?? 0;
          for (let i = 0; i < d.length; i += 4) {
            const v = d[i + ci]; d[i] = d[i+1] = d[i+2] = v; d[i+3] = d[i+3] > 0 ? 255 : 0;
          }
          ctx.putImageData(id, 0, 0);
        } else {
          ctx.drawImage(img, dx, dy, dw, dh);
        }
      } catch { /* non-drawable — canvas stays blank */ }
    }

    // Position popup: prefer left of thumb, fall back to right, clamp to viewport
    this._texPreviewPopup.hidden = false;
    const rect   = thumbEl.getBoundingClientRect();
    const popupW = this._texPreviewPopup.offsetWidth  || 196;
    const popupH = this._texPreviewPopup.offsetHeight || 210;

    let left = rect.left - popupW - 8;
    const openLeft = left >= 8;
    if (!openLeft) left = rect.right + 8;
    if (left + popupW > window.innerWidth - 8) left = window.innerWidth - popupW - 8;

    // Center popup vertically on the thumb so the arrow always hits it cleanly.
    const thumbCenterY = rect.top + rect.height / 2;
    let top = thumbCenterY - popupH / 2;
    if (top + popupH > window.innerHeight - 8) top = window.innerHeight - popupH - 8;
    if (top < 8) top = 8;

    this._texPreviewPopup.style.left = `${Math.round(left)}px`;
    this._texPreviewPopup.style.top  = `${Math.round(top)}px`;

    // Arrow connector: positioned at thumb center, clamped within popup margins
    const ARROW_H = 22;
    const arrowWrap = this._texPreviewArrow;
    if (openLeft) {
      arrowWrap.className = 'picker-arrow-wrap arrow-right';
      arrowWrap.style.left = `${Math.round(left + popupW - 1)}px`;
    } else {
      arrowWrap.className = 'picker-arrow-wrap arrow-left';
      arrowWrap.style.left = `${Math.round(left - 12 + 1)}px`;
    }
    const arrowTop = Math.min(
      Math.max(thumbCenterY - ARROW_H / 2, top + 12),
      top + popupH - 12 - ARROW_H
    );
    arrowWrap.style.top     = `${Math.round(arrowTop)}px`;
    arrowWrap.style.display = 'block';
  }

  // ─── Public methods ───────────────────────────────────────────

  /**
   * Populate the model/object dropdown (Setting 1 + legacy panel)
   */
  updateModelSelect(categories, designThumbs = {}, matThumbs = {}) {
    // CustomSelect dropdown for the main object selector
    if (this._objSelect) {
      const deletable = new Set([...(categories.custom || []), ...(categories.uploaded || [])]);
      const groups = [];
      if (categories.builtin?.length)  groups.push({ label: 'Built-in Models', items: categories.builtin });
      if (categories.custom?.length)   groups.push({ label: 'Custom Models',   items: categories.custom });
      if (categories.uploaded?.length) groups.push({ label: 'Uploaded Models', items: categories.uploaded });
      this._objSelect.populate(groups.length ? { groups } : []);

      this._objSelect._dropdown.querySelectorAll('.custom-select__option').forEach(opt => {
        const name = opt.dataset.value;
        const labelRow = opt.querySelector('.custom-select__option-label-row');

        // Material thumbnails — one circle per part, shown before the design thumb
        const parts = matThumbs[name];
        if (parts?.length && labelRow) {
          const container = document.createElement('span');
          container.className = 'custom-select__option-mat-thumbs';
          parts.forEach(({ partName, dataUrl }) => {
            const img = document.createElement('img');
            img.className = 'custom-select__option-mat-thumb';
            img.dataset.part = partName;
            img.src = dataUrl;
            img.alt = '';
            container.appendChild(img);
          });
          labelRow.appendChild(container);
        }

        // Design thumbnail — shown after the material thumbnails
        const thumbUrl = designThumbs[name];
        if (thumbUrl) {
          const img = document.createElement('img');
          img.className = 'custom-select__option-design-thumb';
          img.src = thumbUrl;
          img.alt = '';
          if (labelRow) labelRow.appendChild(img);
        }

        // Trash button — only for deletable (custom/uploaded) options
        if (!deletable.has(name)) return;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'custom-select__option-delete';
        btn.tabIndex = -1;
        btn.setAttribute('aria-label', 'Delete');
        btn.innerHTML = '<svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 3h8M5 3V2h2v1M4.5 3v6m3-6v6M3 3l.5 7h5L9 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        btn.addEventListener('click', e => {
          e.stopPropagation();
          this.callbacks.onDeleteModel?.(name);
        });
        opt.appendChild(btn);
      });
    }

    // Traditional <select> elements for the other selectors
    [this.elements.modelSelect, this.elements.objectSelectMaterialTab].forEach(sel => {
      if (!sel) return;
      sel.innerHTML = '';
      if (!categories.builtin?.length && !categories.custom?.length && !categories.uploaded?.length) {
        const o = document.createElement('option');
        o.value = ''; o.textContent = '-- no models available --';
        o.disabled = true; o.selected = true;
        sel.appendChild(o);
        return;
      }
      [['Built-in Models', categories.builtin], ['Custom Models', categories.custom], ['Uploaded Models', categories.uploaded]]
        .forEach(([label, names]) => {
          if (!names?.length) return;
          const g = document.createElement('optgroup');
          g.label = label;
          names.forEach(name => {
            const o = document.createElement('option');
            o.value = name; o.textContent = name;
            g.appendChild(o);
          });
          sel.appendChild(g);
        });
    });
  }

  /**
   * Populate the material dropdown (Setting 3) from the library's sections.
   * @param {Array<{ label: string, isObject?: boolean, items: Array<{value: string, label: string}> }>} sections
   * @param {(id: string) => string|null} [getThumbnail]
   * @param {() => string} [getEnvKey]
   */
  updateMaterialPresetSelect(sections, getThumbnail, getEnvKey) {
    if (!this._matSelect) return;
    this._matSelect.populate({ groups: sections.filter(section => section.items.length) }, getThumbnail, getEnvKey);
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
    // Reflectivity is derived from IOR; hide floating-point round-trip noise.
    set(el.reflectivitySlider, el.reflectivityInput, Number((material.reflectivity ?? 0.5).toFixed(12)));
    set(el.sheenSlider, el.sheenInput, material.sheen ?? 0);

    // Normal scale (Vector2 — use x component)
    set(el.normalScaleSlider, el.normalScaleInput, material.normalScale?.x ?? 1);

    // Displacement scale / bias
    set(el.displacementScaleSlider, el.displacementScaleInput, material.displacementScale ?? 1);
    set(el.displacementBiasSlider, el.displacementBiasInput, material.displacementBias ?? 0);

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

  /** Sync a single material property's UI controls without touching any other elements.
   *  Used by the Node Editor to push changes without the overhead of syncMaterialUI. */
  syncOneMaterialProp(matProp, value) {
    const el = this.elements;
    const set = (slider, input, val) => {
      if (slider) slider.value = val;
      if (input)  input.value  = val;
    };
    const setHex = (picker, hexInput, hexStr) => {
      if (!hexStr || !/^#[0-9a-fA-F]{6}$/i.test(hexStr)) return;
      if (picker?._compactColorPicker) {
        picker._compactColorPicker.setColor(hexStr, { emit: false });
      } else {
        if (picker)   picker.value   = hexStr;
        if (hexInput) hexInput.value = hexStr;
      }
    };
    switch (matProp) {
      case 'color':             return setHex(el.basecolorPicker, el.basecolorHex, value);
      case 'metalness':         return set(el.metalnessSlider, el.metalnessInput, value);
      case 'roughness':         return set(el.roughnessSlider, el.roughnessInput, value);
      case 'specularColor':     return setHex(el.speccolorPicker, el.speccolorHex, value);
      case 'specularIntensity': return set(el.specintSlider, el.specintInput, value);
      case 'clearcoat':         return set(el.clearcoatSlider, el.clearcoatInput, value);
      case 'clearcoatRoughness':return set(el.clearcoatroughSlider, el.clearcoatroughInput, value);
      case 'opacity':           return set(el.opacitySlider, el.opacityInput, value);
      case 'transmission':      return set(el.transmissionSlider, el.transmissionInput, value);
      case 'ior':               return set(el.iorSlider, el.iorInput, value);
      case 'thickness':         return set(el.thicknessSlider, el.thicknessInput, value);
      case 'attenuationDistance': return set(el.attdistSlider, el.attdistInput, value === Infinity ? 0 : value);
      case 'attenuationColor':  return setHex(el.attcolorPicker, el.attcolorHex, value);
      case 'sheenColor':        return setHex(el.sheencolorPicker, el.sheencolorHex, value);
      case 'sheenRoughness':    return set(el.sheenroughSlider, el.sheenroughInput, value);
      case 'emissive':          return setHex(el.emissivecolorPicker, el.emissiveHex, value);
      case 'emissiveIntensity': return set(el.emissiveintSlider, el.emissiveintInput, value);
      case 'envMapIntensity':   return set(el.envintSlider, el.envintInput, value);
      case 'anisotropy':        return set(el.anisotropySlider, el.anisotropyInput, value);
      case 'anisotropyRotation':return set(el.anisotropyRotationSlider, el.anisotropyRotationInput, value);
      case 'iridescence':       return set(el.iridescenceSlider, el.iridescenceInput, value);
      case 'iridescenceIOR':    return set(el.iridescenceIorSlider, el.iridescenceIorInput, value);
      case 'iridescenceThicknessRange_min': return set(el.iridescenceThicknessMinSlider, el.iridescenceThicknessMinInput, value);
      case 'iridescenceThicknessRange_max': return set(el.iridescenceThicknessMaxSlider, el.iridescenceThicknessMaxInput, value);
      case 'iridescenceThicknessRange':
        if (Array.isArray(value)) {
          set(el.iridescenceThicknessMinSlider, el.iridescenceThicknessMinInput, value[0]);
          set(el.iridescenceThicknessMaxSlider, el.iridescenceThicknessMaxInput, value[1]);
        }
        return;
      case 'dispersion':        return set(el.dispersionSlider, el.dispersionInput, value);
      case 'reflectivity':      return set(el.reflectivitySlider, el.reflectivityInput, value);
      case 'sheen':             return set(el.sheenSlider, el.sheenInput, value);
      case 'normalScale':        return set(el.normalScaleSlider, el.normalScaleInput, value);
      case 'displacementScale':  return set(el.displacementScaleSlider, el.displacementScaleInput, value);
      case 'displacementBias':   return set(el.displacementBiasSlider, el.displacementBiasInput, value);
    }
  }

  /** Sync the material dropdown to a library id without firing onChange. */
  setMaterialPresetValue(id, label = null) {
    if (!this._matSelect) return;
    if (label) this._matSelect.setLabel(id, label);
    this._matSelect.value = id;
  }

  /** Read the library id currently selected in the material dropdown. */
  getMaterialPresetValue() {
    return this._matSelect ? this._matSelect.value : null;
  }

  /** Register a handler for when the user clicks the rename icon on a preset. */
  onMaterialRenameRequest(cb) {
    this._matSelect?.onRenameRequest(cb);
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
