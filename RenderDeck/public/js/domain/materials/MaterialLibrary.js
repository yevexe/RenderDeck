// MATERIALLIBRARY.JS — One material library per project; every library rule lives here
//
// Each material is one entry with one definition, referenced by a stable id:
//   standard  `standard:${configId}`  shipped JSON + this project's override
//   native    `native:${object}:${name}:${n}`  object file + this project's override
//   custom    `${uuid}`               materials/${pid}:${uuid}
//   internal  `internal:white`        plain white fallback, never listed or deleted
//
// Overrides (metadata material-override:${pid}:${enc(id)}) hold only what the user
// changed, or { deleted: true }. Nothing is shared between projects except the shipped
// definitions and the catalogs read from standard object files.
//
// Parts refer to entries by id (metadata part-material:… → { version: 2, materialId,
// fromFile }), custom models by parts[part].materialId. Each part still has its own
// THREE material instance; main.js applies definition changes across the instances.

import * as THREE from 'three';
import { applyTexQuality } from '../../engine/textureQuality.js';
import * as IDBStorage from '../../storage/indexedDBStorage.js';
import {
  materialOverrideKey, materialOverridePrefix, materialThumbKey, standardCatalogKey,
  uploadedCatalogKey, uploadedCatalogPrefix, partMaterialProjectPrefix, nativeIdPrefix,
} from '../../storage/storageKeys.js';

export const FALLBACK_ID = 'internal:white';
export const DEFAULT_STANDARD_ID = 'standard:RDM_Default_White';

export const CHANNELS = [
  'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'bumpMap', 'displacementMap',
  'specularColorMap', 'specularIntensityMap', 'clearcoatMap', 'clearcoatRoughnessMap',
  'clearcoatNormalMap', 'alphaMap', 'transmissionMap', 'thicknessMap',
  'sheenColorMap', 'sheenRoughnessMap', 'emissiveMap',
  'anisotropyMap', 'iridescenceMap', 'iridescenceThicknessMap',
];
const COLOR_CHANNELS = new Set(['map', 'emissiveMap', 'sheenColorMap', 'specularColorMap', 'attenuationColorMap']);

function sameValue(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-3;
  if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
  return a === b;
}

function sameMaps(a, b) {
  const keysA = Object.keys(a || {});
  return keysA.length === Object.keys(b || {}).length && keysA.every(key => a[key] === b[key]);
}

// Reflectivity is derived from IOR, so it is never compared.
function sameParams(base, params) {
  return Object.entries(params || {}).every(([key, value]) => key === 'reflectivity' || !(key in base) || sameValue(base[key], value));
}

// Short key for a saved version; its text can hold whole images as data URLs.
function hashString(text) {
  let a = 0x811c9dc5, b = 0x1b873593;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b ^ code, 0x5bd1e995);
  }
  return `${text.length}-${(a >>> 0).toString(36)}-${(b >>> 0).toString(36)}`;
}

// Convert a texture's image to a data URL. Returns null if it can't be read.
export function textureToDataURL(tex) {
  const img = tex?.image;
  if (!img) return null;
  if (!(img instanceof HTMLImageElement || img instanceof HTMLCanvasElement || img instanceof ImageBitmap)) return null;
  const w = img.naturalWidth || img.width || 256;
  const h = img.naturalHeight || img.height || 256;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  try {
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/png');
  } catch { return null; }
}

export class MaterialLibrary {
  // loadNativeSources(objectName) → Map(id → pristine physical material), from the object's file
  constructor(materialManager, { standardObjects = [], loadNativeSources = null } = {}) {
    this.materialManager = materialManager;
    this.standardObjects = standardObjects;
    this.loadNativeSources = loadNativeSources;
    this._reset(null);
  }

  _reset(projectId) {
    this.projectId = projectId;
    this.entries = new Map();
    this._overrides = new Map();
    this._catalogs = new Map();    // objectName → catalog record
    this._sources = new Map();     // native id → pristine material for this session
    this._sourceLoads = new Map(); // objectName → in-flight load
    this._textures = new Map();    // `${id}|${channel}` → { url, promise }
    this._writes = new Map();      // id → write chain, so writes to one entry stay ordered
    this.loaded = false;
  }

