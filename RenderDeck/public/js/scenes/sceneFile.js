// SCENEFILE.JS — Self-contained .rdscene files (the zip format of projectFile.js)
//
// Inside a project a saved scene only refers to the project's models, props and
// materials, so editing a model updates every scene using it. An exported file also
// carries what those references point to, so it recreates the scene in any project.
//
// project id placeholders, markers and blobs work as described in projectFile.js.
// project.json → { format, version, exportedAt, scene, records: [{ store, key, value }] }

import { strFromU8, unzipSync } from 'fflate';
import * as IDBStorage from '../storage/indexedDBStorage.js';
import { customModelBlobKeys, isProjectKey, modelWorkingStateOps, uploadedModelBlobKeys } from '../storage/cascade.js';
import { decodeValue, encodeRecords, PID_PLACEHOLDER, swapProjectId, zipProjectFile } from '../storage/projectFile.js';
import { getActiveProjectId } from '../storage/ProjectStorage.js';
import {
  materialOverrideKey, materialOverridePrefix, objectOverridePrefix, nativeIdPrefix, partMaterialPrefix,
  uploadedCatalogKey, uploadedPropBlobKey, uploadedPropKey,
} from '../storage/storageKeys.js';
import { encodeKeyPart as enc } from '../storage/indexedDBStorage.js';
import { isSceneData } from './CustomSceneStorage.js';

const FORMAT = 'renderdeck-scene';
const VERSION = 1;
const DEPENDENCY_STORES = new Set(['models', 'blobs', 'metadata', 'materials', 'uploaded-models', 'uploaded-props', 'node-graphs']);

/**
 * Everything a scene depends on, as [{ store, key }] of records that exist:
 * - every uploaded prop it uses: record and file
 * - its model's working state (materials, designs, node graphs, transform); not the
 *   per-part material thumbnails, which get redrawn
 * - a custom model: its record and design images, then the model it's based on
 * - an uploaded model: its record, files and material list
 * - the custom materials its parts use, edits to those materials, edits to the
 *   model's own file materials, and every edited standard material
 * Environments are standard ones, which every project has.
 */
async function collectSceneDependencies(pid, scene) {
  const wanted = new Map(); // `${store}|${key}` → { store, key }
  const add = (store, key) => wanted.set(`${store}|${key}`, { store, key });
  const materialIds = new Set();

  for (const prop of scene.props || []) {
    if (!prop.type?.startsWith('custom_')) continue;
    const name = prop.type.slice('custom_'.length);
    add('uploaded-props', uploadedPropKey(pid, name));
    add('blobs', uploadedPropBlobKey(pid, name));
  }

  const addWorkingState = async (name) => {
    for (const op of modelWorkingStateOps(pid, name)) {
      if (op.type === 'del') add(op.store, op.key);
      else if (!op.prefix.startsWith('mat-thumb:')) {
        for (const key of await IDBStorage.getAllKeys(op.store, op.prefix)) add(op.store, key);
      }
    }
    for (const key of await IDBStorage.getAllKeys('metadata', partMaterialPrefix(pid, name))) {
      const link = await IDBStorage.get('metadata', key);
      if (link?.materialId) materialIds.add(link.materialId);
    }
  };

  const addModel = async (name, seen = new Set()) => {
    if (seen.has(name)) return;
    seen.add(name);
    const custom = await IDBStorage.get('models', `${pid}:${name}`);
    if (custom) {
      add('models', `${pid}:${name}`);
      customModelBlobKeys(custom).forEach(key => add('blobs', key));
      Object.values(custom.parts || {}).forEach(part => { if (part.materialId) materialIds.add(part.materialId); });
      if (custom.basedOn) await addModel(custom.basedOn, seen);
    }
    const uploaded = await IDBStorage.get('uploaded-models', `${pid}:${name}`);
    if (uploaded) {
      add('uploaded-models', `${pid}:${name}`);
      uploadedModelBlobKeys(pid, name, uploaded).forEach(key => add('blobs', key));
      add('metadata', uploadedCatalogKey(pid, name));
    }
    for (const key of await IDBStorage.getAllKeys('metadata', objectOverridePrefix(pid, nativeIdPrefix(name)))) add('metadata', key);
  };

  if (scene.model?.name) {
    await addWorkingState(scene.model.name);
    await addModel(scene.model.name);
  }

  for (const id of materialIds) {
    add('materials', `${pid}:${id}`);
    add('metadata', materialOverrideKey(pid, id));
    const custom = await IDBStorage.get('materials', `${pid}:${id}`);
    if (custom?.textureSource) add('metadata', materialOverrideKey(pid, custom.textureSource));
  }
  for (const key of await IDBStorage.getAllKeys('metadata', `${materialOverridePrefix(pid)}${enc('standard:')}`)) add('metadata', key);

  return [...wanted.values()];
}

