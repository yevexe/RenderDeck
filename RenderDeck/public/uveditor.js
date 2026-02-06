// ═══════════════════════════════════════════════════════════════
// UVEDITOR.JS - UV Map Editor for RenderDeck
// Allows users to upload and position images on 3D model textures
// ═══════════════════════════════════════════════════════════════

import * as THREE from 'three';
import { ModelVerifier } from './verifier.js';

export class UVEditor {
  constructor(renderer, log, modelManager) {
    this.renderer = renderer;
    this.log = log;
    this.modelManager = modelManager;
    this.verifier = new ModelVerifier();
    
    // Current state
    this.activeMesh = null;
    this.activeModelName = null;
    this.customModelName = null;
    this.baseTexture = null;
    this.overlayImages = []; // Array of { image: Image, position: {x, y}, size: {w, h}, rotation: number, id: number, aspectRatio: number }
    this.nextImageId = 1;
    this.selectedImageId = null;
    
    // Canvas for compositing
    this.textureCanvas = null;
    this.textureCtx = null;
    this.textureSize = 2048; // Default texture resolution
    
    // UV preview canvas
    this.uvCanvas = null;
    this.uvCtx = null;
    
    // Interaction state
    this.isDragging = false;
    this.isResizing = false;
    this.dragStart = { x: 0, y: 0 };
    this.dragOffset = { x: 0, y: 0 };
    
    // Window dragging
    this.isWindowDragging = false;
    this.windowDragStart = { x: 0, y: 0 };
    this.windowPosition = { x: 0, y: 0 };
    
    // Window resizing
    this.isWindowResizing = false;
    this.resizeDragStart = { x: 0, y: 0 };
    
    // Load saved window size or use defaults
    const savedSize = localStorage.getItem('uvEditorWindowSize');
    if (savedSize) {
      this.windowSize = JSON.parse(savedSize);
    } else {
      this.windowSize = { width: 1200, height: 700 };
    }
    
    this.setupUI();
  }

  // ─────────────────────────────────────────────
  // Setup UI Elements
  // ─────────────────────────────────────────────
  setupUI() {
    // Create UV editor container
    const editorContainer = document.createElement('div');
    editorContainer.id = 'uv-editor';
    editorContainer.className = 'uv-editor-container hidden';
    editorContainer.innerHTML = `
      <div class="uv-editor-header">
        <h2>Texture Editor <span class="model-name-display"></span></h2>
        <button class="close-editor-btn">✕</button>
      </div>
      
      <div class="uv-editor-content">
        <!-- UV Canvas Preview -->
        <div class="uv-canvas-container">
          <canvas id="uv-preview-canvas" width="512" height="512"></canvas>
          <div class="uv-controls">
            <p class="uv-hint">UV Map Preview - Drag images to position</p>
          </div>
        </div>
        
        <!-- Image Upload and Controls -->
        <div class="uv-sidebar">
          <div class="upload-section">
            <h3>Add Image</h3>
            <label for="texture-image-upload" class="texture-upload-button">
              📷 Upload Image
            </label>
            <input type="file" id="texture-image-upload" accept=".png,.jpg,.jpeg,.svg" style="display: none;">
            <p class="upload-hint">PNG, JPG, or SVG</p>
          </div>
          
          <div class="images-list">
            <h3>Images on Model</h3>
            <div id="image-layers-list"></div>
          </div>
          
          <div class="selected-image-controls hidden">
            <h3>Selected Image</h3>
            <div class="control-group">
              <label>Position X:</label>
              <input type="range" id="img-pos-x" min="0" max="100" value="50" step="0.1">
              <span class="control-value">50%</span>
            </div>
            <div class="control-group">
              <label>Position Y:</label>
              <input type="range" id="img-pos-y" min="0" max="100" value="50" step="0.1">
              <span class="control-value">50%</span>
            </div>
            <div class="control-group">
              <label>Width:</label>
              <input type="range" id="img-width" min="5" max="100" value="30" step="0.1">
              <span class="control-value">30%</span>
            </div>
            <div class="control-group">
              <label>Height:</label>
              <input type="range" id="img-height" min="5" max="100" value="30" step="0.1">
              <span class="control-value">30%</span>
            </div>
            <div class="control-group">
              <label>Rotation:</label>
              <input type="range" id="img-rotation" min="0" max="360" value="0" step="1">
              <span class="control-value">0°</span>
            </div>
            <button class="delete-image-btn">🗑️ Delete Image</button>
          </div>
          
          <div class="editor-actions">
            <button class="save-custom-model-btn">💾 Save as Custom Model</button>
            <button class="apply-texture-btn">✓ Apply to Model</button>
            <button class="reset-texture-btn">↺ Reset</button>
          </div>
        </div>
      </div>
      
      <div class="resize-handle"></div>
    `;
    
    document.body.appendChild(editorContainer);
    
    // Get canvas references
    this.uvCanvas = document.getElementById('uv-preview-canvas');
    this.uvCtx = this.uvCanvas.getContext('2d');
    
    // Create texture compositing canvas (higher resolution)
    this.textureCanvas = document.createElement('canvas');
    this.textureCanvas.width = this.textureSize;
    this.textureCanvas.height = this.textureSize;
    this.textureCtx = this.textureCanvas.getContext('2d');
    
    this.attachEventListeners();
  }

