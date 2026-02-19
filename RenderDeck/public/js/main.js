// MAIN.JS - Application Orchestrator

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

const container = document.getElementById('scene-view-placeholder');

const sceneManager = new SceneManager();
const rendererManager = new RendererManager(container);
const cameraManager = new CameraManager(container);
cameraManager.setupControls(rendererManager.getDomElement());

const materialManager = new MaterialManager();
const modelManager = new ModelManager(log);
const uvEditor = new UVEditor(rendererManager, log, modelManager, materialManager);

const objLoader = new OBJLoader();
const mtlLoader = new MTLLoader();

let activeModel = null;
let activeMesh = null;

//═══════════════════════════════════════════════════════════════
// SCENE SETUP
//═══════════════════════════════════════════════════════════════

log('RenderDeck initialized.');

initScenes((name, texture) => {
  sceneManager.setEnvironment(texture);
  sceneManager.getScene().background = texture;
  log(`Scene: ${name}`);
});

registerBuiltInModels();

function registerBuiltInModels() {
  Object.entries(MODEL_PATHS).forEach(([key, cfg]) => {
    if (key !== 'BASE_PATH') {
      const displayName = key.split('_')
        .map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
      modelManager.registerModel(displayName, cfg);
    }
  });
}

//═══════════════════════════════════════════════════════════════
// MODEL LOADING
//═══════════════════════════════════════════════════════════════

async function loadModel(name) {
  const modelData = await modelManager.getModel(name);
  if (!modelData) { logError(`Model not found: ${name}`); return; }
  cleanupActiveModel();
  if (modelData.type === 'custom') {
    await loadCustomModel(name, modelData);
  } else {
    await loadRegularModel(name, modelData);
  }
}

async function loadCustomModel(name, modelData) {
  log(`Loading custom model: ${name}…`);
  const loadingPaths = await modelManager.getLoadingPaths(modelData.basedOn);
  if (!loadingPaths) { logError(`Base model not found: ${modelData.basedOn}`); return; }

  const objPath = loadingPaths.type === 'path'
    ? loadingPaths.basePath + loadingPaths.obj : loadingPaths.obj;

  objLoader.load(objPath, (object) => {
    object.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
      child.userData.isCustomModel = true;
      if (!activeMesh) activeMesh = child;

      const presetName = modelData.materialPreset || 'Wood';
      const material = materialManager.getPreset(presetName);
      materialManager.applyEnvironment(material, sceneManager.getScene().environment);
      child.material = material;

      if (modelData.materialProperties) {
        materialManager.applySavedProperties(child.material, modelData.materialProperties);
      }

      if (child.material && modelData.overlayImages?.length > 0) {
        TextureCompositor.createCompositeTexture(child.material.map, modelData.overlayImages)
          .then(tex => {
            if (child.material.map) child.material.map.dispose();
            child.material.map = tex;
            child.material.needsUpdate = true;
          })
          .catch(err => logError(`Composite failed: ${err.message}`));
      }
    });

    sceneManager.add(object);
    activeModel = object;
    centerAndFrameModel(object, cameraManager);
    if (activeMesh?.material) controls.syncMaterialUI(activeMesh.material);
    log(`${name} loaded.`);
    // Initialize UV editor for this custom model
    if (activeMesh) {
      uvEditor.open(activeMesh, name, modelData.materialPreset || 'Wood');
    }
  },
  (xhr) => { if (xhr.lengthComputable && xhr.total > 0) log(`Loading… ${((xhr.loaded/xhr.total)*100).toFixed(0)}%`); },
  (err) => logError(`OBJ load failed: ${err}`));
}

