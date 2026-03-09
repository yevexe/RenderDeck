// MAIN.JS - Application Orchestrator

import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Core
import { SceneManager } from './core/Scene.js';
import { RendererManager } from './core/Renderer.js';
import { CameraManager } from './core/Camera.js';

import { MaterialManager } from './materials/MaterialManager.js';
import { ModelManager } from './models/ModelManager.js';

import { UVEditor } from './ui/UVEditor.js';
import { ControlsManager } from './ui/Controls.js';
import { SceneStateManager }    from './stateEditor/SceneState.js';
import { DesignStateManager }   from './stateEditor/DesignState.js';
import { MaterialStateManager } from './stateEditor/MaterialState.js';
import * as IDBStorage from './storage/indexedDBStorage.js';

// Utils
import { log, logError, logSuccess, logWarn } from './utils/logger.js';
import { TextureCompositor } from './utils/TextureCompositor.js';
import { centerAndFrameModel, cleanupObject } from './utils/helpers.js';

// Config
import { STANDARD_OBJECTS, STANDARD_MATERIALS, STANDARD_ENVIRONMENTS } from './config.js';

// Props
import { PropManager } from './props/PropManager.js';
import { CustomSceneStorage } from './scenes/CustomSceneStorage.js';

// Scenes
import { initScenes, loadScene, getSceneNames } from './core/SceneLoader.js';

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
const gltfLoader = new GLTFLoader();

const propManager = new PropManager(
  sceneManager.getScene(),
  cameraManager.getCamera(),
  rendererManager.getRenderer(),
  cameraManager.getControls(),
  log
);

let activeModel = null;
let activeMesh = null;
let meshMap = {}; // name → mesh reference for multi‑part models

// Background / environment state
let currentEnvTexture = null;   // currently loaded HDR texture
let currentEnvironment = null;  // name of currently loaded HDR (e.g. 'Studio Kominka')
let showEnvBackground = true;   // scene.background = HDR when true
let gradientBgEnabled = false;  // show CSS gradient when true
let currentGradientBg = '';     // key from GRADIENT_PRESETS

const sceneStorage = new CustomSceneStorage();

//═══════════════════════════════════════════════════════════════
// STATE EDITORS — three independent undo/redo stacks
//═══════════════════════════════════════════════════════════════

const sceneState = new SceneStateManager({
  propManager,
  sceneManager,
  loadScene,
  applyBackground: () => applyBackground(),
  markNeedsRender: (n) => markNeedsRender(n),
  getEnv: () => ({ currentEnvironment, currentEnvTexture, showEnvBackground, gradientBgEnabled, currentGradientBg }),
  setEnv: (updates) => {
    if ('currentEnvironment' in updates) currentEnvironment = updates.currentEnvironment;
    if ('currentEnvTexture'  in updates) currentEnvTexture  = updates.currentEnvTexture;
    if ('showEnvBackground'  in updates) showEnvBackground  = updates.showEnvBackground;
    if ('gradientBgEnabled'  in updates) gradientBgEnabled  = updates.gradientBgEnabled;
    if ('currentGradientBg'  in updates) currentGradientBg  = updates.currentGradientBg;
  },
});

const designState = new DesignStateManager({ uvEditor });

const materialState = new MaterialStateManager({
  materialManager,
  getControls:     () => controls,
  getActiveMesh:   () => activeMesh,
  markNeedsRender: (n) => markNeedsRender(n),
});

function pushSceneHistory(label)  { sceneState.push(label); }

function setupHistoryUI() {
  sceneState.setupUI();
  designState.setupUI();
  materialState.setupUI();

  // Save prop transform to scene history when user releases gizmo
  const modeLabels = { translate: 'Moved prop', rotate: 'Rotated prop', scale: 'Scaled prop' };
  propManager.onTransformCommit = (mode) => {
    sceneState.push(modeLabels[mode] || 'Transformed prop');
  };

  // Unified Ctrl+Z / Ctrl+Shift+Z: undo/redo whichever stack has the most recent entry
  const managers = [
    { mgr: sceneState,    restore: (s) => sceneState.restore(s),    ui: () => sceneState.updateUI()    },
    { mgr: designState,   restore: (s) => designState.restore(s),   ui: () => designState.updateUI()   },
    { mgr: materialState, restore: (s) => materialState.restore(s), ui: () => materialState.updateUI() },
  ];

  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;

    if (e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      const target = managers.reduce((best, m) =>
        m.mgr.history.peekUndoTimestamp() > best.mgr.history.peekUndoTimestamp() ? m : best
      );
      const state = target.mgr.history.undo();
      if (state) { target.restore(state); target.ui(); }

    } else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
      e.preventDefault();
      const target = managers.reduce((best, m) =>
        m.mgr.history.peekRedoTimestamp() > best.mgr.history.peekRedoTimestamp() ? m : best
      );
      const state = target.mgr.history.redo();
      if (state) { target.restore(state); target.ui(); }
    }
  });
}

const GRADIENT_PRESETS = {
  grad_studio:  'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
  grad_sunset:  'linear-gradient(135deg, #ff6b6b 0%, #feca57 50%, #ff9ff3 100%)',
  grad_ocean:   'linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)',
  grad_forest:  'linear-gradient(135deg, #134e5e 0%, #71b280 100%)',
  grad_dark:    '#111111',
  grad_white:   '#f5f5f5',
  solid_black:  '#000000',
  solid_white:  '#ffffff',
  solid_gray:   '#444444',
};

const SESSION_STORAGE_KEY = 'session:renderdeck.reloadstate.v2';
const SESSION_BOOT_KEY = 'session:renderdeck.boot.v1';

function applyBackground() {
  const scene = sceneManager.getScene();
  // Priority: env background > CSS gradient > plain clear color
  if (showEnvBackground && currentEnvTexture) {
    scene.background = currentEnvTexture;
    container.style.background = '';
    rendererManager.getRenderer().setClearColor(0x1a1a1a, 1);
  } else {
    scene.background = null;
    if (gradientBgEnabled && currentGradientBg && GRADIENT_PRESETS[currentGradientBg]) {
      container.style.background = GRADIENT_PRESETS[currentGradientBg];
      rendererManager.getRenderer().setClearColor(0x000000, 0); // transparent canvas
    } else {
      container.style.background = '';
      rendererManager.getRenderer().setClearColor(0x1a1a1a, 1);
    }
  }
  syncSceneState();
  markNeedsRender(4);
}

