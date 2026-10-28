
// MIGRATIONS.JS — One-time moves into the DB v8 layout
//
// 1. Old IndexedDB key formats → new keys (see storageKeys.js):
//      metadata session:renderdeck.reloadstate.v2:${pid} → settings/${pid} + metadata session:${pid}
//      metadata channelmap:/lastpreset:${pid}:${model}:${part} → metadata part-material:…
//      metadata design-meta:${pid}:${part} + blobs design-blob:${pid}:${part}:${id}
//        → same data under the session's last model (dropped if there is none)
//      blobs design-thumb:${pid}:${model} → encoded key
//      blobs mat-thumb:* and thumb:v1:* → deleted (regenerated caches)
// 2. localStorage → IndexedDB, then the localStorage keys are removed:
//      rd_user_presets[:pid]          → materials/${pid}:${uuid}.params
//      rd_hidden_presets              → settings/app.hiddenPresets
//      renderdeck-swatch-collections  → settings/app.swatchCollections
//      renderdeck_sketchfab_token     → settings/app.sketchfabToken
//      rd_envpreview_v1_*             → blobs env-preview:*
//      session:renderdeck.boot.v1[:pid], rd_active_project, rd_session_boot → used above, removed
//
// Each step commits in one transaction together with its done-flag.

import * as IDBStorage from './indexedDBStorage.js';
import {
  partMaterialKey, designMetaKey, designBlobKey, designThumbKey,
  sessionKey, projectSettingsKey, APP_SETTINGS_KEY, envPreviewKey,
} from './storageKeys.js';

const KEYS_FLAG = 'migrated:v8:keys';
const ORPHAN_PRESETS_FLAG = 'migrated:v8:orphan-presets';

const OLD_SESSION_PREFIX = 'session:renderdeck.reloadstate.v2';
const OLD_BOOT_PREFIX    = 'session:renderdeck.boot.v1';
const LS_PRESETS_PREFIX  = 'rd_user_presets';
const LS_ENV_PREFIX      = 'rd_envpreview_v1_';

// ─────────────────────────────────────────────
// Entry point — call after ensureActiveProject(), before anything is loaded
// ─────────────────────────────────────────────
export async function runMigrations(activeProjectId) {
  if (!(await IDBStorage.get('metadata', KEYS_FLAG))) {
    await _migrateOldKeys(activeProjectId);
  }
  await _migrateLocalStorage(activeProjectId);
}

// ── Helpers ──────────────────────────────────────────────────

function _lsGet(key) {
  try { return localStorage.getItem(key); } catch (_) { return null; }
}

function _lsJSON(key) {
  const raw = _lsGet(key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) { return null; }
}

function _lsKeys() {
  try { return Object.keys(localStorage); } catch (_) { return []; }
}

function _stripPrivate(params) {
  const clean = {};
  for (const [k, v] of Object.entries(params || {})) {
    if (!k.startsWith('_')) clean[k] = v;
  }
  return clean;
}

// 'prefix:pid:a:b' → { pid, rest: 'a:b' }  (project ids never contain ':')
function _splitPid(key, prefix) {
  const body = key.slice(prefix.length);
  const i = body.indexOf(':');
  if (i < 0) return null;
  return { pid: body.slice(0, i), rest: body.slice(i + 1) };
}

// 'model:part' → split at the LAST ':' (part names rarely contain ':')
function _splitLast(rest) {
  const i = rest.lastIndexOf(':');
  if (i < 0) return null;
  return [rest.slice(0, i), rest.slice(i + 1)];
}

