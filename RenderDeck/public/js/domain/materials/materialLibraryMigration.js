import * as IDBStorage from '../../storage/indexedDBStorage.js';
import { APP_SETTINGS_KEY, materialOverrideKey, partMaterialProjectPrefix } from '../../storage/storageKeys.js';
import { MaterialLibrary } from './MaterialLibrary.js';

const LIBRARY_FLAG = (pid) => `migrated:material-library:${pid}`;

export async function migrateMaterialLibrary(materialManager) {
  const app = (await IDBStorage.get('settings', APP_SETTINGS_KEY)) || {};
  const hidden = Array.isArray(app.hiddenPresets) ? app.hiddenPresets : [];
  const projects = await IDBStorage.getAll('projects');
  const failures = [];

  for (const project of projects) {
    if (await IDBStorage.get('metadata', LIBRARY_FLAG(project.id))) continue;
    try {
      await _migrateProjectLibrary(project.id, materialManager, hidden);
    } catch (err) {
      failures.push(`${project.name}: ${err.message}`);
    }
  }
  if (failures.length) throw new Error(failures.join('; '));

  if ('hiddenPresets' in app || (await IDBStorage.getAllKeys('blobs', 'thumb:')).length) {
    const { hiddenPresets, ...rest } = app;
    await IDBStorage.batch([
      { type: 'put', store: 'settings', key: APP_SETTINGS_KEY, value: rest },
      { type: 'delPrefix', store: 'blobs', prefix: 'thumb:' },
      { type: 'delPrefix', store: 'blobs', prefix: 'mat-thumb:' },
    ]);
  }
}

async function _migrateProjectLibrary(pid, materialManager, hidden) {
  const library = new MaterialLibrary(materialManager);
  await library.loadProject(pid);
  const ops = [];

  for (const label of hidden) {
    const shipped = materialManager.shippedDefinitions.find(definition => definition.label === label);
    if (shipped) ops.push({ type: 'put', store: 'metadata', key: materialOverrideKey(pid, shipped.id), value: { id: shipped.id, deleted: true } });
  }

  const prefix = partMaterialProjectPrefix(pid);
  for (const key of await IDBStorage.getAllKeys('metadata', prefix)) {
    const record = await IDBStorage.get('metadata', key);
    if (!record || record.materialId !== undefined || !record.presetExplicit) continue;
    const base = library.findByLegacyName(record.presetName);
    if (!base) continue;
    const part = decodeURIComponent(key.slice(prefix.length).split(':')[1] || 'edited');
    const materialId = library.legacyToId(base.id, record, part, ops);
    ops.push({ type: 'put', store: 'metadata', key, value: { version: 2, materialId, fromFile: false } });
  }

  const modelPrefix = `${pid}:`;
  for (const key of await IDBStorage.getAllKeys('models', modelPrefix)) {
    const model = await IDBStorage.get('models', key);
    if (!model) continue;
    const toId = (presetName, presetId, materialData, part) => {
      const { channelMaps, ...props } = materialData || {};
      const base = (presetId && library.get(presetId)) || library.findByLegacyName(presetName)
        || library.legacyEmbeddedCustom(presetName || 'Default — White', props, channelMaps, ops);
      return library.legacyToId(base.id, { props, channelMaps }, part, ops);
    };
    if (model.parts) {
      const parts = Object.fromEntries(Object.entries(model.parts).map(([part, data]) => {
        if (data.materialId !== undefined || data.useOriginalMaterial) return [part, data];
        return [part, { ...data, materialId: toId(data.materialPreset, data.materialPresetId, data.materialData, part) }];
      }));
      ops.push({ type: 'put', store: 'models', key, value: { ...model, parts } });
    } else if (model.materialId === undefined) {
      const materialData = { ...(model.materialProperties || {}), channelMaps: model.channelMaps || undefined };
      ops.push({ type: 'put', store: 'models', key, value: { ...model, materialId: toId(model.materialPreset, model.materialPresetId, materialData, 'custom model') } });
    }
  }

  ops.push({ type: 'put', store: 'metadata', key: LIBRARY_FLAG(pid), value: Date.now() });
  await IDBStorage.batch(ops);
}