function syncSceneState() {
  uvEditor.sceneState = {
    sceneName: document.getElementById('environment-select')?.value || null,
    showEnvBackground,
    gradientBgEnabled,
    currentGradientBg,
  };
}

function restoreSceneState(sceneState) {
  if (!sceneState) return;
  if (sceneState.sceneName) {
    const sel = document.getElementById('environment-select');
    if (sel) sel.value = sceneState.sceneName;
    loadScene(sceneState.sceneName, (name, texture) => {
      currentEnvTexture = texture;
      currentEnvironment = name;
      sceneManager.setEnvironment(texture);
      if (activeModel) {
        activeModel.traverse((child) => {
          if (child.isMesh && child.material) {
            child.material.envMap = texture;
            child.material.needsUpdate = true;
          }
        });
      }
      applyBackground();
      log(`Scene: ${name}`);
    });
  }
  if (typeof sceneState.showEnvBackground === 'boolean') showEnvBackground = sceneState.showEnvBackground;
  if (typeof sceneState.gradientBgEnabled === 'boolean') gradientBgEnabled = sceneState.gradientBgEnabled;
  if (typeof sceneState.currentGradientBg === 'string') currentGradientBg = sceneState.currentGradientBg;
  const envBgToggle = document.getElementById('env-bg-toggle');
  if (envBgToggle) envBgToggle.checked = showEnvBackground;
  const gradBgToggle = document.getElementById('gradient-bg-toggle');
  if (gradBgToggle) gradBgToggle.checked = gradientBgEnabled;
  const bgSelect = document.getElementById('background-select');
  if (bgSelect && sceneState.currentGradientBg) bgSelect.value = sceneState.currentGradientBg;
  applyBackground();
}

// hover/select helpers
let hoveredMesh = null;
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

//═══════════════════════════════════════════════════════════════
// SCENE SETUP
//═══════════════════════════════════════════════════════════════

log('RenderDeck initialized.');

initScenes((name, texture) => {
  currentEnvTexture = texture;
  currentEnvironment = name;
  sceneManager.setEnvironment(texture);
  applyBackground();
  log(`Scene: ${name}`);
});

registerBuiltInModels();

function registerBuiltInModels() {
  STANDARD_OBJECTS.forEach(obj => {
    modelManager.registerModel(obj.label, { objPath: obj.objPath, mtlPath: obj.mtlPath });
  });
}

/** Load JSON material presets from assets, then refresh the UI dropdown. */
async function initMaterialPresets() {
  await materialManager.loadPresetsFromManifest(STANDARD_MATERIALS);
  updateMaterialPresetList();
}
initMaterialPresets();

//═══════════════════════════════════════════════════════════════
// MODEL LOADING
//═══════════════════════════════════════════════════════════════

async function loadModel(name, onLoaded = null) {
  // clear any previous part data
  meshMap = {};
  clearHighlight();
  if (controls) {
    controls.updatePartSelect([]);
    controls.setEnabled('objectPartSelect', false);
    controls.setVisible('objectPartSelect', false);
  }

  const modelData = await modelManager.getModel(name);
  if (!modelData) { logError(`Model not found: ${name}`); return; }
  cleanupActiveModel();
  if (modelData.type === 'custom') {
    await loadCustomModel(name, modelData, onLoaded);
  } else {
    await loadRegularModel(name, modelData, onLoaded);
  }
}

async function loadCustomModel(name, modelData, onLoaded = null) {
  log(`Loading custom model: ${name}…`);
  const loadingPaths = await modelManager.getLoadingPaths(modelData.basedOn);
  if (!loadingPaths) { logError(`Base model not found: ${modelData.basedOn}`); return; }

  const objPath = loadingPaths.obj;

  objLoader.load(objPath, (object) => {
    const meshList = [];

    object.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
      child.userData.isCustomModel = true;

      // unique naming
      let baseName = child.name || `Part`;
      let uniqueName = baseName;
      let idx = 1;
      while (meshMap[uniqueName]) {
        uniqueName = `${baseName}_${idx++}`;
      }
      child.name = uniqueName;

      meshList.push(child);
      meshMap[child.name] = child;

      if (!activeMesh) activeMesh = child;

      const presetName = modelData.materialPreset || 'Wood';
      const material = materialManager.getPreset(presetName);
      materialManager.applyEnvironment(material, sceneManager.getScene().environment);
      child.material = material;

      if (modelData.materialProperties) {
        materialManager.applySavedProperties(child.material, modelData.materialProperties);
      }

      // Composite texture is applied by uvEditor.open() after it loads the overlays.
    });

    sceneManager.add(object);
    activeModel = object;
    propManager.setMainModel(activeModel);
    activeMesh = meshList[0] || null;
    const names = meshList.map(m => m.name);
    controls.updatePartSelect(names);
    uvEditor.setPartNames(names, (n) => selectPart(meshMap[n]));
    const multi = names.length > 1;
    controls.setEnabled('objectPartSelect', multi);
    controls.setVisible('objectPartSelect', multi);
    // frame the new model from a top‑right‑corner angle
    centerAndFrameModel(object, cameraManager, {mode: 'corner'});
    if (activeMesh?.material) controls.syncMaterialUI(activeMesh.material);
    log(`${name} loaded.`);
    // Initialize UV editor for this custom model
    if (activeMesh) {
      uvEditor.open(activeMesh, name, modelData.materialPreset || 'Wood');
    }
    // Restore the scene/background that was active when this custom model was saved
    if (modelData.sceneState) {
      restoreSceneState(modelData.sceneState);
    }
    markNeedsRender(60);
    if (onLoaded) onLoaded(object);
  },
  (xhr) => { if (xhr.lengthComputable && xhr.total > 0) log(`Loading… ${((xhr.loaded/xhr.total)*100).toFixed(0)}%`); },
  (err) => logError(`OBJ load failed: ${err}`));
}

