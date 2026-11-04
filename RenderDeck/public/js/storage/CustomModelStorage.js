
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
import { customModelBlobKeys, modelWorkingStateOps, uploadedModelBlobKeys } from './cascade.js';
import { downloadBlob, safeFileName } from '../utils/helpers.js';

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

  // ─────────────────────────────────────────────
  // Export custom models as JSON (active project only)
  // ─────────────────────────────────────────────
  async exportCustomModels() {
    try {
      const models = await this.loadAllCustomModels();
      for (const name of Object.keys(models)) models[name] = this._withMaterials(models[name]);
      const baseModels = await this._baseModelEntries(Object.values(models).map(model => model.basedOn));
      const exportData = { version: 3, exportDate: new Date().toISOString(), models, ...baseModels };
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      downloadBlob(`renderdeck-custom-models-${Date.now()}.json`, blob);
      this.log(`Exported ${Object.keys(models).length} custom model(s)`);
      return true;
    } catch (error) {
      this.log(`Failed to export: ${error.message}`, true);
      return false;
    }
  }

  // An export carries the definitions its parts use, so another project can rebuild them.
  _withMaterials(model) {
    const ids = model.parts
      ? Object.values(model.parts).map(part => part.materialId).filter(Boolean)
      : [model.materialId].filter(Boolean);
    return { ...model, materials: this.materialLibrary?.exportDefinitions(ids) || {} };
  }

  // ─────────────────────────────────────────────
  // Export a single custom model
  // ─────────────────────────────────────────────
  async exportSingleModel(name) {
    try {
      const model = await this.loadCustomModel(name);
      if (!model) { this.log(`Model not found: ${name}`, true); return false; }
      return await this.exportModelData(name, model);
    } catch (error) {
      this.log(`Failed to export model: ${error.message}`, true);
      return false;
    }
  }

  // Download one model's data in the file shape custom models export in.
  async exportModelData(name, model) {
    try {
      const baseModels = await this._baseModelEntries([model.basedOn]);
      const exportData = { version: 3, exportDate: new Date().toISOString(), models: { [name]: this._withMaterials(model) }, ...baseModels };
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      downloadBlob(`${safeFileName(name) || 'model'}-${Date.now()}.json`, blob);
      return true;
    } catch (error) {
      this.log(`Failed to export model: ${error.message}`, true);
      return false;
    }
  }

  // Uploaded models behind these names, with their files, so a file imports into any project:
  // { baseModels: { name: { record, files: [{ key, name, type, dataURL }] } } }, or nothing.
  // key is the part of the blob key after `uploaded:${pid}:${name}`. Standard models are
  // left out because every project has them.
  async _baseModelEntries(names) {
    const projectId = await getActiveProjectId();
    const baseModels = {};
    for (const start of new Set(names)) {
      let name = start;
      for (const seen = new Set(); !seen.has(name);) {
        seen.add(name);
        const custom = await IDBStorage.get('models', modelKey(projectId, name));
        if (custom?.basedOn) name = custom.basedOn;
      }
      if (baseModels[name]) continue;
      const stored = await IDBStorage.get('uploaded-models', `${projectId}:${name}`);
      if (!stored) continue;
      const { projectId: _unused, ...record } = stored;
      const prefix = `uploaded:${projectId}:${name}`;
      const files = [];
      for (const key of uploadedModelBlobKeys(projectId, name, stored)) {
        const blob = await IDBStorage.get('blobs', key);
        if (!blob) continue;
        files.push({
          key: key.slice(prefix.length),
          name: blob.name ?? null,
          type: blob.type,
          dataURL: await IDBStorage.blobToDataURL(blob),
        });
      }
      baseModels[name] = { record, files };
    }
    return Object.keys(baseModels).length ? { baseModels } : {};
  }

  // Writes that recreate an uploaded model from an export file
  _baseModelOps(projectId, name, { record, files }) {
    if (!['uploaded', 'uploaded-glb'].includes(record?.type) || !Array.isArray(files)) {
      throw new Error(`The file's copy of "${name}" is damaged`);
    }
    const ops = files.map(({ key, name: fileName, type, dataURL }) => {
      if (!/^:(glb|obj|mtl(:.+)?|tex:.+)$/.test(key) || !String(dataURL).startsWith('data:')) {
        throw new Error(`The file's copy of "${name}" is damaged`);
      }
      const blob = IDBStorage.dataURLToBlobSync(dataURL);
      return {
        type: 'put',
        store: 'blobs',
        key: `uploaded:${projectId}:${name}${key}`,
        value: fileName ? new File([blob], fileName, { type }) : blob,
      };
    });
    ops.push({ type: 'put', store: 'uploaded-models', key: `${projectId}:${name}`, value: { ...record, name } });
    return ops;
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
  // Import custom models from JSON
  // Accepts both v2 (flat) and v3 (parts) export formats. Imported models are always
  // custom models. hasModel: whether a standard or uploaded model has this name.
  // ─────────────────────────────────────────────
  async importCustomModels(file, { hasModel = () => false } = {}) {
    try {
      const text = await file.text();
      const importData = JSON.parse(text);
      if (!importData.models) {
        return { success: false, error: 'Invalid export file — missing models property' };
      }

      let skippedCount = 0;
      const imported = [];
      const newBaseModels = [];
      const projectId = await getActiveProjectId();
      const fileBases = importData.baseModels && typeof importData.baseModels === 'object' ? importData.baseModels : {};
      const missingBases = Object.keys(fileBases).filter(name => !hasModel(name));
      const nameIsTaken = name => hasModel(name) || name in fileBases;

      for (const [originalName, modelData] of Object.entries(importData.models)) {
        const customNames = await this.getAllCustomModelNames();
        let name = originalName;
        if (nameIsTaken(name)) {
          name = `${originalName} (Custom)`;
          for (let n = 2; nameIsTaken(name) || customNames.includes(name); n++) name = `${originalName} (Custom) (${n})`;
        }
        const existing = customNames.includes(name);
        if (existing) {
          const overwrite = confirm(`Model "${name}" already exists. Overwrite?`);
          if (!overwrite) { skippedCount++; continue; }
        }

        // Normalise v2 flat format to v3 parts format before saving.
        // Overwriting replaces the record, its decals and the old model's
        // working state in one transaction.
        const normalised = await this.materialLibrary.importModelMaterials(this._normaliseImport(modelData));
        // Uploaded models the file carries are written with the first model saved, so a
        // failure leaves neither behind. A model of that name already here is used as it is.
        const extraOps = missingBases.flatMap(base => this._baseModelOps(projectId, base, fileBases[base]));
        const success = await this.saveCustomModel(name, { ...normalised, customName: name }, { replaceWorkingState: existing, extraOps });
        if (success) {
          imported.push({ name, originalName, basedOn: normalised.basedOn });
          newBaseModels.push(...missingBases.splice(0));
        }
      }

      if (imported.length > 0) {
        this.log(`Imported ${imported.length} model(s), skipped ${skippedCount}`);
        return { success: true, name: imported[0].name, imported, newBaseModels, count: imported.length, skipped: skippedCount };
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
      materials:  modelData.materials,
      parts: {
        '__default__': {
          materialId:       modelData.materialId,
          materialPreset:   modelData.materialPreset   || 'Default — White',
          materialData,
          decals: modelData.overlayImages || [],
        },
      },
    };
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