  // ─── Loading ──────────────────────────────────────────────────
  // Everything in memory is replaced, so nothing carries over from another project.
  async loadProject(projectId) {
    this._reset(projectId);
    this.entries.set(FALLBACK_ID, this._makeEntry(FALLBACK_ID, 'internal', 'White', { color: '#ffffff', metalness: 0, roughness: 0.5 }));
    for (const shipped of this.materialManager.shippedDefinitions) {
      this.entries.set(shipped.id, this._makeEntry(shipped.id, 'standard', shipped.label, shipped.params));
    }
    if (!projectId) { this.loaded = true; return; }

    const overrideKeys = await IDBStorage.getAllKeys('metadata', materialOverridePrefix(projectId));
    for (const key of overrideKeys) {
      const record = await IDBStorage.get('metadata', key);
      if (record?.id) this._overrides.set(record.id, record);
    }
    const catalogs = await Promise.all(this.standardObjects.map(object => IDBStorage.get('metadata', standardCatalogKey(object.label))));
    const uploaded = await IDBStorage.getAll('metadata', uploadedCatalogPrefix(projectId));
    [...catalogs, ...uploaded].filter(Boolean).forEach(catalog => this._addCatalogEntries(catalog));
    for (const entry of this.entries.values()) this._applyOverride(entry);

    for (const record of await IDBStorage.getAll('materials', `${projectId}:`)) {
      if (record?.id && record.name && record.params) this.entries.set(record.id, this._customEntry(record));
    }
    this.loaded = true;
  }

  _fullParams(name, params) {
    const material = this.materialManager.createMaterial(name, params);
    const full = this.materialManager.extractProperties(material);
    material.dispose();
    return full;
  }

  _makeEntry(id, origin, name, params, extra = {}) {
    const baseParams = origin === 'native' ? { ...params } : this._fullParams(name, params);
    return {
      id, origin, name, baseName: name, baseParams, params: { ...baseParams },
      channelMaps: {}, clearedChannels: [], deleted: false, objectName: null, textureSource: null, ...extra,
    };
  }

  _customEntry(record) {
    return {
      id: record.id, origin: 'custom', name: record.name, baseName: record.name,
      baseParams: {}, params: this._fullParams(record.name, record.params),
      channelMaps: { ...(record.materialData?.channelMaps || {}) },
      clearedChannels: [...(record.materialData?.clearedChannels || [])],
      deleted: false, objectName: null, order: record.order ?? 0,
      textureSource: record.textureSource || null, legacyKey: record.legacyKey || null, legacyBase: record.legacyBase || null,
    };
  }

  _applyOverride(entry) {
    const override = this._overrides.get(entry.id);
    entry.deleted = !!override?.deleted;
    entry.name = override?.name || entry.baseName;
    entry.params = { ...entry.baseParams, ...(override?.params || {}) };
    entry.channelMaps = { ...(override?.channelMaps || {}) };
    entry.clearedChannels = [...(override?.clearedChannels || [])];
  }

  _addCatalogEntries(catalog) {
    this._catalogs.set(catalog.objectName, catalog);
    for (const item of catalog.materials) {
      if (this.entries.has(item.id)) continue;
      const entry = this._makeEntry(item.id, 'native', item.name, item.params, { objectName: catalog.objectName });
      this._applyOverride(entry);
      this.entries.set(item.id, entry);
    }
  }

  isStandardObject(objectName) {
    return this.standardObjects.some(object => object.label === objectName);
  }

  hasCatalog(objectName) {
    return this._catalogs.has(objectName);
  }

  getCatalog(objectName) {
    return this._catalogs.get(objectName) || null;
  }

  // Read-only for standard objects (shared and derived from the file); per project for uploads.
  async addCatalog(catalog) {
    const key = this.isStandardObject(catalog.objectName)
      ? standardCatalogKey(catalog.objectName)
      : uploadedCatalogKey(this.projectId, catalog.objectName);
    await IDBStorage.put('metadata', key, catalog);
    this._addCatalogEntries(catalog);
  }