async function loadRegularModel(name, modelData) {
  log(`Loading ${name}…`);
  const loadingPaths = await modelManager.getLoadingPaths(name);
  if (!loadingPaths) { logError(`No paths for ${name}`); return; }

  function loadOBJ(materials = null) {
    if (materials) objLoader.setMaterials(materials);
    const objPath = loadingPaths.type === 'path'
      ? loadingPaths.basePath + loadingPaths.obj : loadingPaths.obj;

    objLoader.load(objPath, (object) => {
      object.traverse((child) => {
        if (!child.isMesh) return;
        child.castShadow = true;
        child.receiveShadow = true;
        if (!activeMesh) activeMesh = child;
      });
      sceneManager.add(object);
      activeModel = object;
      centerAndFrameModel(object, cameraManager);
      applyMaterialPreset('Wood');
      log(`${name} loaded.`);
      // Initialize UV editor for this model
      if (activeMesh) {
        uvEditor.open(activeMesh, name, 'Wood');
      }
    },
    (xhr) => { if (xhr.lengthComputable && xhr.total > 0) log(`Loading… ${((xhr.loaded/xhr.total)*100).toFixed(0)}%`); },
    (err) => logError(`OBJ load failed: ${err}`));
  }

  if (loadingPaths.mtl) {
    const mtlPath = loadingPaths.type === 'path'
      ? loadingPaths.basePath + loadingPaths.mtl : loadingPaths.mtl;
    if (loadingPaths.type === 'path') {
      mtlLoader.setPath(loadingPaths.basePath);
      mtlLoader.load(loadingPaths.mtl,
        (m) => { m.preload(); loadOBJ(m); },
        undefined,
        () => loadOBJ());
    } else {
      fetch(mtlPath).then(r => r.text())
        .then(t => { const m = mtlLoader.parse(t, ''); m.preload(); loadOBJ(m); })
        .catch(() => loadOBJ());
    }
  } else {
    loadOBJ();
  }
}

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

function applyMaterialPreset(presetName) {
  if (!activeModel) return;
  activeModel.traverse((child) => {
    if (!child.isMesh) return;
    if (child.userData?.isCustomModel) {
      if (sceneManager.getScene().environment && child.material) {
        child.material.envMap = sceneManager.getScene().environment;
        child.material.needsUpdate = true;
      }
      return;
    }
    const material = materialManager.getPreset(presetName);
    materialManager.applyEnvironment(material, sceneManager.getScene().environment);
    if (child.material) materialManager.dispose(child.material);
    child.material = material;
    if (!activeMesh) activeMesh = child;
    child.material.needsUpdate = true;
  });
  if (activeMesh?.material) controls.syncMaterialUI(activeMesh.material);
  
  // Update UV editor's base texture to match the new material
  if (activeMesh?.material?.map) {
    uvEditor.baseTexture = activeMesh.material.map;
    uvEditor.currentMaterialPreset = presetName;
    uvEditor._renderPreview();
  }
  
  log(`Preset: ${presetName}`);
}

function updateMaterialProperty(property, value) {
  if (!activeMesh?.material) return;
  const mat = activeMesh.material;
  const colorProps = ['color', 'specularColor', 'sheenColor', 'emissive', 'attenuationColor'];
  if (colorProps.includes(property)) {
    mat[property].set(value);
  } else {
    mat[property] = value;
  }
  if (property === 'opacity') mat.transparent = value < 1.0;
  if (property === 'transmission') mat.transparent = value > 0;
  mat.needsUpdate = true;
}

//═══════════════════════════════════════════════════════════════
// CAMERA CONTROLS
//═══════════════════════════════════════════════════════════════

// Sensor sizes in mm (width × height)
const SENSOR_SIZES = {
  fullframe: { w: 36, h: 24 },
  'aps-c':   { w: 23.5, h: 15.6 },
  mft:       { w: 17.3, h: 13 }
};

// State for camera settings
const camState = {
  type: 'perspective',
  focalLength: 50,
  sensorKey: 'fullframe',
  near: 0.1,
  far: 2000,
  exposure: 1.0,
  toneMapping: 'aces',
  dofEnabled: false,
  dofFocus: 5.0,
  dofAperture: 25,  // 1/aperture used by BokehPass
};

function computeFOV(focalLength, sensorKey) {
  const sensor = SENSOR_SIZES[sensorKey] || SENSOR_SIZES.fullframe;
  // Vertical FOV: 2 * atan(sensorHeight / (2 * focalLength))
  return 2 * Math.atan(sensor.h / (2 * focalLength)) * (180 / Math.PI);
}

function applyCameraSettings() {
  const cam = cameraManager.getCamera();
  const renderer = rendererManager.getRenderer();

  if (camState.type === 'perspective') {
    cam.fov = computeFOV(camState.focalLength, camState.sensorKey);
    cam.near = camState.near;
    cam.far = camState.far;
    cam.updateProjectionMatrix();
  }

  // Tone mapping
  const TM = {
    none: THREE.NoToneMapping,
    aces: THREE.ACESFilmicToneMapping,
    reinhard: THREE.ReinhardToneMapping,
    cineon: THREE.CineonToneMapping,
  };
  renderer.toneMapping = TM[camState.toneMapping] ?? THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = camState.exposure;
}