async function loadRegularModel(name, modelData, onLoaded = null) {
  log(`Loading ${name}…`);
  const loadingPaths = await modelManager.getLoadingPaths(name);
  if (!loadingPaths) { logError(`No paths for ${name}`); return; }

  // ── GLB/GLTF branch ───────────────────────────────────────────
  if (loadingPaths.type === 'glb-path' || loadingPaths.type === 'glb-blob') {
    gltfLoader.load(loadingPaths.obj, (gltf) => {
      const object = gltf.scene;
      const meshList = [];

      object.traverse((child) => {
        if (!child.isMesh) return;
        child.castShadow = true;
        child.receiveShadow = true;
        // unique naming
        let baseName = child.name || `Part`;
        let uniqueName = baseName;
        let idx = 1;
        while (meshMap[uniqueName]) {
          uniqueName = `${baseName}_${idx++}`;
        }
        child.name = uniqueName;

        meshList.push(child);
        meshMap[child.name] = child;
      });
      activeMesh = meshList[0] || null;
      {
        const names = meshList.map(m => m.name);
        controls.updatePartSelect(names);
        uvEditor.setPartNames(names, (n) => selectPart(meshMap[n]));
        const multi = names.length > 1;
        controls.setEnabled('objectPartSelect', multi);
        controls.setVisible('objectPartSelect', multi);
      }

      sceneManager.add(object);
      activeModel = object;
      propManager.setMainModel(activeModel);
      centerAndFrameModel(object, cameraManager, {mode: 'corner'});
      log(`${name} loaded.`);
      if (activeMesh) uvEditor.open(activeMesh, name, 'Wood');
      markNeedsRender(60);
      if (onLoaded) onLoaded(object);
    },
    (xhr) => { if (xhr.lengthComputable && xhr.total > 0) log(`Loading… ${((xhr.loaded/xhr.total)*100).toFixed(0)}%`); },
    (err) => logError(`GLB load failed: ${err}`));
    return;
  }

  function loadOBJ(materials = null) {
    if (materials) objLoader.setMaterials(materials);
    const objPath = loadingPaths.obj;

    objLoader.load(objPath, (object) => {
      const meshList = [];
      object.traverse((child) => {
        if (!child.isMesh) return;
        child.castShadow = true;
        child.receiveShadow = true;
        // unique naming
        let baseName = child.name || `Part`;
        let uniqueName = baseName;
        let idx = 1;
        while (meshMap[uniqueName]) {
          uniqueName = `${baseName}_${idx++}`;
        }
        child.name = uniqueName;

        meshList.push(child);
        meshMap[child.name] = child;
      });
      activeMesh = meshList[0] || null;
      {
        const names = meshList.map(m => m.name);
        controls.updatePartSelect(names);
        uvEditor.setPartNames(names, (n) => selectPart(meshMap[n]));
        const multi = names.length > 1;
        controls.setEnabled('objectPartSelect', multi);
        controls.setVisible('objectPartSelect', multi);
      }

      sceneManager.add(object);
      activeModel = object;
      propManager.setMainModel(activeModel);
      centerAndFrameModel(object, cameraManager, {mode: 'corner'});
      applyMaterialPreset(materialManager.getPresetNames()[0] || 'Wood');
      log(`${name} loaded.`);
      // Initialize UV editor for this model
      if (activeMesh) {
        uvEditor.open(activeMesh, name, 'Wood');
      }
      markNeedsRender(60);
      if (onLoaded) onLoaded(object);
    },
    (xhr) => { if (xhr.lengthComputable && xhr.total > 0) log(`Loading… ${((xhr.loaded/xhr.total)*100).toFixed(0)}%`); },
    (err) => logError(`OBJ load failed: ${err}`));
  }

  if (loadingPaths.mtl) {
    if (loadingPaths.type === 'path') {
      const lastSlash = loadingPaths.mtl.lastIndexOf('/');
      const mtlBase = loadingPaths.mtl.substring(0, lastSlash + 1);
      const mtlFile = loadingPaths.mtl.substring(lastSlash + 1);
      mtlLoader.setPath(mtlBase);
      mtlLoader.load(mtlFile,
        (m) => { m.preload(); loadOBJ(m); },
        undefined,
        () => loadOBJ());
    } else {
      fetch(loadingPaths.mtl).then(r => r.text())
        .then(t => { const m = mtlLoader.parse(t, ''); m.preload(); loadOBJ(m); })
        .catch(() => loadOBJ());
    }
  } else {
    loadOBJ();
  }
}

function cleanupActiveModel() {
  if (activeModel) {
    propManager.setMainModel(null);
    sceneManager.remove(activeModel);
    cleanupObject(activeModel);
    activeModel = null;
    activeMesh = null;
    meshMap = {};
    clearHighlight();
    if (controls) {
      controls.updatePartSelect([]);
      controls.setEnabled('objectPartSelect', false);
      controls.setVisible('objectPartSelect', false);
    }
  }
}

//═══════════════════════════════════════════════════════════════
// MATERIAL MANAGEMENT
//═══════════════════════════════════════════════════════════════