  // An upload's list was just stored by ModelManager.
  noteCatalog(catalog) {
    this._addCatalogEntries(catalog);
  }

  // ─── Reading ──────────────────────────────────────────────────
  get(id) {
    return this.entries.get(id) || null;
  }

  isListed(id) {
    const entry = this.get(id);
    return !!entry && !entry.deleted && entry.origin !== 'internal';
  }

  fallbackId() {
    return this.isListed(DEFAULT_STANDARD_ID) ? DEFAULT_STANDARD_ID : FALLBACK_ID;
  }

  // The id a reference points at, or the fallback if that material is gone.
  resolveId(id) {
    const entry = id ? this.get(id) : null;
    return entry && !entry.deleted ? id : this.fallbackId();
  }

  listedIds() {
    return [...this.entries.values()].filter(entry => this.isListed(entry.id)).map(entry => entry.id);
  }

  // Sections for the material dropdown; empty ones are left to the caller to skip.
  getSections() {
    const item = entry => ({ value: entry.id, label: entry.name });
    const listed = [...this.entries.values()].filter(entry => this.isListed(entry.id));
    const sections = [
      { label: 'Custom Materials', items: listed.filter(e => e.origin === 'custom').sort((a, b) => (b.order ?? 0) - (a.order ?? 0)).map(item) },
      { label: 'Standard Materials', items: listed.filter(e => e.origin === 'standard').map(item) },
    ];
    const objectOrder = [
      ...this.standardObjects.map(object => object.label).filter(name => this._catalogs.has(name)),
      ...[...this._catalogs.keys()].filter(name => !this.isStandardObject(name)),
    ];
    for (const objectName of objectOrder) {
      sections.push({ label: objectName, isObject: true, items: listed.filter(e => e.origin === 'native' && e.objectName === objectName).map(item) });
    }
    return sections;
  }

  // Which legacy preset name a pre-library record meant.
  findByLegacyName(name) {
    if (!name) return null;
    for (const entry of this.entries.values()) {
      if ((entry.origin === 'standard' || entry.origin === 'custom') && entry.baseName === name) return entry;
    }
    return null;
  }

  // ─── Editing (memory now; persist(id) writes it) ──────────────
  setParams(id, params) {
    const entry = this.get(id);
    if (!entry) return false;
    let changed = false;
    for (const [key, value] of Object.entries(params)) {
      if (key === 'reflectivity' || sameValue(entry.params[key], value)) continue;
      entry.params[key] = value;
      changed = true;
    }
    return changed;
  }

  // value: data URL = uploaded, null = cleared, undefined = back to what the file has
  setChannel(id, channel, value) {
    const entry = this.get(id);
    if (!entry) return;
    delete entry.channelMaps[channel];
    entry.clearedChannels = entry.clearedChannels.filter(ch => ch !== channel);
    if (value) entry.channelMaps[channel] = value;
    else if (value === null) entry.clearedChannels.push(channel);
  }

  setChannels(id, channelMaps, clearedChannels = []) {
    const entry = this.get(id);
    if (!entry) return;
    entry.channelMaps = { ...(channelMaps || {}) };
    entry.clearedChannels = [...clearedChannels];
  }

  _enqueue(id, task) {
    const next = (this._writes.get(id) || Promise.resolve()).catch(() => {}).then(task);
    this._writes.set(id, next);
    return next;
  }

  _customRecord(entry) {
    return {
      id: entry.id, projectId: this.projectId, name: entry.name, order: entry.order ?? 0,
      params: { ...entry.params }, textureSource: entry.textureSource || null,
      legacyKey: entry.legacyKey || null, legacyBase: entry.legacyBase || null,
      materialData: { channelMaps: Object.keys(entry.channelMaps).length ? entry.channelMaps : null, clearedChannels: entry.clearedChannels },
    };
  }

  _customPutOp(entry) {
    return { type: 'put', store: 'materials', key: `${this.projectId}:${entry.id}`, value: this._customRecord(entry) };
  }

