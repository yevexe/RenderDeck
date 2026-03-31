
// CUSTOMSCENESTORAGE.JS - Custom scene storage (IndexedDB, project-scoped)
// Scenes are stored in renderdeck_db using `${projectId}:${name}` keys.
// Legacy scenes from the old RenderDeckScenes database are auto-migrated.

import * as IDBStorage from '../storage/indexedDBStorage.js';
import { getActiveProjectId } from '../storage/ProjectStorage.js';

const LEGACY_DB_NAME    = 'RenderDeckScenes';
const LEGACY_STORE_NAME = 'scenes';
const MIGRATION_FLAG    = 'scenes_migrated_from_legacy';
const UUID_PREFIX_RE    = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:/i;

function sceneKey(projectId, name) {
  return `${projectId}:${name}`;
}

function isLegacyKey(key) {
  return !UUID_PREFIX_RE.test(key);
}

export class CustomSceneStorage {
  constructor() {
    this._migrationDone = false;
  }

  // ─────────────────────────────────────────────
  // Save a scene
  // ─────────────────────────────────────────────
  async saveScene(name, sceneData) {
    const projectId = await getActiveProjectId();
    const key = sceneKey(projectId, name);
    const existing = await IDBStorage.get('scenes', key);
    const scene = {
      name,
      projectId,
      version: 1,
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      ...sceneData,
    };
    await IDBStorage.put('scenes', key, scene);
    return scene;
  }

  // ─────────────────────────────────────────────
  // Get a scene by name
  // ─────────────────────────────────────────────
  async getScene(name) {
    const projectId = await getActiveProjectId();
    return IDBStorage.get('scenes', sceneKey(projectId, name));
  }

  // ─────────────────────────────────────────────
  // Get all scene names for the active project
  // ─────────────────────────────────────────────
  async getAllSceneNames() {
    await this._ensureMigrated();
    const projectId = await getActiveProjectId();
    const allKeys = await IDBStorage.getAllKeys('scenes');
    const prefix = `${projectId}:`;
return allKeys
      .filter(k => k.startsWith(prefix))
      .map(k => k.slice(prefix.length));
  }

  // ─────────────────────────────────────────────
  // Delete a scene
  // ─────────────────────────────────────────────
  async deleteScene(name) {
    const projectId = await getActiveProjectId();
    await IDBStorage.del('scenes', sceneKey(projectId, name));
    return true;
  }

  // ─────────────────────────────────────────────
  // Clear all scenes in the active project
  // ─────────────────────────────────────────────
  async clearAllScenes() {
    const names = await this.getAllSceneNames();
    for (const name of names) {
      await this.deleteScene(name);
    }
    return true;
  }

  // ─────────────────────────────────────────────
  // Export a scene as JSON
  // ─────────────────────────────────────────────
  async exportScene(name) {
    const scene = await this.getScene(name);
    if (!scene) throw new Error(`Scene not found: ${name}`);
    const blob = new Blob(
      [JSON.stringify({ ...scene, exportedAt: Date.now(), exportVersion: 1 }, null, 2)],
      { type: 'application/json' }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.renderdeck-scene.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return true;
  }

  // ─────────────────────────────────────────────
  // Import a scene from JSON
  // ─────────────────────────────────────────────
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
              resolve({ success: false, reason: 'cancelled' });
              return;
            }
          }
          await this.saveScene(data.name, {
            environment: data.environment,
            props:       data.props,
            camera:      data.camera,
            model:       data.model || null,
          });
          resolve({ success: true, name: data.name });
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }

  // ─────────────────────────────────────────────
  // Migrate legacy RenderDeckScenes DB (runs once)
  // ─────────────────────────────────────────────
  async _ensureMigrated() {
    if (this._migrationDone) return;

    try {
      const alreadyMigrated = await IDBStorage.get('metadata', MIGRATION_FLAG);
      if (alreadyMigrated) {
        this._migrationDone = true;
        return;
      }

      // Race the legacy DB read against a 3s timeout so a stuck IDB can't block the app
      const legacyScenes = await Promise.race([
        this._readLegacyDB(),
        new Promise(resolve => setTimeout(() => resolve([]), 3000)),
      ]);

      if (legacyScenes.length > 0) {
        const projectId = await getActiveProjectId();
        for (const scene of legacyScenes) {
          const key = sceneKey(projectId, scene.name);
          const existing = await IDBStorage.get('scenes', key);
          if (!existing) {
            await IDBStorage.put('scenes', key, { ...scene, projectId });
          }
        }
      }

      await IDBStorage.put('metadata', MIGRATION_FLAG, true);
    } catch (_) {
      // Migration failure is non-fatal
    }

    this._migrationDone = true;
  }

  _readLegacyDB() {
    return new Promise((resolve) => {
      try {
        const request = indexedDB.open(LEGACY_DB_NAME, 1);
        request.onerror = () => resolve([]);
        // onupgradeneeded fires when the DB doesn't exist yet — no handler needed,
        // onsuccess will follow and the store-check will catch the empty DB.
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(LEGACY_STORE_NAME)) {
            db.close();
            resolve([]);
            return;
          }
          try {
            const tx = db.transaction(LEGACY_STORE_NAME, 'readonly');
            const store = tx.objectStore(LEGACY_STORE_NAME);
            const getAll = store.getAll();
            getAll.onsuccess = () => { db.close(); resolve(getAll.result || []); };
            getAll.onerror  = () => { db.close(); resolve([]); };
          } catch (_) {
            db.close();
            resolve([]);
          }
        };
      } catch (_) {
        resolve([]);
      }
    });
  }
}
