
// MAIN.JS - Application Orchestrator (Refactored)

import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';

// Core
import { SceneManager } from './core/Scene.js';
import { RendererManager } from './core/Renderer.js';
import { CameraManager } from './core/Camera.js';

import { MaterialManager } from './materials/MaterialManager.js';

import { ModelManager } from './models/ModelManager.js';

import { UVEditor } from './ui/UVEditor.js';
import { ControlsManager } from './ui/Controls.js';

// Utils
import { log, logError, logSuccess, logWarn } from './utils/logger.js';
import { TextureCompositor } from './utils/TextureCompositor.js';
import { centerAndFrameModel, cleanupObject } from './utils/helpers.js';

// Config
import { CONFIG, MODEL_PATHS } from './config.js';

// Scenes
import { initScenes, loadScene, getSceneNames } from './scenes.js';

//═══════════════════════════════════════════════════════════════
// INITIALIZATION
//═══════════════════════════════════════════════════════════════

const container = document.querySelector('.scene-view-placeholder');

// Initialize core systems
const sceneManager = new SceneManager();
const rendererManager = new RendererManager(container);
const cameraManager = new CameraManager(container);
cameraManager.setupControls(rendererManager.getDomElement());

// Initialize managers
const materialManager = new MaterialManager();
const modelManager = new ModelManager(log);
const uvEditor = new UVEditor(rendererManager, log, modelManager);

// Three.js loaders
const objLoader = new OBJLoader();
const mtlLoader = new MTLLoader();

// Application state
let activeModel = null;
let activeMesh = null;

//═══════════════════════════════════════════════════════════════
// SCENE SETUP
//═══════════════════════════════════════════════════════════════

log('RenderDeck initialized. Drag & drop OBJ files to add models!');

// Load HDR environments
initScenes((name, texture) => {
  sceneManager.setEnvironment(texture);
  sceneManager.getScene().background = texture;  // Also set as visible background
  log(`Scene set to: ${name}`);
});

// Register built-in models
registerBuiltInModels();

function registerBuiltInModels() {
  Object.entries(MODEL_PATHS).forEach(([key, config]) => {
    if (key !== 'BASE_PATH') {
      // Convert PLAIN_MUG to "Plain Mug"
      const displayName = key.split('_')
        .map(word => word.charAt(0) + word.slice(1).toLowerCase())
        .join(' ');
      modelManager.registerModel(displayName, config);
    }
  });
}

//═══════════════════════════════════════════════════════════════
// MODEL LOADING
//═══════════════════════════════════════════════════════════════

/**
 * Main model loading function
 * @param {string} name - Model name
 */
async function loadModel(name) {
  const modelData = await modelManager.getModel(name);
  if (!modelData) {
    logError(`Model not found: ${name}`);
    return;
  }

  cleanupActiveModel();

  if (modelData.type === 'custom') {
    await loadCustomModel(name, modelData);
  } else {
    await loadRegularModel(name, modelData);
  }
}

/**
 * Load custom model (with saved textures)
 */