  // Only what differs from the shipped or file definition is stored.
  _overrideOp(entry) {
    const key = materialOverrideKey(this.projectId, entry.id);
    const params = Object.fromEntries(Object.entries(entry.params)
      .filter(([name, value]) => name !== 'reflectivity' && !sameValue(entry.baseParams[name], value)));
    const record = { id: entry.id };
    if (entry.name !== entry.baseName) record.name = entry.name;
    if (Object.keys(params).length) record.params = params;
    if (Object.keys(entry.channelMaps).length) record.channelMaps = entry.channelMaps;
    if (entry.clearedChannels.length) record.clearedChannels = entry.clearedChannels;
    if (Object.keys(record).length === 1) {
      this._overrides.delete(entry.id);
      return { type: 'del', store: 'metadata', key };
    }
    this._overrides.set(entry.id, record);
    return { type: 'put', store: 'metadata', key, value: record };
  }

  persist(id) {
    return this._enqueue(id, async () => {
      const entry = this.get(id);
      if (!entry || entry.deleted) return;
      await IDBStorage.batch([entry.origin === 'custom' ? this._customPutOp(entry) : this._overrideOp(entry)]);
    });
  }

  rename(id, name) {
    const entry = this.get(id);
    if (!entry || entry.origin === 'internal' || !name) return Promise.resolve(false);
    const previous = entry.name;
    entry.name = name;
    return this.persist(id).then(() => true, err => { entry.name = previous; throw err; });
  }

  // ─── Custom materials ─────────────────────────────────────────
  _newCustomEntry(fields) {
    return {
      id: crypto.randomUUID(), origin: 'custom', baseParams: {}, channelMaps: {}, clearedChannels: [],
      deleted: false, objectName: null, order: Date.now(), textureSource: null, legacyKey: null, legacyBase: null,
      ...fields, baseName: fields.name,
    };
  }

  // "New material": always custom, whatever it was made from. A copy of a native
  // material keeps pointing at the file for its textures instead of copying them.
  async createCustomFrom(id) {
    const source = this.get(id);
    if (!source) throw new Error('Material not found');
    const entry = this._newCustomEntry({
      name: `${source.name} (custom)`,
      params: { ...source.params },
      channelMaps: { ...source.channelMaps },
      clearedChannels: [...source.clearedChannels],
      textureSource: source.origin === 'native' ? source.id : source.textureSource,
      legacyBase: source.legacyBase || null,
    });
    await IDBStorage.batch([this._customPutOp(entry)]);
    this.entries.set(entry.id, entry);
    return entry;
  }

  // ─── References ───────────────────────────────────────────────
  // Every saved record pointing at one of these ids, in every object of this project.
  // skipModels: models being deleted in the same transaction.
  async _referenceOps(idMap, skipModels = []) {
    const ops = [];
    const prefix = partMaterialProjectPrefix(this.projectId);
    const skipped = model => skipModels.includes(model);
    for (const key of await IDBStorage.getAllKeys('metadata', prefix)) {
      if (skipped(decodeURIComponent(key.slice(prefix.length).split(':')[0]))) continue;
      const record = await IDBStorage.get('metadata', key);
      if (record?.materialId && idMap.has(record.materialId)) {
        ops.push({ type: 'put', store: 'metadata', key, value: { ...record, materialId: idMap.get(record.materialId), fromFile: false } });
      }
    }
    const modelPrefix = `${this.projectId}:`;
    for (const key of await IDBStorage.getAllKeys('models', modelPrefix)) {
      if (skipped(key.slice(modelPrefix.length))) continue;
      const model = await IDBStorage.get('models', key);
      if (!model) continue;
      let changed = false;
      const next = { ...model };
      if (idMap.has(model.materialId)) { next.materialId = idMap.get(model.materialId); changed = true; }
      if (model.parts) {
        next.parts = Object.fromEntries(Object.entries(model.parts).map(([part, data]) => {
          if (!idMap.has(data.materialId)) return [part, data];
          changed = true;
          return [part, { ...data, materialId: idMap.get(data.materialId) }];
        }));
      }
      if (changed) ops.push({ type: 'put', store: 'models', key, value: next });
    }
    return ops;
  }

