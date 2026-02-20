
// CUSTOMMODELSTORAGE.JS - Custom Model Storage (IndexedDB)
// Stores overlay configurations WITHOUT baking textures
// Textures are composited in real-time for editing/viewing
// Only baked when user exports the final model

import * as IDBStorage from './indexedDBStorage.js';

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
      // Save overlay image blobs separately for efficiency
      const overlayKeys = [];
      
      if (modelData.overlayImages && modelData.overlayImages.length > 0) {
        for (let i = 0; i < modelData.overlayImages.length; i++) {
          const overlay = modelData.overlayImages[i];
          const overlayKey = `overlay:${name}:${i}`;
          
          // Convert base64 to blob for efficient storage
          if (overlay.imageData) {
            const blob = await IDBStorage.dataURLToBlob(overlay.imageData);
            await IDBStorage.put('blobs', overlayKey, blob);
            overlayKeys.push(overlayKey);
          }
        }
      }

      // Store metadata (NO baked texture)
      const metadata = {
        basedOn: modelData.basedOn,
        customName: modelData.customName,
        materialPreset: modelData.materialPreset || 'Wood', // Save the preset!
        materialProperties: modelData.materialProperties || {}, // Save properties too
        createdDate: new Date().toISOString(),
        lastModified: new Date().toISOString(),
        version: 2, // v2 = overlay-based, not baked
        overlayKeys: overlayKeys,
        overlayMetadata: modelData.overlayImages ? modelData.overlayImages.map(img => ({
          name: img.name,
          position: { ...img.position },
          size: { ...img.size },
          rotation: img.rotation,
          aspectRatio: img.aspectRatio
        })) : []
      };

      await IDBStorage.put('models', name, metadata);
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
    if (!this.idbAvailable) {
      return null;
    }

    try {
      const metadata = await IDBStorage.get('models', name);
      if (!metadata) {
        return null;
      }

      // Load overlay image blobs and convert back to data URLs
      const overlayImages = [];
      
      if (metadata.overlayKeys && metadata.overlayKeys.length > 0) {
        this.log(`Loading ${metadata.overlayKeys.length} overlay images for ${name}`);
        for (let i = 0; i < metadata.overlayKeys.length; i++) {
          const overlayKey = metadata.overlayKeys[i];
          const blob = await IDBStorage.get('blobs', overlayKey);
          
          if (blob && metadata.overlayMetadata[i]) {
            const dataURL = await IDBStorage.blobToDataURL(blob);
            overlayImages.push({
              ...metadata.overlayMetadata[i],
              imageData: dataURL
            });
            this.log(`Loaded overlay ${i + 1}: ${metadata.overlayMetadata[i].name}`);
          } else {
            this.log(`Failed to load overlay ${i + 1}`, true);
          }
        }
      } else {
        this.log(`No overlay images found for ${name}`, true);
      }

      this.log(`Returning ${overlayImages.length} overlay images`);

      return {
        basedOn: metadata.basedOn,
        customName: metadata.customName,
        materialPreset: metadata.materialPreset, // Return the preset!
        materialProperties: metadata.materialProperties, // Return properties!
        createdDate: metadata.createdDate,
        lastModified: metadata.lastModified,
        overlayImages: overlayImages,
        version: metadata.version
      };
      
    } catch (error) {
      this.log(`Failed to load custom model: ${error.message}`, true);
      return null;
    }
  }

  // ─────────────────────────────────────────────
  // Load all custom models
  // ─────────────────────────────────────────────
  async loadAllCustomModels() {
    if (!this.idbAvailable) {
      return {};
    }

    try {
      const keys = await IDBStorage.getAllKeys('models');
      const models = {};
      
      for (const key of keys) {
        const model = await this.loadCustomModel(key);
        if (model) {
          models[key] = model;
        }
      }
      
      return models;
      
    } catch (error) {
      this.log(`Failed to load custom models: ${error.message}`, true);
      return {};
    }
  }

  // ─────────────────────────────────────────────
  // Delete a custom model
  // ─────────────────────────────────────────────
  async deleteCustomModel(name) {
    if (!this.idbAvailable) {
      return false;
    }

    try {
      const metadata = await IDBStorage.get('models', name);
      
      if (metadata) {
        // Delete all overlay blobs
        if (metadata.overlayKeys) {
          for (const overlayKey of metadata.overlayKeys) {
            await IDBStorage.del('blobs', overlayKey);
          }
        }
        
        // Delete metadata
        await IDBStorage.del('models', name);
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
  // Get all custom model names
  // ─────────────────────────────────────────────
  async getAllCustomModelNames() {
    if (!this.idbAvailable) {
      return [];
    }

    try {
      return await IDBStorage.getAllKeys('models');
    } catch (error) {
      this.log(`Failed to get model names: ${error.message}`, true);
      return [];
    }
  }

  // ─────────────────────────────────────────────
  // Export custom models as JSON
  // ─────────────────────────────────────────────
  async exportCustomModels() {
    try {
      const models = await this.loadAllCustomModels();
      
      const exportData = {
        version: 2,
        exportDate: new Date().toISOString(),
        models: models
      };
      
      const json = JSON.stringify(exportData, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
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
      
      const json = JSON.stringify(exportData, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
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
  // Import custom models from JSON
  // ─────────────────────────────────────────────
  async importCustomModels(file) {
    try {
      const text = await file.text();
      const importData = JSON.parse(text);
      
      if (!importData.models) {
        return { 
          success: false, 
          error: 'Invalid export file format - missing models property' 
        };
      }
      
      let importedCount = 0;
      let skippedCount = 0;
      let firstImportedName = null;
      
      for (const [name, modelData] of Object.entries(importData.models)) {
        // Check if exists
        const existing = await this.loadCustomModel(name);
        if (existing) {
          const overwrite = confirm(`Model "${name}" already exists. Overwrite?`);
          if (!overwrite) {
            skippedCount++;
            continue;
          }
          // Delete old version
          await this.deleteCustomModel(name);
        }
        
        // Save imported model
        const success = await this.saveCustomModel(name, modelData);
        if (success) {
          importedCount++;
          if (!firstImportedName) {
            firstImportedName = name;
          }
        }
      }
      
      if (importedCount > 0) {
        this.log(`✓ Imported ${importedCount} model(s), skipped ${skippedCount}`);
        return { 
          success: true, 
          name: firstImportedName,
          count: importedCount,
          skipped: skippedCount
        };
      } else {
        return { 
          success: false, 
          error: `No models imported (${skippedCount} skipped)` 
        };
      }
      
    } catch (error) {
      this.log(`Failed to import: ${error.message}`, true);
      return { 
        success: false, 
        error: error.message 
      };
    }
  }

  // ─────────────────────────────────────────────
  // Clear all custom models
  // ─────────────────────────────────────────────
  async clearAllCustomModels() {
    try {
      const names = await this.getAllCustomModelNames();
      const count = names.length;
      
      if (count === 0) {
        this.log('No custom models to clear');
        return { success: true, count: 0 };
      }
      
      // Delete all custom models (no confirm here - main.js handles it)
      for (const name of names) {
        await this.deleteCustomModel(name);
      }
      
      this.log(`✓ Cleared ${count} custom model(s)`);
      return { success: true, count: count };
      
    } catch (error) {
      this.log(`Failed to clear: ${error.message}`, true);
      return { success: false, count: 0, error: error.message };
    }
  }

  // ─────────────────────────────────────────────
  // Get storage statistics
  // ─────────────────────────────────────────────
  async getStorageStats() {
    try {
      const names = await this.getAllCustomModelNames();
      const stats = {
        modelCount: names.length,
        models: []
      };
      
      for (const name of names) {
        const metadata = await IDBStorage.get('models', name);
        if (metadata) {
          stats.models.push({
            name: name,
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