function applyMaterialPreset(presetName) {
  if (!activeModel) return;
  const env = sceneManager.getScene().environment;

  if (activeMesh) {
    // change only the selected mesh
    if (activeMesh.userData?.isCustomModel) {
      if (env && activeMesh.material) {
        activeMesh.material.envMap = env;
        activeMesh.material.needsUpdate = true;
      }
    } else {
      const material = materialManager.getPreset(presetName);
      materialManager.applyEnvironment(material, env);
      if (activeMesh.material) materialManager.dispose(activeMesh.material);
      activeMesh.material = material;
      activeMesh.material.needsUpdate = true;
    }
  } else {
    // fallback: apply to everything
    activeModel.traverse((child) => {
      if (!child.isMesh) return;
      if (child.userData?.isCustomModel) {
        if (env && child.material) {
          child.material.envMap = env;
          child.material.needsUpdate = true;
        }
        return;
      }
      const material = materialManager.getPreset(presetName);
      materialManager.applyEnvironment(material, env);
      if (child.material) materialManager.dispose(child.material);
      child.material = material;
      if (!activeMesh) activeMesh = child;
      child.material.needsUpdate = true;
    });
  }

  if (activeMesh?.material) controls.syncMaterialUI(activeMesh.material);
  
  // Update UV editor base to match current material (clear stale map if none).
  uvEditor.baseTexture = activeMesh?.material?.map || null;
  uvEditor.currentMaterialPreset = presetName;
  uvEditor._renderPreview();
  
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
// BUTTON-ROW HELPER
//═══════════════════════════════════════════════════════════════

function setupButtonRow(groupId, callback) {
  const group = document.getElementById(groupId);
  if (!group) return;
  group.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-value]');
    if (!btn) return;
    group.querySelectorAll('button').forEach(b => b.classList.remove('button-selected'));
    btn.classList.add('button-selected');
    const targetId = group.dataset.targetInput;
    if (targetId) {
      const input = document.getElementById(targetId);
      if (input) input.value = btn.dataset.value;
    }
    callback(btn.dataset.value);
  });
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
  focalLength: 85,    // default lens length changed to 85mm
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

  // Lens / focal length — button row preset + slider/input for custom value
  setupButtonRow('lens-mm-buttons', (v) => {
    camState.focalLength = parseFloat(v);
    const s = document.getElementById('lens-mm-slider');
    const i = document.getElementById('lens-mm-input');
    if (s) s.value = v;
    if (i) i.value = v;
    applyCameraSettings();
    log(`Lens: ${camState.focalLength}mm`);
  });

  link('lens-mm-slider', 'lens-mm-input', (v) => {
    camState.focalLength = v;
    // Highlight preset button if slider lands on a preset value
    const group = document.getElementById('lens-mm-buttons');
    if (group) {
      group.querySelectorAll('button').forEach(b => {
        if (parseFloat(b.dataset.value) === v) {
          b.classList.add('button-selected');
        } else {
          b.classList.remove('button-selected');
        }
      });
    }
    applyCameraSettings();
    log(`Lens: ${v}mm`);
  });

  // Film / sensor gauge
  setupButtonRow('film-gauge-buttons', (v) => {
    camState.sensorKey = v;
    applyCameraSettings();
    log(`Sensor: ${v}`);
  });

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
  setupButtonRow('tone-mapping-buttons', (v) => {
    camState.toneMapping = v;
    applyCameraSettings();
  });

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

  onPartChange: (partName) => {
    if (!partName) return;
    const mesh = meshMap[partName];
    if (mesh) {
      activeMesh = mesh;
      if (activeMesh.material) controls.syncMaterialUI(activeMesh.material);
      uvEditor.open(activeMesh, getCurrentModelName(), getCurrentMaterialPreset());
      cameraManager.frameObject(activeMesh, {mode: 'corner'});
    }
  },

  onMaterialChange: (preset) => applyMaterialPreset(preset),

  onSceneChange: (sceneName) => {
    loadScene(sceneName, (name, texture) => {
      currentEnvTexture = texture;
      currentEnvironment = name;
      sceneManager.setEnvironment(texture);
      applyBackground();
      log(`Scene: ${name}`);
      if (activeModel) {
        activeModel.traverse((child) => {
          if (child.isMesh && child.material) {
            child.material.envMap = texture;
            child.material.needsUpdate = true;
          }
        });
      }
      pushSceneHistory(`Environment: ${name}`);
    });
  },

  onMaterialPropertyChange: (property, value) => {
    updateMaterialProperty(property, value);
  },

  onMaterialPropertyCommit: () => {
    materialState.push('Material change');
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

  onChannelTextureUpload: (channel, file) => {
    if (!activeMesh?.material) { logError('No active mesh'); return; }
    const url = URL.createObjectURL(file);
    const loader = new THREE.TextureLoader();
    loader.load(url, (tex) => {
      URL.revokeObjectURL(url);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      const old = activeMesh.material[channel];
      if (old && old.isTexture) old.dispose();
      activeMesh.material[channel] = tex;
      activeMesh.material.needsUpdate = true;
      controls.syncMaterialUI(activeMesh.material);
      log(`Channel "${channel}" texture set: ${file.name}`);
    }, undefined, () => logError(`Failed to load texture: ${file.name}`));
  },

  onChannelTextureClear: (channel) => {
    if (!activeMesh?.material) return;
    const old = activeMesh.material[channel];
    if (old && old.isTexture) old.dispose();
    activeMesh.material[channel] = null;
    activeMesh.material.needsUpdate = true;
    controls.syncMaterialUI(activeMesh.material);
    log(`Channel "${channel}" texture cleared`);
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
      if (STANDARD_OBJECTS.length > 0) {
        loadModel(STANDARD_OBJECTS[0].label);
      }
    }
  },
});

// start with part selector hidden/disabled until model loaded
controls.setEnabled('objectPartSelect', false);
controls.setVisible('objectPartSelect', false);

// --- hover highlighting and click-to-select ---
const canvas = rendererManager.getDomElement();
canvas.addEventListener('pointermove', onPointerMove);
canvas.addEventListener('pointermove', () => markNeedsRender(4), { passive: true });
canvas.addEventListener('wheel', () => markNeedsRender(8), { passive: true });
canvas.addEventListener('pointerleave', clearHighlight);
canvas.addEventListener('click', onCanvasClick);
canvas.addEventListener('pointerdown', () => markNeedsRender(4));

function setHighlight(mesh) {
  if (!mesh || mesh === hoveredMesh) return;
  clearHighlight();
  hoveredMesh = mesh;
  // create overlay geometry with orange semi-transparent material on top
  const overlayGeo = mesh.geometry.clone();
  const overlayMat = new THREE.MeshBasicMaterial({
    color: 0xffa500,
    transparent: true,
    opacity: 0.3,
    depthTest: false,
  });
  const highlightMesh = new THREE.Mesh(overlayGeo, overlayMat);
  highlightMesh.name = mesh.name + '_highlight';
  highlightMesh.renderOrder = 999;
  mesh.add(highlightMesh);
  mesh.userData.highlight = highlightMesh;
}

function clearHighlight() {
  if (hoveredMesh) {
    if (hoveredMesh.userData.highlight) {
      hoveredMesh.remove(hoveredMesh.userData.highlight);
      hoveredMesh.userData.highlight.geometry.dispose();
      hoveredMesh.userData.highlight.material.dispose();
      delete hoveredMesh.userData.highlight;
    }
    hoveredMesh = null;
  }
}

function onPointerMove(event) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, cameraManager.getCamera());
  const intersects = raycaster.intersectObjects(Object.values(meshMap), true);
  if (intersects.length > 0) {
    const mesh = intersects[0].object;
    if (mesh !== activeMesh) {
      setHighlight(mesh);
    } else {
      clearHighlight();
    }
  } else {
    clearHighlight();
  }
}