  // Ids used by saved parts of any model other than skipModels.
  async _idsUsedOutside(skipModels) {
    const used = new Set();
    const prefix = partMaterialProjectPrefix(this.projectId);
    for (const key of await IDBStorage.getAllKeys('metadata', prefix)) {
      if (skipModels.includes(decodeURIComponent(key.slice(prefix.length).split(':')[0]))) continue;
      const record = await IDBStorage.get('metadata', key);
      if (record?.materialId) used.add(record.materialId);
    }
    const modelPrefix = `${this.projectId}:`;
    for (const key of await IDBStorage.getAllKeys('models', modelPrefix)) {
      if (skipModels.includes(key.slice(modelPrefix.length))) continue;
      const model = await IDBStorage.get('models', key);
      if (model?.materialId) used.add(model.materialId);
      Object.values(model?.parts || {}).forEach(part => { if (part.materialId) used.add(part.materialId); });
    }
    return used;
  }

  // ─── Deleting ─────────────────────────────────────────────────
  // Saved parts move to the fallback in the same transaction. Returns the fallback id,
  // for the caller to apply to loaded parts.
  async deleteMaterial(id) {
    const entry = this.get(id);
    if (!entry || !this.isListed(id)) return null;
    const wasFallback = this.fallbackId() === id;
    const fallback = wasFallback ? FALLBACK_ID : this.fallbackId();
    return this._enqueue(id, async () => {
      const ops = await this._referenceOps(new Map([[id, fallback]]));
      ops.push({ type: 'del', store: 'blobs', key: materialThumbKey(this.projectId, id) });
      if (entry.origin === 'custom') {
        ops.push({ type: 'del', store: 'materials', key: `${this.projectId}:${id}` });
      } else {
        ops.push({ type: 'put', store: 'metadata', key: materialOverrideKey(this.projectId, id), value: { id, deleted: true } });
      }
      await IDBStorage.batch(ops);
      if (entry.origin === 'custom') {
        this.entries.delete(id);
      } else {
        this._overrides.set(id, { id, deleted: true });
        this._applyOverride(entry);
      }
      this._dropTextures(id);
      return fallback;
    });
  }

  // ─── Resets ───────────────────────────────────────────────────
  async _resetOverrides(ids, extraOps = []) {
    const ops = [...extraOps];
    for (const id of ids) {
      ops.push({ type: 'del', store: 'metadata', key: materialOverrideKey(this.projectId, id) });
      ops.push({ type: 'del', store: 'blobs', key: materialThumbKey(this.projectId, id) });
    }
    await IDBStorage.batch(ops);
    for (const id of ids) {
      this._overrides.delete(id);
      this._applyOverride(this.get(id));
      this._dropTextures(id);
    }
  }

  // "Load Standard". Returns every id that changed. The fallback is reset with them and
  // parts that fell back to it return to 'Default — White'.
  async resetStandardMaterials() {
    const ids = [...this.entries.values()].filter(e => e.origin === 'standard' || e.origin === 'internal').map(e => e.id);
    await this._resetOverrides(ids, await this._referenceOps(new Map([[FALLBACK_ID, DEFAULT_STANDARD_ID]])));
    return ids;
  }

  // "Restore Standard Objects": only deleted natives; edits stay.
  async restoreDeletedNatives() {
    const ids = [...this.entries.values()]
      .filter(e => e.origin === 'native' && e.deleted && this.isStandardObject(e.objectName)).map(e => e.id);
    if (ids.length) await this._resetOverrides(ids);
    return ids;
  }

  // "Restore Original": back to the shipped/file values, or for a custom material to
  // the snapshot taken when the part loaded. Brings a deleted one back.
  async restoreOriginal(id, snapshot = null) {
    const entry = this.get(id);
    if (entry && entry.origin !== 'custom') {
      await this._resetOverrides([id]);
      return;
    }
    if (!snapshot) return;
    const restored = { ...snapshot, params: { ...snapshot.params }, channelMaps: { ...snapshot.channelMaps }, clearedChannels: [...snapshot.clearedChannels] };
    await IDBStorage.batch([this._customPutOp(restored)]);
    this.entries.set(id, restored);
    this._dropTextures(id);
  }