function setupCameraUI() {
  // Helpers: link slider ↔ input
  const link = (sliderId, inputId, callback) => {
    const s = document.getElementById(sliderId);
    const i = document.getElementById(inputId);
    if (!s || !i) return;
    s.addEventListener('input', () => { i.value = s.value; callback(parseFloat(s.value)); });
    i.addEventListener('input', () => {
      const v = parseFloat(i.value);
      if (!isNaN(v)) { s.value = v; callback(v); }
    });
  };

  // Camera type
  const typeSelect = document.getElementById('camera-type-select');
  if (typeSelect) {
    typeSelect.addEventListener('change', (e) => {
      camState.type = e.target.value;
      // Orthographic camera swap would need deeper integration;
      // for now we just update FOV approach or set very high FOV
      if (camState.type === 'orthographic') {
        cameraManager.getCamera().fov = 1; // Near-orthographic
      } else {
        cameraManager.getCamera().fov = computeFOV(camState.focalLength, camState.sensorKey);
      }
      cameraManager.getCamera().updateProjectionMatrix();
    });
  }

  // Lens / focal length
  const lensSelect = document.getElementById('lens-mm-select');
  if (lensSelect) {
    lensSelect.addEventListener('change', (e) => {
      camState.focalLength = parseFloat(e.target.value);
      applyCameraSettings();
      log(`Lens: ${camState.focalLength}mm`);
    });
  }

  // Film / sensor gauge
  const filmSelect = document.getElementById('film-gauge-select');
  if (filmSelect) {
    filmSelect.addEventListener('change', (e) => {
      camState.sensorKey = e.target.value;
      applyCameraSettings();
      log(`Sensor: ${e.target.value}`);
    });
  }

  // Near clip
  link('near-slider', 'near-input', (v) => {
    camState.near = v;
    cameraManager.getCamera().near = v;
    cameraManager.getCamera().updateProjectionMatrix();
  });

  // Far clip
  link('far-slider', 'far-input', (v) => {
    camState.far = v;
    cameraManager.getCamera().far = v;
    cameraManager.getCamera().updateProjectionMatrix();
  });

  // Tone mapping
  const toneSelect = document.getElementById('tone-mapping-select');
  if (toneSelect) {
    toneSelect.addEventListener('change', (e) => {
      camState.toneMapping = e.target.value;
      applyCameraSettings();
    });
  }

  // Exposure
  link('exposure-slider', 'exposure-input', (v) => {
    camState.exposure = v;
    rendererManager.getRenderer().toneMappingExposure = v;
  });

  // DOF toggle
  const dofToggle = document.getElementById('cam-toggle-dof');
  if (dofToggle) {
    dofToggle.addEventListener('change', (e) => {
      camState.dofEnabled = e.target.checked;
      log(`DOF: ${camState.dofEnabled ? 'on' : 'off'}`);
      // Full DOF (BokehPass) would require EffectComposer integration in Renderer
      // Noted for future post-processing implementation
    });
  }

  // DOF focus distance
  link('cam-dof-focus-slider', 'cam-dof-focus-input', (v) => {
    camState.dofFocus = v;
  });

  // DOF aperture/strength
  link('cam-dof-strength-slider', 'cam-dof-strength-input', (v) => {
    camState.dofAperture = v;
  });

  // Apply initial camera settings from UI defaults
  applyCameraSettings();
}

//═══════════════════════════════════════════════════════════════
// UI CONTROLS
//═══════════════════════════════════════════════════════════════

