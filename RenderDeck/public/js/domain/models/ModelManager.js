import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { rewriteMTL } from './MTLUtils.js';
import { uploadedModelMtlKey } from '../../storage/storageKeys.js';

// MODELMANAGER.JS - Model Management System for RenderDeck
// Handles adding, loading, and managing 3D models dynamically

import { ModelVerifier } from './ModelVerifier.js';
import { CustomModelStorage } from '../../storage/CustomModelStorage.js';
import * as IDBStorage from '../../storage/indexedDBStorage.js';
import { ensureActiveProject, getActiveProjectId } from '../../storage/ProjectStorage.js';
import { modelDeleteOps, sessionWithoutModels } from '../../storage/cascade.js';
import { sessionKey, uploadedCatalogKey, standardModelBlobKey, standardModelInfoKey } from '../../storage/storageKeys.js';
import { catalogFromGltf, catalogFromMtl, readGltfJsonFromBlob } from '../materials/nativeCatalog.js';

export class ModelManager {
  constructor(log) {
    this.models = new Map(); // Store models: name -> {objPath, mtlPath, files, ...}
    this.verifier = new ModelVerifier();
    this.storage = new CustomModelStorage(log);
    this.log = log;
    this.nextModelId = 1;
    this._standardModelURLs = new Map(); // name → blob URL of the copy stored in IndexedDB
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
    let catalog = null;
    if (type === 'uploaded-glb') {
      ops.push({ type: 'put', store: 'blobs', key: `${prefix}:glb`, value: verificationFiles.glb });
      ops.push({ type: 'put', store: 'uploaded-models', key: `${projectId}:${name}`, value: {
        name, type, uploadDate: new Date().toISOString()
      } });
      catalog = catalogFromGltf(name, await readGltfJsonFromBlob(verificationFiles.glb));
    } else {
      ops.push({ type: 'put', store: 'blobs', key: `${prefix}:obj`, value: verificationFiles.obj });
      for (const file of verificationFiles.mtls || []) {
        ops.push({ type: 'put', store: 'blobs', key: uploadedModelMtlKey(projectId, name, file.name), value: file });
      }
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
        mtlNames: (verificationFiles.mtls || []).map(file => file.name),
        selectedMtlNames: verificationFiles.selectedMtlNames || [],
        textureNames: (verificationFiles.textures || []).map(t => t.name),
        metadata:     verificationFiles.metadata || {},
      } });
      if (verificationFiles.mtl) {
        const selected = (verificationFiles.mtls || []).filter(file => (verificationFiles.selectedMtlNames || []).includes(file.name));
        const text = selected.length
          ? (await Promise.all(selected.map(file => file.text()))).join('\n')
          : await verificationFiles.mtl.text();
        catalog = catalogFromMtl(name, text);
      }
    }
    if (catalog) ops.push({ type: 'put', store: 'metadata', key: uploadedCatalogKey(projectId, name), value: catalog });
    await IDBStorage.batch(ops);
    if (catalog) this.onCatalogAdded?.(catalog);
  }

  // Native material list of an upload that was stored before lists were kept.
  // Resolves null if it has none (an OBJ without an MTL).
  async readUploadedCatalog(name) {
    const projectId = await getActiveProjectId();
    const prefix = `uploaded:${projectId}:${name}`;
    const meta = await IDBStorage.get('uploaded-models', `${projectId}:${name}`);
    if (!meta) return null;
    if (meta.type === 'uploaded-glb') {
      const blob = await IDBStorage.get('blobs', `${prefix}:glb`);
      return blob ? catalogFromGltf(name, await readGltfJsonFromBlob(blob)) : null;
    }
    if (!meta.hasMtl) return null;
    const selected = await Promise.all((meta.selectedMtlNames || []).map(file => IDBStorage.get('blobs', uploadedModelMtlKey(projectId, name, file))));
    const files = selected.filter(Boolean);
    if (!files.length) files.push(await IDBStorage.get('blobs', `${prefix}:mtl`));
    if (!files[0]) return null;
    return catalogFromMtl(name, (await Promise.all(files.map(file => file.text()))).join('\n'));
  }

  // Turn a failed write into a user-facing error message
  _persistError(name, err) {
    console.error(`[ModelManager] Failed to persist uploaded model "${name}":`, err);
    return IDBStorage.isQuotaError(err)
      ? `Storage full — "${name}" was not saved. Delete unused models or textures and try again.`
      : `Could not save "${name}": ${err.message}`;
  }

  // Make a stored upload available as a model
  async restoreUploadedModel(name) {
    await this._restoreUploadedModel(await getActiveProjectId(), name);
  }

  async _restoreUploadedModel(projectId, name) {
    const meta = await IDBStorage.get('uploaded-models', `${projectId}:${name}`);
    if (!meta) return;
    const blobPrefix = `uploaded:${projectId}:${name}`;
    try {
      if (meta.type === 'uploaded-glb') {
        const glbBlob = await IDBStorage.get('blobs', `${blobPrefix}:glb`);
        if (!glbBlob) return;
        this.models.set(name, {
          type: 'uploaded-glb',
          name,
          objectURLs: { glb: URL.createObjectURL(glbBlob) },
          source: 'user-uploaded',
          uploadDate: meta.uploadDate,
        });
      } else {
        const objBlob = await IDBStorage.get('blobs', `${blobPrefix}:obj`);
        if (!objBlob) return;
        const textureURLs = {};
        for (const texName of (meta.textureNames || [])) {
          const texBlob = await IDBStorage.get('blobs', `${blobPrefix}:tex:${texName}`);
          if (texBlob) textureURLs[texName] = URL.createObjectURL(texBlob);
        }
        let mtlURL = null;
        if (meta.hasMtl) {
          const mtlBlob = await IDBStorage.get('blobs', `${blobPrefix}:mtl`);
          if (mtlBlob) {
      const selected = await Promise.all((meta.selectedMtlNames || []).map(file => IDBStorage.get('blobs', uploadedModelMtlKey(projectId, name, file))));
      const text = selected.length ? (await Promise.all(selected.filter(Boolean).map(file => file.text()))).join('\n') : await mtlBlob.text();
      mtlURL = await this.createMTLWithBlobURLs(new Blob([text]), textureURLs);
    }
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

  async _loadPersistedUploadedModels() {
    if (!IDBStorage.isIndexedDBAvailable()) return;
    try {
      const projectId = await getActiveProjectId();
      const allKeys = await IDBStorage.getAllKeys('uploaded-models');
      const prefix = `${projectId}:`;
      for (const key of allKeys) {
        if (!key.startsWith(prefix)) continue;
        await this._restoreUploadedModel(projectId, key.slice(prefix.length));
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
  // Store each standard object's file in IndexedDB, one at a time, skipping any whose
  // stored copy still matches the server. Runs in the background; a failure leaves that
  // model loading from the network as before, and the next start tries again.
  // ─────────────────────────────────────────────
  async storeStandardModels() {
    for (const [name, model] of [...this.models.entries()]) {
      if (model.type !== 'registry' || !model.objPath) continue;
      const head = await fetch(model.objPath, { method: 'HEAD', cache: 'no-cache' });
      if (!head.ok) throw new Error(`${name}: HTTP ${head.status}`);
      const info = {
        size: head.headers.get('content-length'),
        lastModified: head.headers.get('last-modified'),
        etag: head.headers.get('etag'),
      };
      const stored = await IDBStorage.get('metadata', standardModelInfoKey(name));
      if (stored && stored.size === info.size && stored.lastModified === info.lastModified && stored.etag === info.etag) continue;

      const response = await fetch(model.objPath, { cache: 'no-cache', priority: 'low' });
      if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
      const blob = await response.blob();
      await IDBStorage.batch([
        { type: 'put', store: 'blobs', key: standardModelBlobKey(name), value: blob },
        { type: 'put', store: 'metadata', key: standardModelInfoKey(name), value: info },
      ]);
      // A URL made from an older copy would keep serving that copy
      const previousURL = this._standardModelURLs.get(name);
      if (previousURL) URL.revokeObjectURL(previousURL);
      this._standardModelURLs.delete(name);
    }
  }

  // Blob URL of a standard object's stored copy, or its normal path if there is none yet.
  async _standardModelURL(name, objPath) {
    if (this._standardModelURLs.has(name)) return this._standardModelURLs.get(name);
    try {
      const blob = await IDBStorage.get('blobs', standardModelBlobKey(name));
      if (!blob) return objPath;
      // Another call may have made it while this one read the blob
      if (!this._standardModelURLs.has(name)) this._standardModelURLs.set(name, URL.createObjectURL(blob));
      return this._standardModelURLs.get(name);
    } catch (err) {
      console.warn(`Could not read stored copy of ${name}:`, err);
      return objPath;
    }
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
      try {
        const gltf = await new GLTFLoader().parseAsync(await glbFile.arrayBuffer(), '');
        const resources = new Set();
        let meshes = 0;
        gltf.scene.traverse(child => {
          if (child.isMesh) meshes++;
          if (child.geometry) resources.add(child.geometry);
          for (const material of [child.material].flat().filter(Boolean)) {
            resources.add(material);
            Object.values(material).forEach(value => { if (value?.isTexture) resources.add(value); });
          }
        });
        resources.forEach(resource => resource.dispose());
        if (!meshes) throw new Error('Model contains no drawable meshes');
      } catch (err) {
        result.errors.push(`Invalid GLB: ${err.message}`);
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
      const selected = verification.files.mtls.filter(file => verification.files.selectedMtlNames.includes(file.name));
      const text = (await Promise.all(selected.map(file => file.text()))).join('\n');
      modelData.objectURLs.mtl = await this.createMTLWithBlobURLs(
        new Blob([text]),
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

    const modifiedContent = rewriteMTL(mtlContent, textureMap, warning => this.log(`⚠️ ${warning}`));

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
  async saveCustomModel(name, customData, options) {
    // Use storage module to persist to IndexedDB
    return await this.storage.saveCustomModel(name, customData, options);
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
  // extraOps join the same transaction (what the material library needs to change).
  async deleteModels(names, extraOps = []) {
    const projectId = await getActiveProjectId();
    const ops = [...extraOps];
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
  // Normalize the upload name; duplicate names are rejected by the caller.
  // ─────────────────────────────────────────────
  generateModelName(objFilename) {
    // Remove extension and clean up
    return objFilename.replace(/\.(obj|glb|gltf)$/i, '').replace(/[^a-zA-Z0-9_-]/g, '_');
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
      // sourcePath identifies the model; obj is where its bytes are read from
      const obj = await this._standardModelURL(name, model.objPath);
      if (model.objPath?.endsWith('.glb')) {
        return { type: 'glb-path', obj, sourcePath: model.objPath };
      }
      return { type: 'path', obj, sourcePath: model.objPath, mtl: model.mtlPath };
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

  async restoreImportedBaseModels(names) {
    const projectId = await getActiveProjectId();
    for (const name of names) await this._restoreUploadedModel(projectId, name);
  }
}
