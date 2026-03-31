
// CUSTOMMODELSTORAGE.JS - Custom Model Storage (IndexedDB)
// Stores overlay configurations WITHOUT baking textures
// Models are scoped to the active project via projectId-prefixed keys.

import * as IDBStorage from './indexedDBStorage.js';
import { getActiveProjectId } from './ProjectStorage.js';

// Legacy keys have no project prefix — they predate the project system.
const UUID_PREFIX_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:/i;

function modelKey(projectId, name) {
  return `${projectId}:${name}`;
}

function blobKey(projectId, name, index) {
  return `overlay:${projectId}:${name}:${index}`;
}

function isLegacyKey(key) {
  return !UUID_PREFIX_RE.test(key);
}

export class CustomModelStorage {
  constructor(log) {
    this.log = log;
    this.idbAvailable = IDBStorage.isIndexedDBAvailable();

    if (!this.idbAvailable) {
      this.log('⚠️ IndexedDB not available, custom models will not persist', true);
    }
  }

  // ─────────────────────────────────────────────
  // Save a custom model (overlay data only)
  // ─────────────────────────────────────────────
  async saveCustomModel(name, modelData) {
    if (!this.idbAvailable) {
      this.log('Cannot save: IndexedDB unavailable', true);
      return false;
    }

    try {
      const projectId = await getActiveProjectId();
      const overlayKeys = [];

      if (modelData.overlayImages && modelData.overlayImages.length > 0) {
        for (let i = 0; i < modelData.overlayImages.length; i++) {
          const overlay = modelData.overlayImages[i];
          const key = blobKey(projectId, name, i);

          if (overlay.imageData) {
            const blob = await IDBStorage.dataURLToBlob(overlay.imageData);
            await IDBStorage.put('blobs', key, blob);
            overlayKeys.push(key);
          }
        }
      }

      const metadata = {
        projectId,
        basedOn: modelData.basedOn,
        customName: modelData.customName,
        materialPreset: modelData.materialPreset || 'Default — White',
        materialProperties: modelData.materialProperties || {},
        isCustomMaterial: modelData.isCustomMaterial || false,
        createdDate: new Date().toISOString(),
        lastModified: new Date().toISOString(),
        version: 2,
        overlayKeys,
        overlayMetadata: modelData.overlayImages ? modelData.overlayImages.map(img => ({
          name:        img.name,
          type:        img.type     || 'image',
          textData:    img.textData ? { ...img.textData } : null,
          position:    { ...img.position },
          size:        { ...img.size },
          rotation:    img.rotation,
          aspectRatio: img.aspectRatio,
          flipH:       img.flipH ?? false,
          flipV:       img.flipV ?? false
        })) : []
      };

      await IDBStorage.put('models', modelKey(projectId, name), metadata);
      this.log(`✓ Custom model saved: ${name} (${overlayKeys.length} overlays)`);
      return true;

    } catch (error) {
      this.log(`Failed to save custom model: ${error.message}`, true);
      if (error.name === 'QuotaExceededError') {
        this.log('⚠️ Storage quota exceeded!', true);
        alert('Storage full! Try deleting some old custom models or use smaller images.');
      }
      return false;
    }
  }

  // ─────────────────────────────────────────────
  // Load a custom model (reconstructs overlay data)
  // ─────────────────────────────────────────────
  async loadCustomModel(name) {
    if (!this.idbAvailable) return null;

    try {
      const projectId = await getActiveProjectId();
      return await this._loadByKey(modelKey(projectId, name), name);
    } catch (error) {
      this.log(`Failed to load custom model: ${error.message}`, true);
      return null;
    }
  }

  // Internal: load by full IDB key
  async _loadByKey(fullKey, displayName) {
    const metadata = await IDBStorage.get('models', fullKey);
    if (!metadata) return null;

    const overlayImages = [];
    if (metadata.overlayKeys && metadata.overlayKeys.length > 0) {
      this.log(`Loading ${metadata.overlayKeys.length} overlay images for ${displayName}`);
      for (let i = 0; i < metadata.overlayKeys.length; i++) {
        const blob = await IDBStorage.get('blobs', metadata.overlayKeys[i]);
        if (blob && metadata.overlayMetadata[i]) {
          const dataURL = await IDBStorage.blobToDataURL(blob);
          overlayImages.push({ ...metadata.overlayMetadata[i], imageData: dataURL });
        } else {
          this.log(`Failed to load overlay ${i + 1}`, true);
        }
      }
    }

    return {
      basedOn: metadata.basedOn,
      customName: metadata.customName,
      materialPreset: metadata.materialPreset,
      materialProperties: metadata.materialProperties,
      isCustomMaterial: metadata.isCustomMaterial || false,
      createdDate: metadata.createdDate,
      lastModified: metadata.lastModified,
      overlayImages,
      version: metadata.version
    };
  }