const controls = new ControlsManager({
  onModelChange: (name) => loadModel(name),

  onMaterialChange: (preset) => applyMaterialPreset(preset),

  onSceneChange: (sceneName) => {
    loadScene(sceneName, (name, texture) => {
      sceneManager.setEnvironment(texture);
      sceneManager.getScene().background = texture;
      log(`Scene: ${name}`);
      if (activeModel) {
        activeModel.traverse((child) => {
          if (child.isMesh && child.material) {
            child.material.envMap = texture;
            child.material.needsUpdate = true;
          }
        });
      }
    });
  },

  onMaterialPropertyChange: (property, value) => {
    updateMaterialProperty(property, value);
  },

  onApplyDesign: () => {
    if (!activeMesh) { logError('No model loaded'); return; }
    // Just apply the texture to model - don't call open() which would prompt for name
    uvEditor.applyTextureToModel();
  },

  onResetTexture: () => {
    uvEditor.resetTexture();
  },

  onUploadModel: async (files) => {
    if (!files?.length) return;
    const result = await modelManager.addModelFromFiles(files);
    if (result.success) {
      logSuccess(`Model added: ${result.name}`);
      result.warnings.forEach(w => logWarn(w));
      await updateModelList();
      loadModel(result.name);
    } else {
      result.errors.forEach(e => logError(e));
    }
  },

  onExport: async () => {
    const name = getCurrentModelName();
    if (!name) { logError('No model selected'); return; }
    const data = await modelManager.getModel(name);
    if (data?.type === 'custom') {
      await modelManager.exportCustomModel(name);
      logSuccess(`Exported: ${name}`);
    } else {
      logError('Only custom models can be exported');
    }
  },

  onImport: async (files) => {
    if (!files?.length) return;
    const file = files[0];
    if (!file.name.endsWith('.json') && !file.name.endsWith('.renderdeck.json')) {
      logError('Please select a .json or .renderdeck.json file');
      return;
    }
    const result = await modelManager.importCustomModel(file);
    if (result.success) {
      logSuccess(`Imported: ${result.name}`);
      await updateModelList();
      loadModel(result.name);
    } else {
      logError(`Import failed: ${result.error}`);
    }
  },

  onClearCustom: async () => {
    if (!confirm('Clear all custom models? This cannot be undone!')) return;
    const result = await modelManager.clearAllCustomModels();
    if (result.success) {
      logSuccess(`Cleared ${result.count} custom model(s)`);
      await updateModelList();

      // Reset the material preset dropdown to its placeholder
      const matSelect = document.getElementById('material-select');
      if (matSelect) matSelect.selectedIndex = 0;

      // Load the first built-in model — this applies the Wood default preset
      const first = Object.keys(MODEL_PATHS).find(k => k !== 'BASE_PATH');
      if (first) {
        const name = first.split('_').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
        // loadModel → loadRegularModel → applyMaterialPreset('Wood') → syncMaterialUI
        // so the UI will fully reset to Wood defaults automatically
        loadModel(name);
      }
    }
  },
});

function getCurrentModelName() {
  return document.getElementById('object-select')?.value
    || document.getElementById('model-select')?.value || '';
}

function getCurrentMaterialPreset() {
  return document.getElementById('material-select')?.value || 'Wood';
}

async function updateModelList() {
  const categories = await modelManager.getModelNamesByCategory();
  controls.updateModelSelect(categories);
}

function updateSceneList() {
  controls.updateSceneSelect(getSceneNames());
}

function updateMaterialPresetList() {
  controls.updateMaterialPresetSelect(materialManager.getPresetNames());
}

window.updateModelSelect = updateModelList;
window.switchToModel = (name) => {
  const sel = document.getElementById('object-select') || document.getElementById('model-select');
  if (sel) { sel.value = name; loadModel(name); }
};

//═══════════════════════════════════════════════════════════════
// DRAG & DROP
//═══════════════════════════════════════════════════════════════

container.addEventListener('dragover', (e) => {
  e.preventDefault(); e.stopPropagation();
  container.classList.add('drag-over');
});
container.addEventListener('dragleave', (e) => {
  e.preventDefault(); e.stopPropagation();
  container.classList.remove('drag-over');
});
container.addEventListener('drop', async (e) => {
  e.preventDefault(); e.stopPropagation();
  container.classList.remove('drag-over');
  const files = Array.from(e.dataTransfer.files);
  if (!files.length) return;
  const result = await modelManager.addModelFromFiles(files);
  if (result.success) {
    logSuccess(`Model added: ${result.name}`);
    result.warnings.forEach(w => logWarn(w));
    await updateModelList();
    loadModel(result.name);
  } else {
    result.errors.forEach(e => logError(e));
  }
});


//═══════════════════════════════════════════════════════════════
// POST-PROCESSING UI (Setting 6)
//═══════════════════════════════════════════════════════════════