  // ─── Deleting an object ───────────────────────────────────────
  // Its native materials go. Any that other objects still use become custom materials,
  // with the file's textures copied in because the file is about to be gone.
  // Returns { ops, commit }: add ops to the delete transaction, call commit() after it.
  async prepareObjectDeletion(objectNames, modelNames) {
    const natives = [...this.entries.values()].filter(e => e.origin === 'native' && objectNames.includes(e.objectName));
    if (!natives.length) {
      return { ops: [], idMap: new Map(), commit: () => objectNames.forEach(name => this._catalogs.delete(name)) };
    }
    const nativeIds = new Set(natives.map(e => e.id));
    const used = await this._idsUsedOutside(modelNames);
    const ops = [];
    const idMap = new Map();
    const created = [];
    const updated = [];

    const fileMaps = async (id) => {
      const source = await this.ensureSource(id);
      const maps = {};
      for (const channel of CHANNELS) {
        const url = source[channel] ? textureToDataURL(source[channel]) : null;
        if (url) maps[channel] = url;
      }
      return maps;
    };

    for (const entry of natives) {
      if (!used.has(entry.id)) continue;
      const maps = await fileMaps(entry.id);
      entry.clearedChannels.forEach(channel => { delete maps[channel]; });
      const custom = this._newCustomEntry({
        name: entry.name, params: { ...entry.params },
        channelMaps: { ...maps, ...entry.channelMaps }, clearedChannels: [...entry.clearedChannels],
      });
      ops.push(this._customPutOp(custom));
      idMap.set(entry.id, custom.id);
      created.push(custom);
    }
    for (const entry of this.entries.values()) {
      if (entry.origin !== 'custom' || !nativeIds.has(entry.textureSource)) continue;
      const maps = await fileMaps(entry.textureSource);
      entry.clearedChannels.forEach(channel => { delete maps[channel]; });
      const next = { ...entry, channelMaps: { ...maps, ...entry.channelMaps }, textureSource: null };
      ops.push(this._customPutOp(next));
      updated.push(next);
    }
    if (idMap.size) ops.push(...await this._referenceOps(idMap, modelNames));
    for (const id of nativeIds) ops.push({ type: 'del', store: 'blobs', key: materialThumbKey(this.projectId, id) });

    return {
      ops,
      idMap,
      commit: () => {
        created.forEach(entry => this.entries.set(entry.id, entry));
        updated.forEach(entry => this.entries.set(entry.id, entry));
        for (const id of nativeIds) { this.entries.delete(id); this._overrides.delete(id); this._sources.delete(id); this._dropTextures(id); }
        objectNames.forEach(name => this._catalogs.delete(name));
      },
    };
  }

  // ─── File materials ───────────────────────────────────────────
  hasSource(id) {
    return this._sources.has(id);
  }

  // A loaded file's pristine material becomes the entry's base values for this session.
  registerSource(id, material) {
    this._sources.set(id, material);
    const entry = this.get(id);
    if (!entry) return;
    const changes = this._overrideParams(entry); // includes edits not written yet
    entry.baseParams = this.materialManager.extractProperties(material);
    entry.params = { ...entry.baseParams, ...changes };
  }

  // File textures can be gigabytes, so only what loaded parts use stays in memory.
  releaseSources(keepIds = new Set()) {
    for (const [id, material] of this._sources) {
      if (keepIds.has(id)) continue;
      material.dispose();
      this._sources.delete(id);
    }
  }

  async ensureSource(id) {
    if (this._sources.has(id)) return this._sources.get(id);
    const entry = this.get(id);
    const objectName = entry?.objectName || this._objectOfNative(id);
    if (!objectName || !this.loadNativeSources) throw new Error('Its object is not available');
    if (!this._sourceLoads.has(objectName)) {
      const load = Promise.resolve(this.loadNativeSources(objectName)).finally(() => this._sourceLoads.delete(objectName));
      this._sourceLoads.set(objectName, load);
    }
    const loaded = await this._sourceLoads.get(objectName);
    const material = loaded.get(id);
    if (!material) throw new Error(`${objectName} no longer contains this material`);
    if (!this._sources.has(id)) this.registerSource(id, material);
    return this._sources.get(id);
  }

