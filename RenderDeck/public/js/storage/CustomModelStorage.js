
// CUSTOMMODELSTORAGE.JS - Custom Model Storage (IndexedDB)
// Schema v3: per-part data mirroring the backend models+decals table structure.
//
// IDB 'models' store key:   `${projectId}:${customModelName}`
// IDB 'blobs'  store key:   `overlay:${projectId}:${name}:${partName}:${index}`
//
// Stored value shape (version 3):
// {
//   id, projectId, basedOn, customName, sourceType, version, sceneState,
//   parts: {
//     [partName]: {
//       materialPreset, materialPresetId, isCustomMaterial,
//       materialData: { color, roughness, ..., channelMaps: { ch: dataUrl } },
//       overlayKeys: [...],          // blob store keys (not in export)
//       overlayMetadata: [...]       // position/size/rotation etc (no imageData)
//     }
//   }
// }
//
// Loaded / exported value shape (version 3) — decals have imageData inline:
// {
//   id, basedOn, customName, sourceType, version, sceneState,
//   parts: {
//     [partName]: {
//       materialPreset, materialPresetId, isCustomMaterial,
//       materialData: { ..., channelMaps: {...} },
//       decals: [{ name, imageData, position, size, rotation, flipH, flipV, type, textData, aspectRatio }]
//     }
//   }
// }
//
// Backend mapping:
//   models row   : source_type, source_ref (=basedOn), name, material_data: null
//   decals rows  : one per decal per part (add part_name column to decals table)
//   material_data: per-part materialData — embed in material_data.parts or model_parts table

import * as IDBStorage from './indexedDBStorage.js';
import { getActiveProjectId } from './ProjectStorage.js';

const UUID_PREFIX_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:/i;

function modelKey(projectId, name) {
  return `${projectId}:${name}`;
}

function partBlobKey(projectId, modelName, partName, index) {
  return `overlay:${projectId}:${modelName}:${partName}:${index}`;
}

// Legacy v1 blob key (no partName segment)
function legacyBlobKey(projectId, name, index) {
  return `overlay:${projectId}:${name}:${index}`;
}

function isLegacyKey(key) {
  return !UUID_PREFIX_RE.test(key);
}

export class CustomModelStorage {
  constructor(log) {
    this.log = log;
    this.idbAvailable = IDBStorage.isIndexedDBAvailable();
    if (!this.idbAvailable) {
      this.log('IndexedDB not available, custom models will not persist', true);
    }
  }

  // ─────────────────────────────────────────────
  // Save a custom model (v3 parts schema)
  // modelData: { basedOn, customName, sourceType, sceneState, parts }
  // parts: { [partName]: { materialPreset, materialPresetId, isCustomMaterial, materialData, decals } }
  // decals: [{ name, imageData, position, size, rotation, flipH, flipV, type, textData, aspectRatio }]
  // ─────────────────────────────────────────────
  async saveCustomModel(name, modelData) {
    if (!this.idbAvailable) {
      this.log('Cannot save: IndexedDB unavailable', true);
      return false;
    }

    try {
      const projectId = await getActiveProjectId();

      // Delete old blobs for this model (handles both old and new key formats)
      await this._deleteModelBlobs(projectId, name);

      // Build per-part metadata, storing decal images as blobs
      const partsMetadata = {};
      for (const [partName, partData] of Object.entries(modelData.parts || {})) {
        const overlayKeys = [];
        const overlayMetadata = [];
        for (let i = 0; i < (partData.decals || []).length; i++) {
          const decal = partData.decals[i];
          if (decal.imageData) {
            const key = partBlobKey(projectId, name, partName, i);
            const blob = await IDBStorage.dataURLToBlob(decal.imageData);
            await IDBStorage.put('blobs', key, blob);
            overlayKeys.push(key);
            overlayMetadata.push({
              name:        decal.name,
              type:        decal.type        || 'image',
              textData:    decal.textData    ? { ...decal.textData } : null,
              position:    { ...decal.position },
              size:        { ...decal.size },
              rotation:    decal.rotation,
              aspectRatio: decal.aspectRatio,
              flipH:       decal.flipH       ?? false,
              flipV:       decal.flipV       ?? false,
            });
          }
        }
        partsMetadata[partName] = {
          materialPreset:   partData.materialPreset   || 'Default — White',
          materialPresetId: partData.materialPresetId || null,
          isCustomMaterial: partData.isCustomMaterial || false,
          materialData:     partData.materialData     || {},
          overlayKeys,
          overlayMetadata,
        };
      }

      // Preserve existing ID on re-save
      const existingMeta = await IDBStorage.get('models', modelKey(projectId, name));
      const modelId = modelData.id || existingMeta?.id || crypto.randomUUID();

      const stored = {
        id:          modelId,
        projectId,
        basedOn:     modelData.basedOn,
        customName:  modelData.customName,
        sourceType:  modelData.sourceType || 'standard',
        version:     3,
        sceneState:  modelData.sceneState || null,
        createdDate: existingMeta?.createdDate || new Date().toISOString(),
        lastModified: new Date().toISOString(),
        parts: partsMetadata,
      };

      await IDBStorage.put('models', modelKey(projectId, name), stored);
      const totalDecals = Object.values(partsMetadata).reduce((s, p) => s + p.overlayKeys.length, 0);
      this.log(`Saved: ${name} (${Object.keys(partsMetadata).length} part(s), ${totalDecals} decal(s))`);
      return true;
    } catch (error) {
      this.log(`Failed to save custom model: ${error.message}`, true);
      if (error.name === 'QuotaExceededError') {
        alert('Storage full! Try deleting some old custom models or use smaller images.');
      }
      return false;
    }
  }