function setupPostFXUI() {
  const rm = rendererManager; // shorthand

  // Helper: link slider <-> number input
  const link = (sliderId, inputId, callback) => {
    const s = document.getElementById(sliderId);
    const i = document.getElementById(inputId);
    if (!s || !i) return;
    s.addEventListener('input', () => { i.value = s.value; callback(parseFloat(s.value)); });
    i.addEventListener('input', () => {
      const v = parseFloat(i.value);
      if (!isNaN(v)) { s.value = v; callback(v); }
    });
  };

  // ── Global post-FX toggle (Setting 5 "Enable Post Effects") ──
  const globalToggle = document.getElementById('preview-toggle-postfx');
  if (globalToggle) {
    globalToggle.addEventListener('change', (e) => {
      rm.setPostFXEnabled(e.target.checked);
    });
    // Default: off until user enables or picks a preset
    rm.setPostFXEnabled(false);
  }

  // ── Preset select ─────────────────────────────────────────────
  const presetSelect = document.getElementById('postfx-preset-select');
  if (presetSelect) {
    presetSelect.addEventListener('change', (e) => {
      rm.applyPreset(e.target.value);
      // Also sync the global toggle in Setting 5
      if (globalToggle) globalToggle.checked = rm.postFXEnabled;
    });
  }

  // ── Individual effect toggles ─────────────────────────────────
  const bloomToggle = document.getElementById('post-toggle-bloom');
  if (bloomToggle) {
    bloomToggle.addEventListener('change', (e) => rm.setBloom(e.target.checked));
  }

  const vignetteToggle = document.getElementById('post-toggle-vignette');
  if (vignetteToggle) {
    vignetteToggle.addEventListener('change', (e) => rm.setVignette(e.target.checked));
  }

  const aoToggle = document.getElementById('post-toggle-ao');
  if (aoToggle) {
    aoToggle.addEventListener('change', (e) => rm.setSSAO(e.target.checked));
  }

  const motionBlurToggle = document.getElementById('post-toggle-motionblur');
  if (motionBlurToggle) {
    motionBlurToggle.addEventListener('change', (e) => rm.setMotionBlur(e.target.checked));
  }

  // ── Bloom controls ────────────────────────────────────────────
  link('bloom-strength-slider', 'bloom-strength-input', v => rm.setBloomStrength(v));
  link('bloom-radius-slider',   'bloom-radius-input',   v => rm.setBloomRadius(v));
  link('bloom-threshold-slider','bloom-threshold-input',v => rm.setBloomThreshold(v));

  // ── Vignette controls ─────────────────────────────────────────
  link('vignette-intensity-slider', 'vignette-intensity-input', v => rm.setVignetteIntensity(v));
  link('vignette-softness-slider',  'vignette-softness-input',  v => rm.setVignetteSoftness(v));

  // ── AO controls ───────────────────────────────────────────────
  link('ao-intensity-slider', 'ao-intensity-input', v => rm.setSSAOIntensity(v));
  link('ao-radius-slider',    'ao-radius-input',    v => rm.setSSAORadius(v));

  // ── Motion blur controls ──────────────────────────────────────
  link('motionblur-strength-slider', 'motionblur-strength-input', v => rm.setMotionBlurStrength(v));

  log('Post-processing UI ready.');
}

//═══════════════════════════════════════════════════════════════
// PREVIEW QUALITY UI (Setting 5)
//═══════════════════════════════════════════════════════════════

// Store helpers so we can toggle them
let gridHelper = null;
let axesHelper = null;

