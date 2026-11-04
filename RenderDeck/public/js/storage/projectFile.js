// PROJECTFILE.JS — .rdo project files (a zip made with fflate)
//
// project.json → { format, version, exportedAt, project, records: [{ store, key, value }] }
// blobs/<n>.<ext> → every Blob, File or binary value, and very long data URLs
//
// Keys and values hold PID_PLACEHOLDER instead of the project id, so loading a file
// re-keys it to a new project. Values that JSON can't hold are written as markers:
//   { $rdFile: { path, type, name, lastModified } }   Blob or File
//   { $rdBinary: { path, kind } }                     ArrayBuffer or typed array
//   { $rdText: path }                                 very long data URL
//   { $rdNumber: 'Infinity' }                         Infinity, -Infinity, NaN
//   { $rdDate: milliseconds }                         Date

import { Zip, ZipDeflate, ZipPassThrough, unzipSync, strFromU8, strToU8 } from 'fflate';
import * as IDBStorage from './indexedDBStorage.js';
import { isProjectKey } from './cascade.js';
import { generateId, getProject, listProjects } from './ProjectStorage.js';

const FORMAT = 'renderdeck-project';
const VERSION = 1;
const PID_PLACEHOLDER = '{pid}';
const LONG_TEXT = 256 * 1024; // keeps project.json far below the browser's string limit

// Left out by "Include Uploaded Images in Project File" unchecked. The app already skips a
// layer whose image is missing. Material thumbnails go too, so they get redrawn without
// the textures; uploaded model files, including an OBJ's textures, stay with their model.
// Text layers stay (see textLayerBlobKeys): they aren't uploaded images.
const IMAGE_BLOB_PREFIXES = ['design-blob:', 'design-thumb:', 'overlay:', 'node-image:', 'preset-thumb:', 'mat-thumb:'];
const IMAGE_VALUE_FIELDS = new Set(['channelMaps', 'imageData', 'imageDataUrl']);

const THUMBNAIL_PATTERN = /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$/i;
const BINARY_KINDS = {
  ArrayBuffer, Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array,
  Int32Array, Uint32Array, Float32Array, Float64Array, DataView,
};

const swap = (text, from, to) => (text.includes(from) ? text.split(from).join(to) : text);

function extensionOf(blob) {
  const fromName = /\.([a-z0-9]{1,8})$/i.exec(blob.name || '')?.[1];
  const fromType = /^[a-z]+\/([a-z0-9]{1,8})$/i.exec(blob.type || '')?.[1];
  return (fromName || fromType || 'bin').toLowerCase();
}

// ─────────────────────────────────────────────
// Writing
// ─────────────────────────────────────────────

class ValueEncoder {
  constructor(pid, includeImages) {
    this.pid = pid;
    this.includeImages = includeImages;
    this.attachments = []; // { path, data: Blob | Uint8Array, compress }
  }

  _attach(makePath, data, compress = false) {
    const path = makePath(this.attachments.length);
    this.attachments.push({ path, data, compress });
    return path;
  }

  encode(value) {
    if (typeof value === 'string') {
      if (!value.startsWith('data:')) return swap(value, this.pid, PID_PLACEHOLDER);
      if (value.length <= LONG_TEXT) return value;
      return { $rdText: this._attach(n => `blobs/${n}.txt`, strToU8(value), true) };
    }
    if (typeof value === 'number' && !Number.isFinite(value)) return { $rdNumber: String(value) };
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(item => this.encode(item));
    if (value instanceof Date) return { $rdDate: value.getTime() };
    if (value instanceof Blob) {
      const path = this._attach(n => `blobs/${n}.${extensionOf(value)}`, value);
      return { $rdFile: { path, type: value.type, name: value.name ?? null, lastModified: value.lastModified ?? null } };
    }
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
      const bytes = value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      return { $rdBinary: { path: this._attach(n => `blobs/${n}.bin`, bytes), kind: value.constructor.name } };
    }
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new Error(`A ${value.constructor?.name ?? 'stored'} value can't be written to a project file`);
    }
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      if (!this.includeImages && IMAGE_VALUE_FIELDS.has(key)) continue;
      output[swap(key, this.pid, PID_PLACEHOLDER)] = this.encode(item);
    }
    return output;
  }
}

// Blob keys holding the rendered picture of a text layer. Design layers: design-blob:… next
// to their design-meta:… record. Custom models: overlayKeys matched with overlayMetadata.
async function textLayerBlobKeys(pid) {
  const keys = new Set();
  for (const key of await IDBStorage.getAllKeys('metadata', `design-meta:${pid}:`)) {
    const layers = await IDBStorage.get('metadata', key);
    if (!Array.isArray(layers)) continue;
    for (const layer of layers) {
      if (layer.type === 'text') keys.add(`${key.replace('design-meta:', 'design-blob:')}:${layer.id}`);
    }
  }
  const addOverlays = (overlayKeys, overlayMetadata) => {
    (overlayKeys || []).forEach((key, i) => {
      if (overlayMetadata?.[i]?.type === 'text') keys.add(key);
    });
  };
  for (const record of await IDBStorage.getAll('models', `${pid}:`)) {
    addOverlays(record.overlayKeys, record.overlayMetadata);
    Object.values(record.parts || {}).forEach(part => addOverlays(part.overlayKeys, part.overlayMetadata));
  }
  return keys;
}

