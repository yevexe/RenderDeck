
// INDEXEDDBSTORAGE.JS - IndexedDB Wrapper for RenderDeck
// Provides Promise-based interface for storing models and blobs

import { isSyncable, isSyncInfrastructureStore } from './syncRules.js';

const DB_NAME = 'renderdeck_db';
// Raise this whenever a store is added: a database already at this version won't get it.
const DB_VERSION = 10;

let dbInstance = null;
let dbDeleted = false; // set by deleteDatabase() — no further opens this page

// ─────────────────────────────────────────────
// Open or create the database
// ─────────────────────────────────────────────
export function openDB() {
  return new Promise((resolve, reject) => {
    if (dbDeleted) {
      reject(new Error('Database was deleted — reload the page'));
      return;
    }
    if (dbInstance) {
      resolve(dbInstance);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Create object stores if they don't exist
      if (!db.objectStoreNames.contains('models')) {
        db.createObjectStore('models'); // key: modelName
      }
      if (!db.objectStoreNames.contains('blobs')) {
        db.createObjectStore('blobs'); // key: blobKey (e.g., 'texture:modelName', 'overlay:modelName:0')
      }
      if (!db.objectStoreNames.contains('metadata')) {
        db.createObjectStore('metadata'); // for version tracking and migration flags
      }
      if (!db.objectStoreNames.contains('projects')) {
        db.createObjectStore('projects'); // key: project UUID
      }
      if (!db.objectStoreNames.contains('scenes')) {
        db.createObjectStore('scenes'); // key: `${projectId}:${sceneName}`
      }
      // Custom materials of the material library — mirrors the backend `materials` table.
      // key: `${projectId}:${presetUuid}`
      // value: { id, projectId, name, order, params, textureSource,
      //          materialData: { channelMaps: { ch: dataUrl }, clearedChannels } }
      // thumbnail stored in 'blobs' under `preset-thumb:${projectId}:${presetUuid}`
      if (!db.objectStoreNames.contains('materials')) {
        db.createObjectStore('materials');
      }
      // Uploaded model file persistence — survives page reload.
      // key: `${projectId}:${modelName}`
      // value: { name, type, uploadDate, hasMtl, textureNames, metadata }
      // blobs stored in 'blobs' store under key `uploaded:${projectId}:${name}:*`
      if (!db.objectStoreNames.contains('uploaded-models')) {
        db.createObjectStore('uploaded-models');
      }
      // Uploaded prop files (GLB/GLTF/OBJ) — the prop library.
      // key: `${projectId}:${enc(propName)}`
      // value: { name, format, fileName, uploadDate, sketchfabUid, displayName }
      // file stored in 'blobs' under `uploaded-prop:${projectId}:${enc(propName)}`
      if (!db.objectStoreNames.contains('uploaded-props')) {
        db.createObjectStore('uploaded-props');
      }
      // Uploaded HDR environments.
      // key: `${projectId}:${hdrName}`
      // value: { name, fileName, uploadDate }
      // file in 'blobs' under `uploaded-hdr:${projectId}:${hdrName}`,
      // preview in 'blobs' under `env-preview:uploaded:${projectId}:${hdrName}`
      if (!db.objectStoreNames.contains('uploaded-hdrs')) {
        db.createObjectStore('uploaded-hdrs');
      }
      // Settings records.
      // key: 'app'         → { swatchCollections, sketchfabToken }
      // key: `${projectId}` → { camera, view, renderer, preview, background, environment, ui }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings');
      }
      // Node-editor graph per model part.
      // key: `${projectId}:${enc(modelName)}:${enc(partName)}`
      // value: { nodes, conns, nextNodeId, nextConnId, viewOffset, zoom }
      // image-node files in 'blobs' under `node-image:${projectId}:${enc(modelName)}:${enc(partName)}:${nodeId}`
      if (!db.objectStoreNames.contains('node-graphs')) {
        db.createObjectStore('node-graphs');
      }
      if (!db.objectStoreNames.contains('sync-outbox')) {
        db.createObjectStore('sync-outbox'); // key: encoded store + record key
      }
      if (!db.objectStoreNames.contains('sync-state')) {
        db.createObjectStore('sync-state'); // device/account metadata and sync cursors
      }
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      // Close our connection if another tab wants to upgrade
      dbInstance.onversionchange = () => {
        dbInstance.close();
        dbInstance = null;
      };
      resolve(dbInstance);
    };

    request.onerror = () => {
      reject(new Error(`Failed to open IndexedDB: ${request.error}`));
    };

    // Another tab holds the DB at an older version — resolve with null
    // so the app loads with empty data rather than hanging forever.
    request.onblocked = () => {
      console.warn('IndexedDB upgrade blocked — close other RenderDeck tabs and reload.');
      resolve(null);
    };
  });
}

// Wrap a DOMException so callers can still check err.name (e.g. 'QuotaExceededError')
function _wrapError(message, cause) {
  const err = new Error(`${message}: ${cause?.message || cause}`);
  if (cause?.name) err.name = cause.name;
  return err;
}

