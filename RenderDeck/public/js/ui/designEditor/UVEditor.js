import { fileDataURL, loadDesignImage } from '../../utils/imageAssets.js';
import { markNeedsRender } from '../../engine/renderRequest.js';
import { applyTexQuality } from '../../engine/textureQuality.js';
// UVEDITOR.JS - Design Editor (Inline Tab 2)
// No floating modal. All UI lives inside Tab 2's existing elements.

import * as THREE from 'three';
import { ModelVerifier } from '../../domain/models/ModelVerifier.js';
import { renderPBRMap } from './stickerMaps.js';
import { buildTextImage } from './textLayers.js';

const DESIGN_CANVAS_SIZE = 2048;
// Drag-frame resolutions: 1/4 of the full-res upload for color, less for the PBR masks
const DRAG_COLOR_SIZE = 1024;
const DRAG_MASK_SIZE = 512;
// How long after the last slider change the drag textures make way for full-res ones
const DRAG_RESTORE_DELAY_MS = 300;
// Settings a canvas texture has when there is nothing to copy them from
const PLAIN_TEXTURE = new THREE.Texture();
// Material slots the design owns while a part has layers
const DESIGN_MAP_SLOTS = ['map', 'metalnessMap', 'roughnessMap', 'transmissionMap'];

export class UVEditor {
  constructor(renderer, log, modelManager, materialManager) {
    this.renderer = renderer;
    this.log = log;
    this.modelManager = modelManager;
    this.materialManager = materialManager; // used for full property extraction

    this.verifier = new ModelVerifier({
      maxFileSize: { texture: 20 * 1024 * 1024 },
      maxImageDimension: 8192
    });

    this.activeMesh = null;
    this.activeModelName = null;
    this.customModelName = null;
    this.nextImageId = 1;

    // Design state of every part except the active one (mesh → fields from
    // _capturePartFields). The active part's state lives on the editor itself.
    // A part is only stored while it has layers.
    this._partStates = new Map();
    // Layers each part had when first opened; undo falls back to them
    this._partBaselines = new Map();
    Object.assign(this, this._freshPartFields(null));

    this.currentMaterialPreset = null; // library id of the active part's material

    this._uvCheckerTexture = null;
    this._uvPreviewEnabled = false;
    this._partSelectCallback = null;
    this._wrapImages = true;
    this._uvWireframeCache = null; // offscreen canvas — rebuilt once per mesh, reused every frame

    // Resize / rotate handle state
    this._lockAspectRatio = true;
    this._dragMode = 'translate'; // 'translate' | 'resize' | 'rotate'
    this._resizeStart = null;     // { origW, origH, origDiag }
    this._rotateStart = null;     // { imgRotation, mouseAngle }

    // Temp canvas used by _renderPBRMap for overlay mask compositing
    this._pbrMaskCanvas = document.createElement('canvas');
    this._pbrMaskCtx = this._pbrMaskCanvas.getContext('2d');

    this.uvCanvas = null;
    this.uvCtx = null;
    this._checkerCache = null; 

    // Low-res drag canvases — shared by all parts. Their textures take the active
    // part's settings on every use and are swapped out as soon as the change ends.
    const dragCanvas = (size) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      return canvas;
    };
    this._dragCanvas = dragCanvas(DRAG_COLOR_SIZE);
    this._dragCtx = this._dragCanvas.getContext('2d');
    this._dragTexture = null;

    // Low-res drag PBR canvases for sticker metalness/roughness during drag
    this._dragMetalnessCanvas = dragCanvas(DRAG_MASK_SIZE);
    this._dragMetalnessCtx = this._dragMetalnessCanvas.getContext('2d');
    this._dragRoughnessCanvas = dragCanvas(DRAG_MASK_SIZE);
    this._dragRoughnessCtx = this._dragRoughnessCanvas.getContext('2d');
    this._dragMetalnessTexture = null;
    this._dragRoughnessTexture = null;
    this._dragTransmissionCanvas = dragCanvas(DRAG_MASK_SIZE);
    this._dragTransmissionCtx = this._dragTransmissionCanvas.getContext('2d');
    this._dragTransmissionTexture = null;

    // Base and channel images scaled to drag size (texture → canvas), kept for one drag
    this._dragImageCache = new Map();
    this._dragRestoreTimer = null;

    this.isDragging = false;
    this.dragOffset = { x: 0, y: 0 };
    this._rafPending = false;
    this.sceneState = null; // set by main.js whenever scene/bg changes

    // History hook — set by main.js; called with (label) after any committed change
    this.onCommit = null;
    this.onSaveCustomModel = null;
    this.onModelListChanged = null;
    this.onSelectModel = null;

    // Channel maps hook — set by main.js; returns serialized channel map data for saving
    this.getChannelMaps = null;

    // Design layer persistence hooks
    this._layersSavedHandlers = [];
    this._layersSavedTimer = null;

    // Text tool state
    this._editingTextId = null;

    // Layer drag-reorder state
    this._dragLayerId = null;