async function zipFiles(manifestText, attachments) {
  const chunks = [];
  let failure = null;
  const zip = new Zip((err, chunk) => {
    if (err) failure = err;
    else chunks.push(chunk);
  });
  const add = (entry, bytes) => {
    zip.add(entry);
    entry.push(bytes, true);
    if (failure) throw failure;
  };

  add(new ZipDeflate('project.json', { level: 6 }), strToU8(manifestText));
  for (const { path, data, compress } of attachments) {
    // Read one at a time so a large project never holds every file twice
    const bytes = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data;
    add(compress ? new ZipDeflate(path, { level: 6 }) : new ZipPassThrough(path), bytes);
  }
  zip.end();
  return new Blob(chunks, { type: 'application/zip' });
}

/**
 * Pack one project and every record keyed by its id into a Blob.
 * Call flushWrites() first so nothing is still waiting to be written.
 */
export async function buildProjectFile(pid, { includeImages = true } = {}) {
  const project = await getProject(pid);
  if (!project) throw new Error('This project no longer exists');

  const encoder = new ValueEncoder(pid, includeImages);
  const textBlobs = includeImages ? new Set() : await textLayerBlobKeys(pid);
  const records = [];
  for (const store of await IDBStorage.storeNames()) {
    if (store === 'projects') continue;
    for (const key of await IDBStorage.getAllKeys(store)) {
      if (!isProjectKey(key, pid)) continue;
      if (!includeImages && store === 'blobs' && !textBlobs.has(key) && IMAGE_BLOB_PREFIXES.some(prefix => key.startsWith(prefix))) continue;
      records.push({
        store,
        key: swap(key, pid, PID_PLACEHOLDER),
        value: encoder.encode(await IDBStorage.get(store, key)),
      });
    }
  }

  const manifest = {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    project: encoder.encode(project),
    records,
  };
  return zipFiles(JSON.stringify(manifest), encoder.attachments);
}

// ─────────────────────────────────────────────
// Reading
// ─────────────────────────────────────────────

function decodeValue(value, pid, entries) {
  if (typeof value === 'string') return value.startsWith('data:') ? value : swap(value, PID_PLACEHOLDER, pid);
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(item => decodeValue(item, pid, entries));

  const entry = (path) => {
    const bytes = entries[path];
    if (!bytes) throw new Error(`The file is damaged: ${path} is missing`);
    return bytes;
  };
  if (value.$rdText !== undefined) return strFromU8(entry(value.$rdText));
  if (value.$rdNumber !== undefined) return Number(value.$rdNumber);
  if (value.$rdDate !== undefined) return new Date(value.$rdDate);
  if (value.$rdFile) {
    const { path, type, name, lastModified } = value.$rdFile;
    const bytes = entry(path);
    return name === null
      ? new Blob([bytes], { type })
      : new File([bytes], name, { type, lastModified });
  }
  if (value.$rdBinary) {
    const { path, kind } = value.$rdBinary;
    const Kind = Object.hasOwn(BINARY_KINDS, kind) ? BINARY_KINDS[kind] : null;
    if (!Kind) throw new Error(`The file is damaged: unknown data type ${kind}`);
    const bytes = entry(path);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return Kind === ArrayBuffer ? buffer : new Kind(buffer);
  }

  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    swap(key, PID_PLACEHOLDER, pid),
    decodeValue(item, pid, entries),
  ]));
}

function readManifest(file, entries) {
  const notProject = new Error(`"${file.name}" isn't a RenderDeck project file`);
  if (!entries['project.json']) throw notProject;
  let manifest;
  try {
    manifest = JSON.parse(strFromU8(entries['project.json']));
  } catch (_) {
    throw notProject;
  }
  if (manifest?.format !== FORMAT) throw notProject;
  if (manifest.version !== VERSION) {
    throw new Error(`"${file.name}" uses project file version ${manifest.version}; this version of RenderDeck reads version ${VERSION}`);
  }
  if (typeof manifest.project?.name !== 'string' || !Array.isArray(manifest.records)) {
    throw new Error(`"${file.name}" is damaged`);
  }
  return manifest;
}

function availableName(name, projects) {
  const taken = new Set(projects.map(project => project.name));
  if (!taken.has(name)) return name;
  let n = 2;
  while (taken.has(`${name} (${n})`)) n++;
  return `${name} (${n})`;
}

/**
 * Add a project from a .rdo file under a new id and make it the active project.
 * Everything is written in one transaction, so a failure leaves nothing behind.
 * Never overwrites an existing project: every key must belong to the new id.
 * @returns {Promise<object>} the new project record
 */
export async function importProjectFile(file) {
  let entries;
  try {
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch (_) {
    throw new Error(`"${file.name}" isn't a RenderDeck project file`);
  }
  const manifest = readManifest(file, entries);

  const stores = new Set(await IDBStorage.storeNames());
  const pid = generateId();
  const ops = manifest.records.map(({ store, key, value }) => {
    if (store === 'projects' || !stores.has(store)) throw new Error(`The file is damaged: unknown store ${store}`);
    if (typeof key !== 'string' || !isProjectKey(key, PID_PLACEHOLDER)) throw new Error(`The file is damaged: bad key ${key}`);
    return { type: 'put', store, key: swap(key, PID_PLACEHOLDER, pid), value: decodeValue(value, pid, entries) };
  });

  const stored = decodeValue(manifest.project, pid, entries);
  const project = {
    ...stored,
    id: pid,
    name: availableName(stored.name, await listProjects()),
    updatedAt: Date.now(),
  };
  // The projects page puts this into an <img> tag, so accept nothing but image data
  if (!THUMBNAIL_PATTERN.test(project.thumbnail ?? '')) delete project.thumbnail;

  await IDBStorage.batch([
    ...ops,
    { type: 'put', store: 'projects', key: pid, value: project },
    { type: 'put', store: 'metadata', key: 'activeProjectId', value: pid },
  ]);
  return project;
}