// ─────────────────────────────────────────────
// 1. Old IndexedDB keys
// ─────────────────────────────────────────────
async function _migrateOldKeys(activeProjectId) {
  const ops = [];
  const metaKeys = await IDBStorage.getAllKeys('metadata');
  const blobKeys = await IDBStorage.getAllKeys('blobs');
  const partRecords = new Map();   // new part-material key → record
  const sessionModel = new Map();  // pid → last model name

  const partRecord = (pid, model, part) => {
    const key = partMaterialKey(pid, model, part);
    if (!partRecords.has(key)) partRecords.set(key, {});
    return partRecords.get(key);
  };

  // ── Session records → settings + slim session + part material ──
  const oldSessionKeys = metaKeys.filter(k => k.startsWith(OLD_SESSION_PREFIX));
  const bootPids = _lsKeys()
    .filter(k => k.startsWith(OLD_BOOT_PREFIX))
    .map(k => k.slice(OLD_BOOT_PREFIX.length + 1) || activeProjectId);
  const pids = new Set([
    ...oldSessionKeys.map(k => k.slice(OLD_SESSION_PREFIX.length + 1) || activeProjectId),
    ...bootPids,
  ]);

  for (const pid of pids) {
    if (!pid) continue;
    // Prefer the project-scoped record; the unscoped one predates projects
    const scopedKey = `${OLD_SESSION_PREFIX}:${pid}`;
    const useUnscoped = !metaKeys.includes(scopedKey) && pid === activeProjectId && metaKeys.includes(OLD_SESSION_PREFIX);
    const oldKey = useUnscoped ? OLD_SESSION_PREFIX : scopedKey;
    const old  = (await IDBStorage.get('metadata', oldKey)) || {};
    const boot = _lsJSON(`${OLD_BOOT_PREFIX}:${pid}`) || (pid === activeProjectId ? _lsJSON(OLD_BOOT_PREFIX) : null) || {};

    const modelName = boot.modelName || old.modelName || null;
    const partName  = boot.partName  || old.partName  || null;
    if (modelName) sessionModel.set(pid, modelName);

    if (!(await IDBStorage.get('settings', projectSettingsKey(pid)))) {
      ops.push({ type: 'put', store: 'settings', key: projectSettingsKey(pid), value: {
        camera:      old.camState || null,
        view:        boot.camera || old.camera || null,
        renderer:    boot.rendererState || old.rendererState || null,
        background:  typeof old.showEnvBackground === 'boolean' ? {
          showEnvBackground: old.showEnvBackground,
          gradientBgEnabled: !!old.gradientBgEnabled,
          currentGradientBg: old.currentGradientBg || '',
        } : null,
        environment: boot.sceneName || old.sceneName || null,
        ui: old.uvEditor ? {
          wrapImages:      old.uvEditor.wrapImages,
          lockAspectRatio: old.uvEditor.lockAspectRatio,
        } : null,
      } });
    }

    if (!(await IDBStorage.get('metadata', sessionKey(pid)))) {
      ops.push({ type: 'put', store: 'metadata', key: sessionKey(pid), value: {
        version: 2,
        modelName,
        partName,
        activeCustomScene: old.activeCustomScene || null,
        props:     old.props || [],
        mainModelTransform: null,
        nodeGraph: old.nodeGraph || null,
      } });
    }

    // The active part's material values only ever lived in the session record
    if (modelName && partName) {
      const { channelMaps, ...props } = old.materialProperties || boot.materialPropertiesBase || {};
      const rec = partRecord(pid, modelName, partName);
      const preset = boot.materialPreset || old.materialPreset;
      if (preset) {
        rec.presetName = preset;
        rec.presetExplicit = boot.presetExplicitlyApplied ?? old.presetExplicitlyApplied ?? false;
      }
      if (Object.keys(props).length) rec.props = props;
      if (channelMaps) rec.channelMaps = channelMaps;
    }
    if (metaKeys.includes(oldKey)) ops.push({ type: 'del', store: 'metadata', key: oldKey });
  }
  if (metaKeys.includes(OLD_SESSION_PREFIX)) ops.push({ type: 'del', store: 'metadata', key: OLD_SESSION_PREFIX });

  // ── Eager channel-map and last-preset caches → part material ──
  for (const key of metaKeys) {
    const isMaps   = key.startsWith('channelmap:');
    const isPreset = key.startsWith('lastpreset:');
    if (!isMaps && !isPreset) continue;
    const split = _splitPid(key, isMaps ? 'channelmap:' : 'lastpreset:');
    const mp = split && _splitLast(split.rest);
    if (mp) {
      const value = await IDBStorage.get('metadata', key);
      const rec = partRecord(split.pid, mp[0], mp[1]);
      if (isMaps && value) rec.channelMaps = value;                  // eager cache wins over session copy
      if (isPreset && value?.presetName) { rec.presetName = value.presetName; rec.presetExplicit = true; }
    }
    ops.push({ type: 'del', store: 'metadata', key });
  }

  for (const [key, rec] of partRecords) {
    if (await IDBStorage.get('metadata', key)) continue;
    ops.push({ type: 'put', store: 'metadata', key, value: {
      presetName:     rec.presetName ?? null,
      presetExplicit: rec.presetExplicit ?? false,
      props:          rec.props ?? null,
      channelMaps:    rec.channelMaps ?? null,
    } });
  }

  // ── Design layers keyed by part only → session model + part ──
  for (const key of metaKeys.filter(k => k.startsWith('design-meta:'))) {
    const split = _splitPid(key, 'design-meta:');
    ops.push({ type: 'del', store: 'metadata', key });
    const model = split && sessionModel.get(split.pid);
    if (!model) continue;
    const value = await IDBStorage.get('metadata', key);
    ops.push({ type: 'put', store: 'metadata', key: designMetaKey(split.pid, model, split.rest), value });
  }
  for (const key of blobKeys.filter(k => k.startsWith('design-blob:'))) {
    const split = _splitPid(key, 'design-blob:');
    const partId = split && _splitLast(split.rest);
    ops.push({ type: 'del', store: 'blobs', key });
    const model = split && sessionModel.get(split.pid);
    if (!model || !partId) continue;
    const value = await IDBStorage.get('blobs', key);
    ops.push({ type: 'put', store: 'blobs', key: designBlobKey(split.pid, model, partId[0], partId[1]), value });
  }

  // ── Design thumbnails → encoded model segment ──
  for (const key of blobKeys.filter(k => k.startsWith('design-thumb:'))) {
    const split = _splitPid(key, 'design-thumb:');
    if (!split) continue;
    const newKey = designThumbKey(split.pid, split.rest);
    if (newKey === key) continue;
    const value = await IDBStorage.get('blobs', key);
    ops.push({ type: 'del', store: 'blobs', key });
    ops.push({ type: 'put', store: 'blobs', key: newKey, value });
  }

  // ── Regenerated caches ──
  ops.push({ type: 'delPrefix', store: 'blobs', prefix: 'mat-thumb:' });
  ops.push({ type: 'delPrefix', store: 'blobs', prefix: 'thumb:' });

  ops.push({ type: 'put', store: 'metadata', key: KEYS_FLAG, value: Date.now() });
  await IDBStorage.batch(ops);
}