function setupPreviewQualityUI() {
  const renderer = rendererManager.getRenderer();
  const scene = sceneManager.getScene();

  // ── Shadows toggle ──
  const shadowsToggle = document.getElementById('preview-toggle-shadows');
  if (shadowsToggle) {
    shadowsToggle.addEventListener('change', (e) => {
      renderer.shadowMap.enabled = e.target.checked;
      // Need to update all materials
      if (activeModel) {
        activeModel.traverse((child) => {
          if (child.isMesh && child.material) {
            child.material.needsUpdate = true;
          }
        });
      }
      log(`Shadows: ${e.target.checked ? 'on' : 'off'}`);
    });
  }

  // ── Wireframe toggle ──
  const wireframeToggle = document.getElementById('preview-toggle-wireframe');
  if (wireframeToggle) {
    wireframeToggle.addEventListener('change', (e) => {
      if (activeModel) {
        activeModel.traverse((child) => {
          if (child.isMesh && child.material) {
            child.material.wireframe = e.target.checked;
            child.material.needsUpdate = true;
          }
        });
      }
      log(`Wireframe: ${e.target.checked ? 'on' : 'off'}`);
    });
  }

  // ── Helpers toggle (Grid + Axes) ──
  const helpersToggle = document.getElementById('preview-toggle-helpers');
  if (helpersToggle) {
    helpersToggle.addEventListener('change', (e) => {
      if (e.target.checked) {
        // Create and add helpers if they don't exist
        if (!gridHelper) {
          gridHelper = new THREE.GridHelper(10, 10, 0x888888, 0x444444);
          gridHelper.position.y = -0.01; // Slightly below origin
        }
        if (!axesHelper) {
          axesHelper = new THREE.AxesHelper(2);
        }
        scene.add(gridHelper);
        scene.add(axesHelper);
        log('Helpers: on');
      } else {
        // Remove helpers
        if (gridHelper) scene.remove(gridHelper);
        if (axesHelper) scene.remove(axesHelper);
        log('Helpers: off');
      }
    });
  }

  // ── Vertex Colors toggle ──
  const vertexColorsToggle = document.getElementById('preview-toggle-vertexcolors');
  if (vertexColorsToggle) {
    vertexColorsToggle.addEventListener('change', (e) => {
      if (activeModel) {
        activeModel.traverse((child) => {
          if (child.isMesh && child.material) {
            child.material.vertexColors = e.target.checked;
            child.material.needsUpdate = true;
          }
        });
      }
      log(`Vertex colors: ${e.target.checked ? 'on' : 'off'}`);
    });
  }

  // ── Render Scale ──
  const renderScaleSelect = document.getElementById('render-scale-select');
  if (renderScaleSelect) {
    renderScaleSelect.addEventListener('change', (e) => {
      const scale = parseFloat(e.target.value);
      const baseDPR = window.devicePixelRatio || 1;
      renderer.setPixelRatio(Math.min(baseDPR * scale, 2));
      log(`Render scale: ${(scale * 100).toFixed(0)}%`);
    });
  }

  // ── Max DPR ──
  const maxDprSelect = document.getElementById('max-dpr-select');
  if (maxDprSelect) {
    maxDprSelect.addEventListener('change', (e) => {
      const val = e.target.value;
      if (val === 'auto') {
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      } else {
        renderer.setPixelRatio(parseFloat(val));
      }
      log(`Max DPR: ${val}`);
    });
  }

  // ── Anti-Aliasing mode ──
  const aaSelect = document.getElementById('aa-mode-select');
  if (aaSelect) {
    aaSelect.addEventListener('change', (e) => {
      const mode = e.target.value;
      // MSAA is baked into renderer at creation, but we can toggle FXAA
      if (mode === 'fxaa') {
        rendererManager.setFXAA(true);
      } else {
        rendererManager.setFXAA(false);
      }
      log(`Anti-aliasing: ${mode}`);
    });
  }

  // ── Shadow Quality ──
  const shadowQualitySelect = document.getElementById('shadow-quality-select');
  if (shadowQualitySelect) {
    shadowQualitySelect.addEventListener('change', (e) => {
      const quality = e.target.value;
      const sizes = { off: 0, low: 512, medium: 1024, high: 2048, ultra: 4096 };
      const size = sizes[quality] || 2048;
      
      if (quality === 'off') {
        renderer.shadowMap.enabled = false;
      } else {
        renderer.shadowMap.enabled = true;
        // Update shadow map size on lights
        scene.traverse((obj) => {
          if (obj.isLight && obj.shadow) {
            obj.shadow.mapSize.width = size;
            obj.shadow.mapSize.height = size;
            if (obj.shadow.map) {
              obj.shadow.map.dispose();
              obj.shadow.map = null;
            }
          }
        });
      }
      log(`Shadow quality: ${quality}`);
    });
  }

  log('Preview quality UI ready.');
}

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

updateModelList();
updateSceneList();
updateMaterialPresetList();
setupCameraUI();
setupPostFXUI();
setupPreviewQualityUI();

// Apply initial renderer tone mapping
rendererManager.getRenderer().toneMapping = THREE.ACESFilmicToneMapping;
rendererManager.getRenderer().toneMappingExposure = 1.0;

const firstModel = Object.keys(MODEL_PATHS).find(k => k !== 'BASE_PATH');
if (firstModel) {
  const name = firstModel.split('_').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
  setTimeout(() => loadModel(name), 100);
}