  _objectOfNative(id) {
    for (const [objectName, catalog] of this._catalogs) {
      if (id.startsWith(nativeIdPrefix(objectName))) return objectName;
    }
    return null;
  }

  // ─── Textures and instances ───────────────────────────────────
  _dropTextures(id) {
    for (const key of [...this._textures.keys()]) {
      if (!key.startsWith(`${id}|`)) continue;
      this._textures.get(key).promise.then(texture => texture.dispose(), () => {});
      this._textures.delete(key);
    }
  }

  _loadChannelTexture(id, channel, url) {
    const key = `${id}|${channel}`;
    const cached = this._textures.get(key);
    if (cached?.url === url) return cached.promise;
    if (cached) cached.promise.then(texture => texture.dispose(), () => {});
    const promise = new THREE.TextureLoader().loadAsync(url).then(texture => {
      texture.colorSpace = COLOR_CHANNELS.has(channel) ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
      applyTexQuality(texture);
      return texture;
    });
    this._textures.set(key, { url, promise });
    return promise;
  }

  // What this entry's channel should hold right now: an upload, nothing, or the file's.
  async channelTexture(id, channel, { allowFileLoad = true } = {}) {
    const entry = this.get(id);
    if (!entry) return null;
    if (entry.channelMaps[channel]) return this._loadChannelTexture(id, channel, entry.channelMaps[channel]);
    if (entry.clearedChannels.includes(channel)) return null;
    const sourceId = entry.origin === 'native' ? id : entry.textureSource;
    if (!sourceId) return null;
    if (!allowFileLoad && !this._sources.has(sourceId)) return null;
    return (await this.ensureSource(sourceId))[channel] ?? null;
  }

  // A new THREE material for one part. Throws if a needed file can't be loaded.
  async createInstance(id, { allowFileLoad = true } = {}) {
    const entry = this.get(id);
    if (!entry) throw new Error('Material not found');
    const sourceId = entry.origin === 'native' ? id : entry.textureSource;
    let material;
    if (sourceId && (allowFileLoad || this._sources.has(sourceId))) {
      material = (await this.ensureSource(sourceId)).clone();
    } else if (entry.legacyBase) {
      material = this.materialManager.createLegacyPreset(entry.legacyBase);
    } else {
      material = this.materialManager.createMaterial(entry.name, entry.params);
    }
    this.materialManager.applySavedProperties(material, entry.params);
    material.name = entry.name;
    material.userData.libId = id;
    for (const channel of new Set([...Object.keys(entry.channelMaps), ...entry.clearedChannels])) {
      material[channel] = await this.channelTexture(id, channel, { allowFileLoad: false });
    }
    material.needsUpdate = true;
    return material;
  }

  // For thumbnails: never downloads a file, so a material whose object isn't loaded
  // renders from its values until the textures are available.
  createPreview(id) {
    return this.createInstance(id, { allowFileLoad: false });
  }

  // ─── Pre-library data ─────────────────────────────────────────
  // Find the entry a saved version of a part matches, or make a custom material for
  // it. Pushes writes onto ops; the same version always maps to the same material.
  legacyToId(baseId, { props, channelMaps, clearedChannels }, nameHint, ops) {
    const base = this.get(baseId) || this.get(this.fallbackId());
    const baseFull = base.origin === 'native' ? base.params : this._fullParams(base.name, base.params);
    const maps = channelMaps || {};
    const cleared = clearedChannels || [];
    const clearsSomething = base.origin === 'native' || base.textureSource ? cleared.length > 0 : false;
    if (sameParams(baseFull, props) && sameMaps(base.channelMaps, maps) && !clearsSomething) return base.id;

    const legacyKey = hashString(JSON.stringify([base.id, props || {}, maps, cleared]));
    for (const entry of this.entries.values()) {
      if (entry.origin === 'custom' && entry.legacyKey === legacyKey) return entry.id;
    }
    const custom = this._newCustomEntry({
      name: `${base.name} (${nameHint})`,
      params: { ...baseFull, ...(props || {}) },
      channelMaps: { ...maps },
      clearedChannels: [...cleared],
      textureSource: base.origin === 'native' ? base.id : base.textureSource,
      legacyKey,
      legacyBase: base.legacyBase || null,
    });
    this.entries.set(custom.id, custom);
    ops.push(this._customPutOp(custom));
    return custom.id;
  }

