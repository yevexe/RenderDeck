
// CASCADE.JS — Everything that belongs to a model or a project, as batch() operations
//
// Deletes are built here and committed by the caller in ONE IDBStorage.batch(),
// so a failure leaves either everything or nothing deleted.

import * as IDBStorage from './indexedDBStorage.js';
import { isSyncInfrastructureStore } from './syncRules.js';
import {
  partMaterialPrefix, designMetaPrefix, designBlobPrefix, designThumbKey,
  matThumbPrefix, nodeGraphPrefix, nodeImagePrefix, modelTransformKey, uploadedModelMtlKey,
  uploadedCatalogKey, objectOverridePrefix, nativeIdPrefix,
} from './storageKeys.js';

// ─────────────────────────────────────────────
// Blob keys referenced by a stored model record
// ─────────────────────────────────────────────

// Uploaded model files: blobs `uploaded:${pid}:${name}:{glb|obj|mtl|tex:<file>}`
export function uploadedModelBlobKeys(pid, name, meta) {
  const prefix = `uploaded:${pid}:${name}`;
  if (meta.type === 'uploaded-glb') return [`${prefix}:glb`];
  return [
    `${prefix}:obj`,
    ...(meta.hasMtl ? [`${prefix}:mtl`] : []),
    ...(meta.mtlNames || []).map(file => uploadedModelMtlKey(pid, name, file)),
    ...(meta.textureNames || []).map(t => `${prefix}:tex:${t}`),
  ];
}

// Custom model decals: v3 per-part overlayKeys, v1/v2 flat overlayKeys
export function customModelBlobKeys(record) {
  if (record.version >= 3 && record.parts) {
    return Object.values(record.parts).flatMap(p => p.overlayKeys || []);
  }
  return record.overlayKeys || [];
}

// ─────────────────────────────────────────────
// Working state keyed by model name: per-part materials, design layers,
// node graphs and the thumbnails derived from them. Library records excluded.
// ─────────────────────────────────────────────
export function modelWorkingStateOps(pid, name) {
  return [
    { type: 'del', store: 'metadata', key: modelTransformKey(pid, name) },
    { type: 'delPrefix', store: 'metadata',    prefix: partMaterialPrefix(pid, name) },
    { type: 'delPrefix', store: 'metadata',    prefix: designMetaPrefix(pid, name) },
    { type: 'delPrefix', store: 'blobs',       prefix: designBlobPrefix(pid, name) },
    { type: 'delPrefix', store: 'blobs',       prefix: matThumbPrefix(pid, name) },
    { type: 'delPrefix', store: 'blobs',       prefix: nodeImagePrefix(pid, name) },
    { type: 'delPrefix', store: 'node-graphs', prefix: nodeGraphPrefix(pid, name) },
    { type: 'del',       store: 'blobs',       key: designThumbKey(pid, name) },
  ];
}

// ─────────────────────────────────────────────
// Everything stored for one model: uploaded files or the custom model record
// with its decals, plus its working state.
// ─────────────────────────────────────────────
export async function modelDeleteOps(pid, name) {
  const ops = modelWorkingStateOps(pid, name);

  const uploaded = await IDBStorage.get('uploaded-models', `${pid}:${name}`);
  if (uploaded) {
    ops.push({ type: 'del', store: 'uploaded-models', key: `${pid}:${name}` });
    for (const key of uploadedModelBlobKeys(pid, name, uploaded)) ops.push({ type: 'del', store: 'blobs', key });
    // Its section in the material list goes with it (MaterialLibrary.prepareObjectDeletion
    // turns anything other objects still use into custom materials first).
    ops.push({ type: 'del', store: 'metadata', key: uploadedCatalogKey(pid, name) });
    ops.push({ type: 'delPrefix', store: 'metadata', prefix: objectOverridePrefix(pid, nativeIdPrefix(name)) });
  }

  const custom = await IDBStorage.get('models', `${pid}:${name}`);
  if (custom) {
    ops.push({ type: 'del', store: 'models', key: `${pid}:${name}` });
    for (const key of customModelBlobKeys(custom)) ops.push({ type: 'del', store: 'blobs', key });
  }
  return ops;
}

// Session record (metadata session:${pid}) with the given models removed —
// the open model/part and their node graphs. Returns null if nothing changes.
export function sessionWithoutModels(session, names) {
  if (!session) return null;
  let changed = false;
  const next = { ...session };
  if (names.includes(session.modelName)) {
    next.modelName = null;
    next.partName = null;
    next.mainModelTransform = null;
    changed = true;
  }
  const graphs = session.nodeGraph?.graphs;
  if (graphs) {
    const kept = Object.fromEntries(Object.entries(graphs)
      .filter(([key]) => !names.some(n => key.startsWith(`${n}|`))));
    if (Object.keys(kept).length !== Object.keys(graphs).length) {
      next.nodeGraph = { ...session.nodeGraph, graphs: kept };
      changed = true;
    }
  }
  return changed ? next : null;
}

// ─────────────────────────────────────────────
// Every record keyed by a project id, in every store.
// A key belongs to the project when the id is one of its ':'-separated
// segments (`${pid}:…`, `prefix:${pid}:…`, or exactly `${pid}`).
// That covers the whole material library: custom materials (materials/${pid}:…), standard
// and native changes and deletions (material-override:${pid}:…), part assignments
// (part-material:${pid}:…), uploaded catalogs (native-catalog:${pid}:…) and every
// material thumbnail (preset-thumb:${pid}:…). The shared native-catalog:standard:… and
// the shipped definitions are not keyed by a project and stay.
// ─────────────────────────────────────────────
export function isProjectKey(key, pid) {
  return typeof key === 'string' && key.split(':').includes(pid);
}

export async function projectDeleteOps(pid) {
  const ops = [];
  for (const store of await IDBStorage.storeNames()) {
    if (isSyncInfrastructureStore(store)) continue;
    for (const key of await IDBStorage.getAllKeys(store)) {
      if (isProjectKey(key, pid)) ops.push({ type: 'del', store, key });
    }
  }
  if ((await IDBStorage.get('metadata', 'activeProjectId')) === pid) {
    ops.push({ type: 'del', store: 'metadata', key: 'activeProjectId' });
  }
  return ops;
}
