
// MODELMANAGER.JS - Model Management System for RenderDeck
// Handles adding, loading, and managing 3D models dynamically

import { ModelVerifier } from './ModelVerifier.js';
import { CustomModelStorage } from '../storage/CustomModelStorage.js';
import * as IDBStorage from '../storage/indexedDBStorage.js';
import { ensureActiveProject, getActiveProjectId } from '../storage/ProjectStorage.js';
import { modelDeleteOps, sessionWithoutModels } from '../storage/cascade.js';
import { sessionKey } from '../storage/storageKeys.js';

export class ModelManager {
  constructor(log) {
    this.models = new Map(); // Store models: name -> {objPath, mtlPath, files, ...}
    this.verifier = new ModelVerifier();
    this.storage = new CustomModelStorage(log);
    this.log = log;
    this.nextModelId = 1;
    this.ready = this._init();
  }

  async _init() {
    // Runs while main.js is still loading — make sure the project exists first
    // so uploads are read from the right `${projectId}:` prefix on a fresh profile.
    await ensureActiveProject();
    await this._loadPersistedUploadedModels();
  }

  async loadCustomModelsFromStorage() {
    // Custom models are accessed lazily via storage — no eager load needed.
  }

  // Writes every file and the record in one transaction — all or nothing.
  // Throws on failure (including QuotaExceededError).
  async _persistUploadedModel(projectId, name, type, verificationFiles) {
    const prefix = `uploaded:${projectId}:${name}`;
    const ops = [];
    if (type === 'uploaded-glb') {
      ops.push({ type: 'put', store: 'blobs', key: `${prefix}:glb`, value: verificationFiles.glb });
      ops.push({ type: 'put', store: 'uploaded-models', key: `${projectId}:${name}`, value: {
        name, type, uploadDate: new Date().toISOString()
      } });
    } else {
      ops.push({ type: 'put', store: 'blobs', key: `${prefix}:obj`, value: verificationFiles.obj });
      if (verificationFiles.mtl) {
        ops.push({ type: 'put', store: 'blobs', key: `${prefix}:mtl`, value: verificationFiles.mtl });
      }
      for (const tex of (verificationFiles.textures || [])) {
        ops.push({ type: 'put', store: 'blobs', key: `${prefix}:tex:${tex.name}`, value: tex });
      }
      ops.push({ type: 'put', store: 'uploaded-models', key: `${projectId}:${name}`, value: {
        name,
        type,
        uploadDate:   new Date().toISOString(),
        hasMtl:       !!verificationFiles.mtl,
        textureNames: (verificationFiles.textures || []).map(t => t.name),
        metadata:     verificationFiles.metadata || {},
      } });
    }
    await IDBStorage.batch(ops);
  }

  // Turn a failed write into a user-facing error message
  _persistError(name, err) {
    console.error(`[ModelManager] Failed to persist uploaded model "${name}":`, err);
    return IDBStorage.isQuotaError(err)
      ? `Storage full — "${name}" was not saved. Delete unused models or textures and try again.`
      : `Could not save "${name}": ${err.message}`;
  }

  async _loadPersistedUploadedModels() {
    if (!IDBStorage.isIndexedDBAvailable()) return;
    try {
      const projectId = await getActiveProjectId();
      const allKeys = await IDBStorage.getAllKeys('uploaded-models');
      const prefix = `${projectId}:`;
      for (const key of allKeys) {
        if (!key.startsWith(prefix)) continue;
        const name = key.slice(prefix.length);
        const meta = await IDBStorage.get('uploaded-models', key);
        if (!meta) continue;
        const blobPrefix = `uploaded:${projectId}:${name}`;
        try {
          if (meta.type === 'uploaded-glb') {
            const glbBlob = await IDBStorage.get('blobs', `${blobPrefix}:glb`);
            if (!glbBlob) continue;
            this.models.set(name, {
              type: 'uploaded-glb',
              name,
              objectURLs: { glb: URL.createObjectURL(glbBlob) },
              source: 'user-uploaded',
              uploadDate: meta.uploadDate,
            });
          } else {
            const objBlob = await IDBStorage.get('blobs', `${blobPrefix}:obj`);
            if (!objBlob) continue;
            const textureURLs = {};
            for (const texName of (meta.textureNames || [])) {
              const texBlob = await IDBStorage.get('blobs', `${blobPrefix}:tex:${texName}`);
              if (texBlob) textureURLs[texName] = URL.createObjectURL(texBlob);
            }
            let mtlURL = null;
            if (meta.hasMtl) {
              const mtlBlob = await IDBStorage.get('blobs', `${blobPrefix}:mtl`);
              if (mtlBlob) mtlURL = await this.createMTLWithBlobURLs(mtlBlob, textureURLs);
            }
            this.models.set(name, {
              type: 'uploaded',
              name,
              objectURLs: { obj: URL.createObjectURL(objBlob), mtl: mtlURL, textures: textureURLs },
              source: 'user-uploaded',
              uploadDate: meta.uploadDate,
              metadata: meta.metadata || {},
            });
          }
        } catch (err) {
          console.error(`[ModelManager] Failed to restore uploaded model "${name}":`, err);
          if (typeof this.log === 'function') this.log(`Failed to restore model "${name}": ${err.message}`, true);
        }
      }
    } catch (err) {
      console.error('[ModelManager] Failed to load persisted uploaded models:', err);
      if (typeof this.log === 'function') this.log(`Failed to load persisted models: ${err.message}`, true);
    }
  }