function onCanvasClick() {
  if (hoveredMesh) {
    selectPart(hoveredMesh);
  }
}

function selectPart(mesh) {
  if (!mesh) return;
  clearHighlight();
  activeMesh = mesh;
  if (activeMesh.material) controls.syncMaterialUI(activeMesh.material);
  uvEditor.open(activeMesh, getCurrentModelName(), getCurrentMaterialPreset());
  cameraManager.frameObject(activeMesh, {mode: 'corner'});
  const sel = controls.elements.objectPartSelect;
  if (sel) sel.value = mesh.name;
  const designSel = document.getElementById('design-part-select');
  if (designSel) designSel.value = mesh.name;
}


function getCurrentModelName() {
  return document.getElementById('object-select')?.value
    || document.getElementById('model-select')?.value || '';
}

function getCurrentMaterialPreset() {
  return document.getElementById('material-select')?.value || 'Wood';
}

function waitForModelReady(timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (activeModel && (activeMesh || Object.keys(meshMap).length > 0)) {
        clearInterval(timer);
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        reject(new Error('Timed out waiting for model load'));
      }
    }, 100);
  });
}

function saveSessionState() {
  try {
    const cam = cameraManager.getCamera();
    const orbit = cameraManager.getControls();
    const state = {
      version: 1,
      savedAt: Date.now(),
      modelName: getCurrentModelName() || null,
      partName: activeMesh?.name || null,
      sceneName: controls?.elements?.sceneSelect?.value || null,
      materialPreset: getCurrentMaterialPreset() || null,
      materialProperties: activeMesh?.material
        ? materialManager.extractProperties(activeMesh.material)
        : null,
      showEnvBackground,
      gradientBgEnabled,
      currentGradientBg,
      camState: { ...camState },
      camera: {
        position: { x: cam.position.x, y: cam.position.y, z: cam.position.z },
        target: orbit
          ? { x: orbit.target.x, y: orbit.target.y, z: orbit.target.z }
          : null,
      },
      uvEditor: uvEditor.getSessionState?.() || null,
      props: propManager.getSceneData(),
    };
    // Fast startup hint (sync read/write, tiny payload)
    try {
      localStorage.setItem(SESSION_BOOT_KEY, JSON.stringify({
        version: 1,
        savedAt: state.savedAt,
        modelName: state.modelName,
        partName: state.partName,
        sceneName: state.sceneName,
        materialPreset: state.materialPreset,
      }));
    } catch (_) {
      // ignore localStorage quota/availability failures
    }
    // Persist in IndexedDB so larger state (overlay images) survives reload reliably.
    IDBStorage.put('metadata', SESSION_STORAGE_KEY, state).catch((err) => {
      console.warn('Session state write failed:', err);
    });
  } catch (err) {
    console.warn('Session save failed:', err);
  }
}