  // ─────────────────────────────────────────────
  // Attach Event Listeners
  // ─────────────────────────────────────────────
  attachEventListeners() {
    const container = document.getElementById('uv-editor');
    const header = document.querySelector('.uv-editor-header');
    const resizeHandle = document.querySelector('.resize-handle');
    
    // Window dragging
    header.addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('close-editor-btn')) return;
      this.isWindowDragging = true;
      this.windowDragStart = { x: e.clientX - this.windowPosition.x, y: e.clientY - this.windowPosition.y };
      container.style.cursor = 'move';
    });
    
    document.addEventListener('mousemove', (e) => {
      if (this.isWindowDragging) {
        this.windowPosition.x = e.clientX - this.windowDragStart.x;
        this.windowPosition.y = e.clientY - this.windowDragStart.y;
        container.style.transform = `translate(calc(-50% + ${this.windowPosition.x}px), calc(-50% + ${this.windowPosition.y}px))`;
      }
      
      if (this.isWindowResizing) {
        const deltaX = e.clientX - this.resizeDragStart.x;
        const deltaY = e.clientY - this.resizeDragStart.y;
        
        this.windowSize.width = Math.max(800, this.windowSize.width + deltaX);
        this.windowSize.height = Math.max(500, this.windowSize.height + deltaY);
        
        container.style.width = `${this.windowSize.width}px`;
        container.style.height = `${this.windowSize.height}px`;
        
        this.resizeDragStart = { x: e.clientX, y: e.clientY };
        
        // Save window size to localStorage
        localStorage.setItem('uvEditorWindowSize', JSON.stringify(this.windowSize));
      }
    });
    
    document.addEventListener('mouseup', () => {
      this.isWindowDragging = false;
      this.isWindowResizing = false;
      container.style.cursor = 'default';
    });
    
    // Window resizing
    resizeHandle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      this.isWindowResizing = true;
      this.resizeDragStart = { x: e.clientX, y: e.clientY };
    });
    
    // Close button
    document.querySelector('.close-editor-btn').addEventListener('click', () => {
      this.hide();
    });
    
    // Image upload
    document.getElementById('texture-image-upload').addEventListener('change', (e) => {
      this.handleImageUpload(e.target.files[0]);
    });
    
    // UV Canvas interactions
    this.uvCanvas.addEventListener('mousedown', (e) => this.handleCanvasMouseDown(e));
    this.uvCanvas.addEventListener('mousemove', (e) => this.handleCanvasMouseMove(e));
    this.uvCanvas.addEventListener('mouseup', (e) => this.handleCanvasMouseUp(e));
    this.uvCanvas.addEventListener('mouseleave', (e) => this.handleCanvasMouseUp(e));
    
    // Slider controls
    const sliders = ['img-pos-x', 'img-pos-y', 'img-width', 'img-height', 'img-rotation'];
    sliders.forEach(id => {
      const slider = document.getElementById(id);
      if (slider) {
        slider.addEventListener('input', (e) => this.handleSliderChange(id, e.target.value));
      }
    });
    
    // Action buttons
    document.querySelector('.save-custom-model-btn').addEventListener('click', () => {
      this.saveAsCustomModel();
    });
    
    document.querySelector('.apply-texture-btn').addEventListener('click', () => {
      this.applyTextureToModel();
    });
    
    document.querySelector('.reset-texture-btn').addEventListener('click', () => {
      this.resetTexture();
    });
    
    document.querySelector('.delete-image-btn').addEventListener('click', () => {
      this.deleteSelectedImage();
    });
  }

  // ─────────────────────────────────────────────
  // Show Editor with Model Naming
  // ─────────────────────────────────────────────
  async show(mesh, originalModelName) {
    // Prompt for custom model name
    const defaultName = `${originalModelName} (Custom)`;
    const customName = prompt(`Enter a name for your custom model:`, defaultName);
    
    if (!customName) {
      this.log('Custom model creation cancelled');
      return;
    }
    
    this.activeMesh = mesh;
    this.activeModelName = originalModelName;
    this.customModelName = customName;
    
    const container = document.getElementById('uv-editor');
    container.classList.remove('hidden');
    
    // Update header with model name
    document.querySelector('.model-name-display').textContent = `- ${customName}`;
    
    // Extract current texture if exists
    if (mesh.material && mesh.material.map) {
      this.baseTexture = mesh.material.map;
    }
    
    // Reset position and size
    this.windowPosition = { x: 0, y: 0 };
    this.windowSize = { width: 1200, height: 700 };
    container.style.transform = 'translate(-50%, -50%)';
    container.style.width = `${this.windowSize.width}px`;
    container.style.height = `${this.windowSize.height}px`;
    
    this.renderUVPreview();
    this.log(`UV Editor opened for: ${customName}`);
  }

  hide() {
    document.getElementById('uv-editor').classList.add('hidden');
    this.log('UV Editor closed');
  }

  // ─────────────────────────────────────────────
  // Save as Custom Model
  // ─────────────────────────────────────────────
  saveAsCustomModel() {
    if (!this.customModelName) {
      this.log('No custom model name set', true);
      return;
    }
    
    // Apply texture first
    this.renderCompositeTexture();
    const texture = new THREE.CanvasTexture(this.textureCanvas);
    texture.needsUpdate = true;
    
    // Save the custom model data
    const customModelData = {
      basedOn: this.activeModelName,
      customName: this.customModelName,
      texture: texture,
      textureCanvas: this.textureCanvas.toDataURL('image/png'),
      overlayImages: this.overlayImages.map(img => ({
        name: img.name,
        position: { ...img.position },
        size: { ...img.size },
        rotation: img.rotation,
        aspectRatio: img.aspectRatio
      }))
    };
    
    // Store in modelManager
    this.modelManager.saveCustomModel(this.customModelName, customModelData);
    
    // Apply to current mesh
    if (this.activeMesh.material) {
      if (this.activeMesh.material.map && this.activeMesh.material.map !== this.baseTexture) {
        this.activeMesh.material.map.dispose();
      }
      this.activeMesh.material.map = texture;
      this.activeMesh.material.needsUpdate = true;
    }
    
    this.log(`✓ Custom model saved: ${this.customModelName}`);
    
    // Trigger model list update in main
    if (window.updateModelSelect) {
      window.updateModelSelect();
    }
    
    // Switch to the new custom model in the dropdown
    if (window.switchToModel) {
      window.switchToModel(this.customModelName);
    }
    
    // Close the editor
    this.hide();
  }

  // ─────────────────────────────────────────────
  // Handle Image Upload
  // ─────────────────────────────────────────────
  async handleImageUpload(file) {
    if (!file) return;
    
    this.log(`Validating image: ${file.name}...`);
    
    // Verify the file
    const validation = await this.verifier.validateTextureFile(file);
    
    if (!validation.valid) {
      this.log(`Image validation failed: ${validation.errors.join(', ')}`, true);
      alert(`Invalid image file:\n${validation.errors.join('\n')}`);
      return;
    }
    
    // Load the image
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        // Calculate aspect ratio
        const aspectRatio = img.width / img.height;
        
        // Add image to overlay list
        const imageData = {
          id: this.nextImageId++,
          image: img,
          name: file.name,
          position: { x: 50, y: 50 }, // Center (percentage)
          size: { w: 30, h: 30 / aspectRatio },  // Maintain aspect ratio
          rotation: 0,
          aspectRatio: aspectRatio
        };
        
        this.overlayImages.push(imageData);
        this.updateImagesList();
        this.renderUVPreview();
        this.renderCompositeTexture();
        
        this.log(`Image added: ${file.name}`);
      };
      img.onerror = () => {
        this.log(`Failed to load image: ${file.name}`, true);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
    
    // Clear the input
    document.getElementById('texture-image-upload').value = '';
  }

  // ─────────────────────────────────────────────
  // Update Images List UI
  // ─────────────────────────────────────────────
  updateImagesList() {
    const listContainer = document.getElementById('image-layers-list');
    listContainer.innerHTML = '';
    
    if (this.overlayImages.length === 0) {
      listContainer.innerHTML = '<p class="empty-message">No images added yet</p>';
      return;
    }
    
    this.overlayImages.forEach((imgData, index) => {
      const item = document.createElement('div');
      item.className = 'image-layer-item';
      if (imgData.id === this.selectedImageId) {
        item.classList.add('selected');
      }
      
      item.innerHTML = `
        <span class="layer-number">${index + 1}</span>
        <span class="layer-name">${imgData.name}</span>
      `;
      
      item.addEventListener('click', () => {
        this.selectImage(imgData.id);
      });
      
      listContainer.appendChild(item);
    });
  }

  // ─────────────────────────────────────────────
  // Select an Image
  // ─────────────────────────────────────────────
  selectImage(id) {
    this.selectedImageId = id;
    const imgData = this.overlayImages.find(img => img.id === id);
    
    if (imgData) {
      // Update controls
      document.getElementById('img-pos-x').value = imgData.position.x;
      document.getElementById('img-pos-y').value = imgData.position.y;
      document.getElementById('img-width').value = imgData.size.w;
      document.getElementById('img-height').value = imgData.size.h;
      document.getElementById('img-rotation').value = imgData.rotation;
      
      // Update value displays
      document.querySelectorAll('.selected-image-controls .control-value')[0].textContent = `${imgData.position.x.toFixed(1)}%`;
      document.querySelectorAll('.selected-image-controls .control-value')[1].textContent = `${imgData.position.y.toFixed(1)}%`;
      document.querySelectorAll('.selected-image-controls .control-value')[2].textContent = `${imgData.size.w.toFixed(1)}%`;
      document.querySelectorAll('.selected-image-controls .control-value')[3].textContent = `${imgData.size.h.toFixed(1)}%`;
      document.querySelectorAll('.selected-image-controls .control-value')[4].textContent = `${imgData.rotation}°`;
      
      // Show controls
      document.querySelector('.selected-image-controls').classList.remove('hidden');
    }
    
    this.updateImagesList();
    this.renderUVPreview();
  }

  // ─────────────────────────────────────────────
  // Handle Slider Changes
  // ─────────────────────────────────────────────
  handleSliderChange(sliderId, value) {
    if (!this.selectedImageId) return;
    
    const imgData = this.overlayImages.find(img => img.id === this.selectedImageId);
    if (!imgData) return;
    
    const numValue = parseFloat(value);
    
    switch(sliderId) {
      case 'img-pos-x':
        imgData.position.x = numValue;
        document.querySelectorAll('.selected-image-controls .control-value')[0].textContent = `${numValue.toFixed(1)}%`;
        break;
      case 'img-pos-y':
        imgData.position.y = numValue;
        document.querySelectorAll('.selected-image-controls .control-value')[1].textContent = `${numValue.toFixed(1)}%`;
        break;
      case 'img-width':
        imgData.size.w = numValue;
        document.querySelectorAll('.selected-image-controls .control-value')[2].textContent = `${numValue.toFixed(1)}%`;
        break;
      case 'img-height':
        imgData.size.h = numValue;
        document.querySelectorAll('.selected-image-controls .control-value')[3].textContent = `${numValue.toFixed(1)}%`;
        break;
      case 'img-rotation':
        imgData.rotation = numValue;
        document.querySelectorAll('.selected-image-controls .control-value')[4].textContent = `${numValue}°`;
        break;
    }
    
    this.renderUVPreview();
    this.renderCompositeTexture();
  }

  // ─────────────────────────────────────────────
  // Canvas Mouse Interactions
  // ─────────────────────────────────────────────
  handleCanvasMouseDown(e) {
    const rect = this.uvCanvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    
    // Check if clicking on an image
    for (let i = this.overlayImages.length - 1; i >= 0; i--) {
      const img = this.overlayImages[i];
      if (this.isPointInImage(x, y, img)) {
        this.selectImage(img.id);
        this.isDragging = true;
        this.dragStart = { x, y };
        this.dragOffset = {
          x: x - img.position.x,
          y: y - img.position.y
        };
        break;
      }
    }
  }

  handleCanvasMouseMove(e) {
    if (!this.isDragging || !this.selectedImageId) return;
    
    const rect = this.uvCanvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    
    const imgData = this.overlayImages.find(img => img.id === this.selectedImageId);
    if (imgData) {
      imgData.position.x = Math.max(0, Math.min(100, x - this.dragOffset.x));
      imgData.position.y = Math.max(0, Math.min(100, y - this.dragOffset.y));
      
      // Update sliders
      document.getElementById('img-pos-x').value = imgData.position.x;
      document.getElementById('img-pos-y').value = imgData.position.y;
      document.querySelectorAll('.selected-image-controls .control-value')[0].textContent = `${imgData.position.x.toFixed(1)}%`;
      document.querySelectorAll('.selected-image-controls .control-value')[1].textContent = `${imgData.position.y.toFixed(1)}%`;
      
      this.renderUVPreview();
      this.renderCompositeTexture();
    }
  }

  handleCanvasMouseUp(e) {
    this.isDragging = false;
  }

  // ─────────────────────────────────────────────
  // Check if point is inside image bounds
  // ─────────────────────────────────────────────
  isPointInImage(x, y, imgData) {
    const halfW = imgData.size.w / 2;
    const halfH = imgData.size.h / 2;
    
    return x >= imgData.position.x - halfW &&
           x <= imgData.position.x + halfW &&
           y >= imgData.position.y - halfH &&
           y <= imgData.position.y + halfH;
  }

  // ─────────────────────────────────────────────
  // Render UV Preview
  // ─────────────────────────────────────────────
  renderUVPreview() {
    const ctx = this.uvCtx;
    const canvas = this.uvCanvas;
    
    // Clear canvas
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw grid
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 10; i++) {
      const pos = (i / 10) * canvas.width;
      ctx.beginPath();
      ctx.moveTo(pos, 0);
      ctx.lineTo(pos, canvas.height);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, pos);
      ctx.lineTo(canvas.width, pos);
      ctx.stroke();
    }
    
    // Draw base texture if exists
    if (this.baseTexture && this.baseTexture.image) {
      ctx.globalAlpha = 0.3;
      ctx.drawImage(this.baseTexture.image, 0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 1.0;
    }
    
    // Draw overlay images
    this.overlayImages.forEach(imgData => {
      const x = (imgData.position.x / 100) * canvas.width;
      const y = (imgData.position.y / 100) * canvas.height;
      const w = (imgData.size.w / 100) * canvas.width;
      const h = (imgData.size.h / 100) * canvas.height;
      
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((imgData.rotation * Math.PI) / 180);
      
      // Draw image
      ctx.drawImage(imgData.image, -w/2, -h/2, w, h);
      
      // Draw selection border if selected
      if (imgData.id === this.selectedImageId) {
        ctx.strokeStyle = '#4CAF50';
        ctx.lineWidth = 2;
        ctx.strokeRect(-w/2, -h/2, w, h);
        
        // Draw corner handles
        ctx.fillStyle = '#4CAF50';
        const handleSize = 6;
        ctx.fillRect(-w/2 - handleSize/2, -h/2 - handleSize/2, handleSize, handleSize);
        ctx.fillRect(w/2 - handleSize/2, -h/2 - handleSize/2, handleSize, handleSize);
        ctx.fillRect(-w/2 - handleSize/2, h/2 - handleSize/2, handleSize, handleSize);
        ctx.fillRect(w/2 - handleSize/2, h/2 - handleSize/2, handleSize, handleSize);
      }
      
      ctx.restore();
    });
  }

  // ─────────────────────────────────────────────
  // Render Composite Texture (High Resolution)
  // ─────────────────────────────────────────────
  renderCompositeTexture() {
    const ctx = this.textureCtx;
    const canvas = this.textureCanvas;
    
    // Clear
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw base texture
    if (this.baseTexture && this.baseTexture.image) {
      ctx.drawImage(this.baseTexture.image, 0, 0, canvas.width, canvas.height);
    } else {
      // Default white background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    
    // Draw overlay images
    this.overlayImages.forEach(imgData => {
      const x = (imgData.position.x / 100) * canvas.width;
      const y = (imgData.position.y / 100) * canvas.height;
      const w = (imgData.size.w / 100) * canvas.width;
      const h = (imgData.size.h / 100) * canvas.height;
      
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((imgData.rotation * Math.PI) / 180);
      ctx.drawImage(imgData.image, -w/2, -h/2, w, h);
      ctx.restore();
    });
  }

  // ─────────────────────────────────────────────
  // Apply Texture to Model
  // ─────────────────────────────────────────────
  applyTextureToModel() {
    if (!this.activeMesh) {
      this.log('No active mesh to apply texture to', true);
      return;
    }
    
    // Render final composite
    this.renderCompositeTexture();
    
    // Create texture from canvas
    const texture = new THREE.CanvasTexture(this.textureCanvas);
    texture.needsUpdate = true;
    
    // Apply to material
    if (this.activeMesh.material) {
      // Dispose old texture
      if (this.activeMesh.material.map && this.activeMesh.material.map !== this.baseTexture) {
        this.activeMesh.material.map.dispose();
      }
      
      this.activeMesh.material.map = texture;
      this.activeMesh.material.needsUpdate = true;
    }
    
    this.log('✓ Texture applied to model');
  }

  // ─────────────────────────────────────────────
  // Reset Texture
  // ─────────────────────────────────────────────
  resetTexture() {
    if (confirm('Reset all images? This cannot be undone.')) {
      this.overlayImages = [];
      this.selectedImageId = null;
      this.updateImagesList();
      this.renderUVPreview();
      document.querySelector('.selected-image-controls').classList.add('hidden');
      this.log('Texture reset');
    }
  }

  // ─────────────────────────────────────────────
  // Delete Selected Image
  // ─────────────────────────────────────────────
  deleteSelectedImage() {
    if (!this.selectedImageId) return;
    
    this.overlayImages = this.overlayImages.filter(img => img.id !== this.selectedImageId);
    this.selectedImageId = null;
    this.updateImagesList();
    this.renderUVPreview();
    this.renderCompositeTexture();
    document.querySelector('.selected-image-controls').classList.add('hidden');
    this.log('Image deleted');
  }
}