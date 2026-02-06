// ═══════════════════════════════════════════════════════════════
// MODELMANAGER.JS - Model Management System for RenderDeck
// Handles adding, loading, and managing 3D models dynamically
// ═══════════════════════════════════════════════════════════════

import { ModelVerifier } from './verifier.js';

export class ModelManager {
  constructor() {
    this.models = new Map(); // Store models: name -> {folder, obj, mtl, files}
    this.customModels = new Map(); // Store custom textured models
    this.verifier = new ModelVerifier();
    this.nextModelId = 1;
  }

  // ─────────────────────────────────────────────
  // Add a model from registry (for pre-configured models)
  // ─────────────────────────────────────────────
  registerModel(name, config) {
    this.models.set(name, {
      type: 'registry',
      folder: config.folder,
      obj: config.obj,
      mtl: config.mtl,
      source: 'built-in'
    });
    return true;
  }

  // ─────────────────────────────────────────────
  // Add a model from uploaded files (drag & drop or file input)
  // Returns: { success: boolean, name: string, errors: [], warnings: [] }
  // ─────────────────────────────────────────────
  async addModelFromFiles(files, customName = null) {
    const result = {
      success: false,
      name: null,
      errors: [],
      warnings: [],
      report: ''
    };

    // Verify the files
    const verification = await this.verifier.verifyModelFolder(files);
    result.report = this.verifier.generateReport(verification);

    if (!verification.valid) {
      result.errors = verification.errors;
      result.warnings = verification.warnings;
      return result;
    }

    // Generate a name for the model
    const modelName = customName || this.generateModelName(verification.files.obj.name);

    // Check for duplicate names
    if (this.models.has(modelName)) {
      result.errors.push(`A model named "${modelName}" already exists. Please rename.`);
      return result;
    }

    // Store the model files
    const modelData = {
      type: 'uploaded',
      name: modelName,
      files: {
        obj: verification.files.obj,
        mtl: verification.files.mtl,
        textures: verification.files.textures
      },
      metadata: verification.metadata,
      objectURLs: {}, // Will store blob URLs for loading
      source: 'user-uploaded',
      uploadDate: new Date()
    };

    // Create object URLs for the files (so Three.js can load them)
    modelData.objectURLs.obj = URL.createObjectURL(verification.files.obj);
    
    if (verification.files.mtl) {
      // Need to rewrite MTL content to use blob URLs for textures
      modelData.objectURLs.mtl = await this.createMTLWithBlobURLs(
        verification.files.mtl,
        verification.files.textures
      );
    }

    // Create texture blob URLs
    modelData.objectURLs.textures = {};
    verification.files.textures.forEach(textureFile => {
      modelData.objectURLs.textures[textureFile.name] = URL.createObjectURL(textureFile);
    });

    // Store the model
    this.models.set(modelName, modelData);

    result.success = true;
    result.name = modelName;
    result.warnings = verification.warnings;

    return result;
  }

  // ─────────────────────────────────────────────
  // Create MTL with blob URLs for textures
  // ─────────────────────────────────────────────
  async createMTLWithBlobURLs(mtlFile, textureFiles) {
    const mtlContent = await this.readFileAsText(mtlFile);
    
    // Create a map of texture names to blob URLs
    const textureMap = {};
    textureFiles.forEach(file => {
      textureMap[file.name] = URL.createObjectURL(file);
    });

    // Replace texture filenames with blob URLs
    let modifiedContent = mtlContent;
    const textureMapTypes = ['map_Kd', 'map_Ka', 'map_Ks', 'map_Bump', 'map_d', 'map_Ns'];
    
    textureMapTypes.forEach(mapType => {
      const regex = new RegExp(`^(${mapType}\\s+)(.+)$`, 'gm');
      modifiedContent = modifiedContent.replace(regex, (match, prefix, texturePath) => {
        // Extract just the filename from the path
        const filename = texturePath.trim().split(/[/\\]/).pop();
        const blobURL = textureMap[filename];
        return blobURL ? `${prefix}${blobURL}` : match;
      });
    });

    // Create a new blob for the modified MTL
    const blob = new Blob([modifiedContent], { type: 'text/plain' });
    return URL.createObjectURL(blob);
  }

  // ─────────────────────────────────────────────
  // Get model data for loading
  // ─────────────────────────────────────────────
  getModel(name) {
    return this.models.get(name);
  }

  // ─────────────────────────────────────────────
  // Save a custom textured model
  // ─────────────────────────────────────────────
  saveCustomModel(name, customData) {
    this.customModels.set(name, {
      type: 'custom',
      basedOn: customData.basedOn,
      texture: customData.texture,
      textureCanvas: customData.textureCanvas,
      overlayImages: customData.overlayImages,
      source: 'user-custom',
      createdDate: new Date()
    });
    
    return true;
  }

  // ─────────────────────────────────────────────
  // Get all model names (including custom)
  // ─────────────────────────────────────────────
  getAllModelNames() {
    const regularModels = Array.from(this.models.keys());
    const customModelNames = Array.from(this.customModels.keys());
    return [...regularModels, ...customModelNames];
  }