async function restoreSessionState() {
  let state = null;
  try {
    state = await IDBStorage.get('metadata', SESSION_STORAGE_KEY);
    if (!state || state.version !== 1) return false;
  } catch (err) {
    console.warn('Session parse failed:', err);
    return false;
  }

  try {
    // Restore scene/environment selection first
    if (state.sceneName) {
      const sel = controls?.elements?.sceneSelect;
      if (sel) sel.value = state.sceneName;
      loadScene(state.sceneName, (name, texture) => {
        currentEnvTexture = texture;
        currentEnvironment = name;
        sceneManager.setEnvironment(texture);
        applyBackground();
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
    }

    // Restore background toggles
    if (typeof state.showEnvBackground === 'boolean') showEnvBackground = state.showEnvBackground;
    if (typeof state.gradientBgEnabled === 'boolean') gradientBgEnabled = state.gradientBgEnabled;
    if (typeof state.currentGradientBg === 'string') currentGradientBg = state.currentGradientBg;
    const envBgToggle = document.getElementById('env-bg-toggle');
    if (envBgToggle) envBgToggle.checked = showEnvBackground;
    const gradBgToggle = document.getElementById('gradient-bg-toggle');
    if (gradBgToggle) gradBgToggle.checked = gradientBgEnabled;
    const bgSelect = document.getElementById('background-select');
    if (bgSelect && currentGradientBg) bgSelect.value = currentGradientBg;
    applyBackground();

    // Restore model
    const name = state.modelName;
    if (!name) return false;
    const modelSel = document.getElementById('object-select') || document.getElementById('model-select');
    if (modelSel) modelSel.value = name;

    const modelExists = await modelManager.getModel(name);
    if (!modelExists) return false;

    const activeSelectedName = getCurrentModelName();
    if (activeSelectedName === name && !activeModel) {
      try { await waitForModelReady(4000); } catch (_) { /* fall through to explicit load */ }
    }
    const modelAlreadyReady = !!(activeModel && (activeMesh || Object.keys(meshMap).length > 0));
    const isSameModelAlreadyActive = modelAlreadyReady && activeSelectedName === name;
    if (!isSameModelAlreadyActive) {
      await loadModel(name);
      await waitForModelReady();
    }

    // Restore part selection if available
    if (state.partName && meshMap[state.partName]) {
      selectPart(meshMap[state.partName]);
    }

    // Restore material preset + properties
    if (state.materialPreset) {
      const matSel = document.getElementById('material-select');
      if (matSel) matSel.value = state.materialPreset;
      applyMaterialPreset(state.materialPreset);
    }
    if (state.materialProperties && activeMesh?.material) {
      materialManager.applySavedProperties(activeMesh.material, state.materialProperties);
      controls.syncMaterialUI(activeMesh.material);
    }

    // Restore unsaved design editor overlays
    if (state.uvEditor) {
      await uvEditor.restoreSessionState(state.uvEditor);
    }

    // Restore props
    if (state.props?.length) {
      await propManager.loadSceneData(state.props);
    }

    // Restore camera model/settings last so model framing doesn't override it.
    if (state.camState && typeof state.camState === 'object') {
      Object.assign(camState, state.camState);
      applyCameraSettings();
    }
    if (state.camera?.position) {
      const p = state.camera.position;
      cameraManager.setPosition(p.x, p.y, p.z);
    }
    if (state.camera?.target) {
      const t = state.camera.target;
      cameraManager.setTarget(t.x, t.y, t.z);
    }

    log('Restored previous session.');
    return true;
  } catch (err) {
    console.warn('Session restore failed:', err);
    return false;
  }
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

  // ── Resolution select ──
  const resolutionSelect = document.getElementById('resolution-select');
  if (resolutionSelect) {
    resolutionSelect.addEventListener('change', (e) => {
      const val = e.target.value;
      if (!val) return;
      const [w, h] = val.split('x').map(Number);
      renderer.setSize(w, h);
      const cam = cameraManager.getCamera();
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
      log(`Resolution: ${w}×${h}`);
    });
  }

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
  setupButtonRow('render-scale-buttons', (v) => {
    const scale = parseFloat(v);
    const baseDPR = window.devicePixelRatio || 1;
    renderer.setPixelRatio(Math.min(baseDPR * scale, 2));
    log(`Render scale: ${(scale * 100).toFixed(0)}%`);
  });

  // ── Max DPR ──
  setupButtonRow('max-dpr-buttons', (v) => {
    if (v === 'auto') {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    } else {
      renderer.setPixelRatio(parseFloat(v));
    }
    log(`Max DPR: ${v}`);
  });

  // ── Anti-Aliasing mode ──
  setupButtonRow('aa-mode-buttons', (v) => {
    if (v === 'fxaa') {
      rendererManager.setFXAA(true);
    } else {
      rendererManager.setFXAA(false);
    }
    log(`Anti-aliasing: ${v}`);
  });

  // ── Shadow Quality ──
  setupButtonRow('shadow-quality-buttons', (v) => {
    const sizes = { off: 0, low: 512, medium: 1024, high: 2048, ultra: 4096 };
    const size = sizes[v] || 2048;
    if (v === 'off') {
      renderer.shadowMap.enabled = false;
    } else {
      renderer.shadowMap.enabled = true;
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
    log(`Shadow quality: ${v}`);
  });

  log('Preview quality UI ready.');
}

//═══════════════════════════════════════════════════════════════
// BACKGROUND UI (Setting 1)
//═══════════════════════════════════════════════════════════════

function setupDesignShortcuts() {
  const NUDGE    = 2;  // % per keypress
  const ROT_STEP = 5;  // degrees per keypress

  /** Briefly light up a button to give tactile feedback. */
  const flash = (id) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.classList.add('sc-active');
    setTimeout(() => btn.classList.remove('sc-active'), 200);
  };

  // Keyboard handler — skip when focus is inside a text field
  document.addEventListener('keydown', (e) => {
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    switch (e.key) {
      case 'ArrowUp':    e.preventDefault(); uvEditor.nudgeSelected(0, -NUDGE); flash('sc-up');      break;
      case 'ArrowDown':  e.preventDefault(); uvEditor.nudgeSelected(0,  NUDGE); flash('sc-down');    break;
      case 'ArrowLeft':  e.preventDefault(); uvEditor.nudgeSelected(-NUDGE, 0); flash('sc-left');    break;
      case 'ArrowRight': e.preventDefault(); uvEditor.nudgeSelected( NUDGE, 0); flash('sc-right');   break;
      case 'q': case 'Q': uvEditor.rotateSelected(-ROT_STEP); flash('sc-rot-ccw'); break;
      case 'e': case 'E': uvEditor.rotateSelected( ROT_STEP); flash('sc-rot-cw');  break;
      case 'r': case 'R': uvEditor.resetSelectedTransform();   flash('sc-reset');   break;
    }
  });

  // Wire on-screen buttons — same actions + flash
  const wire = (id, action) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.addEventListener('click', () => {
      action();
      btn.classList.add('sc-active');
      setTimeout(() => btn.classList.remove('sc-active'), 200);
    });
  };

  wire('sc-up',      () => uvEditor.nudgeSelected(0, -NUDGE));
  wire('sc-down',    () => uvEditor.nudgeSelected(0,  NUDGE));
  wire('sc-left',    () => uvEditor.nudgeSelected(-NUDGE, 0));
  wire('sc-right',   () => uvEditor.nudgeSelected( NUDGE, 0));
  wire('sc-rot-ccw', () => uvEditor.rotateSelected(-ROT_STEP));
  wire('sc-rot-cw',  () => uvEditor.rotateSelected( ROT_STEP));
  wire('sc-reset',   () => uvEditor.resetSelectedTransform());
}

function setupBackgroundUI() {
  // "Show environment background" — if OFF, HDR is still used for lighting but not as bg
  const envBgToggle = document.getElementById('env-bg-toggle');
  if (envBgToggle) {
    showEnvBackground = envBgToggle.checked;
    envBgToggle.addEventListener('change', e => {
      showEnvBackground = e.target.checked;
      applyBackground();
      pushSceneHistory(showEnvBackground ? 'Background: show env' : 'Background: hide env');
    });
  }

  // "Enable gradient background"
  const gradBgToggle = document.getElementById('gradient-bg-toggle');
  if (gradBgToggle) {
    gradientBgEnabled = gradBgToggle.checked;
    gradBgToggle.addEventListener('change', e => {
      gradientBgEnabled = e.target.checked;
      applyBackground();
      pushSceneHistory(gradientBgEnabled ? 'Background: gradient on' : 'Background: gradient off');
    });
  }

  // Gradient preset dropdown (reuses the existing background-select element)
  const bgSelect = document.getElementById('background-select');
  if (bgSelect) {
    bgSelect.addEventListener('change', e => {
      currentGradientBg = e.target.value;
      applyBackground();
      pushSceneHistory(`Background: ${e.target.value || 'none'}`);
    });
  }
}

//═══════════════════════════════════════════════════════════════
// PROPS UI
//═══════════════════════════════════════════════════════════════

function setupPropsUI() {
  const propsSelect   = document.getElementById('props-select');
  const addPropBtn    = document.getElementById('add-prop-btn');
  const deletePropBtn = document.getElementById('delete-prop-btn');
  const clearPropsBtn = document.getElementById('clear-props-btn');

  if (!propsSelect) return;

  // Populate dropdown grouped by category
  propsSelect.innerHTML = '<option value="" disabled selected>--- Select a Prop ---</option>';
  const categories = {};
  propManager.getAvailableProps().forEach(prop => {
    if (!categories[prop.category]) categories[prop.category] = [];
    categories[prop.category].push(prop);
  });
  Object.entries(categories).forEach(([cat, items]) => {
    const grp = document.createElement('optgroup');
    grp.label = cat;
    items.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      grp.appendChild(opt);
    });
    propsSelect.appendChild(grp);
  });

  addPropBtn?.addEventListener('click', async () => {
    const propId = propsSelect.value;
    if (!propId) return;
    const target = cameraManager.getControls().target;
    await propManager.addProp(propId, { x: target.x, y: target.y, z: target.z });
    propsSelect.value = '';
    pushSceneHistory(`Added prop: ${propId}`);
  });

  deletePropBtn?.addEventListener('click', () => {
    if (propManager.selectedProp) {
      const id = propManager.selectedProp.id;
      propManager.removeProp(id);
      pushSceneHistory(`Removed prop: ${id}`);
    }
  });

  clearPropsBtn?.addEventListener('click', () => {
    if (confirm('Clear all props?')) {
      propManager.clearAllProps();
      pushSceneHistory('Cleared all props');
    }
  });
}

