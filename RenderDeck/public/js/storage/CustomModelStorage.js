
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
//       materialId,                  // library entry; its definition lives in the library
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
//       materialId,
//       decals: [{ name, imageData, position, size, rotation, flipH, flipV, type, textData, aspectRatio }]
//     }
//   },
//   materials: { [materialId]: definition }  // export only, see MaterialLibrary.exportDefinitions
// }
//
// Records saved before the material library also hold materialPreset, materialPresetId,
// isCustomMaterial and materialData; migrations.js gives them a materialId.
//
// Backend mapping:
//   models row   : source_type, source_ref (=basedOn), name, material_data: null
//   decals rows  : one per decal per part (add part_name column to decals table)
//   material_data: per-part materialData — embed in material_data.parts or model_parts table

import * as IDBStorage from './indexedDBStorage.js';
import { getActiveProjectId } from './ProjectStorage.js';
import { customModelBlobKeys, modelWorkingStateOps } from './cascade.js';

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
  // parts: { [partName]: { materialId, decals } }
  // decals: [{ name, imageData, position, size, rotation, flipH, flipV, type, textData, aspectRatio }]
  //
  // One transaction: the previous decal blobs are deleted, the new ones and the
  // record written — a failure leaves the previously saved model untouched.
  // replaceWorkingState: also clear per-part working state stored under this name
  // (used when an import overwrites a model).
  // ─────────────────────────────────────────────
  async saveCustomModel(name, modelData, { replaceWorkingState = false, extraOps = [] } = {}) {
    if (!this.idbAvailable) {
      this.log('Cannot save: IndexedDB unavailable', true);
      return false;
    }

    try {
      const projectId = await getActiveProjectId();
      const existingMeta = await IDBStorage.get('models', modelKey(projectId, name));
      const ops = [...(replaceWorkingState ? modelWorkingStateOps(projectId, name) : []), ...extraOps];
      for (const key of (existingMeta ? customModelBlobKeys(existingMeta) : [])) {
        ops.push({ type: 'del', store: 'blobs', key });
      }

      // Build per-part metadata; decal images become blobs written in the same transaction
      const partsMetadata = {};
      for (const [partName, partData] of Object.entries(modelData.parts || {})) {
        const overlayKeys = [];
        const overlayMetadata = [];
        for (let i = 0; i < (partData.decals || []).length; i++) {
          const decal = partData.decals[i];
          if (decal.imageData) {
            const key = partBlobKey(projectId, name, partName, i);
            ops.push({ type: 'put', store: 'blobs', key, value: IDBStorage.dataURLToBlobSync(decal.imageData) });
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
          materialId: partData.materialId,
          // Exported before the library: finished when the model first loads
          ...(partData.materialId === undefined && partData.materialData
            ? { useOriginalMaterial: true, materialData: partData.materialData } : {}),
          overlayKeys,
          overlayMetadata,
        };
      }

      // Preserve existing ID on re-save
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
      ops.push({ type: 'put', store: 'models', key: modelKey(projectId, name), value: stored });

      await IDBStorage.batch(ops);
      const totalDecals = Object.values(partsMetadata).reduce((s, p) => s + p.overlayKeys.length, 0);
      this.log(`Saved: ${name} (${Object.keys(partsMetadata).length} part(s), ${totalDecals} decal(s))`);
      return true;
    } catch (error) {
      this.log(IDBStorage.isQuotaError(error)
        ? `Storage full — "${name}" was not saved. Delete unused models or use smaller images.`
        : `Failed to save custom model: ${error.message}`, true);
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
          materialId:          partMeta.materialId,
          // Only present before the library; used if the part hasn't been migrated yet
          useOriginalMaterial: partMeta.useOriginalMaterial || false,
          materialPreset:      partMeta.materialPreset,
          materialData:        partMeta.materialData,
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
      materialId:        metadata.materialId,
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

  // Deleting a custom model (and everything that belongs to it) is done by
  // ModelManager.deleteModels(), which builds its operations in cascade.js.

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

  // Record the ids of parts migrated when the custom model first loaded.
  async setPartMaterialIds(name, ids) {
    const projectId = await getActiveProjectId();
    const key = modelKey(projectId, name);
    const stored = await IDBStorage.get('models', key);
    if (!stored?.parts) return;
    const parts = Object.fromEntries(Object.entries(stored.parts).map(([part, data]) =>
      [part, part in ids ? { ...data, materialId: ids[part] } : data]));
    await IDBStorage.put('models', key, { ...stored, parts });
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