async function loadCustomModel(name, modelData) {
  log(`Loading custom model: ${name}…`);
  log(`Material preset: ${modelData.materialPreset || 'NOT FOUND'}`);
  log(`Overlay images: ${modelData.overlayImages ? modelData.overlayImages.length : 'NONE'}`);

  const baseModelName = modelData.basedOn;
  const loadingPaths = await modelManager.getLoadingPaths(baseModelName);
  
  if (!loadingPaths) {
    logError(`Base model not found: ${baseModelName}`);
    return;
  }

  const objPath = loadingPaths.type === 'path' 
    ? loadingPaths.basePath + loadingPaths.obj
    : loadingPaths.obj;

  objLoader.load(
    objPath,
    (object) => {
      object.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          child.userData.isCustomModel = true;
          
          if (!activeMesh) {
            activeMesh = child;
          }

          // Apply material preset
          const presetName = modelData.materialPreset || 'Wood';
          const material = materialManager.getPreset(presetName);
          materialManager.applyEnvironment(material, sceneManager.getScene().environment);
          child.material = material;
          log(`Applied material preset: ${presetName}`);

          // Apply saved material properties (opacity, etc.)
          if (modelData.materialProperties) {
            materialManager.applySavedProperties(child.material, modelData.materialProperties);
            if (modelData.materialProperties.opacity !== undefined) {
              log(`Applied saved opacity: ${modelData.materialProperties.opacity}`);
            }
          }

          // Create and apply composite texture
          if (child.material && modelData.overlayImages && modelData.overlayImages.length > 0) {
            log('Starting composite texture creation...');
            const presetTexture = child.material.map;
            log(`Preset texture exists: ${!!presetTexture}, has image: ${!!(presetTexture && presetTexture.image)}`);

            TextureCompositor.createCompositeTexture(presetTexture, modelData.overlayImages)
              .then(compositeTexture => {
                log('Composite texture created successfully!');
                if (child.material.map) {
                  child.material.map.dispose();
                }
                child.material.map = compositeTexture;
                child.material.needsUpdate = true;
                log(`✓ Custom texture applied to ${name} (${modelData.overlayImages.length} overlays)`);
              })
              .catch(err => {
                logError(`Failed to create composite texture: ${err.message}`);
              });
          } else {
            log(`Skipping composite: material=${!!child.material}, overlays=${modelData.overlayImages ? modelData.overlayImages.length : 0}`);
          }
        }
      });

      sceneManager.add(object);
      activeModel = object;
      centerAndFrameModel(object, cameraManager);
      log(`${name} loaded with custom texture.`);
    },
    (xhr) => {
      if (xhr.lengthComputable && xhr.total > 0) {
        const percent = ((xhr.loaded / xhr.total) * 100).toFixed(0);
        log(`Loading OBJ… ${percent}%`);
      }
    },
    (err) => {
      logError(`Failed to load OBJ ${name}: ${err}`);
    }
  );
}

/**
 * Load regular model (built-in or uploaded)
 */
async function loadRegularModel(name, modelData) {
  log(`Loading ${name}…`);

  const loadingPaths = await modelManager.getLoadingPaths(name);
  if (!loadingPaths) {
    logError(`Could not get loading paths for ${name}`);
    return;
  }

  function loadOBJ(materials = null) {
    if (materials) {
      objLoader.setMaterials(materials);
    }

    const objPath = loadingPaths.type === 'path' 
      ? loadingPaths.basePath + loadingPaths.obj
      : loadingPaths.obj;

    objLoader.load(
      objPath,
      (object) => {
        object.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            
            if (!activeMesh) {
              activeMesh = child;
            }
          }
        });

        sceneManager.add(object);
        activeModel = object;
        centerAndFrameModel(object, cameraManager);
        applyMaterialPreset(document.getElementById('texture-select').value);
        log(`${name} loaded successfully.`);
      },
      (xhr) => {
        if (xhr.lengthComputable && xhr.total > 0) {
          const percent = ((xhr.loaded / xhr.total) * 100).toFixed(0);
          log(`Loading OBJ… ${percent}%`);
        }
      },
      (err) => {
        logError(`Failed to load OBJ ${name}: ${err}`);
      }
    );
  }

  // Load MTL first if exists
  if (loadingPaths.mtl) {
    const mtlPath = loadingPaths.type === 'path'
      ? loadingPaths.basePath + loadingPaths.mtl
      : loadingPaths.mtl;

    if (loadingPaths.type === 'path') {
      mtlLoader.setPath(loadingPaths.basePath);
      mtlLoader.load(
        loadingPaths.mtl,
        (materials) => {
          materials.preload();
          log(`Materials loaded for ${name}.`);
          loadOBJ(materials);
        },
        undefined,
        (err) => {
          logWarn(`MTL load failed, loading OBJ without materials: ${err}`);
          loadOBJ();
        }
      );
    } else {
      fetch(mtlPath)
        .then(response => response.text())
        .then(mtlText => {
          const materials = mtlLoader.parse(mtlText, '');
          materials.preload();
          log(`Materials loaded for ${name}.`);
          loadOBJ(materials);
        })
        .catch(err => {
          logWarn(`MTL load failed: ${err}`);
          loadOBJ();
        });
    }
  } else {
    loadOBJ();
  }
}