  // ─────────────────────────────────────────────
  // Load a custom model — returns the loaded shape with decals[].imageData inline
  // ─────────────────────────────────────────────
  async loadCustomModel(name) {
    if (!this.idbAvailable) return null;
    try {
      const projectId = await getActiveProjectId();
      return await this._loadByKey(modelKey(projectId, name), name);
    } catch (error) {
      this.log(`Failed to load custom model: ${error.message}`, true);
      return null;
    }
  }

  async _loadByKey(fullKey, displayName) {
    const metadata = await IDBStorage.get('models', fullKey);
    if (!metadata) return null;

    // ── v3: parts-based schema ────────────────
    if (metadata.version >= 3 && metadata.parts) {
      const parts = {};
      for (const [partName, partMeta] of Object.entries(metadata.parts)) {
        const decals = [];
        for (let i = 0; i < partMeta.overlayKeys.length; i++) {
          const blob = await IDBStorage.get('blobs', partMeta.overlayKeys[i]);
          if (blob && partMeta.overlayMetadata[i]) {
            const imageData = await IDBStorage.blobToDataURL(blob);
            decals.push({ ...partMeta.overlayMetadata[i], imageData });
          }
        }
        parts[partName] = {
          materialPreset:   partMeta.materialPreset,
          materialPresetId: partMeta.materialPresetId || null,
          isCustomMaterial: partMeta.isCustomMaterial || false,
          materialData:     partMeta.materialData     || {},
          decals,
        };
      }
      return {
        type:        'custom',
        id:          metadata.id          || null,
        basedOn:     metadata.basedOn,
        customName:  metadata.customName,
        sourceType:  metadata.sourceType  || 'standard',
        version:     metadata.version,
        sceneState:  metadata.sceneState  || null,
        createdDate: metadata.createdDate,
        lastModified: metadata.lastModified,
        parts,
      };
    }

    // ── v1/v2 backward compat: flat single-part schema ──
    // Reconstruct as a single-part model keyed by '__default__'
    const overlayImages = [];
    if (metadata.overlayKeys?.length > 0) {
      for (let i = 0; i < metadata.overlayKeys.length; i++) {
        const blob = await IDBStorage.get('blobs', metadata.overlayKeys[i]);
        if (blob && metadata.overlayMetadata?.[i]) {
          const imageData = await IDBStorage.blobToDataURL(blob);
          overlayImages.push({ ...metadata.overlayMetadata[i], imageData });
        }
      }
    }
    return {
      type:        'custom',
      id:          metadata.id || null,
      basedOn:     metadata.basedOn,
      customName:  metadata.customName,
      sourceType:  'standard',
      version:     metadata.version || 2,
      sceneState:  metadata.sceneState || null,
      createdDate: metadata.createdDate,
      lastModified: metadata.lastModified,
      // v2 compat fields — loadCustomModel in main.js checks for these
      _v2compat: true,
      materialPreset:    metadata.materialPreset,
      materialPresetId:  metadata.materialPresetId || null,
      isCustomMaterial:  metadata.isCustomMaterial || false,
      materialProperties: metadata.materialProperties || {},
      channelMaps:       metadata.channelMaps || null,
      overlayImages,
    };
  }