  // ─────────────────────────────────────────────
  // Load all custom models for the active project
  // ─────────────────────────────────────────────
  async loadAllCustomModels() {
    if (!this.idbAvailable) return {};

    try {
      const projectId = await getActiveProjectId();
      const allKeys = await IDBStorage.getAllKeys('models');
      const models = {};

      for (const key of allKeys) {
        if (isLegacyKey(key)) {
          // Migrate legacy model into the active project
          await this._migrateLegacyKey(key, projectId);
          continue;
        }
        if (!key.startsWith(`${projectId}:`)) continue;

        const name = key.slice(projectId.length + 1);
        const model = await this._loadByKey(key, name);
        if (model) models[name] = model;
      }

      return models;
    } catch (error) {
      this.log(`Failed to load custom models: ${error.message}`, true);
      return {};
    }
  }

  // Migrate a legacy (pre-project) key into the active project
  async _migrateLegacyKey(legacyKey, projectId) {
    try {
      const metadata = await IDBStorage.get('models', legacyKey);
      if (!metadata) return;

      const name = legacyKey; // legacy key IS the name
      const newKey = modelKey(projectId, name);

      // Remap blob keys
      const newOverlayKeys = [];
      if (metadata.overlayKeys) {
        for (let i = 0; i < metadata.overlayKeys.length; i++) {
          const oldBlobKey = metadata.overlayKeys[i];
          const blob = await IDBStorage.get('blobs', oldBlobKey);
          if (blob) {
            const newKey2 = blobKey(projectId, name, i);
            await IDBStorage.put('blobs', newKey2, blob);
            await IDBStorage.del('blobs', oldBlobKey);
            newOverlayKeys.push(newKey2);
          }
        }
      }

      await IDBStorage.put('models', newKey, { ...metadata, projectId, overlayKeys: newOverlayKeys });
      await IDBStorage.del('models', legacyKey);
      this.log(`Migrated legacy model "${name}" to project ${projectId}`);
    } catch (err) {
      this.log(`Migration failed for key "${legacyKey}": ${err.message}`, true);
    }
  }

  // ─────────────────────────────────────────────
  // Delete a custom model
  // ─────────────────────────────────────────────
  async deleteCustomModel(name) {
    if (!this.idbAvailable) return false;

    try {
      const projectId = await getActiveProjectId();
      const key = modelKey(projectId, name);
      const metadata = await IDBStorage.get('models', key);

      if (metadata) {
        if (metadata.overlayKeys) {
          for (const bk of metadata.overlayKeys) {
            await IDBStorage.del('blobs', bk);
          }
        }
        await IDBStorage.del('models', key);
        this.log(`✓ Custom model deleted: ${name}`);
        return true;
      }
      return false;
    } catch (error) {
      this.log(`Failed to delete custom model: ${error.message}`, true);
      return false;
    }
  }

  // ─────────────────────────────────────────────
  // Get all custom model names for the active project
  // ─────────────────────────────────────────────
  async getAllCustomModelNames() {
    if (!this.idbAvailable) return [];

    try {
      const projectId = await getActiveProjectId();
      const allKeys = await IDBStorage.getAllKeys('models');
      const prefix = `${projectId}:`;
      return allKeys
        .filter(k => k.startsWith(prefix))
        .map(k => k.slice(prefix.length));
    } catch (error) {
      this.log(`Failed to get model names: ${error.message}`, true);
      return [];
    }
  }