    this._setupInlineUI();
  }

  setCallbacks(callbacks) {
    Object.assign(this, callbacks);
  }

  // ─── Wire up Tab 2's existing HTML elements ───────────────────
  _setupInlineUI() {
    // Wait for DOM
    const init = () => {
      this.uvCanvas = document.getElementById('design-preview-canvas');
      if (!this.uvCanvas) return; // Tab 2 not ready yet
      this.uvCtx = this.uvCanvas.getContext('2d');

      // Initial empty render
      this._renderPreview();

      // Upload button
      const uploadInput = document.getElementById('texture-image-upload');
      if (uploadInput) {
        uploadInput.addEventListener('change', (e) => {
          if (e.target.files[0]) this.handleImageUpload(e.target.files[0]);
          e.target.value = '';
        });
      }

      // Reset / Save buttons
      const resetBtn = document.getElementById('reset-texture-btn');
      if (resetBtn) resetBtn.addEventListener('click', () => this.resetTexture());

      const saveBtn = document.getElementById('save-custom-model-btn');
      if (saveBtn) saveBtn.addEventListener('click', () => {
        // main.js registers onSaveCustomModel to handle multi-part saves.
        // Fall back to single-part saveAsCustomModel for standalone use.
        if (this.onSaveCustomModel) this.onSaveCustomModel();
        else this.saveAsCustomModel();
      });

      // Canvas drag interactions
      this.uvCanvas.addEventListener('mousedown', (e) => this._onMouseDown(e));
      this.uvCanvas.addEventListener('mousemove', (e) => this._onMouseMove(e));
      this.uvCanvas.addEventListener('mouseup', () => {
        if (this.isDragging) {
          this._restoreFullResTexture();
          this._renderComposite();
          this._updateStickerPBRIfActive();
          this.onCommit?.(`${this._dragMode === 'rotate' ? 'Rotated' : this._dragMode.startsWith('resize') ? 'Resized' : 'Moved'} overlay`);
          this._notifyLayersSaved();
        }
        this.isDragging = false; this._dragMode = 'translate';
      });
      this.uvCanvas.addEventListener('mouseleave', () => {
        if (this.isDragging) {
          this._restoreFullResTexture();
          this._renderComposite();
          this._updateStickerPBRIfActive();
          this.onCommit?.('Moved overlay');
          this._notifyLayersSaved();
        }
        this.isDragging = false; this._dragMode = 'translate';
        if (this.uvCanvas) this.uvCanvas.style.cursor = 'crosshair';
      });

      // File drag-and-drop onto canvas
      this.uvCanvas.addEventListener('dragover', (e) => {
        e.preventDefault(); e.stopPropagation();
        this.uvCanvas.classList.add('drag-over');
      });
      this.uvCanvas.addEventListener('dragleave', (e) => {
        e.preventDefault(); e.stopPropagation();
        this.uvCanvas.classList.remove('drag-over');
      });
      this.uvCanvas.addEventListener('drop', async (e) => {
        e.preventDefault(); e.stopPropagation();
        this.uvCanvas.classList.remove('drag-over');
        for (const file of e.dataTransfer.files) {
          if (/\.(png|jpe?g|svg|webp|gif|bmp)$/i.test(file.name)) await this.handleImageUpload(file);
        }
      });

      // Transformation sliders (Tab 2 IDs)
      this._linkSlider('design-posx-slider', 'design-posx-input', v => this._setSelected('posX', v), 'Position X');
      this._linkSlider('design-posy-slider', 'design-posy-input', v => this._setSelected('posY', v), 'Position Y');
      this._linkSlider('design-width-slider', 'design-width-input', v => this._setSelected('width', v), 'Width');
      this._linkSlider('design-height-slider', 'design-height-input', v => this._setSelected('height', v), 'Height');
      this._linkSlider('design-rotation-slider', 'design-rotation-input', v => this._setSelected('rotation', v), 'Rotation');

      // Part select
      const partSel = document.getElementById('design-part-select');
      if (partSel) {
        partSel.addEventListener('change', (e) => {
          if (e.target.value && this._partSelectCallback) this._partSelectCallback(e.target.value);
        });
      }

      // Canvas tools
      const flipH = document.getElementById('flip-h-btn');
      if (flipH) flipH.addEventListener('click', () => this._flipSelected('h'));
      const flipV = document.getElementById('flip-v-btn');
      if (flipV) flipV.addEventListener('click', () => this._flipSelected('v'));
      const checkUV = document.getElementById('check-uv-btn');
      if (checkUV) checkUV.addEventListener('click', () => this._toggleCheckUV());
      const previewUV = document.getElementById('preview-uv-btn');
      if (previewUV) previewUV.addEventListener('click', () => this._togglePreviewUV());
      const wrapBtn = document.getElementById('wrap-uv-btn');
      if (wrapBtn) {
        wrapBtn.addEventListener('click', () => this._toggleWrap());
        wrapBtn.classList.toggle('button-selected', this._wrapImages);
      }

      const lockAspect = document.getElementById('lock-aspect-ratio');
      if (lockAspect) {
        this._lockAspectRatio = lockAspect.checked;
        lockAspect.addEventListener('change', e => {
          this._lockAspectRatio = e.target.checked;
          this.onPrefsChanged?.();
        });
      }

      // Text tool
      const addTextBtn = document.getElementById('add-text-btn');
      if (addTextBtn) addTextBtn.addEventListener('click', () => this._openTextPanel(null));

      const textCreateBtn = document.getElementById('text-tool-create-btn');
      if (textCreateBtn) textCreateBtn.addEventListener('click', () => this._onTextCreate());

      const textCancelBtn = document.getElementById('text-tool-cancel-btn');
      if (textCancelBtn) textCancelBtn.addEventListener('click', () => this._closeTextPanel());

      // Sync text size slider ↔ input
      const textSizeSlider = document.getElementById('text-tool-size-slider');
      const textSizeInput  = document.getElementById('text-tool-size-input');
      if (textSizeSlider && textSizeInput) {
        textSizeSlider.addEventListener('input', () => { textSizeInput.value = textSizeSlider.value; });
        textSizeInput.addEventListener('input', () => {
          const v = parseInt(textSizeInput.value);
          if (!isNaN(v)) textSizeSlider.value = v;
        });
      }
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }

  // ─── Slider ↔ number input sync ──────────────────────────────
  _linkSlider(sliderId, inputId, callback, historyLabel = 'Transform change') {
    const slider = document.getElementById(sliderId);
    const input = document.getElementById(inputId);
    if (!slider || !input) return;
    slider.addEventListener('input', () => {
      input.value = slider.value;
      callback(parseFloat(slider.value));
    });
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      if (!isNaN(v)) { slider.value = v; callback(v); }
    });
    // Commit to history and persist when user releases the slider or commits the number input
    slider.addEventListener('change', () => { this.onCommit?.(historyLabel); this._notifyLayersSaved(); });
    input.addEventListener('change', () => { this.onCommit?.(historyLabel); this._notifyLayersSaved(); });
  }

  // ─── Apply transformation to selected image ───────────────────
  _setSelected(prop, value) {
    const img = this.overlayImages.find(i => i.id === this.selectedImageId);
    if (!img) return;
    // Tab 2 sliders: -1..1 for position, 0.01-2 for size, 0-360 for rotation
    // UVEditor internally uses 0-100% space
    const _setSlider = (sliderId, inputId, val) => {
      const s = document.getElementById(sliderId); const i = document.getElementById(inputId);
      if (s) s.value = val; if (i) i.value = val;
    };
    switch (prop) {
      case 'posX': img.position.x = (value + 1) / 2 * 100; break;
      case 'posY': img.position.y = (value + 1) / 2 * 100; break;
      case 'width':
        img.size.w = value * 50;
        if (this._lockAspectRatio && img.aspectRatio && img.type !== 'text') {
          img.size.h = img.size.w / img.aspectRatio;
          _setSlider('design-height-slider', 'design-height-input', (img.size.h / 50).toFixed(2));
        }
        break;
      case 'height':
        img.size.h = value * 50;
        if (this._lockAspectRatio && img.aspectRatio && img.type !== 'text') {
          img.size.w = img.size.h * img.aspectRatio;
          _setSlider('design-width-slider', 'design-width-input', (img.size.w / 50).toFixed(2));
        }
        break;
      case 'rotation': img.rotation = value; break;
    }
    this._renderPreview();
    this._renderComposite();
    this._updateStickerPBRIfActive();
  }

  // ─── Sync Tab 2 sliders from selected image data ─────────────
  _syncSlidersFromImage(img) {
    const set = (sliderId, inputId, val) => {
      const s = document.getElementById(sliderId);
      const i = document.getElementById(inputId);
      if (s) s.value = val;
      if (i) i.value = val;
    };
    set('design-posx-slider', 'design-posx-input', ((img.position.x / 100) * 2 - 1).toFixed(2));
    set('design-posy-slider', 'design-posy-input', ((img.position.y / 100) * 2 - 1).toFixed(2));
    set('design-width-slider', 'design-width-input', (img.size.w / 50).toFixed(2));
    set('design-height-slider', 'design-height-input', (img.size.h / 50).toFixed(2));
    set('design-rotation-slider', 'design-rotation-input', img.rotation);
  }

  // ─── Open editor for a mesh (called when model loads) ─────────
  // This sets up the editor for a model - NO prompting for names here
  // preloadedOverlays: already-decoded overlay image array, or null to load from IDB.
  // Pass this when switching parts so we use cached data instead of re-reading IDB.
  async open(mesh, originalModelName, currentMaterialPreset = null, preloadedOverlays = null) {
    // If already editing this mesh (same part), skip reset.
    // customModelName check prevents tearing down sticker state on part switches.
    if (this.activeMesh === mesh &&
        (this.activeModelName === originalModelName || this.customModelName === originalModelName)) {
      return;
    }

    const wasCheckUVActive = this._switchToPart(mesh);
    this.currentMaterialPreset = currentMaterialPreset;

    if (this.liveCanvasTexture) {
      // Returning to a part with a design: its stored layers and composite are current
    } else if (preloadedOverlays !== null) {
      // Part switch with cached overlays — skip IDB entirely
      this.overlayImages = preloadedOverlays;
      // activeModelName / customModelName already set from initial load
    } else {
      const existingCustom = await this.modelManager.getModel(originalModelName);
      if (this.activeMesh !== mesh) return; // another part was opened meanwhile
      const isCustom = existingCustom?.type === 'custom';

      if (isCustom) {
        this.activeModelName = existingCustom.basedOn;
        this.customModelName = originalModelName;
        this.currentMaterialPreset = currentMaterialPreset;
        // v2 compat: flat overlayImages; v3: overlays come per-part via preloadedOverlays
        const savedOverlays = existingCustom._v2compat ? (existingCustom.overlayImages || []) : [];
        const decoded = [];
        if (savedOverlays.length > 0) {
          await Promise.all(savedOverlays.map(saved => new Promise(res => {
            const img = new Image();
            img.onload = () => {
              decoded.push({
                id:          decoded.length + 1,
                image:       img,
                name:        saved.name,
                type:        saved.type     || 'image',
                textData:    saved.textData ? { ...saved.textData } : null,
                position:    { ...saved.position },
                size:        { ...saved.size },
                rotation:    saved.rotation,
                aspectRatio: saved.aspectRatio,
                flipH:       saved.flipH    ?? false,
                flipV:       saved.flipV    ?? false,
              });
              res();
            };
            img.onerror = res;
            img.src = saved.imageData;
          })));
          if (this.activeMesh !== mesh) return;
        }
        this.overlayImages = decoded;
      } else {
        this.activeModelName = originalModelName;
        this.customModelName = null;
        this.overlayImages = [];
      }
    }

    this.log(`Design Editor: ${this.customModelName || this.activeModelName}`);
    this._finishPartSwitch(mesh, wasCheckUVActive);
  }

  // ─── Open with already-decoded overlay images (skips DB read + image decode) ─
  openWithPreloadedData(mesh, originalModelName, modelData, preloadedImages, currentMaterialPreset = null) {
    if (this.activeMesh === mesh && this.activeModelName === (modelData.basedOn || originalModelName)) return;

    const wasCheckUVActive = this._switchToPart(mesh);
    this.activeModelName = modelData.basedOn || originalModelName;
    this.customModelName = originalModelName;
    this.currentMaterialPreset = currentMaterialPreset;
    if (!this.liveCanvasTexture) this.overlayImages = preloadedImages;

    this.log(`Design Editor active for: ${originalModelName}`);
    this._finishPartSwitch(mesh, wasCheckUVActive);
  }

  // ─── Per-part design state ────────────────────────────────────
  // Everything here belongs to one part. A part that hasn't been stored starts
  // from its material; its current map can't be a composite because only stored
  // parts have one.
  _freshPartFields(mesh) {
    const material = mesh?.material;
    return {
      overlayImages: [],
      selectedImageId: null,
      baseTexture: this._cleanMapOf(material),
      liveCanvasTexture: null,
      // Stored material base color (captured at open/apply time for composite background)
      _materialBaseColor: mesh ? (material?.color ? '#' + material.color.getHexString() : '#ffffff') : null,
      // Original PBR values to restore on reset
      _origMetalness: null,
      _origRoughness: null,
      _origTransmission: null,
      _origColor: null,
      _origMetalnessMap: undefined, // THREE.Texture | null (undefined = not captured yet)
      _origRoughnessMap: undefined,
      _origTransmissionMap: undefined,
      _liveMetalnessTexture: null,
      _liveRoughnessTexture: null,
      _liveTransmissionTexture: null,
      // Composite and sticker PBR canvases — allocated once the part has layers
      textureCanvas: null,
      textureCtx: null,
      _metalnessCanvas: null,
      _metalnessCtx: null,
      _roughnessCanvas: null,
      _roughnessCtx: null,
      _transmissionCanvas: null,
      _transmissionCtx: null,
      _uvCheckActive: false,
      _savedMaterialMap: null,
    };
  }

  _capturePartFields() {
    return Object.fromEntries(Object.keys(this._freshPartFields(null)).map(key => [key, this[key]]));
  }

  // The material's map without any design in it. Base textures must only come from here.
  _cleanMapOf(material) {
    const map = this._uvCheckActive && material === this.activeMesh?.material
      ? this._savedMaterialMap
      : material?.map;
    return map && !map.userData?.isDesignComposite ? map : null;
  }

  _nextLayerId(layers) {
    return layers.reduce((max, layer) => Math.max(max, layer.id), 0) + 1;
  }

  _ensureCanvas(canvasKey, ctxKey) {
    if (this[canvasKey]) return;
    this[canvasKey] = document.createElement('canvas');
    this[canvasKey].width = DESIGN_CANVAS_SIZE;
    this[canvasKey].height = DESIGN_CANVAS_SIZE;
    this[ctxKey] = this[canvasKey].getContext('2d');
  }

  _ensureDesignCanvases() {
    this._ensureCanvas('textureCanvas', 'textureCtx');
    this._ensureCanvas('_metalnessCanvas', '_metalnessCtx');
    this._ensureCanvas('_roughnessCanvas', '_roughnessCtx');
  }

  _freeDesignCanvases() {
    for (const key of ['textureCanvas', '_metalnessCanvas', '_roughnessCanvas', '_transmissionCanvas']) {
      if (this[key]) this[key].width = this[key].height = 0; // releases the backing store
      this[key] = null;
    }
    this.textureCtx = this._metalnessCtx = this._roughnessCtx = this._transmissionCtx = null;
  }

  // Store the active part's design under its mesh, or forget it if it has none left.
  _stashActivePart() {
    const mesh = this.activeMesh;
    if (!mesh) return;
    if (!this.overlayImages.length && this.liveCanvasTexture) this._clearActiveDesign();
    if (this.overlayImages.length && this.liveCanvasTexture) {
      this._partStates.set(mesh, this._capturePartFields());
    } else {
      this._partStates.delete(mesh);
    }
  }

  // Leave the active part exactly as it looks and load the next part's state.
  // Returns whether Check UV should be turned back on afterwards.
  _switchToPart(mesh) {
    const wasCheckUVActive = this._uvCheckActive;
    this._deactivateCheckUV();
    this._uvPreviewEnabled = false;
    this._uvWireframeCache = null;
    this.isDragging = false;
    this._dragMode = 'translate';
    const leaving = this.activeMesh?.material;
    if (leaving && this.liveCanvasTexture && (leaving.map === this._dragTexture || leaving.metalnessMap === this._dragMetalnessTexture)) {
      // The low-res drag canvases are shared, so they can't stay on a part we're leaving
      this.commitMaterialChange();
    }
    clearTimeout(this._dragRestoreTimer);
    this._clearDragImageCache();
    this._stashActivePart();
    const pvBtn = document.getElementById('preview-uv-btn');
    if (pvBtn) pvBtn.classList.remove('button-selected');
    this.activeMesh = mesh;
    Object.assign(this, this._partStates.get(mesh) ?? this._freshPartFields(mesh));
    this._partStates.delete(mesh);
    return wasCheckUVActive;
  }

  _finishPartSwitch(mesh, wasCheckUVActive) {
    this.nextImageId = this._nextLayerId(this.overlayImages);
    if (!this._partBaselines.has(mesh)) this._partBaselines.set(mesh, this._copyLayers(this.overlayImages));

    this._updateLayersList();
    const selected = this.overlayImages.find(i => i.id === this.selectedImageId);
    if (selected) this._syncSlidersFromImage(selected);
    this._renderPreview();

    if (this.overlayImages.length > 0 && !this.liveCanvasTexture) this.applyTextureToModel();

    if (wasCheckUVActive) this._toggleCheckUV();
  }

  // Run fn with a stored part loaded as if it were active, then put everything back.
  // The render and sticker code can then serve inactive parts unchanged. fn must be
  // synchronous and must not touch the preview canvas or layer list.
  _withPartState(mesh, fn) {
    const activeMesh = this.activeMesh;
    const activeFields = this._capturePartFields();
    Object.assign(this, this._partStates.get(mesh) ?? this._freshPartFields(mesh));
    this.activeMesh = mesh;
    try {
      return fn();
    } finally {
      this._stashActivePart();
      this.activeMesh = activeMesh;
      Object.assign(this, activeFields);
    }
  }

  _forEachStoredPart(fn) {
    for (const mesh of [...this._partStates.keys()]) this._withPartState(mesh, fn);
  }

  // Show a saved design on a part that isn't active, without opening it.
  restorePartDesign(mesh, layers) {
    if (!layers.length || mesh === this.activeMesh || this._partStates.has(mesh)) return false;
    this._partBaselines.set(mesh, this._copyLayers(layers));
    this._withPartState(mesh, () => {
      this.overlayImages = layers;
      this.applyTextureToModel();
    });
    return true;
  }

  // Bring the material in line with the current layer list.
  _syncDesignToLayers() {
    if (!this.overlayImages.length) { this._clearActiveDesign(); return; }
    if (!this.liveCanvasTexture) { this.applyTextureToModel(); return; }
    this._renderComposite();
    this._updateStickerPBRIfActive();
  }

  // Give the active part its clean material back and free everything its design held.
  _clearActiveDesign() {
    const material = this.activeMesh?.material;
    this._removeStickerPBRMaps();
    if (this.liveCanvasTexture) {
      if (material) {
        if (this._uvCheckActive) this._savedMaterialMap = this.baseTexture;
        else material.map = this.baseTexture;
        material.needsUpdate = true;
      }
      this.liveCanvasTexture.dispose();
      this.liveCanvasTexture = null;
    }
    this._freeDesignCanvases();
    markNeedsRender(4);
  }

  // Called by main.js when the model is unloaded, before its materials are disposed.
  clearAllPartDesigns() {
    this._deactivateCheckUV();
    this.isDragging = false;
    clearTimeout(this._dragRestoreTimer);
    this._clearDragImageCache();
    this._clearActiveDesign();
    for (const [mesh, record] of this._partStates) {
      Object.assign(this, record);
      this.activeMesh = mesh;
      this._clearActiveDesign();
    }
    this._partStates.clear();
    this._partBaselines.clear();
    this.activeMesh = null;
    this._uvWireframeCache = null;
    Object.assign(this, this._freshPartFields(null));
  }

  hasPartDesign(mesh) {
    return mesh === this.activeMesh ? !!this.liveCanvasTexture : this._partStates.has(mesh);
  }

  getPartBaseTexture(mesh) {
    return (mesh === this.activeMesh ? this : this._partStates.get(mesh))?.baseTexture ?? null;
  }

  // Run fn while a part's material shows its real values instead of the sticker overrides.
  withOriginalMaterialValues(mesh, fn) {
    const material = mesh?.material;
    const state = mesh === this.activeMesh ? this : this._partStates.get(mesh);
    if (!material || state?._origMetalness === null || state?._origMetalness === undefined) return fn();
    material.metalness = state._origMetalness;
    material.roughness = state._origRoughness;
    if (state._origTransmission !== null) material.transmission = state._origTransmission;
    if (state._origColor && material.color) material.color.set(state._origColor);
    try {
      return fn();
    } finally {
      material.metalness = 1.0;
      material.roughness = 1.0;
      if (state._liveTransmissionTexture) material.transmission = 1.0;
      if (material.color) material.color.set(0xffffff);
    }
  }

  // Change a material property on any part, including an inactive one with a design:
  // updates the stored original value and re-composites so it shows without opening
  // the part. Doesn't save anything — the caller persists the change.
  updatePartMaterial(mesh, property, value) {
    const material = mesh?.material;
    if (!material) return false;
    if (DESIGN_MAP_SLOTS.includes(property)) {
      this.log(`updatePartMaterial can't set "${property}"; use notifyPartChannelChanged`, true);
      return false;
    }
    const apply = () => this._applyMaterialValue(material, property, value);
    if (mesh === this.activeMesh) {
      apply();
      this._renderPreview();
    } else if (this._partStates.has(mesh)) {
      this._withPartState(mesh, apply);
    } else {
      this._setMaterialValue(material, property, value);
    }
    material.needsUpdate = true;
    markNeedsRender(4);
    return true;
  }

  _setMaterialValue(material, property, value) {
    if (material[property]?.isColor) material[property].set(value);
    else if (property === 'normalScale') material.normalScale?.set(value, value);
    else material[property] = value;
    if (property === 'opacity') material.transparent = value < 1.0;
    if (property === 'transmission') material.transparent = value > 0;
  }

  _applyMaterialValue(material, property, value) {
    if (this._origMetalness === null) {
      if (property === 'color') this._materialBaseColor = value;
      this._setMaterialValue(material, property, value);
    } else if (property === 'color') {
      this._origColor = value;
      this._materialBaseColor = value;
      this._renderComposite();
    } else if (property === 'metalness') {
      this._origMetalness = value;
      this._updateStickerPBRIfActive();
    } else if (property === 'roughness') {
      this._origRoughness = value;
      this._updateStickerPBRIfActive();
    } else if (property === 'transmission') {
      this._origTransmission = value;
      material.transparent = value > 0;
      if (this._liveTransmissionTexture) this._updateStickerPBRIfActive();
      else if (value > 0) this._applyStickerPBRMaps(material);
    } else {
      this._setMaterialValue(material, property, value);
    }
  }

  // ─── Keep old show() as alias for backward compat ────────────
  show(mesh, modelName, preset) {
    return this.open(mesh, modelName, preset);
  }

  // ─── Image upload ─────────────────────────────────────────────
  async handleImageUpload(file) {
    if (!file) return;
    try {
      const validation = await this.verifier.validateTextureFile(file);
      if (!validation.valid) throw new Error(validation.errors.join('\n'));
      const originalDataURL = await fileDataURL(file);
      const image = await loadDesignImage(originalDataURL);
      const aspectRatio = image.naturalWidth / image.naturalHeight;
      const layer = {
        id: this.nextImageId++, image, name: file.name, type: 'image',
        position: { x: 50, y: 50 }, size: { w: 30, h: 30 / aspectRatio },
        rotation: 0, aspectRatio, flipH: false, flipV: false,
        _originalDataURL: originalDataURL,
      };
      const mesh = this.activeMesh;
      if (!mesh) throw new Error('Select a model part before uploading a design.');
      await this.commitImageLayer?.([...this.overlayImages, layer]);
      if (mesh !== this.activeMesh) return;
      this.overlayImages.push(layer);
      this._notifyLayersSaved();
      this._updateLayersList();
      this._renderPreview();
      this.applyTextureToModel();
      this.selectImage(layer.id);
      this.log(`Image saved: ${file.name}`);
    } catch (err) { this.log(`Could not add design: ${err.message}`, true); }
  }

  // ─── Select an overlay image ──────────────────────────────────
  selectImage(id) {
    this.selectedImageId = id;
    const img = this.overlayImages.find(i => i.id === id);
    if (img) this._syncSlidersFromImage(img);
    this._updateLayersList();
    this._renderPreview();
  }

  // ─── Delete selected ──────────────────────────────────────────
  deleteSelectedImage() {
    if (!this.selectedImageId) return;
    this.overlayImages = this.overlayImages.filter(i => i.id !== this.selectedImageId);
    this.selectedImageId = null;
    this._notifyLayersSaved();
    this._updateLayersList();
    this._renderPreview();
    this._syncDesignToLayers();

    this.onCommit?.('Deleted overlay');
    this.log('Image deleted');
  }

  // ─── Update the layer list in Tab 2 ──────────────────────────
  _updateLayersList() {
    const list = document.getElementById('image-layers-list');
    if (!list) return;
    list.innerHTML = '';
    if (this.overlayImages.length === 0) {
      list.innerHTML = '<p class="empty-message">No images added yet</p>';
      return;
    }
    this.overlayImages.forEach((img, i) => {
      const item = document.createElement('div');
      item.className = 'image-layer-item' + (img.id === this.selectedImageId ? ' selected' : '');
      item.draggable = true;

      // ── Drag-to-reorder ──────────────────────────────────────
      item.addEventListener('dragstart', (e) => {
        this._dragLayerId = img.id;
        e.dataTransfer.effectAllowed = 'move';
        setTimeout(() => { item.style.opacity = '0.4'; }, 0);
      });
      item.addEventListener('dragend', () => {
        item.style.opacity = '';
        item.style.borderTop = '';
        item.style.borderBottom = '';
        this._dragLayerId = null;
      });
      item.addEventListener('dragover', (e) => {
        if (this._dragLayerId === null || this._dragLayerId === img.id) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const before = e.clientY < item.getBoundingClientRect().top + item.getBoundingClientRect().height / 2;
        item.style.borderTop    = before ? '2px solid #4CAF50' : '';
        item.style.borderBottom = before ? '' : '2px solid #4CAF50';
      });
      item.addEventListener('dragleave', () => {
        item.style.borderTop = '';
        item.style.borderBottom = '';
      });
      item.addEventListener('drop', (e) => {
        e.preventDefault();
        item.style.borderTop = '';
        item.style.borderBottom = '';
        if (this._dragLayerId === null || this._dragLayerId === img.id) return;

        const fromIdx = this.overlayImages.findIndex(x => x.id === this._dragLayerId);
        const toIdx   = this.overlayImages.findIndex(x => x.id === img.id);
        if (fromIdx === -1 || toIdx === -1) return;

        const before = e.clientY < item.getBoundingClientRect().top + item.getBoundingClientRect().height / 2;
        const [moved] = this.overlayImages.splice(fromIdx, 1);
        const insertAt = this.overlayImages.findIndex(x => x.id === img.id);
        this.overlayImages.splice(before ? insertAt : insertAt + 1, 0, moved);

        this._dragLayerId = null;
        this._notifyLayersSaved();
        this._updateLayersList();
        this._renderPreview();
        this._renderComposite();
        this.onCommit?.('Reordered layers');
      });

      // Thumbnail — white bg for text layers so transparent pixels are visible
      const thumb = document.createElement('canvas');
      thumb.width = 30; thumb.height = 30;
      thumb.style.cssText = 'width:30px;height:30px;border:1px solid #555;border-radius:2px;margin-right:8px;flex-shrink:0;';
      thumb.draggable = false;
      const tCtx = thumb.getContext('2d');
      if (img.type === 'text') {
        tCtx.fillStyle = '#ffffff';
        tCtx.fillRect(0, 0, 30, 30);
      }
      tCtx.drawImage(img.image, 0, 0, 30, 30);

      const name = document.createElement('span');
      name.className = 'image-layer-name';
      name.textContent = `${i + 1}. ${img.type === 'text' ? 'T ' : ''}${img.name}`;

      const del = document.createElement('button');
      del.textContent = '✕';
      del.className = 'button-medium';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectedImageId = img.id;
        this.deleteSelectedImage();
      });

      item.appendChild(thumb);
      item.appendChild(name);

      if (img.type === 'text') {
        const editBtn = document.createElement('button');
        editBtn.textContent = '✎';
        editBtn.className = 'button-medium';
        editBtn.title = 'Edit text';
        editBtn.style.marginLeft = 'auto';
        editBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.selectImage(img.id);
          this._openTextPanel(img);
        });
        item.appendChild(editBtn);
      } else {
        del.style.marginLeft = 'auto';
      }

      item.appendChild(del);
      item.addEventListener('click', () => this.selectImage(img.id));
      list.appendChild(item);
    });
  }

  // ─── UV Preview render ────────────────────────────────────────
  _buildCheckerCache(w, h) {
    const sq = 32;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const cx = c.getContext('2d');
    for (let row = 0; row < h / sq; row++) {
      for (let col = 0; col < w / sq; col++) {
        cx.fillStyle = (row + col) % 2 === 0 ? '#2a2a2a' : '#333';
        cx.fillRect(col * sq, row * sq, sq, sq);
      }
    }
    return c;
  }

  _renderPreview() {
    if (!this.uvCanvas || !this.uvCtx) return;
    const ctx = this.uvCtx;
    const { width: w, height: h } = this.uvCanvas;

    ctx.clearRect(0, 0, w, h);

    // Checkerboard background — built once and reused
    if (!this._checkerCache || this._checkerCache.width !== w || this._checkerCache.height !== h) {
      this._checkerCache = this._buildCheckerCache(w, h);
    }
    ctx.drawImage(this._checkerCache, 0, 0);

    // Material color ghost — shows the material's base color as faded context
    if (this._materialBaseColor && this._materialBaseColor !== '#ffffff') {
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = this._materialBaseColor;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }

    // Base texture ghost — shows the material's texture map if it has one
    if (this.baseTexture?.image) {
      ctx.globalAlpha = 0.25;
      ctx.drawImage(this.baseTexture.image, 0, 0, w, h);
      ctx.globalAlpha = 1;
    }

    // Grid
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 10; i++) {
      const p = (i / 10);
      ctx.beginPath(); ctx.moveTo(p * w, 0); ctx.lineTo(p * w, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, p * h); ctx.lineTo(w, p * h); ctx.stroke();
    }

    // UV wireframe — drawn before decals so decals render on top
    if (this._uvPreviewEnabled) this._drawUVWireframe(ctx, w, h);

    // Overlays
    const wrapOffsets = this._wrapImages
      ? [[-w,-h],[-w,0],[-w,h],[0,-h],[0,0],[0,h],[w,-h],[w,0],[w,h]]
      : [[0, 0]];

    // Draw bottom-up: last array entry first, so layer 1 (index 0) renders on top.
    [...this.overlayImages].reverse().forEach(img => {
      const x = (img.position.x / 100) * w;
      const y = (img.position.y / 100) * h;
      const iw = (img.size.w / 100) * w;
      const ih = (img.size.h / 100) * h;

      wrapOffsets.forEach(([dx, dy]) => {
        ctx.save();
        ctx.translate(x + dx, y + dy);
        ctx.rotate((img.rotation * Math.PI) / 180);
        if (img.flipH) ctx.scale(-1, 1);
        if (img.flipV) ctx.scale(1, -1);
        ctx.drawImage(img.image, -iw / 2, -ih / 2, iw, ih);

        // Selection indicator only on the primary (non-offset) copy
        if (dx === 0 && dy === 0 && img.id === this.selectedImageId) {
          ctx.strokeStyle = '#4CAF50';
          ctx.lineWidth = 2;
          ctx.strokeRect(-iw / 2, -ih / 2, iw, ih);
          // Corner resize handles
          ctx.fillStyle = '#4CAF50';
          const hs = 7;
          // Corner handles
          [[-iw/2, -ih/2], [iw/2, -ih/2], [-iw/2, ih/2], [iw/2, ih/2]].forEach(([cx, cy]) => {
            ctx.fillRect(cx - hs / 2, cy - hs / 2, hs, hs);
          });
          // Edge midpoint handles
          [[0, -ih/2], [0, ih/2], [-iw/2, 0], [iw/2, 0]].forEach(([ex, ey]) => {
            ctx.fillRect(ex - hs / 2, ey - hs / 2, hs, hs);
          });
          // Rotate handle: circle above top-center connected by a line
          const rotY = -ih / 2 - 16;
          ctx.strokeStyle = '#4CAF50'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(0, -ih / 2); ctx.lineTo(0, rotY + 5); ctx.stroke();
          ctx.beginPath(); ctx.arc(0, rotY, 5, 0, Math.PI * 2);
          ctx.fillStyle = '#4CAF50'; ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1; ctx.stroke();
        }
        ctx.restore();
      });
    });

  }

  // ─── Composite render (shared logic) ─────────────────────────
  _renderCompositeToCanvas(ctx, w, h, useWrap, quality = 'high') {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = quality;
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = this._materialBaseColor || '#ffffff';
    ctx.fillRect(0, 0, w, h);

    if (this.baseTexture?.image && this.baseTexture !== this.liveCanvasTexture) {
      this._drawTextureImage(ctx, this.baseTexture, w, h);
      // When sticker PBR is active, material.color is forced to white so decals
      // aren't tinted by Three.js. Bake the original color tint into the composite
      // via multiply blend so it's preserved (matches Three.js color * map behavior).
      if (this._origColor !== null && this._materialBaseColor && this._materialBaseColor !== '#ffffff') {
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = this._materialBaseColor;
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'source-over';
      }
    }

    const wrapOffsets = (useWrap && this._wrapImages)
      ? [[-w,-h],[-w,0],[-w,h],[0,-h],[0,0],[0,h],[w,-h],[w,0],[w,h]]
      : [[0, 0]];

    // Draw bottom-up: last array entry first, so layer 1 (index 0) renders on top.
    [...this.overlayImages].reverse().forEach(img => {
      const x = (img.position.x / 100) * w;
      const y = (img.position.y / 100) * h;
      const iw = (img.size.w / 100) * w;
      const ih = (img.size.h / 100) * h;
      wrapOffsets.forEach(([dx, dy]) => {
        ctx.save();
        ctx.translate(x + dx, y + dy);
        ctx.rotate((img.rotation * Math.PI) / 180);
        if (img.flipH) ctx.scale(-1, 1);
        if (img.flipV) ctx.scale(1, -1);
        ctx.drawImage(img.image, -iw / 2, -ih / 2, iw, ih);
        ctx.restore();
      });
    });
  }

  // ─── Design texture settings ──────────────────────────────────
  // Every texture of a design — composite, PBR masks and their drag versions — goes
  // through here, so they all sample the part's UVs the same way. colorSpace is only
  // passed for textures that aren't color (the masks).
  _applyDesignTextureSettings(texture, source, colorSpace = null) {
    const from = source ?? PLAIN_TEXTURE;
    texture.flipY = from.flipY;
    texture.wrapS = from.wrapS;
    texture.wrapT = from.wrapT;
    texture.magFilter = from.magFilter;
    texture.minFilter = from.minFilter;
    texture.anisotropy = from.anisotropy;
    texture.colorSpace = colorSpace ?? (from.colorSpace || THREE.SRGBColorSpace);
    // Always apply renderer-aware quality settings (anisotropy, mipmap filtering)
    // regardless of the source. Keeps the texture sharp at angles.
    applyTexQuality(texture);
    texture.needsUpdate = true;
  }

  _makeStickerTexture(canvas) {
    const texture = new THREE.CanvasTexture(canvas);
    this._applyDesignTextureSettings(texture, this.liveCanvasTexture, THREE.LinearSRGBColorSpace);
    return texture;
  }

  // Create a shared drag texture if needed and give it the active part's settings.
  _refreshDragTexture(key, canvas, colorSpace = null) {
    if (!this[key]) this[key] = new THREE.CanvasTexture(canvas);
    this._applyDesignTextureSettings(this[key], this.liveCanvasTexture, colorSpace);
    return this[key];
  }

  // The flipY the design's canvases are displayed with.
  _designFlipY() {
    return (this.liveCanvasTexture ?? this.baseTexture ?? PLAIN_TEXTURE).flipY;
  }

  // Draw a material texture into a design canvas. A texture with a different flipY
  // (an upload on a GLB part) is mirrored so it looks the same as it does without a design.
  _drawTextureImage(ctx, texture, w, h) {
    const image = w < DESIGN_CANVAS_SIZE ? this._dragImageOf(texture, w) : texture.image;
    const mirror = texture.flipY !== this._designFlipY();
    if (mirror) {
      ctx.save();
      ctx.translate(0, h);
      ctx.scale(1, -1);
    }
    ctx.drawImage(image, 0, 0, w, h);
    if (mirror) ctx.restore();
  }

  // Scaling a 4K image down on every drag frame is what stutters, so do it once.
  _dragImageOf(texture, size) {
    let canvas = this._dragImageCache.get(texture);
    if (canvas?.width !== size) {
      canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(texture.image, 0, 0, size, size);
      this._dragImageCache.set(texture, canvas);
    }
    return canvas;
  }

  _clearDragImageCache() {
    this._dragImageCache.clear();
  }

  // Sliders end with a commit, but the node editor and color fields may never send one.
  _scheduleDragRestore() {
    clearTimeout(this._dragRestoreTimer);
    this._dragRestoreTimer = setTimeout(() => {
      if (!this.isDragging) this.commitMaterialChange();
    }, DRAG_RESTORE_DELAY_MS);
  }

  // ─── High-res composite render ────────────────────────────────
  _renderComposite() {
    if (!this.textureCtx) return; // no layers on this part
    this._renderCompositeToCanvas(this.textureCtx, DESIGN_CANVAS_SIZE, DESIGN_CANVAS_SIZE, true);

    if (this.liveCanvasTexture) {
      this.liveCanvasTexture.needsUpdate = true;
      markNeedsRender(4);
    }
  }

  
  // Renders to a smaller canvas during drag — much less GPU upload per frame.
  // Full-res texture is restored on mouseup/mouseleave.
  _renderCompositeDrag() {
    this._renderCompositeToCanvas(this._dragCtx, DRAG_COLOR_SIZE, DRAG_COLOR_SIZE, true, 'medium');

    this._refreshDragTexture('_dragTexture', this._dragCanvas);
    this._dragTexture.userData.isDesignComposite = true;

    if (!this._uvCheckActive && this.activeMesh?.material && this.activeMesh.material.map !== this._dragTexture) {
      this.activeMesh.material.map = this._dragTexture;
      this.activeMesh.material.needsUpdate = true;
    }

    
    if (this._liveMetalnessTexture || this._liveRoughnessTexture || this._liveTransmissionTexture) {
      this._renderStickerPBRMapsDrag();
    }

    markNeedsRender(4);
  }

  // ─── Low-res sticker PBR maps during drag ───────────────────
  _renderStickerPBRMapsDrag() {
    const m = this.activeMesh?.material;
    if (!m) return;

    const metalness = this._origMetalness ?? m.metalness ?? 0;
    const roughness = this._origRoughness ?? m.roughness ?? 0.5;

    this._renderPBRMap(this._dragMetalnessCtx, DRAG_MASK_SIZE, DRAG_MASK_SIZE, metalness * 255, 0, this._origMetalnessMap, metalness);
    this._renderPBRMap(this._dragRoughnessCtx, DRAG_MASK_SIZE, DRAG_MASK_SIZE, roughness * 255, 0.5 * 255, this._origRoughnessMap, roughness);

    this._refreshDragTexture('_dragMetalnessTexture', this._dragMetalnessCanvas, THREE.LinearSRGBColorSpace);
    this._refreshDragTexture('_dragRoughnessTexture', this._dragRoughnessCanvas, THREE.LinearSRGBColorSpace);

    if (m.metalnessMap !== this._dragMetalnessTexture) {
      m.metalnessMap = this._dragMetalnessTexture;
      m.roughnessMap = this._dragRoughnessTexture;
      m.needsUpdate = true;
    }

    // Transmission drag map
    const transmission = this._origTransmission ?? m.transmission ?? 0;
    if (this._liveTransmissionTexture) {
      this._renderPBRMap(this._dragTransmissionCtx, DRAG_MASK_SIZE, DRAG_MASK_SIZE, transmission * 255, 0, this._origTransmissionMap, transmission);
      this._refreshDragTexture('_dragTransmissionTexture', this._dragTransmissionCanvas, THREE.LinearSRGBColorSpace);
      if (m.transmissionMap !== this._dragTransmissionTexture) {
        m.transmissionMap = this._dragTransmissionTexture;
        m.needsUpdate = true;
      }
    }
  }

  // ─── Restore full-res texture after drag ─────────────────────
  _restoreFullResTexture() {
    clearTimeout(this._dragRestoreTimer);
    this._clearDragImageCache();
    if (this.activeMesh?.material) {
      if (this.liveCanvasTexture && !this._uvCheckActive) {
        this.activeMesh.material.map = this.liveCanvasTexture;
      }
      // Restore full-res PBR maps
      if (this._liveMetalnessTexture) {
        this.activeMesh.material.metalnessMap = this._liveMetalnessTexture;
      }
      if (this._liveRoughnessTexture) {
        this.activeMesh.material.roughnessMap = this._liveRoughnessTexture;
      }
      if (this._liveTransmissionTexture) {
        this.activeMesh.material.transmissionMap = this._liveTransmissionTexture;
      } else if (this._origTransmissionMap !== undefined) {
        // Drag replaced transmissionMap with a flat canvas; restore the original
        this.activeMesh.material.transmissionMap = this._origTransmissionMap ?? null;
      }
      this.activeMesh.material.needsUpdate = true;
    }
  }

  // ─── Render a PBR map using overlay shapes as a mask ─────────
  // Fills canvas with `bgValue` (0-255 gray) or draws `bgImage`, then draws
  // overlay shapes filled with `fgValue` using canvas composite operations.
  // bgScale: multiplier applied to bgImage pixels (e.g. origRoughness) so that
  // Three.js applying material.roughness=1.0 yields the same effective roughness
  // as the original material.roughness * rawPixel.
  _renderPBRMap(ctx, w, h, bgValue, fgValue, bgImage = null, bgScale = 1) {
    renderPBRMap({
      ctx,
      width: w,
      height: h,
      bgValue,
      fgValue,
      bgImage,
      bgScale,
      wrapImages: this._wrapImages,
      overlayImages: this.overlayImages,
      maskCanvas: this._pbrMaskCanvas,
      maskContext: this._pbrMaskCtx,
      drawTextureImage: (context, texture, width, height) => this._drawTextureImage(context, texture, width, height),
    });
  }

  _updateStickerPBRIfActive() {
    if (this._liveMetalnessTexture || this._liveRoughnessTexture || this._liveTransmissionTexture) {
      this._renderStickerPBRMaps();
      if (this._liveMetalnessTexture) this._liveMetalnessTexture.needsUpdate = true;
      if (this._liveRoughnessTexture) this._liveRoughnessTexture.needsUpdate = true;
      if (this._liveTransmissionTexture) this._liveTransmissionTexture.needsUpdate = true;
      markNeedsRender(2);
    }
  }

  // ─── Generate sticker metalness + roughness maps ─────────────
  _renderStickerPBRMaps() {
    const m = this.activeMesh?.material;
    if (!m || !this._metalnessCtx) return;

    const metalness = this._origMetalness ?? m.metalness ?? 0;
    const roughness = this._origRoughness ?? m.roughness ?? 0.5;

    // Metalness map: original value everywhere, 0 where decals are.
    // bgScale=metalness: scales channel map pixels so Three.js (roughness=1.0) gives correct effective value.
    this._renderPBRMap(this._metalnessCtx, 2048, 2048, metalness * 255, 0, this._origMetalnessMap, metalness);
    // Roughness map: original value everywhere, 0.5 where decals are (matte sticker).
    this._renderPBRMap(this._roughnessCtx, 2048, 2048, roughness * 255, 0.5 * 255, this._origRoughnessMap, roughness);

    // Transmission map: original value everywhere, 0 where decals are (opaque sticker).
    const transmission = this._origTransmission ?? m.transmission ?? 0;
    if (this._liveTransmissionTexture) {
      this._renderPBRMap(this._transmissionCtx, 2048, 2048, transmission * 255, 0, this._origTransmissionMap, transmission);
    }
  }

  // Called by main.js when a base color channel map is applied or cleared while decals are active.
  // Updates the composite base so the channel map appears underneath decals.
  notifyBaseMapChanged(newTexture) {
    if (!this.overlayImages.length) return;
    // The material slot held the composite, so nothing else frees the old base
    if (this.baseTexture && this.baseTexture !== newTexture) this.baseTexture.dispose();
    this._clearDragImageCache();
    this.baseTexture = newTexture || null;
    this._renderComposite();
    if (this.liveCanvasTexture && this.activeMesh?.material) {
      if (this._uvCheckActive) this._savedMaterialMap = this.liveCanvasTexture;
      else this.activeMesh.material.map = this.liveCanvasTexture;
      this.activeMesh.material.needsUpdate = true;
      markNeedsRender(4);
    }
  }

  // Called by main.js when a roughness/metalness channel map changes while sticker PBR maps are active.
  // Re-generates the sticker PBR maps using the new channel map as background, then
  // re-assigns the live sticker textures to the material (the upload handler overwrote them).
  notifyPBRMapChanged(channel, texture) {
    const origKey = { metalnessMap: '_origMetalnessMap', roughnessMap: '_origRoughnessMap', transmissionMap: '_origTransmissionMap' }[channel];
    if (origKey) {
      const previous = this[origKey];
      if (previous && previous !== texture) previous.dispose();
      this._clearDragImageCache();
      this[origKey] = texture ?? null;
    }
    this._updateStickerPBRIfActive();
    // Re-assign sticker maps — the channel map upload set material[channel] = rawTex,
    // overwriting the live sticker composite. Restore sticker ownership of those slots.
    if (this.activeMesh?.material) {
      if (this._liveMetalnessTexture)   this.activeMesh.material.metalnessMap   = this._liveMetalnessTexture;
      if (this._liveRoughnessTexture)   this.activeMesh.material.roughnessMap   = this._liveRoughnessTexture;
      if (this._liveTransmissionTexture) this.activeMesh.material.transmissionMap = this._liveTransmissionTexture;
      this.activeMesh.material.needsUpdate = true;
      markNeedsRender(4);
    }
  }

  // Same as the two notifications above, for a channel change on any part.
  notifyPartChannelChanged(mesh, channel, texture) {
    if (!this.hasPartDesign(mesh) || !DESIGN_MAP_SLOTS.includes(channel)) return;
    const notify = () => {
      if (channel === 'map') this.notifyBaseMapChanged(texture);
      else this.notifyPBRMapChanged(channel, texture);
    };
    if (mesh === this.activeMesh) notify();
    else this._withPartState(mesh, notify);
  }

  applyTextureToModel() {
    if (!this.activeMesh) { this.log('No model loaded', true); return; }

    // Keep baseTexture as the original source map. While a composite is live the
    // material's map can't tell us anything, and notifyBaseMapChanged keeps it current.
    if (!this.liveCanvasTexture) this.baseTexture = this._cleanMapOf(this.activeMesh.material);

    // Capture material base color for composite background fill (prevents black-material issue)
    // Use stored original color if sticker PBR maps are active (material.color is overridden to white)
    if (this._origColor) {
      this._materialBaseColor = this._origColor;
    } else if (this.activeMesh.material?.color) {
      const hex = this.activeMesh.material.color.getHexString();
      // Don't overwrite a valid base color with sticker-mode white (0xffffff)
      if (hex !== 'ffffff' || !this._materialBaseColor) {
        this._materialBaseColor = '#' + hex;
      }
    }

    // If no overlays, no need to create composite - just keep original
    if (this.overlayImages.length === 0) {
      this.log('No overlays to apply');
      return;
    }

    this._ensureDesignCanvases();

    // Create a new CanvasTexture. A part keeps its settings for as long as it has a
    // design, so adding a layer after its base changed doesn't flip what's there.
    const texture = new THREE.CanvasTexture(this.textureCanvas);
    texture.userData.isDesignComposite = true;
    this._applyDesignTextureSettings(texture, this.liveCanvasTexture ?? this.baseTexture);

    // Dispose any previously-applied live canvas texture (not the original base)
    if (this.liveCanvasTexture) this.liveCanvasTexture.dispose();
    this.liveCanvasTexture = texture;

    // Render the composite (draws base texture + overlays)
    this._renderComposite();

    if (this.activeMesh.material) {
      if (this._uvCheckActive) this._savedMaterialMap = texture;
      else this.activeMesh.material.map = texture;

      // Sticker PBR: override metalness/roughness where decals are
      this._applyStickerPBRMaps(this.activeMesh.material);

      this.activeMesh.material.needsUpdate = true;
    }

    markNeedsRender(4);
    this.log('✓ Design applied to model');
  }

  // ─── Apply sticker metalness/roughness maps to material ──────
  _applyStickerPBRMaps(material) {
    // Capture originals on first apply
    if (this._origMetalness === null) this._origMetalness = material.metalness ?? 0;
    if (this._origRoughness === null) this._origRoughness = material.roughness ?? 0.5;
    if (this._origTransmission === null) this._origTransmission = material.transmission ?? 0;
    const colorJustCaptured = this._origColor === null;
    if (colorJustCaptured && material.color) {
      this._origColor = '#' + material.color.getHexString();
      this._materialBaseColor = this._origColor;
    }
    if (this._origMetalnessMap    === undefined) this._origMetalnessMap    = material.metalnessMap    ?? null;
    if (this._origRoughnessMap    === undefined) this._origRoughnessMap    = material.roughnessMap    ?? null;
    if (this._origTransmissionMap === undefined) this._origTransmissionMap = material.transmissionMap ?? null;

    // If the base color was just captured for the first time and is non-white, the composite
    // was already rendered without the color tint baked in (_origColor was null then).
    // Re-render now so the tint is baked before material.color is forced to white below.
    if (colorJustCaptured && this._origColor && this._origColor !== '#ffffff' && this.liveCanvasTexture) {
      this._renderCompositeToCanvas(this.textureCtx, 2048, 2048, true);
      this.liveCanvasTexture.needsUpdate = true;
    }

    // Dispose previous live PBR textures
    if (this._liveMetalnessTexture)  this._liveMetalnessTexture.dispose();
    if (this._liveRoughnessTexture)  this._liveRoughnessTexture.dispose();
    if (this._liveTransmissionTexture) this._liveTransmissionTexture.dispose();

    this._liveMetalnessTexture = this._makeStickerTexture(this._metalnessCanvas);
    this._liveRoughnessTexture = this._makeStickerTexture(this._roughnessCanvas);

    material.metalnessMap = this._liveMetalnessTexture;
    material.roughnessMap = this._liveRoughnessTexture;
    // Set scalar values to 1.0 so maps are used as direct values
    material.metalness = 1.0;
    material.roughness = 1.0;

    // Transmission map: opaque where decals are, original transparency elsewhere
    if (this._origTransmission > 0) {
      this._ensureCanvas('_transmissionCanvas', '_transmissionCtx');
      this._liveTransmissionTexture = this._makeStickerTexture(this._transmissionCanvas);
      material.transmissionMap = this._liveTransmissionTexture;
      material.transmission = 1.0;
    } else if (this._liveTransmissionTexture) {
      this._liveTransmissionTexture = null;
      material.transmissionMap = this._origTransmissionMap ?? null;
      material.transmission = this._origTransmission;
    }

    // Generate the maps
    this._renderStickerPBRMaps();

    // Set color to white — the base color is baked into the composite texture
    // so Three.js doesn't multiply/tint the decals
    if (material.color) material.color.set(0xffffff);
  }

  // ─── Remove sticker PBR maps and restore originals ───────────
  _removeStickerPBRMaps() {
    const m = this.activeMesh?.material;

    if (this._liveMetalnessTexture) {
      this._liveMetalnessTexture.dispose();
      this._liveMetalnessTexture = null;
      if (m) m.metalnessMap = this._origMetalnessMap ?? null;
    }
    if (this._liveRoughnessTexture) {
      this._liveRoughnessTexture.dispose();
      this._liveRoughnessTexture = null;
      if (m) m.roughnessMap = this._origRoughnessMap ?? null;
    }
    if (this._liveTransmissionTexture) {
      this._liveTransmissionTexture.dispose();
      this._liveTransmissionTexture = null;
      if (m) m.transmissionMap = this._origTransmissionMap ?? null;
    }
    this._origMetalnessMap = undefined;
    this._origRoughnessMap = undefined;
    this._origTransmissionMap = undefined;
    if (this._origMetalness !== null) { if (m) m.metalness = this._origMetalness; this._origMetalness = null; }
    if (this._origRoughness !== null) { if (m) m.roughness = this._origRoughness; this._origRoughness = null; }
    if (this._origTransmission !== null) { if (m) m.transmission = this._origTransmission; this._origTransmission = null; }
    if (this._origColor !== null) { if (m?.color) m.color.set(this._origColor); this._origColor = null; }
    if (m) m.needsUpdate = true;
  }

  // Swap a part's material for a new instance, active or not. A logo stays on the part
  // and is composited over the new material's map.
  replacePartMaterial(mesh, material, disposeOld) {
    const swap = () => {
      this.prepareMaterialSwap();
      const old = mesh.material;
      mesh.material = material;
      disposeOld?.(old);
      this.onMaterialPresetApplied(mesh);
    };
    if (mesh === this.activeMesh) {
      swap();
    } else if (this._partStates.has(mesh)) {
      this._withPartState(mesh, swap);
    } else {
      disposeOld?.(mesh.material);
      mesh.material = material;
    }
    markNeedsRender(4);
  }

  // What a material slot holds underneath any design on the part.
  getPartCleanChannel(mesh, channel) {
    const state = mesh === this.activeMesh ? this : this._partStates.get(mesh);
    if (!state?.liveCanvasTexture) return mesh.material?.[channel] ?? null;
    if (channel === 'map') return state.baseTexture ?? null;
    const orig = { metalnessMap: state._origMetalnessMap, roughnessMap: state._origRoughnessMap, transmissionMap: state._origTransmissionMap }[channel];
    return orig !== undefined ? orig : (mesh.material?.[channel] ?? null);
  }

  // Apply a whole definition's values to a part, with one re-composite for parts with a
  // logo. applySaved(material, params) writes values onto the material.
  applyPartDefinition(mesh, params, applySaved) {
    const material = mesh?.material;
    if (!material) return;
    const apply = () => {
      if (this._origMetalness === null) {
        applySaved(material, params);
        if (params.color) this._materialBaseColor = params.color;
        return;
      }
      const { color, metalness, roughness, transmission, ...rest } = params;
      applySaved(material, rest);
      if (color !== undefined) { this._origColor = color; this._materialBaseColor = color; }
      if (metalness !== undefined) this._origMetalness = metalness;
      if (roughness !== undefined) this._origRoughness = roughness;
      if (transmission !== undefined) this._origTransmission = transmission;
      if (this._origTransmission > 0 && !this._liveTransmissionTexture) this._applyStickerPBRMaps(material);
      this._renderComposite();
      this._updateStickerPBRIfActive();
    };
    if (mesh === this.activeMesh) {
      apply();
      this._renderPreview();
    } else if (this._partStates.has(mesh)) {
      this._withPartState(mesh, apply);
    } else {
      applySaved(material, params);
    }
    material.needsUpdate = true;
    markNeedsRender(4);
  }

  // Called by main.js right before the active part's material is replaced, so the old
  // material holds its clean maps when it is disposed. The composite stays alive for
  // onMaterialPresetApplied.
  prepareMaterialSwap() {
    this._resumeCheckUV = this._uvCheckActive;
    this._deactivateCheckUV();
    clearTimeout(this._dragRestoreTimer);
    this._clearDragImageCache();
    this._removeStickerPBRMaps();
    if (this.liveCanvasTexture && this.activeMesh?.material) this.activeMesh.material.map = this.baseTexture;
    this.baseTexture = null;
  }


  resetTexture() {
    if (this.overlayImages.length === 0) return;
    this.overlayImages = [];
    this.selectedImageId = null;
    this._clearActiveDesign();

    this._updateLayersList();
    this._renderPreview();
    markNeedsRender(4);
    this._notifyLayersSaved();
    this.onCommit?.('Removed all decals');
    this.log('All decals removed');
  }

  // ─── Public transform helpers (used by keyboard shortcuts & UI buttons) ──

  /** Move selected overlay by dx/dy in % canvas units with portal wrap-around. */
  nudgeSelected(dx, dy) {
    const img = this.overlayImages.find(i => i.id === this.selectedImageId);
    if (!img) return;
    img.position.x = this._wrapPercent(img.position.x + dx);
    img.position.y = this._wrapPercent(img.position.y + dy);
    this._syncSlidersFromImage(img);
    this._renderPreview();
    this._restoreFullResTexture();
    this._renderComposite();
    this._updateStickerPBRIfActive();
  }

  /** Rotate selected overlay by deltaDeg degrees. */
  rotateSelected(deltaDeg) {
    const img = this.overlayImages.find(i => i.id === this.selectedImageId);
    if (!img) return;
    img.rotation = ((img.rotation + deltaDeg) % 360 + 360) % 360;
    this._syncSlidersFromImage(img);
    this._renderPreview();
    this._restoreFullResTexture();
    this._renderComposite();
    this._updateStickerPBRIfActive();
  }

  /** Reset selected overlay to its initial center/size/rotation defaults. */
  resetSelectedTransform() {
    const img = this.overlayImages.find(i => i.id === this.selectedImageId);
    if (!img) return;
    img.position = { x: 50, y: 50 };
    img.rotation = 0;
    img.size = { w: 30, h: 30 / (img.aspectRatio || 1) };
    this._syncSlidersFromImage(img);
    this._renderPreview();
    this._restoreFullResTexture();
    this._renderComposite();
    this._updateStickerPBRIfActive();
  }

  // ─── Public API for material property changes ──────────────────
  // Called by main.js so it doesn't need to reach into internals.

  updateMaterialColor(value) {
    const hasDecals = this.overlayImages && this.overlayImages.length > 0;
    if (this._origColor !== null) {
      this._origColor = value;
      this._materialBaseColor = value;
      this._renderPreview();
      if (hasDecals) {
        this._renderCompositeDrag();
        this._scheduleDragRestore();
      } else {
        this._renderComposite();
      }
      return true;
    }
    this._materialBaseColor = value;
    this._renderPreview();
    return false;
  }

  updateMaterialPBR(property, value) {
    const hasDecals = this.overlayImages && this.overlayImages.length > 0;
    if (property === 'metalness' && this._origMetalness !== null) {
      this._origMetalness = value;
      if (hasDecals) { this._renderStickerPBRMapsDrag(); this._scheduleDragRestore(); } else {
        this._renderStickerPBRMaps();
        if (this._liveMetalnessTexture) this._liveMetalnessTexture.needsUpdate = true;
      }
      return true;
    }
    if (property === 'roughness' && this._origRoughness !== null) {
      this._origRoughness = value;
      if (hasDecals) { this._renderStickerPBRMapsDrag(); this._scheduleDragRestore(); } else {
        this._renderStickerPBRMaps();
        if (this._liveRoughnessTexture) this._liveRoughnessTexture.needsUpdate = true;
      }
      return true;
    }
    if (property === 'transmission' && this._origTransmission !== null) {
      this._origTransmission = value;
      if (!this._liveTransmissionTexture) {
        // No sticker composite for transmission — update scalar directly so the
        // original transmissionMap keeps working in real-time without being
        // replaced by a flat drag canvas
        if (this.activeMesh?.material) {
          this.activeMesh.material.transmission = value;
          this.activeMesh.material.needsUpdate = true;
        }
      } else if (hasDecals) {
        this._renderStickerPBRMapsDrag();
        this._scheduleDragRestore();
      } else {
        this._renderStickerPBRMaps();
        this._liveTransmissionTexture.needsUpdate = true;
      }
      return true;
    }
    return false;
  }

  commitMaterialChange() {
    this._restoreFullResTexture();
    this._renderComposite();
    this._updateStickerPBRIfActive();
  }

  reapplyDecalState() {
    this._reapplyPartDecalState();
    this._forEachStoredPart(() => this._reapplyPartDecalState());
  }

  _reapplyPartDecalState() {
    if (!this.activeMesh?.material || !this.overlayImages?.length) return;
    const mat = this.activeMesh.material;
    if (this.liveCanvasTexture && !this._uvCheckActive) mat.map = this.liveCanvasTexture;
    if (this._origColor !== null && mat.color) mat.color.set(0xffffff);
    if (this._liveMetalnessTexture) { mat.metalnessMap = this._liveMetalnessTexture; mat.metalness = 1.0; }
    if (this._liveRoughnessTexture) { mat.roughnessMap = this._liveRoughnessTexture; mat.roughness = 1.0; }
    if (this._liveTransmissionTexture) { mat.transmissionMap = this._liveTransmissionTexture; mat.transmission = 1.0; }
    mat.needsUpdate = true;
  }

  onMaterialPresetApplied(mesh) {
    if (mesh !== this.activeMesh) return;
    this.baseTexture = this._cleanMapOf(mesh.material);
    this._materialBaseColor = '#' + mesh.material.color.getHexString();
    if (this.overlayImages.length > 0 && this.liveCanvasTexture) {
      this._renderComposite();
      mesh.material.map = this.liveCanvasTexture;
      this._applyStickerPBRMaps(mesh.material);
      mesh.material.needsUpdate = true;
    }
    if (this._resumeCheckUV) {
      this._resumeCheckUV = false;
      this._toggleCheckUV();
    }
  }

  async saveAsCustomModel() {
    if (!this.customModelName) {
      const defaultName = `${this.activeModelName} (Custom)`;
      const customName = prompt('Enter a name for your custom model:', defaultName);
      if (!customName) { 
        this.log('Save cancelled'); 
        return; 
      }
      this.customModelName = customName;
    }


    let materialProperties = {};
    if (this.activeMesh?.material) {
      const mat = this.activeMesh.material;
      // When sticker PBR maps are active, metalness/roughness are set to 1.0
      // so the maps drive per-pixel values. Temporarily restore the real
      // original values before extracting so we save the correct properties.
      const stickerActive = this._origMetalness !== null;
      if (stickerActive) {
        mat.metalness = this._origMetalness;
        mat.roughness = this._origRoughness;
        if (this._origTransmission !== null) mat.transmission = this._origTransmission;
        if (this._origColor && mat.color) mat.color.set(this._origColor);
      }
      if (this.materialManager) {
        materialProperties = this.materialManager.extractProperties(mat);
      } else {

        const m = this.activeMesh.material;
        materialProperties = {
          color: m.color ? '#' + m.color.getHexString() : '#ffffff',
          metalness: this._origMetalness ?? m.metalness ?? 0,
          roughness: this._origRoughness ?? m.roughness ?? 0.5,
          opacity: m.opacity ?? 1,
          transparent: m.transparent ?? false,
          clearcoat: m.clearcoat ?? 0,
          clearcoatRoughness: m.clearcoatRoughness ?? 0.1,
          specularIntensity: m.specularIntensity ?? 1,
          specularColor: m.specularColor ? '#' + m.specularColor.getHexString() : '#ffffff',
          transmission: m.transmission ?? 0,
          ior: m.ior ?? 1.5,
          thickness: m.thickness ?? 0,
          attenuationDistance: m.attenuationDistance === Infinity ? 0 : (m.attenuationDistance ?? 0),
          attenuationColor: m.attenuationColor ? '#' + m.attenuationColor.getHexString() : '#ffffff',
          sheen: m.sheen ?? 0,
          sheenRoughness: m.sheenRoughness ?? 1,
          sheenColor: m.sheenColor ? '#' + m.sheenColor.getHexString() : '#ffffff',
          emissive: m.emissive ? '#' + m.emissive.getHexString() : '#000000',
          emissiveIntensity: m.emissiveIntensity ?? 0,
          envMapIntensity: m.envMapIntensity ?? 1,
        };
      }
      // Restore overridden values so sticker PBR maps continue to work
      if (stickerActive) {
        mat.metalness = 1.0;
        mat.roughness = 1.0;
        if (this._liveTransmissionTexture) mat.transmission = 1.0;
        if (mat.color) mat.color.set(0xffffff);
      }
    }

    const serializedImages = await Promise.all(this.overlayImages.map(async img => {
      const c = document.createElement('canvas');
      const iw = img.image.naturalWidth  || img.image.width  || 1;
      const ih = img.image.naturalHeight || img.image.height || 1;
      c.width = iw; c.height = ih;
      const sc = c.getContext('2d');
      sc.imageSmoothingEnabled = true;
      sc.imageSmoothingQuality = 'high';
      sc.drawImage(img.image, 0, 0, iw, ih);
      return {
        name:        img.name,
        type:        img.type     || 'image',
        textData:    img.textData ? { ...img.textData } : null,
        position:    { ...img.position },
        size:        { ...img.size },
        rotation:    img.rotation,
        aspectRatio: img.aspectRatio,
        flipH:       img.flipH,
        flipV:       img.flipV,
        imageData:   this.encodeLayerImage(img)
      };
    }));

    await this.modelManager.saveCustomModel(this.customModelName, {
      basedOn: this.activeModelName,
      customName: this.customModelName,
      overlayImages: serializedImages,
      materialProperties,
      materialId: this.currentMaterialPreset,
      sceneState: this.sceneState || null,
    });

    if (this.overlayImages.length > 0) this.applyTextureToModel();

    this.log(`✓ Saved: ${this.customModelName}`);
    if (this.onModelListChanged) await this.onModelListChanged();
    this.onSelectModel?.(this.customModelName);
  }

  // ─── Local-space coordinate transform ────────────────────────
  // Returns {x, y} in %-space relative to a given image center, un-rotated to local axes.
  _getLocalMouseCoords(mouseX, mouseY, img, centerX = img.position.x, centerY = img.position.y) {
    const dx = mouseX - centerX;
    const dy = mouseY - centerY;
    const a = -(img.rotation * Math.PI) / 180;
    return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) };
  }

  // Normalize into [0,100) for portal-like wrap across preview edges.
  _wrapPercent(v) {
    return ((v % 100) + 100) % 100;
  }

  // Wrapped centers used for hit-testing when wrap mode is enabled.
  _getWrapCenters(img) {
    if (!this._wrapImages) return [{ x: img.position.x, y: img.position.y }];
    const centers = [];
    const offsets = [-100, 0, 100];
    offsets.forEach(ox => {
      offsets.forEach(oy => centers.push({ x: img.position.x + ox, y: img.position.y + oy }));
    });
    return centers;
  }

  // ─── Update canvas cursor based on hover state ─────────────
  _updateCursor(mouseX, mouseY) {
    if (!this.uvCanvas) return;
    // Handle sizes in %-space (canvas is 512px; 10px → ~1.95%)
    const CORNER_HS  = (10 / 512) * 100;
    const ROT_DIST   = (16 / 512) * 100;
    const ROT_RADIUS = (10 / 512) * 100;

    for (let i = 0; i < this.overlayImages.length; i++) {
      const img = this.overlayImages[i];
      const hw = img.size.w / 2, hh = img.size.h / 2;
      // Only check primary center for cursor — skip 9x wrap centers
      const center = { x: img.position.x, y: img.position.y };
      {
        const local = this._getLocalMouseCoords(mouseX, mouseY, img, center.x, center.y);

        // Rotate handle (above top-center in local space)
        const rotLY = -(hh + ROT_DIST);
        if (Math.sqrt(local.x ** 2 + (local.y - rotLY) ** 2) <= ROT_RADIUS) {
          this.uvCanvas.style.cursor = 'grab'; return;
        }
        // Corner handles (only for selected image)
        if (img.id === this.selectedImageId) {
          for (const [cx, cy] of [[-hw,-hh],[hw,-hh],[-hw,hh],[hw,hh]]) {
            if (Math.abs(local.x - cx) <= CORNER_HS && Math.abs(local.y - cy) <= CORNER_HS) {
              this.uvCanvas.style.cursor = 'nwse-resize'; return;
            }
          }
          // Edge midpoint handles
          if (Math.abs(local.x) <= CORNER_HS && Math.abs(local.y + hh) <= CORNER_HS) { this.uvCanvas.style.cursor = 'ns-resize'; return; }
          if (Math.abs(local.x) <= CORNER_HS && Math.abs(local.y - hh) <= CORNER_HS) { this.uvCanvas.style.cursor = 'ns-resize'; return; }
          if (Math.abs(local.x + hw) <= CORNER_HS && Math.abs(local.y) <= CORNER_HS) { this.uvCanvas.style.cursor = 'ew-resize'; return; }
          if (Math.abs(local.x - hw) <= CORNER_HS && Math.abs(local.y) <= CORNER_HS) { this.uvCanvas.style.cursor = 'ew-resize'; return; }
        }
        // Body hit
        if (Math.abs(local.x) <= hw && Math.abs(local.y) <= hh) {
          this.uvCanvas.style.cursor = 'move'; return;
        }
      }
    }
    this.uvCanvas.style.cursor = 'crosshair';
  }
  _onMouseDown(e) {
    if (!this.uvCanvas) return;
    const rect = this.uvCanvas.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * 100;
    const mouseY = ((e.clientY - rect.top) / rect.height) * 100;

    const CORNER_HS  = (10 / 512) * 100;
    const ROT_DIST   = (16 / 512) * 100;
    const ROT_RADIUS = (10 / 512) * 100;

    for (let i = 0; i < this.overlayImages.length; i++) {
      const img = this.overlayImages[i];
      const hw = img.size.w / 2, hh = img.size.h / 2;
      const centers = this._getWrapCenters(img);

      for (const center of centers) {
        const local = this._getLocalMouseCoords(mouseX, mouseY, img, center.x, center.y);

        // 1. Rotate handle
        const rotLY = -(hh + ROT_DIST);
        if (Math.sqrt(local.x ** 2 + (local.y - rotLY) ** 2) <= ROT_RADIUS) {
          this.selectImage(img.id);
          this.isDragging = true;
          this._dragMode = 'rotate';
          this._rotateStart = {
            imgRotation: img.rotation,
            mouseAngle: Math.atan2(mouseY - center.y, mouseX - center.x) * 180 / Math.PI
          };
          this.uvCanvas.style.cursor = 'grabbing';
          return;
        }

        // 2. Corner + edge resize handles (only for the currently selected image)
        if (img.id === this.selectedImageId) {
          // Corners
          for (const [cx, cy] of [[-hw,-hh],[hw,-hh],[-hw,hh],[hw,hh]]) {
            if (Math.abs(local.x - cx) <= CORNER_HS && Math.abs(local.y - cy) <= CORNER_HS) {
              this.isDragging = true;
              this._dragMode = 'resize';
              const diag = Math.sqrt(hw ** 2 + hh ** 2);
              this._resizeStart = { origW: img.size.w, origH: img.size.h, origDiag: diag || 1 };
              this.uvCanvas.style.cursor = 'nwse-resize';
              return;
            }
          }
          // Edge midpoints — top/bottom stretch height, left/right stretch width
          if (Math.abs(local.x) <= CORNER_HS && Math.abs(local.y + hh) <= CORNER_HS) {
            this.isDragging = true; this._dragMode = 'resize-v';
            this._resizeStart = { origW: img.size.w, origH: img.size.h, origDiag: 1 };
            this.uvCanvas.style.cursor = 'ns-resize'; return;
          }
          if (Math.abs(local.x) <= CORNER_HS && Math.abs(local.y - hh) <= CORNER_HS) {
            this.isDragging = true; this._dragMode = 'resize-v';
            this._resizeStart = { origW: img.size.w, origH: img.size.h, origDiag: 1 };
            this.uvCanvas.style.cursor = 'ns-resize'; return;
          }
          if (Math.abs(local.x + hw) <= CORNER_HS && Math.abs(local.y) <= CORNER_HS) {
            this.isDragging = true; this._dragMode = 'resize-h';
            this._resizeStart = { origW: img.size.w, origH: img.size.h, origDiag: 1 };
            this.uvCanvas.style.cursor = 'ew-resize'; return;
          }
          if (Math.abs(local.x - hw) <= CORNER_HS && Math.abs(local.y) <= CORNER_HS) {
            this.isDragging = true; this._dragMode = 'resize-h';
            this._resizeStart = { origW: img.size.w, origH: img.size.h, origDiag: 1 };
            this.uvCanvas.style.cursor = 'ew-resize'; return;
          }
        }

        // 3. Body - translate
        if (Math.abs(local.x) <= hw && Math.abs(local.y) <= hh) {
          this.selectImage(img.id);
          this.isDragging = true;
          this._dragMode = 'translate';
          this.dragOffset = { x: mouseX - center.x, y: mouseY - center.y };
          this.uvCanvas.style.cursor = 'move';
          return;
        }
      }
    }
  }
  _onMouseMove(e) {
    if (!this.uvCanvas) return;
    const rect = this.uvCanvas.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * 100;
    const mouseY = ((e.clientY - rect.top) / rect.height) * 100;

    if (!this.isDragging) {
      this._updateCursor(mouseX, mouseY);
      return;
    }
    if (!this.selectedImageId) return;

    const img = this.overlayImages.find(i => i.id === this.selectedImageId);
    if (!img) return;

    if (this._dragMode === 'translate') {
      img.position.x = this._wrapPercent(mouseX - this.dragOffset.x);
      img.position.y = this._wrapPercent(mouseY - this.dragOffset.y);

    } else if (this._dragMode === 'rotate') {
      const mouseAngle = Math.atan2(mouseY - img.position.y, mouseX - img.position.x) * 180 / Math.PI;
      const delta = mouseAngle - this._rotateStart.mouseAngle;
      img.rotation = ((this._rotateStart.imgRotation + delta) % 360 + 360) % 360;

    } else if (this._dragMode === 'resize') {
      const local = this._getLocalMouseCoords(mouseX, mouseY, img);
      if (this._lockAspectRatio && img.aspectRatio && img.type !== 'text') {
        // Scale uniformly by how far mouse is from center vs original diagonal
        const newDiag = Math.sqrt(local.x ** 2 + local.y ** 2);
        const scale = newDiag / this._resizeStart.origDiag;
        img.size.w = Math.max(2, this._resizeStart.origW * scale);
        img.size.h = Math.max(1, this._resizeStart.origH * scale);
      } else {
        img.size.w = Math.max(2, Math.abs(local.x) * 2);
        img.size.h = Math.max(1, Math.abs(local.y) * 2);
      }
    } else if (this._dragMode === 'resize-h') {
      const local = this._getLocalMouseCoords(mouseX, mouseY, img);
      img.size.w = Math.max(2, Math.abs(local.x) * 2);
    } else if (this._dragMode === 'resize-v') {
      const local = this._getLocalMouseCoords(mouseX, mouseY, img);
      img.size.h = Math.max(1, Math.abs(local.y) * 2);
    }

    this._syncSlidersFromImage(img);
    if (!this._rafPending) {
      this._rafPending = true;
      requestAnimationFrame(() => {
        this._rafPending = false;
        this._renderPreview();
        // Only use drag-quality composite if still dragging — mouseup may have
        // fired between the queued rAF and its execution, restoring full-res texture.
        if (this.liveCanvasTexture && this.isDragging) this._renderCompositeDrag();
      });
    }
  }

  // ─── Populate the part select in the Design Editor ────────────
  setPartNames(names, callback) {
    this._partSelectCallback = callback;
    const sel = document.getElementById('design-part-select');
    if (!sel) return;
    sel.innerHTML = '';
    if (names.length === 0) {
      sel.innerHTML = '<option value="">— No parts —</option>';
      return;
    }
    names.forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    });
    if (names.length > 0) sel.value = names[0];
  }

  // ─── Flip selected overlay image ─────────────────────────────
  _flipSelected(axis) {
    const img = this.overlayImages.find(i => i.id === this.selectedImageId);
    if (!img) return;
    if (axis === 'h') img.flipH = !img.flipH;
    else img.flipV = !img.flipV;
    this._renderPreview();
    this._renderComposite();
    this._updateStickerPBRIfActive();
    markNeedsRender(4);
    this._notifyLayersSaved();
    this.onCommit?.(`Flipped ${axis === 'h' ? 'horizontal' : 'vertical'}`);
  }

  // ─── Text Tool ────────────────────────────────────────────────

  _openTextPanel(editLayer = null) {
    const panel = document.getElementById('text-tool-panel');
    if (!panel) return;
    this._editingTextId = editLayer ? editLayer.id : null;

    const title = document.getElementById('text-tool-panel-title');
    if (title) title.textContent = editLayer ? 'Edit Text' : 'Add Text';

    const td = editLayer?.textData;
    const g = id => document.getElementById(id);

    if (g('text-tool-content'))    g('text-tool-content').value    = td?.content    ?? '';
    if (g('text-tool-font'))       g('text-tool-font').value       = td?.fontFamily ?? 'Roboto';
    const size = td?.fontSize ?? 72;
    if (g('text-tool-size-input')) g('text-tool-size-input').value = size;
    if (g('text-tool-size-slider'))g('text-tool-size-slider').value= size;
    if (g('text-tool-color'))      g('text-tool-color').value      = td?.color      ?? '#000000';
    if (g('text-tool-bold'))       g('text-tool-bold').checked     = td?.bold       ?? false;
    if (g('text-tool-italic'))     g('text-tool-italic').checked   = td?.italic     ?? false;

    panel.style.display = 'block';
  }

  _closeTextPanel() {
    const panel = document.getElementById('text-tool-panel');
    if (panel) panel.style.display = 'none';
    this._editingTextId = null;
  }

  async _onTextCreate() {
    const g = id => document.getElementById(id);
    const content = g('text-tool-content')?.value ?? '';
    if (!content.trim()) { console.log('Please enter some text.'); return; }

    const textData = {
      content,
      fontFamily: g('text-tool-font')?.value        ?? 'Roboto',
      fontSize:   parseInt(g('text-tool-size-input')?.value ?? '72'),
      color:      g('text-tool-color')?.value        ?? '#000000',
      bold:       g('text-tool-bold')?.checked       ?? false,
      italic:     g('text-tool-italic')?.checked     ?? false,
    };

    const editId = this._editingTextId;
    this._closeTextPanel();
    await this._addTextLayer(textData, editId);
  }

  // Render text to a high-res canvas and return a loaded HTMLImageElement.
  async _buildTextImage(textData) {
    return buildTextImage(textData);
  }

  // Create a new text overlay or regenerate an existing one.
  async _addTextLayer(textData, editId = null) {
    const { image, aspectRatio } = await this._buildTextImage(textData);
    const label = `"${textData.content.replace(/\n/g, ' ').slice(0, 24)}"`;

    if (editId !== null) {
      const existing = this.overlayImages.find(i => i.id === editId);
      if (existing) {
        existing.image       = image;
        existing.name        = label;
        existing.textData    = { ...textData };
        existing.aspectRatio = aspectRatio;
        existing.size.h      = existing.size.w / aspectRatio;
        delete existing._originalDataURL; // a restored layer's copy still shows the old text
        this._notifyLayersSaved();
      }
      this.log('Text layer updated');
      this.onCommit?.('Edited text layer');
    } else {
      const entry = {
        id:          this.nextImageId++,
        image,
        name:        label,
        type:        'text',
        textData:    { ...textData },
        position:    { x: 50, y: 50 },
        size:        { w: 40, h: 40 / aspectRatio },
        rotation:    0,
        aspectRatio,
        flipH:       false,
        flipV:       false,
      };
      this.overlayImages.push(entry);
      this._notifyLayersSaved();
      this.selectImage(entry.id);
      this.log('Text layer added — drag to position, click layer to edit');
      this.onCommit?.('Added text layer');
    }

    this._updateLayersList();
    this._renderPreview();
    this.applyTextureToModel();
  }

  // ─── Deactivate Check UV (internal helper) ────────────────────
  _deactivateCheckUV() {
    if (!this._uvCheckActive) return;
    if (this._uvCheckerTexture) {
      this._uvCheckerTexture.dispose();
      this._uvCheckerTexture = null;
    }
    if (this.activeMesh?.material) {
      this.activeMesh.material.map = this.liveCanvasTexture || this._savedMaterialMap;
      this.activeMesh.material.needsUpdate = true;
    }
    this._savedMaterialMap = null;
    this._uvCheckActive = false;
    const btn = document.getElementById('check-uv-btn');
    if (btn) btn.classList.remove('button-selected');
  }

  // ─── Toggle UV Checker texture on model ──────────────────────
  _toggleCheckUV() {
    if (!this.activeMesh?.material) { this.log('No model loaded'); return; }
    const btn = document.getElementById('check-uv-btn');
    if (!this._uvCheckActive) {
      const mesh = this.activeMesh;
      const loader = new THREE.TextureLoader();
      loader.load('./assets/standard/images/maps/UVChecker.png', (texture) => {
        // The part may have changed, or Check UV turned on, while this was loading
        if (mesh !== this.activeMesh || !mesh.material || this._uvCheckActive) { texture.dispose(); return; }
        this._savedMaterialMap = mesh.material.map;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.flipY = this._savedMaterialMap?.flipY ?? false;
        this._uvCheckerTexture = texture;
        this.activeMesh.material.map = texture;
        this.activeMesh.material.needsUpdate = true;
        this._uvCheckActive = true;
        if (btn) btn.classList.add('button-selected');
        markNeedsRender(4);
        this.log('Check UV: on');
      }, undefined, () => this.log('Check UV: failed to load UVChecker.png'));
    } else {
      this._deactivateCheckUV();
      markNeedsRender(4);
      this.log('Check UV: off');
    }
  }

  // ─── Toggle wrap-around for overlay images ────────────────────
  _toggleWrap() {
    this._wrapImages = !this._wrapImages;
    const btn = document.getElementById('wrap-uv-btn');
    if (btn) btn.classList.toggle('button-selected', this._wrapImages);
    this._renderPreview();
    this._renderComposite();
    this._updateStickerPBRIfActive();
    this._forEachStoredPart(() => {
      this._renderComposite();
      this._updateStickerPBRIfActive();
    });
    this.onPrefsChanged?.();
    this.log(`Wrap: ${this._wrapImages ? 'on' : 'off'}`);
  }

  // ─── Toggle UV wireframe overlay in the preview canvas ───────
  _togglePreviewUV() {
    this._uvPreviewEnabled = !this._uvPreviewEnabled;
    const btn = document.getElementById('preview-uv-btn');
    if (btn) btn.classList.toggle('button-selected', this._uvPreviewEnabled);
    this._renderPreview();
    this.log(`Preview UV: ${this._uvPreviewEnabled ? 'on' : 'off'}`);
  }

  // ─── Draw UV wireframe triangles on the preview canvas ───────
  // Renders once into an offscreen canvas, then reuses it every subsequent
  // frame via drawImage — avoids re-stroking thousands of triangles on drag.
  _drawUVWireframe(ctx, w, h) {
    if (!this.activeMesh?.geometry) return;

    // Rebuild cache if missing or canvas size changed
    if (!this._uvWireframeCache ||
        this._uvWireframeCache.width !== w ||
        this._uvWireframeCache.height !== h) {

      const geo = this.activeMesh.geometry;
      const uvAttr = geo.attributes.uv;
      if (!uvAttr) return;

      const offscreen = document.createElement('canvas');
      offscreen.width  = w;
      offscreen.height = h;
      const oc = offscreen.getContext('2d');

      const uvs   = uvAttr.array;
      const index = geo.index;

      // GLB/GLTF textures have flipY=false (V=0 at top); OBJ uses flipY=true (V=0 at bottom).
      // The canvas Y-axis has 0 at top, so OBJ needs (1-v)*h but GLB needs v*h.
      const meshTex = this.activeMesh.material?.map;
      const flipV   = meshTex ? meshTex.flipY !== false : true;
      const toY = (v) => flipV ? (1 - v) * h : v * h;

      oc.strokeStyle = 'rgba(120, 210, 255, 0.65)';
      oc.lineWidth   = 1.5;
      oc.lineJoin    = 'round';

      const drawTri = (i0, i1, i2) => {
        oc.beginPath();
        oc.moveTo(uvs[i0 * 2] * w, toY(uvs[i0 * 2 + 1]));
        oc.lineTo(uvs[i1 * 2] * w, toY(uvs[i1 * 2 + 1]));
        oc.lineTo(uvs[i2 * 2] * w, toY(uvs[i2 * 2 + 1]));
        oc.closePath();
        oc.stroke();
      };

      if (index) {
        const idx = index.array;
        for (let i = 0; i < idx.length; i += 3) drawTri(idx[i], idx[i + 1], idx[i + 2]);
      } else {
        for (let i = 0; i < uvAttr.count; i += 3) drawTri(i, i + 1, i + 2);
      }

      this._uvWireframeCache = offscreen;
    }

    ctx.drawImage(this._uvWireframeCache, 0, 0);
  }

  // ─── History restore (called by main.js on undo/redo) ────────
  // state comes from snapshotOverlays — no re-encoding, uses live image refs.
  // A part the snapshot doesn't list hadn't been opened yet, so it goes back to the
  // layers it was first opened with. Undo never wipes layers that were loaded later.
  restoreHistoryState(state) {
    if (!state) return;
    const layersFor = mesh => (mesh === state.mesh ? state.overlayImages : null)
      ?? state.parts?.get(mesh)
      ?? this._partBaselines.get(mesh)
      ?? [];

    for (const mesh of this._partBaselines.keys()) {
      if (mesh === this.activeMesh || !mesh.material) continue;
      const layers = layersFor(mesh);
      if (this._sameLayers(this._partStates.get(mesh)?.overlayImages ?? [], layers)) continue;
      this._withPartState(mesh, () => {
        this.overlayImages = this._copyLayers(layers);
        this.selectedImageId = null;
        this._syncDesignToLayers();
      });
      this.onPartLayersRestored?.(mesh, this._copyLayers(layers));
    }

    this.overlayImages = this._copyLayers(layersFor(this.activeMesh));
    this.nextImageId = this._nextLayerId(this.overlayImages);
    const selectedId = this.activeMesh === state.mesh ? state.selectedImageId : this.selectedImageId;
    this.selectedImageId = this.overlayImages.some(i => i.id === selectedId) ? selectedId : null;
    this._notifyLayersSaved();
    this._updateLayersList();
    const sel = this.overlayImages.find(i => i.id === this.selectedImageId);
    if (sel) this._syncSlidersFromImage(sel);
    this._renderPreview();
    this._syncDesignToLayers();
    markNeedsRender(4);
  }

  _copyLayers(layers) {
    return layers.map(layer => ({
      ...layer,
      position: { ...layer.position },
      size:     { ...layer.size },
      textData: layer.textData ? { ...layer.textData } : null,
    }));
  }

  _sameLayers(a, b) {
    const key = l => [l.id, l.position.x, l.position.y, l.size.w, l.size.h, l.rotation, !!l.flipH, !!l.flipV].join();
    return a.length === b.length && a.every((layer, i) => layer.image === b[i].image && key(layer) === key(b[i]));
  }

  // ─── Snapshot the current overlay state for history ──────────
  // Returns a plain object — no dataURL encoding, keeps HTMLImageElement refs.
  // Covers every part opened so far, because undo restores all of them together.
  snapshotOverlays() {
    const parts = new Map();
    for (const mesh of this._partBaselines.keys()) {
      if (mesh !== this.activeMesh) parts.set(mesh, this._copyLayers(this._partStates.get(mesh)?.overlayImages ?? []));
    }
    return {
      mesh: this.activeMesh,
      overlayImages: this._copyLayers(this.overlayImages),
      selectedImageId: this.selectedImageId,
      parts,
    };
  }

  // --- Session persistence helpers (used by main.js autosave) ---

  _imageToDataURL(img) {
    if (!img) return null;
    const w = img.naturalWidth  || img.width  || 1;
    const h = img.naturalHeight || img.height || 1;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const cx = c.getContext('2d');
    cx.imageSmoothingEnabled = true;
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/png');
  }

  getSessionState() {
    return {
      wrapImages: this._wrapImages,
      lockAspectRatio: this._lockAspectRatio,
      selectedImageId: this.selectedImageId,
      nextImageId: this.nextImageId,
      materialBaseColor: this._materialBaseColor,
      overlayImages: this.overlayImages.map(img => ({
        id:          img.id,
        name:        img.name,
        type:        img.type     || 'image',
        textData:    img.textData ? { ...img.textData } : null,
        position:    { ...img.position },
        size:        { ...img.size },
        rotation:    img.rotation,
        aspectRatio: img.aspectRatio,
        flipH:       !!img.flipH,
        flipV:       !!img.flipV,
        imageData:   img._originalDataURL ?? this._imageToDataURL(img.image),
      })),
    };
  }

  async restoreSessionState(state) {
    if (!state) return;

    this._wrapImages = state.wrapImages !== undefined ? !!state.wrapImages : this._wrapImages;
    this._lockAspectRatio = state.lockAspectRatio !== undefined ? !!state.lockAspectRatio : this._lockAspectRatio;
    this._materialBaseColor = state.materialBaseColor || this._materialBaseColor;
    this.nextImageId = Number.isFinite(state.nextImageId) ? state.nextImageId : this.nextImageId;

    const mesh = this.activeMesh;
    const loaded = [];
    const overlays = Array.isArray(state.overlayImages) ? state.overlayImages : [];
    const decoded = await Promise.all(overlays.map(async saved => {
      if (!saved?.imageData) return null;
      try {
        const image = await loadDesignImage(saved.imageData);
        return { ...saved, id: saved.id ?? this.nextImageId++, image,
          name: saved.name || 'Design', type: saved.type || 'image',
          aspectRatio: saved.aspectRatio || image.width / image.height,
          _originalDataURL: saved.imageData };
      } catch (err) { this.log(`Could not restore design: ${err.message}`, true); return null; }
    }));
    loaded.push(...decoded.filter(Boolean));
    if (mesh !== this.activeMesh) return; // these layers belong to a part we've since left

    // Only replace overlays if the session has unsaved ones — otherwise keep
    // the decals that openWithPreloadedData restored from the saved custom model.
    if (loaded.length > 0) {
      this.overlayImages = loaded;
      this.selectedImageId = loaded.some(i => i.id === state.selectedImageId)
        ? state.selectedImageId
        : (loaded[0]?.id ?? null);
      this.nextImageId = this._nextLayerId(loaded);
      if (mesh) this._partBaselines.set(mesh, this._copyLayers(loaded));
    }

    const wrapBtn = document.getElementById('wrap-uv-btn');
    if (wrapBtn) wrapBtn.classList.toggle('button-selected', this._wrapImages);
    const lockAspect = document.getElementById('lock-aspect-ratio');
    if (lockAspect) lockAspect.checked = this._lockAspectRatio;

    this._updateLayersList();
    if (this.selectedImageId) {
      const sel = this.overlayImages.find(i => i.id === this.selectedImageId);
      if (sel) this._syncSlidersFromImage(sel);
    }
    this._renderPreview();
    if (this.overlayImages.length > 0) this.applyTextureToModel();
  }

  // ─── Design layer persistence hooks ──────────────────────────
  onLayersSaved(cb) {
    this._layersSavedHandlers.push(cb);
  }

  // Fires immediately with a snapshot of the current layers. Image encoding is
  // deferred: handlers call encodeLayerImage(entry) when they actually write, so
  // the (debounced) persistence layer decides when that cost is paid.
  _notifyLayersSaved() {
    const snapshot = this.overlayImages.map(img => ({
      id:          img.id,
      name:        img.name,
      type:        img.type     || 'image',
      textData:    img.textData ? { ...img.textData } : null,
      position:    { ...img.position },
      size:        { ...img.size },
      rotation:    img.rotation,
      aspectRatio: img.aspectRatio,
      flipH:       !!img.flipH,
      flipV:       !!img.flipV,
      image:            img.image,
      _originalDataURL: img._originalDataURL,
    }));
    this._layersSavedHandlers.forEach(cb => cb(snapshot));
  }

  /** Data URL for a layer snapshot entry from _notifyLayersSaved. */
  encodeLayerImage(entry) {
    return entry._originalDataURL ?? this._imageToDataURL(entry.image);
  }

  // A copy of a part's material for export, with or without its design. A part with a
  // design keeps it in its composite textures. Caller is responsible for disposing it.
  getExportMaterial(mesh, includeDesign) {
    if (!includeDesign) return this.getCleanMaterialForThumbnail(mesh);
    const material = mesh.material.clone();
    if (mesh === this.activeMesh && this._uvCheckActive) material.map = this._savedMaterialMap ?? null;
    return material;
  }

  // ─── Build a clean material for thumbnail rendering ───────────
  // Returns a cloned material with the channel map texture (not the composite)
  // and original PBR scalars/maps restored (not sticker-mode overrides).
  // Caller is responsible for disposing the returned material.
  getCleanMaterialForThumbnail(mesh = this.activeMesh) {
    if (!mesh?.material) return null;
    if (mesh !== this.activeMesh) {
      if (!this._partStates.has(mesh)) return mesh.material.clone();
      return this._withPartState(mesh, () => this.getCleanMaterialForThumbnail());
    }
    const m = mesh.material.clone();
    // When decals are active, liveCanvasTexture is the composite. Replace it with
    // the raw channel map (baseTexture) so the thumbnail shows no decal overlay.
    // When no decals are active, material.map is already the correct channel map.
    if (this.liveCanvasTexture) {
      m.map = this.baseTexture ?? null;
    } else if (this._uvCheckActive) {
      m.map = this._savedMaterialMap ?? null;
    }
    // Restore original PBR scalars if sticker PBR is active
    if (this._origRoughness !== null) m.roughness = this._origRoughness;
    if (this._origMetalness !== null) m.metalness = this._origMetalness;
    if (this._origTransmission !== null) m.transmission = this._origTransmission;
    // Restore original PBR maps
    if (this._origRoughnessMap    !== undefined) m.roughnessMap    = this._origRoughnessMap    ?? null;
    if (this._origMetalnessMap    !== undefined) m.metalnessMap    = this._origMetalnessMap    ?? null;
    if (this._origTransmissionMap !== undefined) m.transmissionMap = this._origTransmissionMap ?? null;
    // Restore original color (sticker mode forces white)
    if (this._origColor !== null && m.color) m.color.set(this._origColor);
    m.needsUpdate = true;
    return m;
  }
}