  // ─────────────────────────────────────────────
  // Load all custom models for the active project
  // ─────────────────────────────────────────────
  async loadAllCustomModels() {
    if (!this.idbAvailable) return {};
    try {
      const projectId = await getActiveProjectId();
      const allKeys = await IDBStorage.getAllKeys('models');
      const models = {};
      for (const key of allKeys) {
        if (isLegacyKey(key)) {
          await this._migrateLegacyKey(key, projectId);
          continue;
        }
        if (!key.startsWith(`${projectId}:`)) continue;
        const name = key.slice(projectId.length + 1);
        const model = await this._loadByKey(key, name);
        if (model) models[name] = model;
      }
      return models;
    } catch (error) {
      this.log(`Failed to load custom models: ${error.message}`, true);
      return {};
    }
  }

  // ─────────────────────────────────────────────
  // Delete all blob entries for a model (both v2 and v3 key formats)
  // ─────────────────────────────────────────────
  async _deleteModelBlobs(projectId, name) {
    const existing = await IDBStorage.get('models', modelKey(projectId, name));
    if (!existing) return;

    if (existing.version >= 3 && existing.parts) {
      // v3: blobs keyed per part
      for (const partMeta of Object.values(existing.parts)) {
        for (const bk of (partMeta.overlayKeys || [])) {
          await IDBStorage.del('blobs', bk);
        }
      }
    } else {
      // v2: flat overlay keys
      for (const bk of (existing.overlayKeys || [])) {
        await IDBStorage.del('blobs', bk);
      }
    }
  }

  // ─────────────────────────────────────────────
  // Delete a custom model and all its blobs
  // ─────────────────────────────────────────────
  async deleteCustomModel(name) {
    if (!this.idbAvailable) return false;
    try {
      const projectId = await getActiveProjectId();
      await this._deleteModelBlobs(projectId, name);
      await IDBStorage.del('models', modelKey(projectId, name));
      this.log(`Deleted: ${name}`);
      return true;
    } catch (error) {
      this.log(`Failed to delete custom model: ${error.message}`, true);
      return false;
    }
  }

  // ─────────────────────────────────────────────
  // Get all custom model names for the active project
  // ─────────────────────────────────────────────
  async getAllCustomModelNames() {
    if (!this.idbAvailable) return [];
    try {
      const projectId = await getActiveProjectId();
      const allKeys = await IDBStorage.getAllKeys('models');
      const prefix = `${projectId}:`;
      return allKeys.filter(k => k.startsWith(prefix)).map(k => k.slice(prefix.length));
    } catch (error) {
      this.log(`Failed to get model names: ${error.message}`, true);
      return [];
    }
  }

