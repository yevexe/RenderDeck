// UVEDITOR.JS - Design Editor (Inline Tab 2)
// No floating modal. All UI lives inside Tab 2's existing elements.

import * as THREE from 'three';
import { ModelVerifier } from '../models/ModelVerifier.js';

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
    this.baseTexture = null;
    this.overlayImages = [];
    this.nextImageId = 1;
    this.selectedImageId = null;
    this.currentMaterialPreset = 'Wood';

    this._uvCheckActive = false;
    this._savedMaterialMap = null;
    this._uvCheckerTexture = null;
    this._uvPreviewEnabled = false;
    this._partSelectCallback = null;
    this._wrapImages = true;

    // Stored material base color (captured at open/apply time for composite background)
    this._materialBaseColor = null;

    // Resize / rotate handle state
    this._lockAspectRatio = true;
    this._dragMode = 'translate'; // 'translate' | 'resize' | 'rotate'
    this._resizeStart = null;     // { origW, origH, origDiag }
    this._rotateStart = null;     // { imgRotation, mouseAngle }

    this.textureCanvas = document.createElement('canvas');
    this.textureCanvas.width = 2048;
    this.textureCanvas.height = 2048;
    this.textureCtx = this.textureCanvas.getContext('2d');

    this.uvCanvas = null;
    this.uvCtx = null;
    this._checkerCache = null; // cached checkerboard for fast preview redraws

    this.isDragging = false;
    this.dragOffset = { x: 0, y: 0 };
    this._rafPending = false;
    this.sceneState = null; // set by main.js whenever scene/bg changes

    // History hook — set by main.js; called with (label) after any committed change
    this.onCommit = null;

    // Text tool state
    this._editingTextId = null;

    // Layer drag-reorder state
    this._dragLayerId = null;

    this._setupInlineUI();
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

      // Apply / Reset / Save buttons
      const applyBtn = document.getElementById('apply-design-btn');
      if (applyBtn) applyBtn.addEventListener('click', () => this.applyTextureToModel());

      const resetBtn = document.getElementById('reset-texture-btn');
      if (resetBtn) resetBtn.addEventListener('click', () => this.resetTexture());

      const saveBtn = document.getElementById('save-custom-model-btn');
      if (saveBtn) saveBtn.addEventListener('click', () => this.saveAsCustomModel());

      const deleteBtn = document.getElementById('delete-selected-image-btn');
      if (deleteBtn) deleteBtn.addEventListener('click', () => this.deleteSelectedImage());

      // Canvas drag interactions
      this.uvCanvas.addEventListener('mousedown', (e) => this._onMouseDown(e));
      this.uvCanvas.addEventListener('mousemove', (e) => this._onMouseMove(e));
      this.uvCanvas.addEventListener('mouseup', () => {
        if (this.isDragging) {
          this._renderComposite();
          this.onCommit?.(`${this._dragMode === 'rotate' ? 'Rotated' : this._dragMode.startsWith('resize') ? 'Resized' : 'Moved'} overlay`);
        }
        this.isDragging = false; this._dragMode = 'translate';
      });
      this.uvCanvas.addEventListener('mouseleave', () => {
        if (this.isDragging) {
          this._renderComposite();
          this.onCommit?.('Moved overlay');
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
      this.uvCanvas.addEventListener('drop', (e) => {
        e.preventDefault(); e.stopPropagation();
        this.uvCanvas.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) this.handleImageUpload(file);
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
        lockAspect.addEventListener('change', e => { this._lockAspectRatio = e.target.checked; });
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
    // Commit to history when user releases the slider or commits the number input
    slider.addEventListener('change', () => this.onCommit?.(historyLabel));
    input.addEventListener('change', () => this.onCommit?.(historyLabel));
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
  async open(mesh, originalModelName, currentMaterialPreset = 'Wood') {
    // If we're already editing this same model, don't reset anything
    if (this.activeMesh === mesh && this.activeModelName === originalModelName) {
      return;
    }

    // Clean up transient state before switching mesh
    const wasCheckUVActive = this._uvCheckActive;
    this._deactivateCheckUV();
    this._uvPreviewEnabled = false;
    this._materialBaseColor = null;
    const pvBtn = document.getElementById('preview-uv-btn');
    if (pvBtn) pvBtn.classList.remove('button-selected');
    this.activeMesh = mesh;
    this.currentMaterialPreset = currentMaterialPreset;

    const existingCustom = await this.modelManager.getModel(originalModelName);
    const isCustom = existingCustom?.type === 'custom';

    if (isCustom) {
      // Loading an existing custom model - restore its overlays
      this.activeModelName = existingCustom.basedOn;
      this.customModelName = originalModelName;
      this.currentMaterialPreset = existingCustom.materialPreset || currentMaterialPreset;

      if (existingCustom.overlayImages?.length > 0) {
        this.overlayImages = [];
        this.nextImageId = 1;
        await Promise.all(existingCustom.overlayImages.map(saved => new Promise(res => {
          const img = new Image();
          img.onload = () => {
            this.overlayImages.push({
              id:          this.nextImageId++,
              image:       img,
              name:        saved.name,
              type:        saved.type     || 'image',
              textData:    saved.textData ? { ...saved.textData } : null,
              position:    { ...saved.position },
              size:        { ...saved.size },
              rotation:    saved.rotation,
              aspectRatio: saved.aspectRatio,
              flipH:       saved.flipH ?? false,
              flipV:       saved.flipV ?? false
            });
            res();
          };
          img.onerror = res;
          img.src = saved.imageData;
        })));
      }
    } else {

      this.activeModelName = originalModelName;
      this.customModelName = null; // Will be set on save
      this.overlayImages = [];
      this.nextImageId = 1;
    }

    // Custom models use null base so the composite starts from material color only.
    this.baseTexture = isCustom ? null : (mesh.material?.map || null);
    this._materialBaseColor = mesh.material?.color
      ? ('#' + mesh.material.color.getHexString())
      : '#ffffff';

    // Reset live canvas texture reference for this session
    this.liveCanvasTexture = null;

    this._updateLayersList();
    this._renderPreview();
    this.log(`Design Editor active for: ${this.customModelName || this.activeModelName}`);

    // For custom models with overlays, apply the composite immediately so the
    // designs are visible on the 3D model right after loading (correct layer order,
    // flipH/flipV, and material color as the base layer).
    if (isCustom && this.overlayImages.length > 0) {
      this._renderComposite();
      const texture = new THREE.CanvasTexture(this.textureCanvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
      this.liveCanvasTexture = texture;
      if (mesh.material) {
        mesh.material.map = texture;
        mesh.material.needsUpdate = true;
      }
      window.markNeedsRender?.(4);
    }

    // Re-apply UV checker to the new mesh if it was active on the previous part
    if (wasCheckUVActive) this._toggleCheckUV();
  }

  // ─── Keep old show() as alias for backward compat ────────────
  show(mesh, modelName, preset) {
    return this.open(mesh, modelName, preset);
  }

  // ─── Image upload ─────────────────────────────────────────────
  async handleImageUpload(file) {
    if (!file) return;
    this.log(`Validating: ${file.name}...`);
    const validation = await this.verifier.validateTextureFile(file);
    if (!validation.valid) {
      this.log(`Invalid image: ${validation.errors.join(', ')}`, true);
      alert(`Invalid image:\n${validation.errors.join('\n')}`);
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const aspectRatio = img.width / img.height;
        const imageData = {
          id: this.nextImageId++,
          image: img,
          name: file.name,
          position: { x: 50, y: 50 },
          size: { w: 30, h: 30 / aspectRatio },
          rotation: 0,
          aspectRatio,
          flipH: false,
          flipV: false
        };
        this.overlayImages.push(imageData);
        this._updateLayersList();
        this._renderPreview();
        this.log(`Image added: ${file.name} — click "Apply to Model" to apply`);

        this.selectImage(imageData.id);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
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
    this._updateLayersList();
    this._renderPreview();
    this._renderComposite();
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

    // Base texture ghost
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

    // UV wireframe overlay
    if (this._uvPreviewEnabled) this._drawUVWireframe(ctx, w, h);
  }

  // ─── High-res composite render ────────────────────────────────
  _renderComposite() {
    const ctx = this.textureCtx;
    const { width: w, height: h } = this.textureCanvas;
    ctx.clearRect(0, 0, w, h);

    // Always paint base material color first so designs keep the object's base color.
    ctx.fillStyle = this._materialBaseColor || '#ffffff';
    ctx.fillRect(0, 0, w, h);

    // Then draw source base texture if present (but never feed back live composited texture).
    if (this.baseTexture?.image && this.baseTexture !== this.liveCanvasTexture) {
      ctx.drawImage(this.baseTexture.image, 0, 0, w, h);
    }

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
        ctx.restore();
      });
    });


    if (this.liveCanvasTexture) {
      this.liveCanvasTexture.needsUpdate = true;
      window.markNeedsRender?.(4); // tell Three.js to pick up the texture upload
    }
  }


  applyTextureToModel() {
    if (!this.activeMesh) { this.log('No model loaded', true); return; }

    // Keep baseTexture as the original source map. Never replace it with live composited map.
    // If no source map cached yet, capture the current non-live map.
    if (!this.baseTexture || this.baseTexture === this.liveCanvasTexture) {
      const currentMap = this.activeMesh.material?.map || null;
      this.baseTexture = (currentMap && currentMap !== this.liveCanvasTexture) ? currentMap : null;
    }

    // Capture material base color for composite background fill (prevents black-material issue)
    if (this.activeMesh.material?.color) {
      this._materialBaseColor = '#' + this.activeMesh.material.color.getHexString();
    }

    // If no overlays, no need to create composite - just keep original
    if (this.overlayImages.length === 0) {
      this.log('No overlays to apply');
      return;
    }

    // Dispose any previously-applied live canvas texture (not the original base)
    if (this.liveCanvasTexture) {
      this.liveCanvasTexture.dispose();
      this.liveCanvasTexture = null;
    }

    // Dispose previous map if it's not the original base preset texture
    if (this.activeMesh.material?.map && this.activeMesh.material.map !== this.baseTexture) {
      this.activeMesh.material.map.dispose();
    }

    // Render the composite (draws base texture + overlays)
    this._renderComposite();

    // Create a new CanvasTexture — always sRGB so tone-mapping is correct
    const texture = new THREE.CanvasTexture(this.textureCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;

    // Copy texture parameters from base texture when available
    if (this.baseTexture) {
      // Override colorSpace only if base texture has an explicit non-empty value
      if (this.baseTexture.colorSpace) texture.colorSpace = this.baseTexture.colorSpace;
      texture.flipY = this.baseTexture.flipY;
      texture.wrapS = this.baseTexture.wrapS;
      texture.wrapT = this.baseTexture.wrapT;
      texture.magFilter = this.baseTexture.magFilter;
      texture.minFilter = this.baseTexture.minFilter;
      texture.anisotropy = this.baseTexture.anisotropy;
    }
    texture.needsUpdate = true;

    this.liveCanvasTexture = texture;

    if (this.activeMesh.material) {
      this.activeMesh.material.map = texture;
      this.activeMesh.material.needsUpdate = true;
    }

    this.log('✓ Design applied to model — drag images to reposition');
  }


  resetTexture() {
    if (!confirm('Reset all designs? This cannot be undone.')) return;
    this.overlayImages = [];
    this.selectedImageId = null;
    this._updateLayersList();
    this._renderPreview();
    this.log('Design reset');
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
    this._renderComposite();
  }

  /** Rotate selected overlay by deltaDeg degrees. */
  rotateSelected(deltaDeg) {
    const img = this.overlayImages.find(i => i.id === this.selectedImageId);
    if (!img) return;
    img.rotation = ((img.rotation + deltaDeg) % 360 + 360) % 360;
    this._syncSlidersFromImage(img);
    this._renderPreview();
    this._renderComposite();
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
    this._renderComposite();
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
      if (this.materialManager) {
        materialProperties = this.materialManager.extractProperties(this.activeMesh.material);
      } else {

        const m = this.activeMesh.material;
        materialProperties = {
          color: m.color ? '#' + m.color.getHexString() : '#ffffff',
          metalness: m.metalness ?? 0,
          roughness: m.roughness ?? 0.5,
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
    }

    const serializedImages = await Promise.all(this.overlayImages.map(async img => {
      const c = document.createElement('canvas');
      c.width = img.image.width; c.height = img.image.height;
      c.getContext('2d').drawImage(img.image, 0, 0);
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
        imageData:   c.toDataURL('image/png')
      };
    }));

    await this.modelManager.saveCustomModel(this.customModelName, {
      basedOn: this.activeModelName,
      customName: this.customModelName,
      overlayImages: serializedImages,
      materialProperties,
      materialPreset: this.currentMaterialPreset,
      sceneState: this.sceneState || null,
    });

    this._renderComposite();
    const texture = new THREE.CanvasTexture(this.textureCanvas);
    
    texture.colorSpace = THREE.SRGBColorSpace;
    
    if (this.baseTexture) {
      texture.flipY = this.baseTexture.flipY;
      texture.wrapS = this.baseTexture.wrapS;
      texture.wrapT = this.baseTexture.wrapT;
      texture.magFilter = this.baseTexture.magFilter;
      texture.minFilter = this.baseTexture.minFilter;
      texture.anisotropy = this.baseTexture.anisotropy;
    }
    texture.needsUpdate = true;
    if (this.activeMesh?.material) {
      if (this.activeMesh.material.map && this.activeMesh.material.map !== this.baseTexture) {
        this.activeMesh.material.map.dispose();
      }
      this.activeMesh.material.map = texture;
      this.activeMesh.material.needsUpdate = true;
    }

    this.log(`✓ Saved: ${this.customModelName}`);
    window.updateModelSelect?.();
    window.switchToModel?.(this.customModelName);
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
      const centers = this._getWrapCenters(img);
      for (const center of centers) {
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
        // Only run the expensive 2048×2048 composite during drag if the texture
        // is already live on the model (user clicked Apply) — gives live model preview.
        // Before Apply, composite runs cheaply on mouseup instead.
        if (this.liveCanvasTexture) this._renderComposite();
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
    if (!content.trim()) { alert('Please enter some text.'); return; }

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
    const { content, fontFamily, fontSize, color, bold, italic } = textData;
    const weight = bold   ? 'bold'   : 'normal';
    const style  = italic ? 'italic' : 'normal';
    const scale  = 3; // 3× oversample for crisp texture quality
    const scaledSize = fontSize * scale;
    const fontStr = `${style} ${weight} ${scaledSize}px "${fontFamily}"`;

    // Ensure the font is available before drawing
    try { await document.fonts.load(fontStr); } catch (_) { /* fallback to whatever is cached */ }

    const lines      = content.split('\n');
    const lineHeight = scaledSize * 1.25;
    const padH       = scaledSize * 0.4;
    const padV       = scaledSize * 0.3;

    // Measure maximum line width
    const mCvs = document.createElement('canvas');
    mCvs.width = 4; mCvs.height = 4;
    const mCtx = mCvs.getContext('2d');
    mCtx.font = fontStr;
    let maxW = 0;
    for (const line of lines) {
      const w = mCtx.measureText(line || ' ').width;
      if (w > maxW) maxW = w;
    }

    const cvs = document.createElement('canvas');
    cvs.width  = Math.max(Math.ceil(maxW + padH * 2), 4);
    cvs.height = Math.max(Math.ceil(lineHeight * lines.length + padV * 2), 4);

    const ctx = cvs.getContext('2d');
    ctx.font         = fontStr;
    ctx.fillStyle    = color;
    ctx.textBaseline = 'top';
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], padH, padV + i * lineHeight);
    }

    const dataUrl = cvs.toDataURL('image/png');
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve({ image: img, aspectRatio: cvs.width / cvs.height });
      img.src = dataUrl;
    });
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
      this.selectImage(entry.id);
      this.log('Text layer added — drag to position, click layer to edit');
      this.onCommit?.('Added text layer');
    }

    this._updateLayersList();
    this._renderPreview();
    this._renderComposite();
  }

  // ─── Deactivate Check UV (internal helper) ────────────────────
  _deactivateCheckUV() {
    if (!this._uvCheckActive) return;
    if (this._uvCheckerTexture) {
      this._uvCheckerTexture.dispose();
      this._uvCheckerTexture = null;
    }
    if (this.activeMesh?.material) {
      this.activeMesh.material.map = this._savedMaterialMap;
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
      this._savedMaterialMap = this.activeMesh.material.map;
      const loader = new THREE.TextureLoader();
      loader.load('./assets/standard/images/maps/UVChecker.png', (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.flipY = this._savedMaterialMap?.flipY ?? false;
        this._uvCheckerTexture = texture;
        this.activeMesh.material.map = texture;
        this.activeMesh.material.needsUpdate = true;
        this._uvCheckActive = true;
        if (btn) btn.classList.add('button-selected');
        this.log('Check UV: on');
      }, undefined, () => this.log('Check UV: failed to load UVChecker.png'));
    } else {
      this._deactivateCheckUV();
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
  _drawUVWireframe(ctx, w, h) {
    if (!this.activeMesh?.geometry) return;
    const geo = this.activeMesh.geometry;
    const uvAttr = geo.attributes.uv;
    if (!uvAttr) return;

    const uvs = uvAttr.array;
    const index = geo.index;

    ctx.save();
    ctx.strokeStyle = 'rgba(120, 210, 255, 0.65)';
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';

    const drawTri = (i0, i1, i2) => {
      // UV V axis is flipped relative to canvas Y (UV 0=bottom, canvas 0=top)
      ctx.beginPath();
      ctx.moveTo(uvs[i0 * 2] * w,       (1 - uvs[i0 * 2 + 1]) * h);
      ctx.lineTo(uvs[i1 * 2] * w,       (1 - uvs[i1 * 2 + 1]) * h);
      ctx.lineTo(uvs[i2 * 2] * w,       (1 - uvs[i2 * 2 + 1]) * h);
      ctx.closePath();
      ctx.stroke();
    };

    if (index) {
      const idx = index.array;
      for (let i = 0; i < idx.length; i += 3) drawTri(idx[i], idx[i + 1], idx[i + 2]);
    } else {
      for (let i = 0; i < uvAttr.count; i += 3) drawTri(i, i + 1, i + 2);
    }

    ctx.restore();
  }

  // ─── History restore (called by main.js on undo/redo) ────────
  // state = { overlayImages, selectedImageId } — no re-encoding, uses live image refs
  restoreHistoryState(state) {
    if (!state) return;
    this.overlayImages = state.overlayImages.map(s => ({
      ...s,
      position: { ...s.position },
      size:     { ...s.size },
      textData: s.textData ? { ...s.textData } : null,
    }));
    this.selectedImageId = state.selectedImageId ?? null;
    this._updateLayersList();
    const sel = this.overlayImages.find(i => i.id === this.selectedImageId);
    if (sel) this._syncSlidersFromImage(sel);
    this._renderPreview();
    this._renderComposite();
  }

  // ─── Snapshot the current overlay state for history ──────────
  // Returns a plain object — no dataURL encoding, keeps HTMLImageElement refs.
  snapshotOverlays() {
    return {
      overlayImages: this.overlayImages.map(img => ({
        id:          img.id,
        name:        img.name,
        type:        img.type     || 'image',
        textData:    img.textData ? { ...img.textData } : null,
        position:    { ...img.position },
        size:        { ...img.size },
        rotation:    img.rotation,
        aspectRatio: img.aspectRatio,
        flipH:       img.flipH,
        flipV:       img.flipV,
        image:       img.image, // live HTMLImageElement — no re-encoding needed
      })),
      selectedImageId: this.selectedImageId,
    };
  }

  // --- Session persistence helpers (used by main.js autosave) ---

  _imageToDataURL(img) {
    if (!img) return null;
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const cx = c.getContext('2d');
    cx.drawImage(img, 0, 0);
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
        imageData:   this._imageToDataURL(img.image),
      })),
    };
  }

  async restoreSessionState(state) {
    if (!state) return;

    this._wrapImages = state.wrapImages !== undefined ? !!state.wrapImages : this._wrapImages;
    this._lockAspectRatio = state.lockAspectRatio !== undefined ? !!state.lockAspectRatio : this._lockAspectRatio;
    this._materialBaseColor = state.materialBaseColor || this._materialBaseColor;
    this.nextImageId = Number.isFinite(state.nextImageId) ? state.nextImageId : this.nextImageId;

    const loaded = [];
    const overlays = Array.isArray(state.overlayImages) ? state.overlayImages : [];
    await Promise.all(overlays.map(saved => new Promise((resolve) => {
      if (!saved?.imageData) { resolve(); return; }
      const img = new Image();
      img.onload = () => {
        loaded.push({
          id:          Number.isFinite(saved.id) ? saved.id : this.nextImageId++,
          image:       img,
          name:        saved.name || 'Design',
          type:        saved.type     || 'image',
          textData:    saved.textData ? { ...saved.textData } : null,
          position:    saved.position ? { ...saved.position } : { x: 50, y: 50 },
          size:        saved.size     ? { ...saved.size }     : { w: 30, h: 30 },
          rotation:    Number.isFinite(saved.rotation) ? saved.rotation : 0,
          aspectRatio: saved.aspectRatio || (img.width / img.height),
          flipH:       !!saved.flipH,
          flipV:       !!saved.flipV,
        });
        resolve();
      };
      img.onerror = () => resolve();
      img.src = saved.imageData;
    })));

    this.overlayImages = loaded;
    this.selectedImageId = loaded.some(i => i.id === state.selectedImageId)
      ? state.selectedImageId
      : (loaded[0]?.id ?? null);

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
    this._renderComposite();
    if (this.overlayImages.length > 0) this.applyTextureToModel();
  }
}