  // ─────────────────────────────────────────────
  // Add a model from registry (for pre-configured models)
  // ─────────────────────────────────────────────
  registerModel(name, config) {
    this.models.set(name, {
      type: 'registry',
      objPath: config.objPath,
      mtlPath: config.mtlPath || null,
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

    // ── GLB path ──────────────────────────────────────────────────
    if (verification.files.glb) {
      const glbFile = verification.files.glb;
      const modelName = customName || this.generateModelName(glbFile.name);
      if (this.models.has(modelName)) {
        result.errors.push(`A model named "${modelName}" already exists. Please rename.`);
        return result;
      }
      // Save first — the model only appears once it is stored
      try {
        const projectId = await getActiveProjectId();
        await this._persistUploadedModel(projectId, modelName, 'uploaded-glb', { glb: glbFile });
      } catch (err) {
        result.errors.push(this._persistError(modelName, err));
        return result;
      }
      this.models.set(modelName, {
        type: 'uploaded-glb',
        name: modelName,
        objectURLs: { glb: URL.createObjectURL(glbFile) },
        source: 'user-uploaded',
        uploadDate: new Date()
      });
      result.success = true;
      result.name = modelName;
      result.warnings = verification.warnings;
      return result;
    }

    // ── OBJ path ──────────────────────────────────────────────────
    const modelName = customName || this.generateModelName(verification.files.obj.name);

    // Check for duplicate names
    if (this.models.has(modelName)) {
      result.errors.push(`A model named "${modelName}" already exists. Please rename.`);
      return result;
    }

    // Save first — the model only appears once it is stored
    try {
      const projectId = await getActiveProjectId();
      await this._persistUploadedModel(projectId, modelName, 'uploaded', {
        ...verification.files, metadata: verification.metadata,
      });
    } catch (err) {
      result.errors.push(this._persistError(modelName, err));
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

    // Create object URLs for the files (so Three.js can load them).
    // The MTL is rewritten to point at the same texture URLs, so every URL this
    // model creates is listed in objectURLs and revoked when it is deleted.
    modelData.objectURLs.obj = URL.createObjectURL(verification.files.obj);
    modelData.objectURLs.textures = {};
    verification.files.textures.forEach(textureFile => {
      modelData.objectURLs.textures[textureFile.name] = URL.createObjectURL(textureFile);
    });
    if (verification.files.mtl) {
      modelData.objectURLs.mtl = await this.createMTLWithBlobURLs(
        verification.files.mtl,
        modelData.objectURLs.textures
      );
    }

    // Store the model
    this.models.set(modelName, modelData);

    result.success = true;
    result.name = modelName;
    result.warnings = verification.warnings;

    return result;
  }

  // ─────────────────────────────────────────────
  // Create MTL with blob URLs for textures
  // textureMap: { fileName: blobURL } — URLs owned by the model (not created here)
  // ─────────────────────────────────────────────
  async createMTLWithBlobURLs(mtlFile, textureMap) {
    const mtlContent = await this.readFileAsText(mtlFile);

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
  async getModel(name) {
    // Check custom models in storage first
    const customModel = await this.storage.loadCustomModel(name);
    if (customModel) {
      return {
        type: 'custom',
        ...customModel
      };
    }
    
    // Then check regular models
    return this.models.get(name);
  }

  // ─────────────────────────────────────────────
  // Save a custom textured model
  // ─────────────────────────────────────────────
  async saveCustomModel(name, customData) {
    // Use storage module to persist to IndexedDB
    return await this.storage.saveCustomModel(name, customData);
  }

  // ─────────────────────────────────────────────
  // Get all model names by category
  // ─────────────────────────────────────────────
  async getModelNamesByCategory() {
    const customNames = await this.storage.getAllCustomModelNames();
    return {
      builtin: Array.from(this.models.entries())
        .filter(([_, model]) => model.type === 'registry')
        .map(([name, _]) => name),
      // include both regular OBJ uploads and GLB uploads in the "uploaded" bucket
      uploaded: Array.from(this.models.entries())
        .filter(([_, model]) => model.type === 'uploaded' || model.type === 'uploaded-glb')
        .map(([name, _]) => name),
      custom: customNames
    };
  }

  // ─────────────────────────────────────────────
  // Delete models (uploaded or custom) and everything stored for them — files,
  // decals, per-part materials, design layers, thumbnails, node graphs and their
  // session entries — in one transaction. Blob URLs are revoked only after the
  // write committed. Throws on failure (nothing is deleted then).
  // ─────────────────────────────────────────────
  async deleteModels(names) {
    const projectId = await getActiveProjectId();
    const ops = [];
    for (const name of names) ops.push(...await modelDeleteOps(projectId, name));
    const session = sessionWithoutModels(await IDBStorage.get('metadata', sessionKey(projectId)), names);
    if (session) ops.push({ type: 'put', store: 'metadata', key: sessionKey(projectId), value: session });
    await IDBStorage.batch(ops);
    names.forEach(name => this._releaseModel(name));
  }

  // Free the in-memory copy of an uploaded model (blob URLs)
  _releaseModel(name) {
    const model = this.models.get(name);
    if (!model || model.type === 'registry') return;
    const urls = model.objectURLs || {};
    [urls.glb, urls.obj, urls.mtl, ...Object.values(urls.textures || {})]
      .filter(Boolean)
      .forEach(url => URL.revokeObjectURL(url));
    this.models.delete(name);
  }

  // Names of saved custom models built on the given base model
  async getCustomModelsBasedOn(baseName) {
    const projectId = await getActiveProjectId();
    const prefix = `${projectId}:`;
    const keys = await IDBStorage.getAllKeys('models', prefix);
    const names = [];
    for (const key of keys) {
      const record = await IDBStorage.get('models', key);
      if (record?.basedOn === baseName) names.push(key.slice(prefix.length));
    }
    return names;
  }

  // ─────────────────────────────────────────────
  // Get model info for display (updated for custom)
  // ─────────────────────────────────────────────
  async getModelInfo(name) {
    // Check custom models in storage
    const customModel = await this.storage.loadCustomModel(name);
    if (customModel) {
      return {
        name,
        type: 'Custom',
        basedOn: customModel.basedOn,
        source: 'IndexedDB',
        createdDate: customModel.createdDate,
        lastModified: customModel.lastModified,
        hasCustomTexture: true,
        imageCount: customModel.overlayImages?.length || 0
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
        hasTextures: !!model.mtlPath
      };
    } else if (model.type === 'uploaded-glb') {
      return {
        name,
        type: 'User Upload (GLB)',
        source: model.source,
        uploadDate: model.uploadDate
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
    let baseName = objFilename.replace(/\.(obj|glb|gltf)$/i, '').replace(/[^a-zA-Z0-9_-]/g, '_');
    
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
  async getLoadingPaths(name) {
    // Check if it's a custom model from storage
    const customModel = await this.storage.loadCustomModel(name);
    if (customModel) {
      // For custom models, return the base model's paths
      // The texture will be applied separately
      return await this.getLoadingPaths(customModel.basedOn);
    }
    
    const model = this.models.get(name);
    if (!model) return null;

    if (model.type === 'registry') {
      if (model.objPath?.endsWith('.glb')) {
        return { type: 'glb-path', obj: model.objPath };
      }
      return { type: 'path', obj: model.objPath, mtl: model.mtlPath };
    } else if (model.type === 'uploaded-glb') {
      return { type: 'glb-blob', obj: model.objectURLs.glb };
    } else {
      // Blob URL-based loading for uploaded OBJ files
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
          objPath: model.objPath,
          mtlPath: model.mtlPath
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
          objPath: item.objPath,
          mtlPath: item.mtlPath
        });
      }
    });
  }

  // ─────────────────────────────────────────────
  // Export a single custom model
  // ─────────────────────────────────────────────
  async exportCustomModel(name) {
    const success = await this.storage.exportSingleModel(name);
    return success;
  }

  // ─────────────────────────────────────────────
  // Import custom model(s) from JSON file
  // ─────────────────────────────────────────────
  async importCustomModel(file) {
    const result = await this.storage.importCustomModels(file);
    return result;
  }
}