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
import * as IDBStorage from '../../storage/indexedDBStorage.js';
import { isSyncInfrastructureStore } from '../../storage/syncRules.js';
import { isProjectKey } from '../../storage/cascade.js';
import { generateId, getProject, listProjects } from '../../storage/ProjectStorage.js';
import { createRecordEncoder, decodeRecordValue, encodeRecords as encodeRecordValues } from '../recordCodec.js';

const FORMAT = 'renderdeck-project';
const VERSION = 1;
export const PID_PLACEHOLDER = '{pid}';

// Left out by "Include Uploaded Images in Project File" unchecked. The app already skips a
// layer whose image is missing. Material thumbnails go too, so they get redrawn without
// the textures; uploaded model files, including an OBJ's textures, stay with their model.
// Text layers stay (see textLayerBlobKeys): they aren't uploaded images.
const IMAGE_BLOB_PREFIXES = ['design-blob:', 'design-thumb:', 'overlay:', 'node-image:', 'preset-thumb:', 'mat-thumb:'];
const THUMBNAIL_PATTERN = /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$/i;

export const swapProjectId = (text, from, to) => (text.includes(from) ? text.split(from).join(to) : text);
const swap = swapProjectId;

export const encodeRecords = (pid, records) => encodeRecordValues(records, { pid });

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

export async function zipProjectFile(manifestText, attachments) {
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

  const encoder = createRecordEncoder({ pid, includeImages });
  const textBlobs = includeImages ? new Set() : await textLayerBlobKeys(pid);
  const records = [];
  for (const store of await IDBStorage.storeNames()) {
    if (store === 'projects' || isSyncInfrastructureStore(store)) continue;
    for (const key of await IDBStorage.getAllKeys(store)) {
      if (!isProjectKey(key, pid)) continue;
      if (!includeImages && store === 'blobs' && !textBlobs.has(key) && IMAGE_BLOB_PREFIXES.some(prefix => key.startsWith(prefix))) continue;
      records.push({
        store,
        key: swap(key, pid, PID_PLACEHOLDER),
        value: await encoder.encode(await IDBStorage.get(store, key)),
      });
    }
  }

  const manifest = {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    project: await encoder.encode(project),
    records,
  };
  return zipProjectFile(JSON.stringify(manifest), encoder.attachments);
}

// ─────────────────────────────────────────────
// Reading
// ─────────────────────────────────────────────

export const decodeValue = (value, pid, entries) => decodeRecordValue(value, { pid, entries });

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
  const ops = [];
  for (const { store, key, value } of manifest.records) {
    if (store === 'projects' || isSyncInfrastructureStore(store) || !stores.has(store)) {
      throw new Error(`The file is damaged: unknown store ${store}`);
    }
    if (typeof key !== 'string' || !isProjectKey(key, PID_PLACEHOLDER)) throw new Error(`The file is damaged: bad key ${key}`);
    ops.push({
      type: 'put',
      store,
      key: swap(key, PID_PLACEHOLDER, pid),
      value: await decodeValue(value, pid, entries),
    });
  }

  const stored = await decodeValue(manifest.project, pid, entries);
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
