
// CUSTOMSCENESTORAGE.JS - Custom scene storage (IndexedDB, project-scoped)
// Scenes are stored in renderdeck_db using `${projectId}:${name}` keys.
// Legacy scenes from the old RenderDeckScenes database are auto-migrated.

import * as IDBStorage from './indexedDBStorage.js';
import { getActiveProjectId } from './ProjectStorage.js';

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

// A string name, plus at least one scene section, each of the type it should be
export function isSceneData(data) {
  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  if (!isObject(data) || typeof data.name !== 'string' || !data.name.trim()) return false;
  const { environment, props, camera, model } = data;
  if (environment !== undefined && environment !== null && !isObject(environment)) return false;
  if (props !== undefined && props !== null && !Array.isArray(props)) return false;
  if (camera !== undefined && camera !== null && !(isObject(camera) && isObject(camera.position) && isObject(camera.target))) return false;
  if (model !== undefined && model !== null && !(isObject(model) && typeof model.name === 'string')) return false;
  return !!(environment || props || camera || model);
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
  // Import a scene from JSON (.rdscene files go through sceneFile.js)
  // ─────────────────────────────────────────────
  async importScene(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const data = JSON.parse(e.target.result);
          if (!isSceneData(data)) throw new Error(`"${file.name}" isn't a RenderDeck scene file`);
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
            ...(data.cameraSettings ? { cameraSettings: data.cameraSettings } : {}),
            ...(data.renderer ? { renderer: data.renderer } : {}),
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
