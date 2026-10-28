
// STORAGEKEYS.JS — Key formats for renderdeck_db
// One place for every compound key so saves, loads and cascade deletes agree.
// Model and part names are URI-encoded inside per-part keys so a ':' in a name
// can't make one model's prefix match another model's keys.

import { encodeKeyPart as enc } from './indexedDBStorage.js';

// ── Per-part working state (keyed by model + part) ───────────
function partSegment(pid, modelName, partName) {
  return `${pid}:${enc(modelName)}:${enc(partName)}`;
}
function modelSegment(pid, modelName) {
  return `${pid}:${enc(modelName)}:`;
}

// metadata: { presetName, presetExplicit, props, channelMaps }
export const partMaterialKey    = (pid, model, part) => `part-material:${partSegment(pid, model, part)}`;
export const partMaterialPrefix = (pid, model)       => `part-material:${modelSegment(pid, model)}`;

// metadata: [{ id, name, type, textData, position, size, rotation, aspectRatio, flipH, flipV }]
export const designMetaKey    = (pid, model, part) => `design-meta:${partSegment(pid, model, part)}`;
export const designMetaPrefix = (pid, model)       => `design-meta:${modelSegment(pid, model)}`;

// blobs: image Blob for one design layer
export const designBlobKey       = (pid, model, part, id) => `design-blob:${partSegment(pid, model, part)}:${id}`;
export const designBlobPartPrefix = (pid, model, part)    => `design-blob:${partSegment(pid, model, part)}:`;
export const designBlobPrefix    = (pid, model)           => `design-blob:${modelSegment(pid, model)}`;

// blobs: first design layer image, shown in the object dropdown
export const designThumbKey = (pid, model) => `design-thumb:${pid}:${enc(model)}`;

// blobs: material sphere thumbnail (data URL) per part, shown in the object dropdown
export const matThumbKey    = (pid, model, part) => `mat-thumb:${partSegment(pid, model, part)}`;
export const matThumbPrefix = (pid, model)       => `mat-thumb:${modelSegment(pid, model)}`;

// node-graphs store key, and blobs for image nodes
export const nodeGraphKey    = (pid, model, part) => partSegment(pid, model, part);
export const nodeGraphPrefix = (pid, model)       => modelSegment(pid, model);
export const nodeImageKey    = (pid, model, part, nodeId) => `node-image:${partSegment(pid, model, part)}:${nodeId}`;
export const nodeImagePrefix = (pid, model)       => `node-image:${modelSegment(pid, model)}`;

// Decode the model/part segments of a per-part key (inverse of partSegment)
export function parsePartKey(key, prefix) {
  const parts = key.slice(prefix.length).split(':');
  if (parts.length < 2) return null;
  return { modelName: decodeURIComponent(parts[0]), partName: decodeURIComponent(parts[1]) };
}

// ── Project-level records ────────────────────────────────────
// metadata: { version: 2, modelName, partName, activeCustomScene, props, mainModelTransform, nodeGraph }
export const sessionKey = (pid) => `session:${pid}`;

// blobs: rendered sphere thumbnail for a user preset (data URL)
export const presetThumbKey    = (pid, uuid) => `preset-thumb:${pid}:${uuid}`;
export const presetThumbPrefix = (pid)       => `preset-thumb:${pid}:`;

// settings store
export const APP_SETTINGS_KEY = 'app';
export const projectSettingsKey = (pid) => pid;

// ── Caches (derived data, safe to clear) ─────────────────────
// blobs: data URL of an HDR rendered onto a sphere
export const envPreviewKey = (id) => `env-preview:${id}`;
export const ENV_PREVIEW_PREFIX = 'env-preview:';