// ─────────────────────────────────────────────
// 2. localStorage → IndexedDB
// ─────────────────────────────────────────────
async function _migrateLocalStorage(activeProjectId) {
  const lsKeys = _lsKeys();
  const ops = [];
  const toRemove = [];

  // ── App-wide values → settings/app (stored value wins if already set) ──
  const app = { ...((await IDBStorage.get('settings', APP_SETTINGS_KEY)) || {}) };
  let appChanged = false;
  const swatches = _lsJSON('renderdeck-swatch-collections');
  if (swatches) {
    if (!app.swatchCollections && Array.isArray(swatches) && swatches.length) { app.swatchCollections = swatches; appChanged = true; }
    toRemove.push('renderdeck-swatch-collections');
  }
  const hidden = _lsJSON('rd_hidden_presets');
  if (hidden) {
    if (!app.hiddenPresets && Array.isArray(hidden)) { app.hiddenPresets = hidden; appChanged = true; }
    toRemove.push('rd_hidden_presets');
  }
  const token = _lsGet('renderdeck_sketchfab_token');
  if (token !== null) {
    if (!app.sketchfabToken && token) { app.sketchfabToken = token; appChanged = true; }
    toRemove.push('renderdeck_sketchfab_token');
  }
  if (appChanged) ops.push({ type: 'put', store: 'settings', key: APP_SETTINGS_KEY, value: app });

  // ── User preset values → materials records ──
  const presetKeys = lsKeys.filter(k => k === LS_PRESETS_PREFIX || k.startsWith(`${LS_PRESETS_PREFIX}:`));
  const migratedPids = new Set();
  for (const key of presetKeys) {
    const pid = key === LS_PRESETS_PREFIX ? activeProjectId : key.slice(LS_PRESETS_PREFIX.length + 1);
    toRemove.push(key);
    // The unscoped legacy key only applies if the project has no scoped key of its own
    if (key === LS_PRESETS_PREFIX && lsKeys.includes(`${LS_PRESETS_PREFIX}:${pid}`)) continue;
    if (!pid || migratedPids.has(pid)) continue;
    migratedPids.add(pid);
    const data = _lsJSON(key);
    if (!data?.names || !data?.params) continue;
    for (let i = 0; i < data.names.length; i++) {
      const name = data.names[i];
      const params = data.params[name];
      if (!params) continue;
      const id = params._id || crypto.randomUUID();
      const existing = await IDBStorage.get('materials', `${pid}:${id}`);
      if (existing?.params) continue; // already migrated
      ops.push({ type: 'put', store: 'materials', key: `${pid}:${id}`, value: {
        id,
        projectId: pid,
        name,
        order: data.names.length - i, // names are newest first
        params: _stripPrivate(params),
        materialData: { channelMaps: existing?.materialData?.channelMaps ?? null },
      } });
    }
  }
  // Preset records without values can never be loaded (their values were only in
  // localStorage, or the preset was deleted) — remove them, once.
  if (!(await IDBStorage.get('metadata', ORPHAN_PRESETS_FLAG))) {
    const writtenPresetKeys = new Set(ops.filter(o => o.store === 'materials').map(o => o.key));
    for (const key of await IDBStorage.getAllKeys('materials')) {
      if (writtenPresetKeys.has(key)) continue;
      const rec = await IDBStorage.get('materials', key);
      if (!rec?.params) ops.push({ type: 'del', store: 'materials', key });
    }
    ops.push({ type: 'put', store: 'metadata', key: ORPHAN_PRESETS_FLAG, value: Date.now() });
  }

  // ── Environment preview cache ──
  for (const key of lsKeys.filter(k => k.startsWith(LS_ENV_PREFIX))) {
    const dataUrl = _lsGet(key);
    if (dataUrl) ops.push({ type: 'put', store: 'blobs', key: envPreviewKey(key.slice(LS_ENV_PREFIX.length)), value: dataUrl });
    toRemove.push(key);
  }

  // ── Keys whose data was already moved or is now kept in IndexedDB ──
  for (const key of lsKeys) {
    if (key.startsWith(OLD_BOOT_PREFIX) || key === 'rd_active_project' || key === 'rd_session_boot') {
      toRemove.push(key);
    }
  }

  // IndexedDB first; localStorage keys are removed only once the write committed
  await IDBStorage.batch(ops);
  for (const key of toRemove) {
    try { localStorage.removeItem(key); } catch (_) {}
  }
}