// Resolve the open DB or throw — writes must not silently succeed without a database
async function _requireDB(storeNames) {
  const db = await openDB();
  if (!db) throw new Error('IndexedDB unavailable (upgrade blocked by another tab)');
  for (const name of storeNames) {
    if (!db.objectStoreNames.contains(name)) throw new Error(`Unknown store: ${name}`);
  }
  return db;
}

// Names of every object store in the database
export async function storeNames() {
  const db = await openDB();
  return db ? [...db.objectStoreNames] : [];
}

// ─────────────────────────────────────────────
// Close this page's connection and delete the whole database.
// Resolves once deleted; rejects if another tab keeps it open.
// No IndexedDB access is possible on this page afterwards (reload it).
// ─────────────────────────────────────────────
export function deleteDatabase() {
  dbDeleted = true;
  if (dbInstance) { dbInstance.close(); dbInstance = null; }
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(_wrapError('Failed to delete database', request.error));
    request.onblocked = () => reject(new Error('Another RenderDeck tab is open — close it and try again'));
  });
}

// Key range covering every string key that starts with `prefix`
export function prefixRange(prefix) {
  return IDBKeyRange.bound(prefix, prefix + '￿');
}

// Encode one segment of a compound key so ':' inside names can't break prefix matching
export function encodeKeyPart(value) {
  return encodeURIComponent(String(value));
}

export function isQuotaError(err) {
  return err?.name === 'QuotaExceededError';
}

// ─────────────────────────────────────────────
// Get a value from a store
// ─────────────────────────────────────────────
export function get(storeName, key) {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await openDB();
      if (!db || !db.objectStoreNames.contains(storeName)) { resolve(undefined); return; }
      const transaction = db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.get(key);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(_wrapError(`Failed to get ${key} from ${storeName}`, request.error));
    } catch (err) {
      reject(err);
    }
  });
}

// ─────────────────────────────────────────────
// Put a value into a store
// ─────────────────────────────────────────────
export function put(storeName, key, value) {
  return batch([{ type: 'put', store: storeName, key, value }]);
}

// ─────────────────────────────────────────────
// Delete a value from a store
// ─────────────────────────────────────────────
export function del(storeName, key) {
  return batch([{ type: 'del', store: storeName, key }]);
}

// ─────────────────────────────────────────────
// Run several writes across multiple stores in ONE readwrite transaction.
// Either every operation commits or none does.
// ops: [{ type: 'put', store, key, value }
//       { type: 'del', store, key }
//       { type: 'delPrefix', store, prefix }
//       { type: 'clear', store }] — deletes matching keys and queues their sync entries
// Values must be ready before calling (no awaiting inside a transaction).
// ─────────────────────────────────────────────
export function batch(ops) {
  return _batch(ops, true);
}

// Local maintenance and server-applied changes must not queue data for upload.
export function batchWithoutOutbox(ops) {
  return _batch(ops, false);
}

function outboxKey(storeName, key) {
  return `${encodeURIComponent(storeName)}|${encodeURIComponent(String(key))}`;
}

function _batch(ops, trackChanges) {
  return new Promise(async (resolve, reject) => {
    if (!ops.length) { resolve(); return; }
    try {
      const storeNames = [...new Set([
        ...ops.map(o => o.store),
        ...(trackChanges && ops.some(op => !isSyncInfrastructureStore(op.store)) ? ['sync-outbox'] : []),
      ])];
      const db = await _requireDB(storeNames);
      const transaction = db.transaction(storeNames, 'readwrite');

      transaction.oncomplete = () => {
        if (ops.some(op => op.type === 'put' && (op.value instanceof Blob || op.store === 'uploaded-models' || op.store === 'uploaded-props'))) void requestPersistentStorage();
        resolve();
      };
      transaction.onerror = () => reject(_wrapError(`Transaction on ${storeNames.join(', ')} failed`, transaction.error));
      // Quota errors abort the transaction without a request error
      transaction.onabort = () => reject(_wrapError(`Transaction on ${storeNames.join(', ')} aborted`, transaction.error || 'aborted'));

      const queueOutbox = (storeName, key) => {
        if (!trackChanges || !isSyncable(storeName, key)) return;
        transaction.objectStore('sync-outbox').put(
          { store: storeName, key, changedAt: Date.now() },
          outboxKey(storeName, key),
        );
      };

      const deleteKeys = (storeName, keys) => {
        const store = transaction.objectStore(storeName);
        for (const key of keys) {
          store.delete(key);
          queueOutbox(storeName, key);
        }
      };

      let index = 0;
      const runNext = () => {
        while (index < ops.length) {
          const op = ops[index++];
          const store = transaction.objectStore(op.store);
          if (op.type === 'put') {
            store.put(op.value, op.key);
            queueOutbox(op.store, op.key);
          } else if (op.type === 'del') {
            store.delete(op.key);
            queueOutbox(op.store, op.key);
          } else if (op.type === 'delPrefix' || op.type === 'clear') {
            const request = op.type === 'clear'
              ? store.getAllKeys()
              : store.getAllKeys(prefixRange(op.prefix));
            request.onsuccess = () => {
              try {
                deleteKeys(op.store, request.result);
                runNext();
              } catch (err) {
                try { transaction.abort(); } catch (_) { /* already finished */ }
                reject(err);
              }
            };
            request.onerror = () => reject(_wrapError(`Failed to enumerate keys in ${op.store}`, request.error));
            return;
          } else {
            throw new Error(`Unknown batch op: ${op.type}`);
          }
        }
      };

      try {
        runNext();
      } catch (err) {
        // e.g. DataCloneError from a value IndexedDB can't store — roll back the
        // operations already queued so the batch stays all-or-nothing
        try { transaction.abort(); } catch (_) { /* already finished */ }
        throw err;
      }
    } catch (err) {
      reject(err);
    }
  });
}