  // ─────────────────────────────────────────────
  // Get all model names by category
  // ─────────────────────────────────────────────
  getModelNamesByCategory() {
    return {
      builtin: Array.from(this.models.entries())
        .filter(([_, model]) => model.type === 'registry')
        .map(([name, _]) => name),
      uploaded: Array.from(this.models.entries())
        .filter(([_, model]) => model.type === 'uploaded')
        .map(([name, _]) => name),
      custom: Array.from(this.customModels.keys())
    };
  }

  // ─────────────────────────────────────────────
  // Get model data for loading (updated to handle custom)
  // ─────────────────────────────────────────────
  getModel(name) {
    // Check custom models first
    if (this.customModels.has(name)) {
      return this.customModels.get(name);
    }
    return this.models.get(name);
  }

  // ─────────────────────────────────────────────
  // Remove a model (updated to handle custom)
  // ─────────────────────────────────────────────
  removeModel(name) {
    // Try custom models first
    if (this.customModels.has(name)) {
      const model = this.customModels.get(name);
      if (model.texture) model.texture.dispose();
      this.customModels.delete(name);
      return true;
    }
    
    // Regular model removal
    const model = this.models.get(name);
    if (!model) return false;

    // Cleanup blob URLs if uploaded model
    if (model.type === 'uploaded' && model.objectURLs) {
      if (model.objectURLs.obj) URL.revokeObjectURL(model.objectURLs.obj);
      if (model.objectURLs.mtl) URL.revokeObjectURL(model.objectURLs.mtl);
      Object.values(model.objectURLs.textures || {}).forEach(url => {
        URL.revokeObjectURL(url);
      });
    }

    this.models.delete(name);
    return true;
  }

  // ─────────────────────────────────────────────
  // Get model info for display (updated for custom)
  // ─────────────────────────────────────────────
  getModelInfo(name) {
    // Check custom models
    if (this.customModels.has(name)) {
      const model = this.customModels.get(name);
      return {
        name,
        type: 'Custom',
        basedOn: model.basedOn,
        source: model.source,
        createdDate: model.createdDate,
        hasCustomTexture: true
      };
    }
    
    // Regular models
    const model = this.models.get(name);
    if (!model) return null;

    if (model.type === 'registry') {
      return {
        name,
        type: 'Built-in',
        source: model.source,
        hasTextures: !!model.mtl
      };
    } else {
      return {
        name,
        type: 'User Upload',
        source: model.source,
        uploadDate: model.uploadDate,
        hasTextures: model.files.textures.length > 0,
        textureCount: model.files.textures.length,
        vertexCount: model.metadata.objInfo?.vertexCount,
        faceCount: model.metadata.objInfo?.faceCount
      };
    }
  }

  // ─────────────────────────────────────────────
  // Get all model names
  // ─────────────────────────────────────────────

  // ─────────────────────────────────────────────
  // Generate a unique model name
  // ─────────────────────────────────────────────
  generateModelName(objFilename) {
    // Remove extension and clean up
    let baseName = objFilename.replace(/\.obj$/i, '').replace(/[^a-zA-Z0-9_-]/g, '_');
    
    // Ensure uniqueness
    let name = baseName;
    let counter = 1;
    while (this.models.has(name)) {
      name = `${baseName}_${counter}`;
      counter++;
    }

    return name;
  }

  // ─────────────────────────────────────────────
  // Helper: Read file as text
  // ─────────────────────────────────────────────
  readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = (e) => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  }

  // ─────────────────────────────────────────────
  // Get loading paths for Three.js loaders
  // ─────────────────────────────────────────────
  getLoadingPaths(name) {
    // Check if it's a custom model first
    if (this.customModels.has(name)) {
      const customModel = this.customModels.get(name);
      // For custom models, return the base model's paths
      // The texture will be applied separately
      return this.getLoadingPaths(customModel.basedOn);
    }
    
    const model = this.models.get(name);
    if (!model) return null;

    if (model.type === 'registry') {
      // Traditional path-based loading
      return {
        type: 'path',
        basePath: `../models/${model.folder}/`,
        obj: model.obj,
        mtl: model.mtl
      };
    } else {
      // Blob URL-based loading for uploaded files
      return {
        type: 'blob',
        obj: model.objectURLs.obj,
        mtl: model.objectURLs.mtl,
        textures: model.objectURLs.textures
      };
    }
  }

  // ─────────────────────────────────────────────
  // Export model list (for saving/loading state)
  // ─────────────────────────────────────────────
  exportModelList() {
    const list = [];
    this.models.forEach((model, name) => {
      if (model.type === 'registry') {
        list.push({
          name,
          type: 'registry',
          folder: model.folder,
          obj: model.obj,
          mtl: model.mtl
        });
      }
      // Note: Uploaded models can't be exported (they're runtime only)
    });
    return list;
  }

  // ─────────────────────────────────────────────
  // Import model list (for loading saved state)
  // ─────────────────────────────────────────────
  importModelList(list) {
    list.forEach(item => {
      if (item.type === 'registry') {
        this.registerModel(item.name, {
          folder: item.folder,
          obj: item.obj,
          mtl: item.mtl
        });
      }
    });
  }
}