function setupTransformToolbar() {
  const btnTranslate = document.getElementById('tf-translate');
  const btnRotate    = document.getElementById('tf-rotate');
  const btnScale     = document.getElementById('tf-scale');
  const btnSnap      = document.getElementById('tf-snap');
  const modeBtns     = [btnTranslate, btnRotate, btnScale];

  function activateMode(mode, btn) {
    modeBtns.forEach(b => b?.classList.remove('tf-btn--active'));
    btn?.classList.add('tf-btn--active');
    propManager.setTransformMode(mode);
  }

  btnTranslate?.addEventListener('click', () => activateMode('translate', btnTranslate));
  btnRotate?.addEventListener('click',    () => activateMode('rotate',    btnRotate));
  btnScale?.addEventListener('click',     () => activateMode('scale',     btnScale));

  let snapOn = false;
  btnSnap?.addEventListener('click', () => {
    snapOn = !snapOn;
    propManager.setSnapEnabled(snapOn);
    btnSnap.classList.toggle('tf-btn--active', snapOn);
  });

  // Keep toolbar in sync with keyboard shortcuts (PropManager handles the actual mode change)
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    switch (e.key.toLowerCase()) {
      case 'g': modeBtns.forEach(b => b?.classList.remove('tf-btn--active')); btnTranslate?.classList.add('tf-btn--active'); break;
      case 'r': modeBtns.forEach(b => b?.classList.remove('tf-btn--active')); btnRotate?.classList.add('tf-btn--active');    break;
      case 's':
        if (!e.ctrlKey && !e.metaKey) { modeBtns.forEach(b => b?.classList.remove('tf-btn--active')); btnScale?.classList.add('tf-btn--active'); }
        break;
    }
  });
}

//═══════════════════════════════════════════════════════════════
// CUSTOM SCENES UI
//═══════════════════════════════════════════════════════════════

// loadSceneSetup — restores a full saved scene (env, props, model+transform, camera)
// Camera is restored INSIDE the model onLoaded callback so it runs after centerAndFrameModel.
async function loadSceneSetup(sceneData) {
  // 1. Restore environment
  if (sceneData.environment?.hdr) {
    const sel = document.getElementById('environment-select');
    if (sel) sel.value = sceneData.environment.hdr;
    loadScene(sceneData.environment.hdr, (name, texture) => {
      currentEnvTexture = texture;
      currentEnvironment = name;
      sceneManager.setEnvironment(texture);
      applyBackground();
      log(`Scene: ${name}`);
    });
  }

  // 2. Restore props
  if (sceneData.props) {
    await propManager.loadSceneData(sceneData.props);
  }

  // 3. Camera restore — must run AFTER centerAndFrameModel inside onLoaded
  function restoreCameraFromScene() {
    if (!sceneData.camera) return;
    const cam      = cameraManager.getCamera();
    const orbit    = cameraManager.getControls();
    cam.position.set(sceneData.camera.position.x, sceneData.camera.position.y, sceneData.camera.position.z);
    orbit.target.set(sceneData.camera.target.x, sceneData.camera.target.y, sceneData.camera.target.z);
    orbit.update();
  }

  // 4. Restore model + transform + camera
  if (sceneData.model?.name) {
    const sel = document.getElementById('object-select') || document.getElementById('model-select');
    if (sel) sel.value = sceneData.model.name;
    await loadModel(sceneData.model.name, () => {
      if (activeModel) {
        const m = sceneData.model;
        activeModel.position.set(m.position.x, m.position.y, m.position.z);
        activeModel.rotation.set(m.rotation.x, m.rotation.y, m.rotation.z);
        activeModel.scale.set(m.scale.x, m.scale.y, m.scale.z);
      }
      restoreCameraFromScene();
    });
  } else {
    restoreCameraFromScene();
  }
}

async function resetScene() {
  propManager.clearAllProps();

  cleanupActiveModel();
  if (STANDARD_OBJECTS.length > 0) {
    const defaultLabel = STANDARD_OBJECTS[0].label;
    const sel = document.getElementById('object-select');
    if (sel) sel.value = defaultLabel;
    loadModel(defaultLabel);
  }

  const defaultEnv = STANDARD_ENVIRONMENTS[0];
  if (defaultEnv) {
    const envSel = document.getElementById('environment-select');
    if (envSel) envSel.value = defaultEnv.label;
    loadScene(defaultEnv.label, (name, texture) => {
      currentEnvTexture = texture;
      currentEnvironment = name;
      sceneManager.setEnvironment(texture);
      applyBackground();
    });
  }

  showEnvBackground = true;
  gradientBgEnabled = false;
  currentGradientBg = '';
  const envBgToggle  = document.getElementById('env-bg-toggle');
  const gradBgToggle = document.getElementById('gradient-bg-toggle');
  const bgSelect     = document.getElementById('background-select');
  if (envBgToggle)  envBgToggle.checked  = true;
  if (gradBgToggle) gradBgToggle.checked = false;
  if (bgSelect)     bgSelect.value = '';
  applyBackground();

  cameraManager.reset();
  log('Scene reset to defaults.');
}

