// ═══════════════════════════════════════════════════════════════
// INDEXEDBSTORAGE.JS - IndexedDB Wrapper for RenderDeck
// Provides Promise-based interface for storing models and blobs
// ═══════════════════════════════════════════════════════════════

const DB_NAME = 'renderdeck_db';
const DB_VERSION = 1;

let dbInstance = null;

// ─────────────────────────────────────────────
// Open or create the database
// ─────────────────────────────────────────────
export function openDB() {
  return new Promise((resolve, reject) => {
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
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };

    request.onerror = () => {
      reject(new Error(`Failed to open IndexedDB: ${request.error}`));
    };
  });
}

// ─────────────────────────────────────────────
// Get a value from a store
// ─────────────────────────────────────────────
export function get(storeName, key) {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await openDB();
      const transaction = db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.get(key);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error(`Failed to get ${key} from ${storeName}: ${request.error}`));
    } catch (err) {
      reject(err);
    }
  });
}

// ─────────────────────────────────────────────
// Put a value into a store
// ─────────────────────────────────────────────
export function put(storeName, key, value) {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await openDB();
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.put(value, key);

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(new Error(`Failed to put ${key} into ${storeName}: ${transaction.error}`));
      request.onerror = () => reject(new Error(`Put request failed: ${request.error}`));
    } catch (err) {
      reject(err);
    }
  });
}

// ─────────────────────────────────────────────
// Delete a value from a store
// ─────────────────────────────────────────────
export function del(storeName, key) {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await openDB();
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.delete(key);

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(new Error(`Failed to delete ${key} from ${storeName}: ${transaction.error}`));
    } catch (err) {
      reject(err);
    }
  });
}

// ─────────────────────────────────────────────
// Get all keys from a store
// ─────────────────────────────────────────────
export function getAllKeys(storeName) {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await openDB();
      const transaction = db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.getAllKeys();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error(`Failed to get keys from ${storeName}: ${request.error}`));
    } catch (err) {
      reject(err);
    }
  });
}

// ─────────────────────────────────────────────
// Get all values from a store
// ─────────────────────────────────────────────
export function getAll(storeName) {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await openDB();
      const transaction = db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error(`Failed to get all from ${storeName}: ${request.error}`));
    } catch (err) {
      reject(err);
    }
  });
}

// ─────────────────────────────────────────────
// Clear all entries in a store
// ─────────────────────────────────────────────
export function clearStore(storeName) {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await openDB();
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.clear();

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(new Error(`Failed to clear ${storeName}: ${transaction.error}`));
    } catch (err) {
      reject(err);
    }
  });
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