  // ─────────────────────────────────────────────
  // Export custom models as JSON (active project only)
  // ─────────────────────────────────────────────
  async exportCustomModels() {
    try {
      const models = await this.loadAllCustomModels();
      const exportData = { version: 3, exportDate: new Date().toISOString(), models };
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `renderdeck-custom-models-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      this.log(`Exported ${Object.keys(models).length} custom model(s)`);
      return true;
    } catch (error) {
      this.log(`Failed to export: ${error.message}`, true);
      return false;
    }
  }

  // ─────────────────────────────────────────────
  // Export a single custom model
  // ─────────────────────────────────────────────
  async exportSingleModel(name) {
    try {
      const model = await this.loadCustomModel(name);
      if (!model) { this.log(`Model not found: ${name}`, true); return false; }
      const exportData = { version: 3, exportDate: new Date().toISOString(), models: { [name]: model } };
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name.replace(/[^a-z0-9]/gi, '_')}-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      this.log(`Exported: ${name}`);
      return true;
    } catch (error) {
      this.log(`Failed to export model: ${error.message}`, true);
      return false;
    }
  }

  // ─────────────────────────────────────────────
  // Import custom models from JSON
  // Accepts both v2 (flat) and v3 (parts) export formats
  // ─────────────────────────────────────────────
  async importCustomModels(file) {
    try {
      const text = await file.text();
      const importData = JSON.parse(text);
      if (!importData.models) {
        return { success: false, error: 'Invalid export file — missing models property' };
      }

      let importedCount = 0, skippedCount = 0, firstImportedName = null;

      for (const [name, modelData] of Object.entries(importData.models)) {
        const existing = await this.loadCustomModel(name);
        if (existing) {
          const overwrite = confirm(`Model "${name}" already exists. Overwrite?`);
          if (!overwrite) { skippedCount++; continue; }
          await this.deleteCustomModel(name);
        }

        // Normalise v2 flat format to v3 parts format before saving
        const normalised = this._normaliseImport(modelData);
        const success = await this.saveCustomModel(name, normalised);
        if (success) {
          importedCount++;
          if (!firstImportedName) firstImportedName = name;
        }
      }

      if (importedCount > 0) {
        this.log(`Imported ${importedCount} model(s), skipped ${skippedCount}`);
        return { success: true, name: firstImportedName, count: importedCount, skipped: skippedCount };
      }
      return { success: false, error: `No models imported (${skippedCount} skipped)` };
    } catch (error) {
      this.log(`Failed to import: ${error.message}`, true);
      return { success: false, error: error.message };
    }
  }

  // Convert a v2 flat model record into v3 parts shape
  _normaliseImport(modelData) {
    if (modelData.parts) return modelData; // already v3
    // v2: wrap the single-part flat data into parts['__default__']
    const materialData = { ...(modelData.materialProperties || {}) };
    if (modelData.channelMaps) materialData.channelMaps = modelData.channelMaps;
    return {
      basedOn:    modelData.basedOn,
      customName: modelData.customName,
      sourceType: 'standard',
      sceneState: modelData.sceneState || null,
      parts: {
        '__default__': {
          materialPreset:   modelData.materialPreset   || 'Default — White',
          materialPresetId: modelData.materialPresetId || null,
          isCustomMaterial: modelData.isCustomMaterial || false,
          materialData,
          decals: modelData.overlayImages || [],
        },
      },
    };
  }

  // ─────────────────────────────────────────────
  // Clear all custom models in the active project
  // ─────────────────────────────────────────────
  async clearAllCustomModels() {
    try {
      const names = await this.getAllCustomModelNames();
      if (names.length === 0) { this.log('No custom models to clear'); return { success: true, count: 0 }; }
      for (const name of names) await this.deleteCustomModel(name);
      this.log(`Cleared ${names.length} custom model(s)`);
      return { success: true, count: names.length };
    } catch (error) {
      this.log(`Failed to clear custom models: ${error.message}`, true);
      return { success: false, error: error.message };
    }
  }

  // ─────────────────────────────────────────────
  // Migrate a legacy (pre-project) key into the active project
  // ─────────────────────────────────────────────
  async _migrateLegacyKey(legacyKey, projectId) {
    try {
      const metadata = await IDBStorage.get('models', legacyKey);
      if (!metadata) return;
      const name = legacyKey;
      const newKey = modelKey(projectId, name);
      const newOverlayKeys = [];
      if (metadata.overlayKeys) {
        for (let i = 0; i < metadata.overlayKeys.length; i++) {
          const oldBlobKey = metadata.overlayKeys[i];
          const blob = await IDBStorage.get('blobs', oldBlobKey);
          if (blob) {
            const newBlobKey = legacyBlobKey(projectId, name, i);
            await IDBStorage.put('blobs', newBlobKey, blob);
            await IDBStorage.del('blobs', oldBlobKey);
            newOverlayKeys.push(newBlobKey);
          }
        }
      }
      await IDBStorage.put('models', newKey, { ...metadata, projectId, overlayKeys: newOverlayKeys });
      await IDBStorage.del('models', legacyKey);
      this.log(`Migrated legacy model "${name}" to project ${projectId}`);
    } catch (err) {
      this.log(`Migration failed for "${legacyKey}": ${err.message}`, true);
    }
  }
}
