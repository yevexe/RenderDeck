
// CONTROLS.JS - UI Controls Management
// UPDATED: Added scene-select support and better error handling

import { log } from '../utils/logger.js';

export class ControlsManager {
  constructor(callbacks) {
    this.callbacks = callbacks;
    this.elements = {};
    this.initialize();
  }

  /**
   * Initialize and cache all UI elements
   */
  initialize() {
    // Get all UI elements
    this.elements = {
      modelSelect: document.getElementById('model-select'),
      sceneSelect: document.getElementById('scene-select'),
      textureSelect: document.getElementById('texture-select'),
      opacitySlider: document.getElementById('opacity-slider'),
      roughnessSlider: document.getElementById('roughness-slider'),
      metalnessSlider: document.getElementById('metalness-slider'),
      editTextureBtn: document.getElementById('edit-texture-btn'),
      uploadModelBtn: document.getElementById('upload-model-btn'),
      modelFileInput: document.getElementById('model-file-input'),
      exportBtn: document.getElementById('export-btn'),
      importBtn: document.getElementById('import-btn'),
      fileInput: document.getElementById('file-input'),
      clearCustomBtn: document.getElementById('clear-custom-btn')
    };

    // Log missing elements (helpful for debugging)
    const missingElements = Object.entries(this.elements)
      .filter(([name, element]) => !element)
      .map(([name]) => name);
    
    if (missingElements.length > 0) {
      log(`⚠️ Missing UI elements: ${missingElements.join(', ')}`, true);
    }

    this.setupEventListeners();
  }

  /**
   * Setup all event listeners
   */
  setupEventListeners() {
    // Model selection
    if (this.elements.modelSelect) {
      this.elements.modelSelect.addEventListener('change', (e) => {
        if (this.callbacks.onModelChange) {
          this.callbacks.onModelChange(e.target.value);
        }
      });
    }

    // Scene selection ← ADDED
    if (this.elements.sceneSelect) {
      this.elements.sceneSelect.addEventListener('change', (e) => {
        if (this.callbacks.onSceneChange) {
          this.callbacks.onSceneChange(e.target.value);
        }
      });
    }

    // Material selection
    if (this.elements.textureSelect) {
      this.elements.textureSelect.addEventListener('change', (e) => {
        if (this.callbacks.onMaterialChange) {
          this.callbacks.onMaterialChange(e.target.value);
        }
      });
    }

    // Opacity slider
    if (this.elements.opacitySlider) {
      this.elements.opacitySlider.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        if (this.callbacks.onOpacityChange) {
          this.callbacks.onOpacityChange(value);
        }
      });
    }

    // Roughness slider
    if (this.elements.roughnessSlider) {
      this.elements.roughnessSlider.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        if (this.callbacks.onRoughnessChange) {
          this.callbacks.onRoughnessChange(value);
        }
      });
    }

    // Metalness slider
    if (this.elements.metalnessSlider) {
      this.elements.metalnessSlider.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        if (this.callbacks.onMetalnessChange) {
          this.callbacks.onMetalnessChange(value);
        }
      });
    }

    // Edit texture button
    if (this.elements.editTextureBtn) {
      this.elements.editTextureBtn.addEventListener('click', () => {
        if (this.callbacks.onEditTexture) {
          this.callbacks.onEditTexture();
        }
      });
    }

    // Upload model button
    if (this.elements.uploadModelBtn) {
      this.elements.uploadModelBtn.addEventListener('click', () => {
        if (this.elements.modelFileInput) {
          this.elements.modelFileInput.click();
        }
      });
    }

    // Model file input
    if (this.elements.modelFileInput) {
      this.elements.modelFileInput.addEventListener('change', (e) => {
        const files = e.target.files;
        if (files && files.length > 0 && this.callbacks.onUploadModel) {
          this.callbacks.onUploadModel(files);
        }
        // Reset input so same file can be selected again
        e.target.value = '';
      });
    }

    // Export button
    if (this.elements.exportBtn) {
      this.elements.exportBtn.addEventListener('click', () => {
        if (this.callbacks.onExport) {
          this.callbacks.onExport();
        }
      });
    }

    // Import button
    if (this.elements.importBtn) {
      this.elements.importBtn.addEventListener('click', () => {
        if (this.elements.fileInput) {
          this.elements.fileInput.click();
        }
      });
    }

    // File input
    if (this.elements.fileInput) {
      this.elements.fileInput.addEventListener('change', (e) => {
        const files = e.target.files;
        if (files && files.length > 0 && this.callbacks.onImport) {
          this.callbacks.onImport(files);
        }
        // Reset input so same file can be selected again
        e.target.value = '';
      });
    }

    // Clear custom models button
    if (this.elements.clearCustomBtn) {
      this.elements.clearCustomBtn.addEventListener('click', () => {
        if (this.callbacks.onClearCustom) {
          this.callbacks.onClearCustom();
        }
      });
    }
  }

  /**
   * Update model dropdown with categorized models
   * @param {Object} categories - {builtin: [], uploaded: [], custom: []}
   */
  updateModelSelect(categories) {
    if (!this.elements.modelSelect) return;

    this.elements.modelSelect.innerHTML = '';
    
    // Built-in models
    if (categories.builtin && categories.builtin.length > 0) {
      const builtinGroup = document.createElement('optgroup');
      builtinGroup.label = 'Built-in Models';
      categories.builtin.forEach((name) => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        builtinGroup.appendChild(opt);
      });
      this.elements.modelSelect.appendChild(builtinGroup);
    }
    
    // Custom models
    if (categories.custom && categories.custom.length > 0) {
      const customGroup = document.createElement('optgroup');
      customGroup.label = 'Custom Models';
      categories.custom.forEach((name) => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        customGroup.appendChild(opt);
      });
      this.elements.modelSelect.appendChild(customGroup);
    }

    // Uploaded models
    if (categories.uploaded && categories.uploaded.length > 0) {
      const uploadedGroup = document.createElement('optgroup');
      uploadedGroup.label = 'Uploaded Models';
      categories.uploaded.forEach((name) => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        uploadedGroup.appendChild(opt);
      });
      this.elements.modelSelect.appendChild(uploadedGroup);
    }
  }

  /**
   * Populate scene dropdown ← ADDED
   * @param {string[]} sceneNames - Array of scene names
   */
  updateSceneSelect(sceneNames) {
    if (!this.elements.sceneSelect) return;

    this.elements.sceneSelect.innerHTML = '';
    
    sceneNames.forEach((name) => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      this.elements.sceneSelect.appendChild(opt);
    });
  }

  /**
   * Set slider value
   * @param {string} slider - Slider name (opacity, roughness, metalness)
   * @param {number} value
   */
  setSliderValue(slider, value) {
    const element = this.elements[`${slider}Slider`];
    if (element) {
      element.value = value;
    }
  }

  /**
   * Get slider value
   * @param {string} slider - Slider name
   * @returns {number}
   */
  getSliderValue(slider) {
    const element = this.elements[`${slider}Slider`];
    return element ? parseFloat(element.value) : 0;
  }

  /**
   * Enable/disable UI element
   * @param {string} elementName - Element name
   * @param {boolean} enabled
   */
  setEnabled(elementName, enabled) {
    const element = this.elements[elementName];
    if (element) {
      element.disabled = !enabled;
    }
  }

  /**
   * Show/hide UI element
   * @param {string} elementName - Element name
   * @param {boolean} visible
   */
  setVisible(elementName, visible) {
    const element = this.elements[elementName];
    if (element) {
      element.style.display = visible ? '' : 'none';
    }
  }
}