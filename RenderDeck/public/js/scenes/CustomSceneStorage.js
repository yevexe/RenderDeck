
// CUSTOMSCENESTORAGE.JS - IndexedDB storage for custom scene setups

const DB_NAME    = 'RenderDeckScenes';
const DB_VERSION = 1;
const STORE_NAME = 'scenes';

export class CustomSceneStorage {
  constructor() { this.db = null; }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror   = () => reject(request.error);
      request.onsuccess = () => { this.db = request.result; resolve(this); };
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'name' });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
    });
  }

  async saveScene(name, sceneData) {
    if (!this.db) await this.init();
    const scene = { name, version: 1, createdAt: Date.now(), updatedAt: Date.now(), ...sceneData };
    return new Promise((resolve, reject) => {
      const tx    = this.db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get(name);
      getReq.onsuccess = () => {
        if (getReq.result) scene.createdAt = getReq.result.createdAt;
        const putReq = store.put(scene);
        putReq.onsuccess = () => resolve(scene);
        putReq.onerror   = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }

  async getScene(name) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx    = this.db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(name);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror   = () => reject(request.error);
    });
  }

  async getAllSceneNames() {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx    = this.db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAllKeys();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror   = () => reject(request.error);
    });
  }

  async deleteScene(name) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx    = this.db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(name);
      request.onsuccess = () => resolve(true);
      request.onerror   = () => reject(request.error);
    });
  }

  async clearAllScenes() {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx    = this.db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.clear();
      request.onsuccess = () => resolve(true);
      request.onerror   = () => reject(request.error);
    });
  }

  async exportScene(name) {
    const scene = await this.getScene(name);
    if (!scene) throw new Error(`Scene not found: ${name}`);
    const blob = new Blob([JSON.stringify({ ...scene, exportedAt: Date.now(), exportVersion: 1 }, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `${name}.renderdeck-scene.json`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
    return true;
  }

  async importScene(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const data = JSON.parse(e.target.result);
          if (!data.name) throw new Error('Invalid scene file: missing name');
          const existing = await this.getScene(data.name);
          if (existing) {
            if (!confirm(`Scene "${data.name}" already exists. Overwrite?`)) {
              resolve({ success: false, reason: 'cancelled' }); return;
            }
          }
          await this.saveScene(data.name, {
            environment: data.environment,
            props:       data.props,
            camera:      data.camera,
            model:       data.model || null
          });
          resolve({ success: true, name: data.name });
        } catch (err) { reject(err); }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }
}