// ─────────────────────────────────────────────
// Get all keys from a store (optionally only keys starting with prefix)
// ─────────────────────────────────────────────
export function getAllKeys(storeName, prefix = null) {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await openDB();
      if (!db || !db.objectStoreNames.contains(storeName)) { resolve([]); return; }
      const transaction = db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const request = prefix === null ? store.getAllKeys() : store.getAllKeys(prefixRange(prefix));

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(_wrapError(`Failed to get keys from ${storeName}`, request.error));
    } catch (err) {
      reject(err);
    }
  });
}

// ─────────────────────────────────────────────
// Get all values from a store (optionally only keys starting with prefix)
// ─────────────────────────────────────────────
export function getAll(storeName, prefix = null) {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await openDB();
      if (!db || !db.objectStoreNames.contains(storeName)) { resolve([]); return; }
      const transaction = db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const request = prefix === null ? store.getAll() : store.getAll(prefixRange(prefix));

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(_wrapError(`Failed to get all from ${storeName}`, request.error));
    } catch (err) {
      reject(err);
    }
  });
}

// ─────────────────────────────────────────────
// Clear all entries in a store
// ─────────────────────────────────────────────
export function clearStore(storeName) {
  return batch([{ type: 'clear', store: storeName }]);
}

// ─────────────────────────────────────────────
// Convert data URL to Blob
// ─────────────────────────────────────────────
export async function dataURLToBlob(dataURL) {
  try {
    const response = await fetch(dataURL);
    return await response.blob();
  } catch (err) {
    throw new Error(`Failed to convert data URL to blob: ${err.message}`);
  }
}

// ─────────────────────────────────────────────
// Convert data URL to Blob synchronously (no fetch) — safe to use while the
// page is being hidden, when async work may never get to run
// ─────────────────────────────────────────────
export function dataURLToBlobSync(dataURL) {
  const comma = dataURL.indexOf(',');
  const header = dataURL.slice(5, comma); // after 'data:'
  const data = dataURL.slice(comma + 1);
  const mime = header.split(';')[0] || 'application/octet-stream';
  let bytes;
  if (header.includes(';base64')) {
    const binary = atob(data);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  } else {
    bytes = new TextEncoder().encode(decodeURIComponent(data));
  }
  return new Blob([bytes], { type: mime });
}

// ─────────────────────────────────────────────
// Convert Blob to data URL
// ─────────────────────────────────────────────
export function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to convert blob to data URL'));
    reader.readAsDataURL(blob);
  });
}

// ─────────────────────────────────────────────
// Check if IndexedDB is available
// ─────────────────────────────────────────────
export function isIndexedDBAvailable() {
  try {
    return 'indexedDB' in window && indexedDB !== null;
  } catch (err) {
    return false;
  }
}

// Best effort only: denial never prevents using IndexedDB.
let persistentStorageState = { status: 'not requested', granted: false };
let persistenceRequest = null;
export function getPersistentStorageState() { return { ...persistentStorageState }; }
export function requestPersistentStorage() {
  if (persistenceRequest) return persistenceRequest;
  persistenceRequest = (async () => {
    try {
      const storage = navigator.storage;
      const granted = storage?.persisted ? (await storage.persisted() || await storage.persist?.()) : false;
      persistentStorageState = { granted: !!granted, status: !storage?.persist ? 'unavailable' : granted ? 'persistent' : 'best effort' };
      console.info('[Storage] Persistence:', persistentStorageState.status);
      document.dispatchEvent(new CustomEvent('storage-persistence-changed'));
      return !!granted;
    } catch (err) {
      persistentStorageState = { granted: false, status: 'unavailable', error: err.message };
      console.warn('[Storage] Persistence request failed:', err);
      return false;
    } finally { persistenceRequest = null; }
  })();
  return persistenceRequest;
}
export function startPersistentStorageRequests() {
  void requestPersistentStorage();
  const retry = () => {
    document.removeEventListener('pointerdown', retry, true);
    document.removeEventListener('keydown', retry, true);
    void requestPersistentStorage();
  };
  document.addEventListener('pointerdown', retry, true);
  document.addEventListener('keydown', retry, true);
}
