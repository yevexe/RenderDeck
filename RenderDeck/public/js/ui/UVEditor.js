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

    this.textureCanvas = document.createElement('canvas');
    this.textureCanvas.width = 2048;
    this.textureCanvas.height = 2048;
    this.textureCtx = this.textureCanvas.getContext('2d');

    this.uvCanvas = null;
    this.uvCtx = null;

    this.isDragging = false;
    this.dragOffset = { x: 0, y: 0 };

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
      this.uvCanvas.addEventListener('mouseup', () => { this.isDragging = false; });
      this.uvCanvas.addEventListener('mouseleave', () => { this.isDragging = false; });

      // Transformation sliders (Tab 2 IDs)
      this._linkSlider('design-posx-slider', 'design-posx-input', v => this._setSelected('posX', v));
      this._linkSlider('design-posy-slider', 'design-posy-input', v => this._setSelected('posY', v));
      this._linkSlider('design-width-slider', 'design-width-input', v => this._setSelected('width', v));
      this._linkSlider('design-height-slider', 'design-height-input', v => this._setSelected('height', v));
      this._linkSlider('design-rotation-slider', 'design-rotation-input', v => this._setSelected('rotation', v));
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }

  // ─── Slider ↔ number input sync ──────────────────────────────
  _linkSlider(sliderId, inputId, callback) {
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
  }

  // ─── Apply transformation to selected image ───────────────────
  _setSelected(prop, value) {
    const img = this.overlayImages.find(i => i.id === this.selectedImageId);
    if (!img) return;
    // Tab 2 sliders use -1 to 1 for position, 0.01-2 for size, 0-360 for rotation
    // UVEditor internally uses 0-100 % space
    switch (prop) {
      case 'posX': img.position.x = (value + 1) / 2 * 100; break;
      case 'posY': img.position.y = (value + 1) / 2 * 100; break;
      case 'width': img.size.w = value * 50; break;   // 0.01-2 → 0.5-100%
      case 'height': img.size.h = value * 50; break;
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
              id: this.nextImageId++,
              image: img,
              name: saved.name,
              position: { ...saved.position },
              size: { ...saved.size },
              rotation: saved.rotation,
              aspectRatio: saved.aspectRatio
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

    if (mesh.material?.map) this.baseTexture = mesh.material.map;

    // Reset live canvas texture reference for this session
    this.liveCanvasTexture = null;

    this._updateLayersList();
    this._renderPreview();
    this.log(`Design Editor active for: ${this.customModelName || this.activeModelName}`);
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
          aspectRatio
        };
        this.overlayImages.push(imageData);
        this._updateLayersList();
        this._renderPreview();
        this._renderComposite();
        this.log(`Image added: ${file.name}`);

        // Auto-select the new image
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

      // Thumbnail
      const thumb = document.createElement('canvas');
      thumb.width = 30; thumb.height = 30;
      thumb.style.cssText = 'width:30px;height:30px;border:1px solid #555;border-radius:2px;margin-right:8px;flex-shrink:0;';
      const tCtx = thumb.getContext('2d');
      tCtx.drawImage(img.image, 0, 0, 30, 30);

      const name = document.createElement('span');
      name.className = 'image-layer-name';
      name.textContent = `${i + 1}. ${img.name}`;

      const del = document.createElement('button');
      del.textContent = '✕';
      del.className = 'button-medium';
      del.style.marginLeft = 'auto';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectedImageId = img.id;
        this.deleteSelectedImage();
      });

      item.appendChild(thumb);
      item.appendChild(name);
      item.appendChild(del);
      item.addEventListener('click', () => this.selectImage(img.id));
      list.appendChild(item);
    });
  }

  // ─── UV Preview render ────────────────────────────────────────
  _renderPreview() {
    if (!this.uvCanvas || !this.uvCtx) return;
    const ctx = this.uvCtx;
    const { width: w, height: h } = this.uvCanvas;

    ctx.clearRect(0, 0, w, h);

    // Checkerboard background
    const sq = 32;
    for (let row = 0; row < h / sq; row++) {
      for (let col = 0; col < w / sq; col++) {
        ctx.fillStyle = (row + col) % 2 === 0 ? '#2a2a2a' : '#333';
        ctx.fillRect(col * sq, row * sq, sq, sq);
      }
    }

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
    this.overlayImages.forEach(img => {
      const x = (img.position.x / 100) * w;
      const y = (img.position.y / 100) * h;
      const iw = (img.size.w / 100) * w;
      const ih = (img.size.h / 100) * h;

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((img.rotation * Math.PI) / 180);
      ctx.drawImage(img.image, -iw / 2, -ih / 2, iw, ih);

      if (img.id === this.selectedImageId) {
        ctx.strokeStyle = '#4CAF50';
        ctx.lineWidth = 2;
        ctx.strokeRect(-iw / 2, -ih / 2, iw, ih);
        // Corner handles
        ctx.fillStyle = '#4CAF50';
        const hs = 7;
        [[-iw/2, -ih/2], [iw/2, -ih/2], [-iw/2, ih/2], [iw/2, ih/2]].forEach(([cx, cy]) => {
          ctx.fillRect(cx - hs / 2, cy - hs / 2, hs, hs);
        });
      }
      ctx.restore();
    });
  }

  // ─── High-res composite render ────────────────────────────────
  _renderComposite() {
    const ctx = this.textureCtx;
    const { width: w, height: h } = this.textureCanvas;
    ctx.clearRect(0, 0, w, h);

    if (this.baseTexture?.image) {
      ctx.drawImage(this.baseTexture.image, 0, 0, w, h);
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
    }

    this.overlayImages.forEach(img => {
      const x = (img.position.x / 100) * w;
      const y = (img.position.y / 100) * h;
      const iw = (img.size.w / 100) * w;
      const ih = (img.size.h / 100) * h;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((img.rotation * Math.PI) / 180);
      ctx.drawImage(img.image, -iw / 2, -ih / 2, iw, ih);
      ctx.restore();
    });


    if (this.liveCanvasTexture) {
      this.liveCanvasTexture.needsUpdate = true;
    }
  }


  applyTextureToModel() {
    if (!this.activeMesh) { this.log('No model loaded', true); return; }

    // Make sure we have the base texture from the current material
    if (!this.baseTexture && this.activeMesh.material?.map) {
      this.baseTexture = this.activeMesh.material.map;
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

    // Create a new CanvasTexture
    const texture = new THREE.CanvasTexture(this.textureCanvas);
    
    // Copy encoding/colorSpace from base texture to match exactly
    if (this.baseTexture) {
      if (this.baseTexture.colorSpace !== undefined) {
        texture.colorSpace = this.baseTexture.colorSpace;
      }
      if (this.baseTexture.encoding !== undefined) {
        texture.encoding = this.baseTexture.encoding;
      }
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
        name: img.name,
        position: { ...img.position },
        size: { ...img.size },
        rotation: img.rotation,
        aspectRatio: img.aspectRatio,
        imageData: c.toDataURL('image/png')
      };
    }));

    await this.modelManager.saveCustomModel(this.customModelName, {
      basedOn: this.activeModelName,
      customName: this.customModelName,
      overlayImages: serializedImages,
      materialProperties,
      materialPreset: this.currentMaterialPreset
    });

    this._renderComposite();
    const texture = new THREE.CanvasTexture(this.textureCanvas);
    
    if (THREE.SRGBColorSpace) {
      texture.colorSpace = THREE.SRGBColorSpace;
    }
    if (THREE.sRGBEncoding) {
      texture.encoding = THREE.sRGBEncoding;
    }
    
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

  _onMouseDown(e) {
    if (!this.uvCanvas) return;
    const rect = this.uvCanvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    for (let i = this.overlayImages.length - 1; i >= 0; i--) {
      const img = this.overlayImages[i];
      const hw = img.size.w / 2, hh = img.size.h / 2;
      if (x >= img.position.x - hw && x <= img.position.x + hw &&
          y >= img.position.y - hh && y <= img.position.y + hh) {
        this.selectImage(img.id);
        this.isDragging = true;
        this.dragOffset = { x: x - img.position.x, y: y - img.position.y };
        break;
      }
    }
  }

  _onMouseMove(e) {
    if (!this.isDragging || !this.selectedImageId || !this.uvCanvas) return;
    const rect = this.uvCanvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    const img = this.overlayImages.find(i => i.id === this.selectedImageId);
    if (img) {
      img.position.x = Math.max(0, Math.min(100, x - this.dragOffset.x));
      img.position.y = Math.max(0, Math.min(100, y - this.dragOffset.y));
      this._syncSlidersFromImage(img);
      this._renderPreview();
      this._renderComposite();
    }
  }
}