/**
 * Clean up active model
 */
function cleanupActiveModel() {
  if (activeModel) {
    sceneManager.remove(activeModel);
    cleanupObject(activeModel);
    activeModel = null;
    activeMesh = null;
  }
}

//═══════════════════════════════════════════════════════════════
// MATERIAL MANAGEMENT
//═══════════════════════════════════════════════════════════════

/**
 * Apply material preset to active model
 * @param {string} presetName - Material preset name
 */
function applyMaterialPreset(presetName) {
  if (!activeModel) return;

  activeModel.traverse((child) => {
    if (child.isMesh) {
      // Skip custom models - they manage their own materials
      if (child.userData && child.userData.isCustomModel) {
        // Just update environment map
        if (sceneManager.getScene().environment && child.material) {
          child.material.envMap = sceneManager.getScene().environment;
          child.material.envMapIntensity = 1.0;
          child.material.needsUpdate = true;
        }
        return;
      }

      // Regular models - apply preset
      const material = materialManager.getPreset(presetName);
      materialManager.applyEnvironment(material, sceneManager.getScene().environment);
      
      // Dispose old material
      if (child.material) {
        materialManager.dispose(child.material);
      }
      
      child.material = material;
      child.material.needsUpdate = true;
    }
  });

  log(`Texture preset applied: ${presetName}`);
}

/**
 * Update material property on active mesh
 * @param {string} property - Property name (opacity, roughness, metalness)
 * @param {number} value - New value
 */
function updateMaterialProperty(property, value) {
  if (!activeMesh || !activeMesh.material) return;

  activeMesh.material[property] = value;
  
  // Enable transparency if opacity < 1
  if (property === 'opacity') {
    activeMesh.material.transparent = value < 1.0;
  }
  
  activeMesh.material.needsUpdate = true;
}

//═══════════════════════════════════════════════════════════════
// UI CONTROLS
//═══════════════════════════════════════════════════════════════

const controls = new ControlsManager({
  onModelChange: (name) => {
    loadModel(name);
  },
  
  onMaterialChange: (preset) => {
    applyMaterialPreset(preset);
  },
  
  onSceneChange: (sceneName) => {
    loadScene(sceneName, (name, texture) => {
      sceneManager.setEnvironment(texture);
      // Also set as background so you can see it!
      sceneManager.getScene().background = texture;
      log(`Scene changed to: ${name}`);
      
      // Update environment map on active model
      if (activeModel) {
        activeModel.traverse((child) => {
          if (child.isMesh && child.material) {
            child.material.envMap = texture;
            child.material.envMapIntensity = 1.0;
            child.material.needsUpdate = true;
          }
        });
      }
    });
  },
  
  onOpacityChange: (value) => {
    updateMaterialProperty('opacity', value);
  },
  
  onRoughnessChange: (value) => {
    updateMaterialProperty('roughness', value);
  },
  
  onMetalnessChange: (value) => {
    updateMaterialProperty('metalness', value);
  },
  
  onEditTexture: () => {
    if (!activeMesh) {
      logError('No model loaded to edit');
      alert('Please load a model first before editing textures.');
      return;
    }
    const currentModelName = document.getElementById('model-select').value;
    const currentPreset = document.getElementById('texture-select').value;
    uvEditor.show(activeMesh, currentModelName, currentPreset);
  },
  
  onUploadModel: async (files) => {
    if (!files || files.length === 0) return;
    
    log(`Processing ${files.length} uploaded file(s)...`);
    
    const result = await modelManager.addModelFromFiles(files);
    
    if (result.success) {
      logSuccess(`Model added: ${result.name}`);
      if (result.warnings.length > 0) {
        result.warnings.forEach(w => logWarn(w));
      }
      await updateModelList();
      loadModel(result.name);
    } else {
      logError('Failed to add model:');
      result.errors.forEach(e => logError(e));
    }
  },
  
  onExport: async () => {
    const modelName = document.getElementById('model-select').value;
    if (!modelName) {
      logError('No model selected');
      return;
    }
    
    const modelData = await modelManager.getModel(modelName);
    if (modelData && modelData.type === 'custom') {
      const success = await modelManager.exportCustomModel(modelName);
      if (success) {
        logSuccess(`Exported: ${modelName}`);
      }
    } else {
      logError('Only custom models can be exported');
    }
  },
  
  onImport: async (files) => {
    if (!files || files.length === 0) return;
    
    const file = files[0];
    if (!file.name.endsWith('.json') && !file.name.endsWith('.renderdeck.json')) {
      logError('Please select a .json or .renderdeck.json file');
      return;
    }
    
    const result = await modelManager.importCustomModel(file);
    if (result.success) {
      logSuccess(`Imported: ${result.name}`);
      updateModelList();
      // Load the imported model
      loadModel(result.name);
    } else {
      logError(`Import failed: ${result.error}`);
    }
  },
  
  onClearCustom: async () => {
    if (!confirm('Clear all custom models? This cannot be undone!')) {
      return;
    }
    
    const result = await modelManager.clearAllCustomModels();
    if (result.success) {
      logSuccess(`Cleared ${result.count} custom model(s)`);
      updateModelList();
      // Load first built-in model
      const firstModel = Object.keys(MODEL_PATHS).find(k => k !== 'BASE_PATH');
      if (firstModel) {
        const displayName = firstModel.split('_')
          .map(word => word.charAt(0) + word.slice(1).toLowerCase())
          .join(' ');
        loadModel(displayName);
      }
    } else {
      logError('Failed to clear custom models');
    }
  }
});