async function setupSceneSetupUI() {
  const sceneSelect    = document.getElementById('scene-select');
  const saveSceneBtn   = document.getElementById('save-scene-btn');
  const exportSceneBtn = document.getElementById('export-scene-btn');
  const importSceneBtn = document.getElementById('import-scene-btn');
  const sceneFileInput = document.getElementById('scene-file-input');
  const clearScenesBtn = document.getElementById('clear-scenes-btn');
  const resetSceneBtn  = document.getElementById('reset-scene-btn');

  if (!sceneSelect) return;

  async function populateScenesDropdown() {
    sceneSelect.innerHTML = '<option value="" disabled selected>--- Select a Scene ---</option>';
    const names = await sceneStorage.getAllSceneNames();
    if (names.length > 0) {
      const grp = document.createElement('optgroup');
      grp.label = 'Custom Scenes';
      names.forEach(name => {
        const opt = document.createElement('option');
        opt.value = `custom:${name}`;
        opt.textContent = name;
        grp.appendChild(opt);
      });
      sceneSelect.appendChild(grp);
    }
  }

  await populateScenesDropdown();

  sceneSelect.addEventListener('change', async (e) => {
    const value = e.target.value;
    if (!value.startsWith('custom:')) return;
    const sceneData = await sceneStorage.getScene(value.replace('custom:', ''));
    if (sceneData) await loadSceneSetup(sceneData);
  });

  saveSceneBtn?.addEventListener('click', async () => {
    const name = prompt('Enter scene name:');
    if (!name?.trim()) return;
    const cam    = cameraManager.getCamera();
    const orbit  = cameraManager.getControls();
    await sceneStorage.saveScene(name.trim(), {
      environment: { hdr: currentEnvironment, background: currentGradientBg || null },
      props:  propManager.getSceneData(),
      camera: {
        position: { x: cam.position.x,  y: cam.position.y,  z: cam.position.z },
        target:   { x: orbit.target.x,  y: orbit.target.y,  z: orbit.target.z }
      },
      model: activeModel ? {
        name:     getCurrentModelName(),
        position: { x: activeModel.position.x, y: activeModel.position.y, z: activeModel.position.z },
        rotation: { x: activeModel.rotation.x, y: activeModel.rotation.y, z: activeModel.rotation.z },
        scale:    { x: activeModel.scale.x,    y: activeModel.scale.y,    z: activeModel.scale.z }
      } : null
    });
    await populateScenesDropdown();
    log(`Scene saved: ${name.trim()}`);
  });

  exportSceneBtn?.addEventListener('click', async () => {
    const value = sceneSelect?.value;
    if (!value?.startsWith('custom:')) { log('Select a scene to export'); return; }
    await sceneStorage.exportScene(value.replace('custom:', ''));
  });

  importSceneBtn?.addEventListener('click', () => sceneFileInput?.click());
  sceneFileInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const result = await sceneStorage.importScene(file);
      if (result.success) {
        await populateScenesDropdown();
        log(`Scene imported: ${result.name}`);
      }
    } catch (err) { logError(`Scene import failed: ${err.message}`); }
    sceneFileInput.value = '';
  });

  clearScenesBtn?.addEventListener('click', async () => {
    if (!confirm('Delete all custom scenes? This cannot be undone!')) return;
    await sceneStorage.clearAllScenes();
    await populateScenesDropdown();
    log('All custom scenes deleted');
  });

  resetSceneBtn?.addEventListener('click', async () => {
    if (!confirm('Reset scene to defaults? This will remove all props and reload the default model.')) return;
    await resetScene();
  });
}

//═══════════════════════════════════════════════════════════════
// ANIMATION LOOP
//═══════════════════════════════════════════════════════════════

// Demand rendering — only render when something changed.
// markNeedsRender(frames) schedules N frames of rendering (default 4).
// Camera movement/damping also triggers continuous rendering while active.
let _renderBurst = 4;
function markNeedsRender(frames = 4) {
  if (frames > _renderBurst) _renderBurst = frames;
}
window.markNeedsRender = markNeedsRender; // expose for UVEditor + other modules

// Any slider or dropdown change triggers a render burst (covers all material/bg/env changes)
document.addEventListener('input',  () => markNeedsRender(4), { passive: true, capture: true });
document.addEventListener('change', () => markNeedsRender(4), { passive: true, capture: true });

function animate() {
  requestAnimationFrame(animate);
  const cameraMoved = cameraManager.update(); // true while camera is moving/damping
  if (cameraMoved && _renderBurst < 4) _renderBurst = 4;

  if (_renderBurst > 0) {
    if (propManager.hasOutlines()) propManager.updateOutlines();
    rendererManager.render(sceneManager.getScene(), cameraManager.getCamera());
    _renderBurst--;
  }
}
animate();

//═══════════════════════════════════════════════════════════════
// INITIAL SETUP
//═══════════════════════════════════════════════════════════════

async function initializeApp() {
  // Fast path: preload last edited model immediately (sync localStorage read).
  try {
    const raw = localStorage.getItem(SESSION_BOOT_KEY);
    if (raw) {
      const boot = JSON.parse(raw);
      const bootName = boot?.modelName;
      if (bootName) {
        const modelSel = document.getElementById('object-select') || document.getElementById('model-select');
        if (modelSel) modelSel.value = bootName;
        loadModel(bootName);
      }
    }
  } catch (_) {
    // ignore malformed/blocked localStorage
  }

  await updateModelList();
  updateSceneList();
  updateMaterialPresetList();
  setupCameraUI();
  setupPostFXUI();
  setupPreviewQualityUI();
  setupBackgroundUI();
  setupDesignShortcuts();
  setupPropsUI();
  setupTransformToolbar();
  await setupSceneSetupUI();
  setupHistoryUI();

  // Apply initial renderer tone mapping
  rendererManager.getRenderer().toneMapping = THREE.ACESFilmicToneMapping;
  rendererManager.getRenderer().toneMappingExposure = 1.0;

  const restored = await restoreSessionState();
  if (!restored && STANDARD_OBJECTS.length > 0) {
    setTimeout(() => loadModel(STANDARD_OBJECTS[0].label), 100);
  }

  // Record initial history states after everything is loaded
  setTimeout(() => {
    designState.init('Initial state');
    materialState.init('Initial state');
    sceneState.init('Initial state');
  }, 500);
}

window.addEventListener('beforeunload', saveSessionState);
window.addEventListener('pagehide', saveSessionState);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveSessionState();
});

initializeApp();
//
