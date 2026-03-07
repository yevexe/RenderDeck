// CONTROLS.JS - UI Controls Management
// Handles both original controls and new MeshPhysicalMaterial controls from Setting 3

import { log } from '../utils/logger.js';

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
      applyDesignBtn: document.getElementById('apply-design-btn'),
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

      // Base
      basecolorPicker: document.getElementById('basecolor-picker'),
      basecolorHex: document.getElementById('basecolor-hex'),
      basecolorSwatch: document.getElementById('basecolor-swatch'),
      metalnessSlider: document.getElementById('metalness-slider'),
      metalnessInput: document.getElementById('metalness-input'),
      roughnessSlider: document.getElementById('roughness-slider'),
      roughnessInput: document.getElementById('roughness-input'),

      // Specular
      specularEnable: document.getElementById('specular-enable'),
      speccolorPicker: document.getElementById('speccolor-picker'),
      speccolorHex: document.getElementById('speccolor-hex'),
      speccolorSwatch: document.getElementById('speccolor-swatch'),
      specintSlider: document.getElementById('specint-slider'),
      specintInput: document.getElementById('specint-input'),

      // Clearcoat
      clearcoatEnable: document.getElementById('clearcoat-enable'),
      clearcoatSlider: document.getElementById('clearcoat-slider'),
      clearcoatInput: document.getElementById('clearcoat-input'),
      clearcoatroughSlider: document.getElementById('clearcoatrough-slider'),
      clearcoatroughInput: document.getElementById('clearcoatrough-input'),

      // Opacity
      opacityEnable: document.getElementById('opacity-enable'),
      opacitySlider: document.getElementById('opacity-slider'),
      opacityInput: document.getElementById('opacity-input'),

      // Transmission
      transEnable: document.getElementById('trans-enable'),
      transmissionSlider: document.getElementById('transmission-slider'),
      transmissionInput: document.getElementById('transmission-input'),
      iorSlider: document.getElementById('ior-slider'),
      iorInput: document.getElementById('ior-input'),
      thicknessSlider: document.getElementById('thickness-slider'),
      thicknessInput: document.getElementById('thickness-input'),
      attenEnable: document.getElementById('atten-enable'),
      attdistSlider: document.getElementById('attdist-slider'),
      attdistInput: document.getElementById('attdist-input'),
      attcolorPicker: document.getElementById('attcolor-picker'),
      attcolorHex: document.getElementById('attcolor-hex'),
      attcolorSwatch: document.getElementById('attcolor-swatch'),

      // Sheen
      sheenEnable: document.getElementById('sheen-enable'),
      sheencolorPicker: document.getElementById('sheencolor-picker'),
      sheencolorHex: document.getElementById('sheencolor-hex'),
      sheencolorSwatch: document.getElementById('sheencolor-swatch'),
      sheenroughSlider: document.getElementById('sheenrough-slider'),
      sheenroughInput: document.getElementById('sheenrough-input'),

      // Emissive
      emissiveEnable: document.getElementById('emissive-enable'),
      emissivecolorPicker: document.getElementById('emissivecolor-picker'),
      emissiveHex: document.getElementById('emissive-hex'),
      emissiveSwatch: document.getElementById('emissive-swatch'),
      emissiveintSlider: document.getElementById('emissiveint-slider'),
      emissiveintInput: document.getElementById('emissiveint-input'),

      // Env map intensity
      envintSlider: document.getElementById('envint-slider'),
      envintInput: document.getElementById('envint-input'),

      // Old model management buttons (kept for compatibility)
      uploadModelBtn: document.getElementById('upload-model-btn'),
      modelFileInput: document.getElementById('model-file-input'),
      exportBtn: document.getElementById('export-btn'),
      importBtn: document.getElementById('import-btn'),
      fileInput: document.getElementById('file-input'),
      clearCustomBtn: document.getElementById('clear-custom-btn'),
      modelSelect: document.getElementById('model-select'),
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

    // ── Material preset ──────────────────────────────────────────
    if (el.materialSelect) {
      el.materialSelect.addEventListener('change', e => cb.onMaterialChange?.(e.target.value));
    }

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
    // MATERIAL PROPERTY COMMIT — fires onMaterialPropertyCommit after slider release
    // or color picker commit. Used for history snapshots (no live-preview impact).
    {
      const matSliders = [
        el.metalnessSlider, el.roughnessSlider, el.specintSlider,
        el.clearcoatSlider, el.clearcoatroughSlider, el.opacitySlider,
        el.transmissionSlider, el.iorSlider, el.thicknessSlider,
        el.attdistSlider, el.sheenroughSlider, el.emissiveintSlider, el.envintSlider,
      ];
      const matInputs = [
        el.metalnessInput, el.roughnessInput, el.specintInput,
        el.clearcoatroughInput, el.opacityInput, el.transmissionInput,
        el.iorInput, el.thicknessInput, el.attdistInput, el.sheenroughInput,
        el.emissiveintInput, el.envintInput,
      ];
      const matColors = [
        el.basecolorPicker, el.speccolorPicker, el.attcolorPicker,
        el.sheencolorPicker, el.emissivecolorPicker,
      ];
      const commit = () => cb.onMaterialPropertyCommit?.();
      matSliders.forEach(s => s?.addEventListener('change', commit));
      matInputs.forEach(i => i?.addEventListener('change', commit));
      matColors.forEach(c => c?.addEventListener('change', commit));
      // material preset select is already a commit point
      if (el.materialSelect) el.materialSelect.addEventListener('change', commit);
    }

    // ──────────────────────────────────────────────────────────────
    // DESIGN EDITOR (Setting 2)
    // UVEditor._setupInlineUI() directly owns image upload, canvas drag,
    // and transform sliders. Controls.js only wires open + reset.
    if (el.applyDesignBtn) {
      el.applyDesignBtn.addEventListener('click', () => cb.onApplyDesign?.());
    }
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
  // Dynamically inserts a 22×22 canvas thumbnail next to each channel's first control.
  // Click opens a file picker; right-click clears the texture.
  _setupChannelPickers() {
    // [mapKey, insertBeforeElementId]
    const CHANNELS = [
      ['map',              'basecolor-picker'],
      ['specularColorMap', 'speccolor-picker'],
      ['clearcoatMap',     'clearcoat-input'],
      ['alphaMap',         'opacity-input'],
      ['transmissionMap',  'transmission-input'],
      ['sheenColorMap',    'sheencolor-picker'],
      ['emissiveMap',      'emissivecolor-picker'],
    ];

    CHANNELS.forEach(([mapKey, refId]) => {
      const refEl = document.getElementById(refId);
      if (!refEl || !refEl.parentElement) return;

      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = '.png,.jpg,.jpeg,.webp';
      fileInput.style.display = 'none';
      document.body.appendChild(fileInput);

      const thumb = document.createElement('canvas');
      thumb.className = 'channel-tex-thumb';
      thumb.width = 22; thumb.height = 22;
      thumb.title = 'Click: upload texture  •  Right-click: clear';

      thumb.addEventListener('click', () => fileInput.click());
      thumb.addEventListener('contextmenu', e => {
        e.preventDefault();
        this.callbacks.onChannelTextureClear?.(mapKey);
      });
      fileInput.addEventListener('change', e => {
        if (e.target.files[0]) this.callbacks.onChannelTextureUpload?.(mapKey, e.target.files[0]);
        e.target.value = '';
      });

      refEl.parentElement.insertBefore(thumb, refEl);
      this.elements[`texThumb_${mapKey}`] = thumb;

      // Initial empty state
      this._drawChannelThumb(thumb, null);
    });
  }

  /** Draw a texture preview into a channel thumbnail canvas, or show empty state. */
  _drawChannelThumb(canvas, texture) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (texture?.image) {
      ctx.drawImage(texture.image, 0, 0, canvas.width, canvas.height);
      canvas.classList.add('has-texture');
    } else {
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = '#555'; ctx.lineWidth = 1;
      const m = canvas.width / 2;
      ctx.beginPath();
      ctx.moveTo(m, 4); ctx.lineTo(m, canvas.height - 4);
      ctx.moveTo(4, m); ctx.lineTo(canvas.width - 4, m);
      ctx.stroke();
      canvas.classList.remove('has-texture');
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
   * Populate the material preset dropdown (Setting 3)
   */
  updateMaterialPresetSelect(presetNames) {
    const sel = this.elements.materialSelect;
    if (!sel) return;
    const placeholder = Array.from(sel.options).find(o => o.disabled && o.selected);
    sel.innerHTML = '';
    if (placeholder) sel.appendChild(placeholder);
    presetNames.forEach(name => {
      const o = document.createElement('option');
      o.value = name; o.textContent = name;
      sel.appendChild(o);
    });
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
  syncMaterialUI(material) {
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

    // Update channel texture thumbnails
    const CHANNEL_KEYS = ['map', 'specularColorMap', 'clearcoatMap', 'alphaMap', 'transmissionMap', 'sheenColorMap', 'emissiveMap'];
    CHANNEL_KEYS.forEach(ch => {
      const thumb = el[`texThumb_${ch}`];
      if (thumb) this._drawChannelThumb(thumb, material[ch] ?? null);
    });
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