  // A custom material a pre-library custom model carried inside itself.
  legacyEmbeddedCustom(name, props, channelMaps, ops) {
    const existing = this.findByLegacyName(name);
    if (existing) return existing;
    const legacyBase = this.materialManager.isLegacyPreset(name) ? name : null;
    const custom = this._newCustomEntry({ name, params: this._fullParams(name, props || {}), channelMaps: { ...(channelMaps || {}) }, legacyBase });
    this.entries.set(custom.id, custom);
    ops.push(this._customPutOp(custom));
    return custom;
  }

  // ─── Export and import ────────────────────────────────────────
  // What another project needs to rebuild these materials.
  exportDefinitions(ids) {
    const definitions = {};
    for (const id of new Set(ids)) {
      const entry = this.get(id);
      if (!entry) continue;
      definitions[id] = {
        id, origin: entry.origin, name: entry.name, params: entry.params,
        overrideParams: this._overrideParams(entry),
        channelMaps: entry.channelMaps, clearedChannels: entry.clearedChannels,
        objectName: entry.objectName, textureSource: entry.textureSource,
      };
    }
    return definitions;
  }

  _overrideParams(entry) {
    return Object.fromEntries(Object.entries(entry.params)
      .filter(([name, value]) => name !== 'reflectivity' && !sameValue(entry.baseParams[name], value)));
  }

  // Imported definitions never link projects: custom materials always become new
  // copies here. A standard or native one links to this project's own entry only if
  // that looks the same; otherwise it becomes a new custom material too.
  importDefinition(definition, ops) {
    const local = this.get(definition.id);
    if (definition.origin !== 'custom' && local && !local.deleted) {
      const sameEdits = sameParams(this._overrideParams(local), definition.overrideParams || {})
        && Object.keys(this._overrideParams(local)).length === Object.keys(definition.overrideParams || {}).length
        && sameMaps(local.channelMaps, definition.channelMaps)
        && sameValue([...local.clearedChannels].sort(), [...(definition.clearedChannels || [])].sort());
      if (sameEdits) return local.id;
    }
    const custom = this._newCustomEntry({
      name: definition.name,
      params: { ...definition.params },
      channelMaps: { ...(definition.channelMaps || {}) },
      clearedChannels: [...(definition.clearedChannels || [])],
      textureSource: definition.origin === 'native' ? definition.id : (definition.textureSource || null),
    });
    this.entries.set(custom.id, custom);
    ops.push(this._customPutOp(custom));
    return custom.id;
  }

  // Give an imported custom model ids that belong to this project.
  async importModelMaterials(modelData) {
    const ops = [];
    const next = { ...modelData, parts: { ...(modelData.parts || {}) } };
    const imported = new Map();
    const mapId = (id) => {
      if (!imported.has(id)) {
        const definition = modelData.materials?.[id];
        imported.set(id, definition ? this.importDefinition(definition, ops) : this.fallbackId());
      }
      return imported.get(id);
    };
    for (const [partName, part] of Object.entries(next.parts)) {
      if (part.materialId) {
        next.parts[partName] = { ...part, materialId: mapId(part.materialId) };
      } else if (!part.useOriginalMaterial && part.materialPreset) {
        // Exported before the library existed
        const { channelMaps, ...props } = part.materialData || {};
        const base = this.findByLegacyName(part.materialPreset)
          || this.legacyEmbeddedCustom(part.materialPreset, props, channelMaps, ops);
        next.parts[partName] = { ...part, materialId: this.legacyToId(base.id, { props, channelMaps }, partName, ops) };
      }
    }
    delete next.materials;
    if (ops.length) await IDBStorage.batch(ops);
    return next;
  }
}