/** Pack a saved scene and everything it depends on into a Blob. */
export async function buildSceneFile(name) {
  const pid = await getActiveProjectId();
  const scene = await IDBStorage.get('scenes', `${pid}:${name}`);
  if (!scene) throw new Error(`Scene not found: ${name}`);

  const dependencies = await collectSceneDependencies(pid, scene);
  const present = [];
  for (const { store, key } of dependencies) {
    const value = await IDBStorage.get(store, key);
    if (value !== undefined && value !== null) present.push({ store, key, value });
  }
  const { encoder, records } = encodeRecords(pid, present);
  const manifest = {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    scene: encoder.encode(scene),
    records,
  };
  return zipProjectFile(JSON.stringify(manifest), encoder.attachments);
}

// Equal content, comparing files by size and bytes
async function sameStored(a, b) {
  if (a instanceof Blob || b instanceof Blob) {
    if (!(a instanceof Blob && b instanceof Blob) || a.size !== b.size) return false;
    const [bytesA, bytesB] = await Promise.all([a.arrayBuffer(), b.arrayBuffer()]);
    const viewA = new Uint8Array(bytesA);
    const viewB = new Uint8Array(bytesB);
    return viewA.every((byte, i) => byte === viewB[i]);
  }
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return Object.is(a, b);
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  if (keysA.length !== Object.keys(b).length) return false;
  for (const key of keysA) {
    if (!(key in b) || !await sameStored(a[key], b[key])) return false;
  }
  return true;
}

// What the person calls this record, for the question about conflicts
function recordLabel(store, key, value, pid) {
  const segments = key.split(':');
  const after = segments[segments.indexOf(pid) + 1] ?? '';
  let name = after;
  try { name = decodeURIComponent(after); } catch (_) { /* keep the raw text */ }
  if (store === 'models') return `custom model "${key.slice(pid.length + 1)}"`;
  if (store === 'uploaded-models') return `model "${key.slice(pid.length + 1)}"`;
  if (store === 'uploaded-props' || key.startsWith('uploaded-prop:')) return `prop "${name}"`;
  if (key.startsWith('uploaded:')) return `model "${name}"`;
  if (store === 'materials') return `material "${value?.name ?? name}"`;
  if (key.startsWith('material-override:')) return `material "${value?.name ?? name}"`;
  return `work on "${name}"`;
}

/**
 * Add a .rdscene file's scene and everything it carries to the active project.
 * Records that are identical are skipped; different ones are asked about once.
 * Everything is written in one transaction.
 * @returns {Promise<?{ name: string, uploadedModels: string[] }>} null if cancelled
 */
export async function importSceneFile(file) {
  const notScene = new Error(`"${file.name}" isn't a RenderDeck scene file`);
  let entries;
  try {
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch (_) {
    throw notScene;
  }
  if (!entries['project.json']) throw notScene;
  let manifest;
  try {
    manifest = JSON.parse(strFromU8(entries['project.json']));
  } catch (_) {
    throw notScene;
  }
  if (manifest?.format !== FORMAT) throw notScene;
  if (manifest.version !== VERSION) {
    throw new Error(`"${file.name}" uses scene file version ${manifest.version}; this version of RenderDeck reads version ${VERSION}`);
  }

  const pid = await getActiveProjectId();
  const scene = decodeValue(manifest.scene, pid, entries);
  if (!isSceneData(scene) || !Array.isArray(manifest.records)) throw new Error(`"${file.name}" is damaged`);

  const sceneKey = `${pid}:${scene.name}`;
  if (await IDBStorage.get('scenes', sceneKey) && !confirm(`Scene "${scene.name}" already exists. Overwrite?`)) return null;

  const fresh = [];
  const different = [];
  for (const { store, key, value } of manifest.records) {
    if (!DEPENDENCY_STORES.has(store)) throw new Error(`The file is damaged: unknown store ${store}`);
    if (typeof key !== 'string' || !isProjectKey(key, PID_PLACEHOLDER)) throw new Error(`The file is damaged: bad key ${key}`);
    const record = { store, key: swapProjectId(key, PID_PLACEHOLDER, pid), value: decodeValue(value, pid, entries) };
    const existing = await IDBStorage.get(store, record.key);
    if (existing === undefined || existing === null) fresh.push(record);
    else if (!await sameStored(existing, record.value)) different.push(record);
  }

  let replace = false;
  if (different.length) {
    const labels = [...new Set(different.map(({ store, key, value }) => recordLabel(store, key, value, pid)))];
    replace = confirm(`This scene includes ${labels.length} items that already exist in this project: ${labels.join(', ')}.\n\nOK = replace them with the scene's versions, Cancel = keep yours`);
  }

  const written = [...fresh, ...(replace ? different : [])];
  await IDBStorage.batch([
    ...written.map(({ store, key, value }) => ({ type: 'put', store, key, value })),
    { type: 'put', store: 'scenes', key: sceneKey, value: { ...scene, projectId: pid, updatedAt: Date.now() } },
  ]);
  return {
    name: scene.name,
    uploadedModels: written.filter(({ store }) => store === 'uploaded-models').map(({ key }) => key.slice(pid.length + 1)),
  };
}
