import * as IDBStorage from '../../storage/indexedDBStorage.js';
import { getActiveProjectId } from '../../storage/ProjectStorage.js';
import { uploadedModelBlobKeys } from '../../storage/cascade.js';
import { downloadBlob, safeFileName } from '../../utils/helpers.js';

export async function exportCustomModels(storage) {
  try {
    const models = await storage.loadAllCustomModels();
    for (const name of Object.keys(models)) models[name] = _withMaterials(storage, models[name]);
    const baseModels = await _baseModelEntries(Object.values(models).map(model => model.basedOn));
    const exportData = { version: 3, exportDate: new Date().toISOString(), models, ...baseModels };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    downloadBlob(`renderdeck-custom-models-${Date.now()}.json`, blob);
    storage.log(`Exported ${Object.keys(models).length} custom model(s)`);
    return true;
  } catch (error) {
    storage.log(`Failed to export: ${error.message}`, true);
    return false;
  }
}

export async function exportSingleModel(storage, name) {
  try {
    const model = await storage.loadCustomModel(name);
    if (!model) { storage.log(`Model not found: ${name}`, true); return false; }
    return await exportModelData(storage, name, model);
  } catch (error) {
    storage.log(`Failed to export model: ${error.message}`, true);
    return false;
  }
}

export async function exportModelData(storage, name, model) {
  try {
    const baseModels = await _baseModelEntries([model.basedOn]);
    const exportData = { version: 3, exportDate: new Date().toISOString(), models: { [name]: _withMaterials(storage, model) }, ...baseModels };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    downloadBlob(`${safeFileName(name) || 'model'}-${Date.now()}.json`, blob);
    return true;
  } catch (error) {
    storage.log(`Failed to export model: ${error.message}`, true);
    return false;
  }
}

function _withMaterials(storage, model) {
  const ids = model.parts
    ? Object.values(model.parts).map(part => part.materialId).filter(Boolean)
    : [model.materialId].filter(Boolean);
  return { ...model, materials: storage.materialLibrary?.exportDefinitions(ids) || {} };
}

async function _baseModelEntries(names) {
  const projectId = await getActiveProjectId();
  const baseModels = {};
  for (const start of new Set(names)) {
    let name = start;
    for (const seen = new Set(); !seen.has(name);) {
      seen.add(name);
      const custom = await IDBStorage.get('models', `${projectId}:${name}`);
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

function _baseModelOps(projectId, name, { record, files }) {
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

export async function importCustomModels(storage, file, { hasModel = () => false } = {}) {
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
      const customNames = await storage.getAllCustomModelNames();
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

      const normalised = await storage.materialLibrary.importModelMaterials(_normaliseImport(modelData));
      const extraOps = missingBases.flatMap(base => _baseModelOps(projectId, base, fileBases[base]));
      const success = await storage.saveCustomModel(name, { ...normalised, customName: name }, { replaceWorkingState: existing, extraOps });
      if (success) {
        imported.push({ name, originalName, basedOn: normalised.basedOn });
        newBaseModels.push(...missingBases.splice(0));
      }
    }

    if (imported.length > 0) {
      storage.log(`Imported ${imported.length} model(s), skipped ${skippedCount}`);
      return { success: true, name: imported[0].name, imported, newBaseModels, count: imported.length, skipped: skippedCount };
    }
    return { success: false, error: `No models imported (${skippedCount} skipped)` };
  } catch (error) {
    storage.log(`Failed to import: ${error.message}`, true);
    return { success: false, error: error.message };
  }
}

function _normaliseImport(modelData) {
  if (modelData.parts) return modelData;
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