/**
 * Update model dropdown list
 */
async function updateModelList() {
  const categories = await modelManager.getModelNamesByCategory();
  controls.updateModelSelect(categories);
}

/**
 * Update scene dropdown list
 */
function updateSceneList() {
  const sceneNames = getSceneNames();
  controls.updateSceneSelect(sceneNames);
}

// Make updateModelSelect available globally (for UVEditor)
window.updateModelSelect = updateModelList;

// Make switchToModel available globally (for UVEditor)
window.switchToModel = (name) => {
  const modelSelect = document.getElementById('model-select');
  if (modelSelect) {
    modelSelect.value = name;
    loadModel(name);
  }
};

//═══════════════════════════════════════════════════════════════
// DRAG & DROP FILE UPLOAD
//═══════════════════════════════════════════════════════════════

container.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.stopPropagation();
  container.style.borderColor = '#4CAF50';
});

container.addEventListener('dragleave', (e) => {
  e.preventDefault();
  e.stopPropagation();
  container.style.borderColor = '';
});

container.addEventListener('drop', async (e) => {
  e.preventDefault();
  e.stopPropagation();
  container.style.borderColor = '';

  const files = Array.from(e.dataTransfer.files);
  if (files.length === 0) return;

  log(`Processing ${files.length} dropped file(s)...`);

  const result = await modelManager.addModelFromFiles(files);
  
  if (result.success) {
    logSuccess(`Model added: ${result.name}`);
    if (result.warnings.length > 0) {
      result.warnings.forEach(w => logWarn(w));
    }
    await updateModelList();
    loadModel(result.name);
  } else {
    logError('Failed to add model:');
    result.errors.forEach(e => logError(e));
  }
});

//═══════════════════════════════════════════════════════════════
// ANIMATION LOOP
//═══════════════════════════════════════════════════════════════

function animate() {
  requestAnimationFrame(animate);
  cameraManager.update();
  rendererManager.render(sceneManager.getScene(), cameraManager.getCamera());
}

animate();

//═══════════════════════════════════════════════════════════════
// INITIAL SETUP
//═══════════════════════════════════════════════════════════════

// Update model list
updateModelList();

// Update scene list
updateSceneList();

// Load first model
const firstModel = Object.keys(MODEL_PATHS).find(k => k !== 'BASE_PATH');
if (firstModel) {
  const displayName = firstModel.split('_')
    .map(word => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ');
  setTimeout(() => loadModel(displayName), 100);
}