  // ─────────────────────────────────────────────
  // Export custom models as JSON (active project only)
  // ─────────────────────────────────────────────
  async exportCustomModels() {
    try {
      const models = await this.loadAllCustomModels();
      const exportData = {
        version: 2,
        exportDate: new Date().toISOString(),
        models
      };
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `renderdeck-custom-models-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      this.log(`✓ Exported ${Object.keys(models).length} custom model(s)`);
      return true;
    } catch (error) {
      this.log(`Failed to export: ${error.message}`, true);
      return false;
    }
  }

  // ─────────────────────────────────────────────
  // Export a single custom model
  // ─────────────────────────────────────────────
  async exportSingleModel(name) {
    try {
      const model = await this.loadCustomModel(name);
      if (!model) {
        this.log(`Model not found: ${name}`, true);
        return false;
      }
      const exportData = {
        version: 2,
        exportDate: new Date().toISOString(),
        models: { [name]: model }
      };
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name.replace(/[^a-z0-9]/gi, '_')}-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      this.log(`✓ Exported: ${name}`);
      return true;
    } catch (error) {
      this.log(`Failed to export model: ${error.message}`, true);
      return false;
    }
  }

  // ─────────────────────────────────────────────
  // Import custom models from JSON (into active project)
  // ─────────────────────────────────────────────
  async importCustomModels(file) {
    try {
      const text = await file.text();
      const importData = JSON.parse(text);

      if (!importData.models) {
        return { success: false, error: 'Invalid export file format - missing models property' };
      }

      let importedCount = 0;
      let skippedCount = 0;
      let firstImportedName = null;

      for (const [name, modelData] of Object.entries(importData.models)) {
        const existing = await this.loadCustomModel(name);
        if (existing) {
          const overwrite = confirm(`Model "${name}" already exists. Overwrite?`);
          if (!overwrite) { skippedCount++; continue; }
          await this.deleteCustomModel(name);
        }
        const success = await this.saveCustomModel(name, modelData);
        if (success) {
          importedCount++;
          if (!firstImportedName) firstImportedName = name;
        }
      }

      if (importedCount > 0) {
        this.log(`✓ Imported ${importedCount} model(s), skipped ${skippedCount}`);
        return { success: true, name: firstImportedName, count: importedCount, skipped: skippedCount };
      }
      return { success: false, error: `No models imported (${skippedCount} skipped)` };

    } catch (error) {
      this.log(`Failed to import: ${error.message}`, true);
      return { success: false, error: error.message };
    }
  }

  // ─────────────────────────────────────────────
  // Clear all custom models in the active project
  // ─────────────────────────────────────────────
  async clearAllCustomModels() {
    try {
      const names = await this.getAllCustomModelNames();
      const count = names.length;
      if (count === 0) {
        this.log('No custom models to clear');
        return { success: true, count: 0 };
      }
      for (const name of names) {
        await this.deleteCustomModel(name);
      }
      this.log(`✓ Cleared ${count} custom model(s)`);
      return { success: true, count };
    } catch (error) {
      this.log(`Failed to clear: ${error.message}`, true);
      return { success: false, count: 0, error: error.message };
    }
  }

  // ─────────────────────────────────────────────
  // Get storage statistics (active project only)
  // ─────────────────────────────────────────────
  async getStorageStats() {
    try {
      const projectId = await getActiveProjectId();
      const names = await this.getAllCustomModelNames();
      const stats = { modelCount: names.length, models: [] };

      for (const name of names) {
        const metadata = await IDBStorage.get('models', modelKey(projectId, name));
        if (metadata) {
          stats.models.push({
            name,
            overlayCount: metadata.overlayKeys?.length || 0,
            lastModified: metadata.lastModified
          });
        }
      }
      return stats;
    } catch (error) {
      this.log(`Failed to get stats: ${error.message}`, true);
      return null;
    }
  }

  // ─────────────────────────────────────────────
  // Get storage report
  // ─────────────────────────────────────────────
  async getStorageReport() {
    const stats = await this.getStorageStats();
    let report = '=== RenderDeck Custom Models ===\n\n';
    if (stats) {
      report += `Total Models: ${stats.modelCount}\n\n`;
      if (stats.models.length > 0) {
        report += 'Models:\n';
        stats.models.forEach(model => {
          report += `  • ${model.name}: ${model.overlayCount} overlay(s)\n`;
        });
      } else {
        report += 'No custom models saved.\n';
      }
    }
    return report;
  }
}
