// MAIN.JS - Application Orchestrator

import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { LineSegments2 }        from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial }         from 'three/addons/lines/LineMaterial.js';

// Core
import { SceneManager } from './core/Scene.js';
import { RendererManager } from './core/Renderer.js';
import { CameraManager } from './core/Camera.js';

import { MaterialManager } from './materials/MaterialManager.js';
import { ModelManager } from './models/ModelManager.js';

import { UVEditor } from './ui/UVEditor.js';
import { ControlsManager, initDebugPanelWidth, initObjectPropsTabs } from './ui/Controls.js';
import { SceneStateManager }    from './stateEditor/SceneState.js';
import { DesignStateManager }   from './stateEditor/DesignState.js';
import { MaterialStateManager } from './stateEditor/MaterialState.js';
import * as IDBStorage from './storage/indexedDBStorage.js';

// Utils
import { log, logError, logSuccess, logWarn } from './utils/logger.js';

import { cleanupObject } from './utils/helpers.js';

// Sketchfab integration
import { SketchfabAPI }    from './sketchfab/SketchfabAPI.js';
import { SketchfabModal }  from './sketchfab/SketchfabModal.js';
import { extractModelFromZip } from './sketchfab/SketchfabLoader.js';

// Config
import { STANDARD_OBJECTS, STANDARD_MATERIALS, STANDARD_ENVIRONMENTS } from './config.js';

// Props
import { PropManager } from './props/PropManager.js';
// Project + scene storage routes through StorageService for cloud users and
// delegates to the IDB-backed guest classes otherwise. Sync/async active-ID
// readers stay on ProjectStorage — that's a per-device preference.
import { getActiveProjectId, getActiveProjectIdSync } from './storage/ProjectStorage.js';
import {
  ensureActiveProject,
  updateProject,
  clearSignedUrls,
  listSceneNames,
  getScene as loadSceneRecord,
  saveScene as persistScene,
  deleteScene as removeScene,
  listPropAssets,
  uploadPropAsset,
  deletePropAsset,
  getAssetSignedUrl,
} from './storage/StorageService.js';
import { init as initAuth, getUser, onAuthChange, signOut } from './auth/AuthService.js';

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
// Wire channel map serialization so uvEditor can include them in custom model saves
uvEditor.getChannelMaps = () => serializeChannelMaps();

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
const _channelMapData = new Map(); // channel key → base64 data URL (persists original file data)
let meshMap = {}; // name → mesh reference for multi‑part models

// Per-part state cache — populated when switching parts so each part's
// channel maps and decal overlays survive while another part is active.
// Shape: { [partName]: { channelMaps: { ch: dataUrl }, overlayImages: [...] } }
let _partCache = {};

// ── Performance mode ──────────────────────────────────────────
const HIGH_POLY_THRESHOLD = 100_000; // faces
let performanceModeEnabled = false;  // auto-set on high-poly load; user can override
let _activeModelFaceCount  = 0;
let _isOrbiting = false; // true while OrbitControls drag is active

// Texture quality: track current anisotropy so every loaded texture gets the right setting
let currentAnisotropy = 16;

/** Apply current quality settings to a freshly-loaded Three.js texture. */
function applyTexQuality(tex) {
  if (!tex || !tex.isTexture) return;
  const renderer = rendererManager?.getRenderer?.();
  const maxAniso = renderer ? renderer.capabilities.getMaxAnisotropy() : 16;
  tex.anisotropy = Math.min(currentAnisotropy, maxAniso);
  if (tex.generateMipmaps !== false) {
    tex.minFilter = THREE.LinearMipmapLinearFilter;
  }
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
}

/** Traverse an Object3D and apply quality settings to every texture on every mesh. */
function applyTexQualityToObject(root) {
  const TEX_SLOTS = [
    'map','normalMap','roughnessMap','metalnessMap','aoMap',
    'emissiveMap','displacementMap','alphaMap','bumpMap',
    'clearcoatMap','clearcoatNormalMap','clearcoatRoughnessMap',
    'specularColorMap','specularIntensityMap','transmissionMap','thicknessMap',
    'sheenColorMap','sheenRoughnessMap',
    'anisotropyMap','iridescenceMap','iridescenceThicknessMap',
  ];
  root.traverse(child => {
    if (!child.isMesh) return;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    mats.forEach(mat => { if (mat) TEX_SLOTS.forEach(s => applyTexQuality(mat[s])); });
  });
}

/**
 * Convert a single material to MeshPhysicalMaterial, preserving all compatible
 * textures and properties. Does NOT dispose the source — caller handles that.
 */
function convertToPhysical(sourceMat) {
  if (sourceMat.isMeshPhysicalMaterial) return sourceMat;

  const props = {
    name:              sourceMat.name       || '',
    side:              sourceMat.side       ?? THREE.FrontSide,
    opacity:           sourceMat.opacity    ?? 1.0,
    transparent:       sourceMat.transparent ?? false,
    color:             sourceMat.color      ? sourceMat.color.clone() : new THREE.Color(0xffffff),
    map:               sourceMat.map        || null,
    emissive:          sourceMat.emissive   ? sourceMat.emissive.clone() : new THREE.Color(0x000000),
    emissiveIntensity: sourceMat.emissiveIntensity ?? 1.0,
    emissiveMap:       sourceMat.emissiveMap  || null,
    alphaMap:          sourceMat.alphaMap    || null,
    bumpMap:           sourceMat.bumpMap     || null,
    bumpScale:         sourceMat.bumpScale   ?? 1,
    displacementMap:   sourceMat.displacementMap   || null,
    displacementScale: sourceMat.displacementScale ?? 1,
    displacementBias:  sourceMat.displacementBias  ?? 0,
  };

  if (sourceMat.isMeshStandardMaterial) {
    // Standard → Physical: direct property mapping (Physical extends Standard)
    Object.assign(props, {
      metalness:       sourceMat.metalness       ?? 0,
      roughness:       sourceMat.roughness       ?? 1,
      metalnessMap:    sourceMat.metalnessMap    || null,
      roughnessMap:    sourceMat.roughnessMap    || null,
      normalMap:       sourceMat.normalMap       || null,
      normalScale:     sourceMat.normalScale ? sourceMat.normalScale.clone() : new THREE.Vector2(1, 1),
      aoMap:           sourceMat.aoMap           || null,
      aoMapIntensity:  sourceMat.aoMapIntensity  ?? 1,
      envMapIntensity: sourceMat.envMapIntensity ?? 1,
    });
  } else if (sourceMat.isMeshPhongMaterial || sourceMat.isMeshLambertMaterial) {
    // Phong/Lambert → Physical: approximate PBR values
    const shininess = sourceMat.shininess ?? 30;
    Object.assign(props, {
      metalness:       0,
      roughness:       Math.max(0.2, 1 - Math.sqrt(shininess / 1000)),
      normalMap:       sourceMat.normalMap || null,
      normalScale:     sourceMat.normalScale ? sourceMat.normalScale.clone() : new THREE.Vector2(1, 1),
      envMapIntensity: 1.0,
    });
    if (sourceMat.specular)    props.specularColor    = sourceMat.specular.clone();
    if (sourceMat.specularMap) props.specularColorMap = sourceMat.specularMap;
  }

  return new THREE.MeshPhysicalMaterial(props);
}

/**
 * Traverse all meshes in an object and upgrade non-Physical materials to
 * MeshPhysicalMaterial. Shared materials are converted once; originals disposed.
 */
function convertObjectToPhysical(object) {
  const env = sceneManager.getScene().environment;
  const seen = new Map(); // originalMat → physicalMat

  object.traverse(child => {
    if (!child.isMesh) return;
    const isArray = Array.isArray(child.material);
    const mats = isArray ? child.material : [child.material];
    const newMats = mats.map(m => {
      if (!m) return m;
      if (m.isMeshPhysicalMaterial) { materialManager.applyEnvironment(m, env); return m; }
      if (seen.has(m)) return seen.get(m);
      const p = convertToPhysical(m);
      materialManager.applyEnvironment(p, env);
      seen.set(m, p);
      return p;
    });
    child.material = isArray ? newMats : newMats[0];
    (isArray ? newMats : [newMats[0]]).forEach(m => { if (m) m.needsUpdate = true; });
  });

  // Dispose originals that were actually replaced
  seen.forEach((physMat, origMat) => { if (origMat !== physMat) origMat.dispose(); });
}

// Background / environment state
let currentEnvTexture = null;   // currently loaded HDR texture
let currentEnvironment = null;  // name of currently loaded HDR (e.g. 'Studio Kominka')
let showEnvBackground = true;   // scene.background = HDR when true
let gradientBgEnabled = false;  // show CSS gradient when true
let currentGradientBg = '';     // key from GRADIENT_PRESETS

const sketchfabAPI   = new SketchfabAPI();

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
  getModelName: () => getCurrentModelName(),
  loadModel:    (name) => loadModel(name),
});

const designState = new DesignStateManager({ uvEditor });

const materialState = new MaterialStateManager({
  materialManager,
  getControls:     () => controls,
  getActiveMesh:   () => activeMesh,
  markNeedsRender: (n) => markNeedsRender(n),
  getUVEditor:     () => uvEditor,
  getPresetName:   () => getCurrentMaterialPreset(),
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

function syncBgCards(value) {
  document.querySelectorAll('#bg-preset-grid .bg-preset-card').forEach(card => {
    card.classList.toggle('selected', card.dataset.value === value);
  });
}

function syncEnvCards(value) {
  document.querySelectorAll('#env-preset-grid .bg-preset-card').forEach(card => {
    card.classList.toggle('selected', card.dataset.value === value);
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

const SESSION_STORAGE_BASE = 'session:renderdeck.reloadstate.v2';
const SESSION_BOOT_BASE    = 'session:renderdeck.boot.v1';

// Project-scoped session keys — each project has its own autosave state.
function sessionStorageKey(projectId) {
  return projectId ? `${SESSION_STORAGE_BASE}:${projectId}` : SESSION_STORAGE_BASE;
}
function sessionBootKey(projectId) {
  return projectId ? `${SESSION_BOOT_BASE}:${projectId}` : SESSION_BOOT_BASE;
}

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
  if (bgSelect && sceneState.currentGradientBg) { bgSelect.value = sceneState.currentGradientBg; syncBgCards(sceneState.currentGradientBg); }
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
  syncEnvCards(name);
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
const materialPresetsReady = initMaterialPresets();

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

  // Clear history stacks — they are per-object
  materialState.history.clear();
  materialState.updateUI();
  designState.history.clear();
  designState.updateUI();

  const modelData = await modelManager.getModel(name);
  if (!modelData) { logError(`Model not found: ${name}`); return; }

  // Keep the object selector in sync with whatever is actually loading
  const _sel = document.getElementById('object-select') || document.getElementById('model-select');
  if (_sel && _sel.value !== name) _sel.value = name;

  cleanupActiveModel();

  // Show a warning for user-uploaded files (not persisted on refresh)
  const _uploadWarn = document.getElementById('uploaded-model-warning');
  if (_uploadWarn) {
    const isUploaded = modelData.type === 'uploaded' || modelData.type === 'uploaded-glb';
    _uploadWarn.style.display = isUploaded ? 'flex' : 'none';
  }

  if (modelData.type === 'custom') {
    await loadCustomModel(name, modelData, onLoaded);
  } else {
    await loadRegularModel(name, modelData, onLoaded);
  }

  // Re-init history with the new model's state
  setTimeout(() => {
    materialState.init('Initial state');
    designState.init('Initial state');
  }, 100);
}

// Decode a saved decals array (with imageData strings) into live overlay objects
// with decoded HTMLImageElement instances. Returns a Promise<overlay[]>.
function _decodeDecals(decals) {
  if (!decals?.length) return Promise.resolve([]);
  return Promise.all(decals.map((saved, i) => new Promise(res => {
    const img = new Image();
    img.onload = () => res({
      id:          i + 1,
      image:       img,
      name:        saved.name,
      type:        saved.type        || 'image',
      textData:    saved.textData    ? { ...saved.textData } : null,
      position:    { ...saved.position },
      size:        { ...saved.size },
      rotation:    saved.rotation,
      aspectRatio: saved.aspectRatio,
      flipH:       saved.flipH       ?? false,
      flipV:       saved.flipV       ?? false,
    });
    img.onerror = () => res(null);
    img.src = saved.imageData;
  }))).then(r => r.filter(Boolean));
}

async function loadCustomModel(name, modelData, onLoaded = null) {
  log(`Loading custom model: ${name}…`);
  const loadingPaths = await modelManager.getLoadingPaths(modelData.basedOn);
  if (!loadingPaths) { logError(`Base model not found: ${modelData.basedOn}`); return; }

  await materialPresetsReady;

  // ── Determine schema version ──────────────────────────────────────────────
  const isV3 = !!(modelData.parts && modelData.version >= 3);

  // For v2 compat: pre-decode the single overlay set in parallel with geometry load
  const v2OverlayPreload = (!isV3 && modelData.overlayImages?.length > 0)
    ? _decodeDecals(modelData.overlayImages) : Promise.resolve([]);

  // For v3: pre-decode decals for every part in parallel with geometry load
  const v3DecalPreload = isV3
    ? Object.fromEntries(await Promise.all(
        Object.entries(modelData.parts).map(async ([pName, pData]) => [
          pName, await _decodeDecals(pData.decals)
        ])
      ))
    : {};

  // ── Load base geometry ────────────────────────────────────────────────────
  const isGLB = loadingPaths.type === 'glb-path' || loadingPaths.type === 'glb-blob';
  const object = await new Promise((resolve) => {
    const onProgress = (xhr) => { if (xhr.lengthComputable && xhr.total > 0) log(`Loading… ${((xhr.loaded/xhr.total)*100).toFixed(0)}%`); };
    if (isGLB) {
      gltfLoader.load(loadingPaths.obj, gltf => resolve(gltf.scene), onProgress,
        err => { logError(`GLB load failed: ${err}`); resolve(null); });
    } else {
      objLoader.load(loadingPaths.obj, obj => resolve(obj), onProgress,
        err => { logError(`OBJ load failed: ${err}`); resolve(null); });
    }
  });
  if (!object) return;

  // ── Assign materials per mesh ─────────────────────────────────────────────
  const meshList = [];
  _partCache = {}; // clear stale part cache from previous model

  object.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;
    child.userData.isCustomModel = true;

    let baseName = child.name || 'Part';
    let uniqueName = baseName;
    let idx = 1;
    while (meshMap[uniqueName]) uniqueName = `${baseName}_${idx++}`;
    child.name = uniqueName;

    meshList.push(child);
    meshMap[child.name] = child;
    if (!activeMesh) activeMesh = child;

    if (isV3) {
      // v3: each part has its own materialData
      const partData = modelData.parts[child.name];
      let presetName = partData?.materialPreset || 'Default — White';
      if (partData?.materialPresetId) {
        const byId = materialManager.getPresetNameById(partData.materialPresetId);
        if (byId) presetName = byId;
      }
      const matProps = partData?.materialData || {};
      const isCustomMat = partData?.isCustomMaterial
        ?? (!materialManager.isStandardPreset(presetName) && presetName !== 'Default — White');

      if (isCustomMat && matProps && !materialManager.getPresetNames().includes(presetName)) {
        materialManager.addUserPreset(presetName, matProps);
        scheduleThumbnailUpdate(presetName, null);
      }

      // Always create a per-mesh material instance — getPreset may return a shared object.
      const material = (() => {
        const m = materialManager.createFreshPreset(presetName);
        m.name = presetName;
        return m;
      })();
      materialManager.applyEnvironment(material, sceneManager.getScene().environment);
      if (matProps) materialManager.applySavedProperties(material, matProps);
      child.material = material;
    } else {
      // v2 compat: flat single-preset for all parts
      let savedPreset = modelData.materialPreset || 'Default — White';
      if (modelData.materialPresetId) {
        const byId = materialManager.getPresetNameById(modelData.materialPresetId);
        if (byId) savedPreset = byId;
      }
      const isCustomMat = modelData.isCustomMaterial === true
        || (modelData.isCustomMaterial === undefined
            && !materialManager.isStandardPreset(savedPreset)
            && savedPreset !== 'Default — White');

      if (isCustomMat && modelData.materialProperties
          && !materialManager.getPresetNames().includes(savedPreset)) {
        materialManager.addUserPreset(savedPreset, modelData.materialProperties);
        scheduleThumbnailUpdate(savedPreset, null);
      }

      // Always create a per-mesh material instance — getPreset may return a shared object.
      const material = (() => {
        const m = materialManager.createFreshPreset(savedPreset);
        m.name = savedPreset;
        return m;
      })();
      materialManager.applyEnvironment(material, sceneManager.getScene().environment);
      if (modelData.materialProperties) materialManager.applySavedProperties(material, modelData.materialProperties);
      child.material = material;
    }
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

  // ── Restore first part's channel maps + open UV editor ───────────────────
  _channelMapData.clear();

  if (isV3) {
    // Pre-populate _partCache for all parts so selectPart can restore them immediately
    for (const [partName, partData] of Object.entries(modelData.parts)) {
      const channelMaps = partData.materialData?.channelMaps || null;
      _partCache[partName] = {
        channelMaps,
        overlayImages: v3DecalPreload[partName] || [],
        materialPreset:   partData.materialPreset   || 'Default — White',
        materialPresetId: partData.materialPresetId || null,
        isCustomMaterial: partData.isCustomMaterial || false,
      };
    }

    // Apply channel maps for every part immediately so they're visible without clicking
    for (const [partName, partCache] of Object.entries(_partCache)) {
      const mesh = meshMap[partName];
      if (mesh?.material && partCache?.channelMaps) {
        await restoreChannelMaps(mesh.material, partCache.channelMaps);
      }
    }

    if (activeMesh) {
      const firstPartCache = _partCache[activeMesh.name];
      const firstPreset = firstPartCache?.materialPreset || 'Default — White';
      controls.syncMaterialUI(activeMesh.material, getChannelThumbnailOverrides());
      updateMaterialPresetList();
      controls.setMaterialPresetValue(firstPreset);
      uvEditor.activeModelName  = modelData.basedOn;
      uvEditor.customModelName  = name;
      uvEditor.currentMaterialPreset = firstPreset;
      // Open UV editor with pre-decoded overlays for first part
      const firstOverlays = firstPartCache?.overlayImages || [];
      uvEditor.openWithPreloadedData(activeMesh, name, {
        basedOn:           modelData.basedOn,
        materialPreset:    firstPreset,
        materialProperties: firstPartCache?.materialData || {},
      }, firstOverlays, firstPreset);
      controls.syncMaterialUI(activeMesh.material, getChannelThumbnailOverrides());
    }
  } else {
    // v2 compat path
    const savedPreset = modelData.materialPreset || 'Default — White';
    if (modelData.channelMaps && activeMesh?.material) {
      await restoreChannelMaps(activeMesh.material, modelData.channelMaps);
    }
    controls.syncMaterialUI(activeMesh?.material, getChannelThumbnailOverrides());
    updateMaterialPresetList();
    controls.setMaterialPresetValue(savedPreset);
    if (activeMesh) {
      const preloadedImages = await v2OverlayPreload;
      uvEditor.openWithPreloadedData(activeMesh, name, modelData, preloadedImages, savedPreset);
    }
    if (modelData.channelMaps && activeMesh?.material) {
      controls.syncMaterialUI(activeMesh.material, getChannelThumbnailOverrides());
    }
  }

  if (modelData.sceneState) restoreSceneState(modelData.sceneState);

  const _customBootLoad = !!_bootCamera;
  if (_bootCamera) {
    cameraManager.setPosition(_bootCamera.position.x, _bootCamera.position.y, _bootCamera.position.z);
    if (_bootCamera.target) cameraManager.setTarget(_bootCamera.target.x, _bootCamera.target.y, _bootCamera.target.z);
    _bootCamera = null;
  }
  if (!_customBootLoad) cameraManager.reframeObject(object);
  checkAndApplyPolyPerf(object);
  markNeedsRender(60);
  if (onLoaded) onLoaded(object);
}

async function loadRegularModel(name, _modelData, onLoaded = null) {
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
        // Clone material so each mesh gets an independent instance.
        // GLB loader reuses the same material object for all meshes sharing a material index.
        if (child.material) {
          child.material = child.material.clone();
          child.material.needsUpdate = true;
        }
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
      convertObjectToPhysical(object);
      applyTexQualityToObject(object);
      if (activeMesh?.material) controls.syncMaterialUI(activeMesh.material, getChannelThumbnailOverrides());
      const _glbBootLoad = !!_bootCamera;
      if (_bootCamera) {
        cameraManager.setPosition(_bootCamera.position.x, _bootCamera.position.y, _bootCamera.position.z);
        if (_bootCamera.target) cameraManager.setTarget(_bootCamera.target.x, _bootCamera.target.y, _bootCamera.target.z);
        _bootCamera = null;
      }
      if (!_glbBootLoad) cameraManager.reframeObject(object);
      rendererManager.getRenderer()?.compile(sceneManager.getScene(), cameraManager.getCamera());
      log(`${name} loaded.`);
      checkAndApplyPolyPerf(object);
      if (activeMesh) uvEditor.open(activeMesh, name, materialManager.getPresetNames().includes(activeMesh.material?.name) ? activeMesh.material.name : 'Default — White');
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
    const hasMtl = !!materials; // track whether MTL materials were provided

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

      if (hasMtl) {
        // MTL materials loaded — convert Phong → Physical, preserve all textures
        convertObjectToPhysical(object);
        applyTexQualityToObject(object);
        if (activeMesh?.material) controls.syncMaterialUI(activeMesh.material, getChannelThumbnailOverrides());
      } else {
        // No MTL — apply the default blank material
        applyTexQualityToObject(object);
        applyMaterialPreset('Default — White');
      }

      const _objBootLoad = !!_bootCamera;
      if (_bootCamera) {
        cameraManager.setPosition(_bootCamera.position.x, _bootCamera.position.y, _bootCamera.position.z);
        if (_bootCamera.target) cameraManager.setTarget(_bootCamera.target.x, _bootCamera.target.y, _bootCamera.target.z);
        _bootCamera = null;
      }
      if (!_objBootLoad) cameraManager.reframeObject(object);
      // Pre-compile the real mesh shader variants so the first rendered frame
      // doesn't stall on onFirstUse (absorbs the cost into the loading wait).
      rendererManager.getRenderer()?.compile(sceneManager.getScene(), cameraManager.getCamera());
      log(`${name} loaded.`);
      checkAndApplyPolyPerf(object);
      // Initialize UV editor for this model
      if (activeMesh) {
        uvEditor.open(activeMesh, name, materialManager.getPresetNames().includes(activeMesh.material?.name) ? activeMesh.material.name : 'Default — White');
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

// ── Count total triangles across a loaded Three.js object ────
function countModelFaces(model) {
  let faces = 0;
  model.traverse(child => {
    if (!child.isMesh) return;
    const geo = child.geometry;
    if (geo.index) faces += geo.index.count / 3;
    else if (geo.attributes.position) faces += geo.attributes.position.count / 3;
  });
  return Math.round(faces);
}

// ── Show/hide perf mode indicators (viewport label + tab warning) ──
function updatePerfModeUI() {
  // Viewport label follows the toggle (manual or auto)
  const label = document.getElementById('perf-mode-label');
  if (label) label.style.display = performanceModeEnabled ? '' : 'none';
  // Tab warning only shows when an actual high-poly model is loaded
  const tabWarning = document.getElementById('perf-warning-tab');
  if (tabWarning) tabWarning.style.display = _activeModelFaceCount > HIGH_POLY_THRESHOLD ? '' : 'none';
}

// ── Show/hide the high-poly warning banner ────────────────────
function updatePolyWarning(faceCount) {
  const banner = document.getElementById('high-poly-warning');
  if (!banner) return;
  if (faceCount > HIGH_POLY_THRESHOLD) {
    banner.style.display = '';
    banner.querySelector('#poly-count-display').textContent =
      `${faceCount.toLocaleString()} faces`;
  } else {
    banner.style.display = 'none';
  }
}

// ── Run after any model finishes loading ─────────────────────
function checkAndApplyPolyPerf(model) {
  _activeModelFaceCount = countModelFaces(model);
  const toggle = document.getElementById('perf-mode-toggle');
  if (_activeModelFaceCount > HIGH_POLY_THRESHOLD) {
    performanceModeEnabled = true;
    if (toggle) toggle.checked = true;
  } else {
    performanceModeEnabled = false;
    if (toggle) toggle.checked = false;
    rendererManager.exitOrbitPerfMode();
  }
  updatePolyWarning(_activeModelFaceCount);
  updatePerfModeUI();
}

/**
 * Capture the current WebGL viewport as a compressed JPEG thumbnail and
 * persist it to the project record in IndexedDB.
 */
async function _saveThumbnailToProject(projectId) {
  try {
    const canvas = rendererManager.getRenderer()?.domElement;
    if (!canvas || !projectId) return;

    const THUMB_W = 400;
    const THUMB_H = 225;
    const tmp = document.createElement('canvas');
    tmp.width  = THUMB_W;
    tmp.height = THUMB_H;
    tmp.getContext('2d').drawImage(canvas, 0, 0, THUMB_W, THUMB_H);
    const dataUrl = tmp.toDataURL('image/jpeg', 0.5);

    await updateProject(projectId, { thumbnail: dataUrl });
  } catch (err) {
    console.warn('Thumbnail capture failed:', err);
  }
}

function cleanupActiveModel() {
  if (activeModel) {
    // Clear UV editor state before disposing mesh so sticker PBR maps don't leak
    uvEditor._removeStickerPBRMaps();
    if (uvEditor.liveCanvasTexture) {
      uvEditor.liveCanvasTexture.dispose();
      uvEditor.liveCanvasTexture = null;
    }
    uvEditor.overlayImages = [];
    uvEditor.selectedImageId = null;
    uvEditor.baseTexture = null;
    uvEditor._origColor = null;
    uvEditor._origTransmission = null;
    uvEditor._materialBaseColor = null;
    // Channel maps and part cache belong to the model being unloaded.
    _channelMapData.clear();
    _partCache = {};

    // Reset performance mode state
    _activeModelFaceCount = 0;
    updatePolyWarning(0);

    // Hide upload warning when model is cleared
    const _uw = document.getElementById('uploaded-model-warning');
    if (_uw) _uw.style.display = 'none';

    propManager.setMainModel(null);
    sceneManager.remove(activeModel);
    // Detach cached materials before cleanup so they aren't disposed
    activeModel.traverse(child => {
      if (child.isMesh && child.material) {
        materialManager.dispose(child.material);
        child.material = null;
      }
    });
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

// ── Material shader warmup + thumbnail generation ──────────────────────────
//
// Two separate concerns, two separate renderers:
//
//  1. WARMUP  — main renderer, tiny 1×1 offscreen target, no pixel readback.
//               Renders each cached material instance once so Three.js fires
//               onFirstUse (caches getUniforms) before the user ever switches.
//
//  2. THUMBNAILS — dedicated small renderer with antialias:true.
//               Renders each preset onto a sphere and calls toDataURL() on its
//               own canvas — the only reliable way to get smooth AA pixels.

const _matThumbCache = new Map(); // presetName → dataUrl

// IDB thumbnail cache — persists rendered thumbnails across page loads.
// Bump THUMB_CACHE_VERSION when standard preset visuals change to force a re-render.
const THUMB_CACHE_VERSION = 1;
const THUMB_IDB_PREFIX    = `thumb:v${THUMB_CACHE_VERSION}:`;

async function loadCachedThumbnails() {
  try {
    const keys = await IDBStorage.getAllKeys('blobs');
    await Promise.all(
      keys
        .filter(k => k.startsWith(THUMB_IDB_PREFIX))
        .map(async (key) => {
          const dataUrl = await IDBStorage.get('blobs', key);
          if (dataUrl) _matThumbCache.set(key.slice(THUMB_IDB_PREFIX.length), dataUrl);
        })
    );
  } catch (err) {
    console.warn('Thumbnail cache load failed:', err);
  }
}

// ── Warmup (main renderer) ──────────────────────────────────────────────────
let _warmupScene      = null;
let _warmupCamera     = null;
let _warmupSphereMesh = null;

function _ensureWarmupScene() {
  if (_warmupScene) return;
  _warmupCamera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  _warmupCamera.position.set(0, 0.3, 3.5);
  _warmupCamera.lookAt(0, 0, 0);

  _warmupScene = new THREE.Scene();
  const domeMat = new THREE.MeshBasicMaterial({ color: 0x252525, side: THREE.BackSide });
  _warmupScene.add(new THREE.Mesh(new THREE.SphereGeometry(8, 32, 16), domeMat));
  _warmupSphereMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 48));
  _warmupScene.add(_warmupSphereMesh);
  const key  = new THREE.DirectionalLight(0xffffff, 4);   key.position.set(3, 4, 3);
  const fill = new THREE.DirectionalLight(0x7799cc, 1.5); fill.position.set(-3, 0, -2);
  const rim  = new THREE.DirectionalLight(0xffffff, 2.5); rim.position.set(-2, 3, -3);
  _warmupScene.add(key, fill, rim, new THREE.AmbientLight(0x404040, 2));
}

// ── Thumbnail renderer (separate context, antialias canvas) ────────────────
let _thumbRenderer   = null;
let _thumbScene      = null;
let _thumbCamera     = null;
let _thumbSphereMesh = null;

function _ensureThumbRenderer() {
  if (_thumbRenderer) return;
  _thumbRenderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  _thumbRenderer.setSize(64, 64, false);
  _thumbRenderer.outputColorSpace = THREE.SRGBColorSpace;
  _thumbRenderer.toneMapping      = THREE.ACESFilmicToneMapping;
  _thumbRenderer.toneMappingExposure = 1.4;

  _thumbCamera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  _thumbCamera.position.set(0, 0.3, 3.5);
  _thumbCamera.lookAt(0, 0, 0);

  _thumbScene = new THREE.Scene();
  const domeMat = new THREE.MeshBasicMaterial({ color: 0x606060, side: THREE.BackSide });
  _thumbScene.add(new THREE.Mesh(new THREE.SphereGeometry(8, 32, 16), domeMat));
  _thumbSphereMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 48));
  _thumbScene.add(_thumbSphereMesh);
  const key  = new THREE.DirectionalLight(0xffffff, 4);   key.position.set(3, 4, 3);
  const fill = new THREE.DirectionalLight(0x7799cc, 1.5); fill.position.set(-3, 0, -2);
  const rim  = new THREE.DirectionalLight(0xffffff, 2.5); rim.position.set(-2, 3, -3);
  _thumbScene.add(key, fill, rim, new THREE.AmbientLight(0x404040, 2));
}

/**
 * For each preset:
 *  - compile its shader asynchronously via compileAsync (uses KHR_parallel_shader_compile
 *    on Chrome/Edge so gl.linkProgram runs on the GPU thread, not the main thread).
 *  - render a thumbnail with the dedicated antialias renderer if not already cached.
 *
 * compileAsync suspends the async function while the GPU compiles, so the main
 * thread stays responsive — no more 350ms+ frame stalls per preset.
 */
async function warmupAndGenerateThumbnails() {
  const renderer = rendererManager.getRenderer();
  if (!renderer) return;

  _ensureWarmupScene();
  _ensureThumbRenderer();

  const env = sceneManager.getScene().environment;
  _warmupScene.environment          = env ?? null;
  _warmupScene.environmentIntensity = env ? 0.6 : 0;
  _thumbScene.environment           = env ?? null;
  _thumbScene.environmentIntensity  = env ? 0.4 : 0;

  for (const name of materialManager.getPresetNames()) {
    // Assign fresh material and compile its shader asynchronously.
    // compileAsync uses KHR_parallel_shader_compile if available: the GPU links
    // the program in parallel while JS is suspended, then the Promise resolves.
    // On browsers without the extension it falls back to synchronous compile.
    const mat = materialManager.createFreshPreset(name);
    if (env) materialManager.applyEnvironment(mat, env);
    _warmupSphereMesh.material = mat;
    await renderer.compileAsync(_warmupScene, _warmupCamera);
    mat.dispose();

    // Thumbnail — skip if already loaded from IDB cache
    if (!_matThumbCache.has(name)) {
      const thumbMat = materialManager.createFreshPreset(name);
      _thumbSphereMesh.material = thumbMat;
      _thumbRenderer.render(_thumbScene, _thumbCamera);
      const dataUrl = _thumbRenderer.domElement.toDataURL();
      _matThumbCache.set(name, dataUrl);
      IDBStorage.put('blobs', THUMB_IDB_PREFIX + name, dataUrl).catch(() => {});
      thumbMat.dispose();
    }

    // Yield to keep the render loop responsive between presets
    await new Promise(resolve => requestAnimationFrame(resolve));
  }

  // Warmup resets cached preset instances — re-apply sticker state
  uvEditor.reapplyDecalState();

  // All thumbnails are now cached — refresh the material list so they appear.
  updateMaterialPresetList();
}

async function applyMaterialPreset(presetName) {
  if (!activeModel) return;
  const env = sceneManager.getScene().environment;

  // Step 1: Swap material (also removes sticker PBR maps and resets _orig* state)
  const applyToMesh = (mesh) => {
    uvEditor._removeStickerPBRMaps();
    const material = materialManager.getPreset(presetName);
    materialManager.applyEnvironment(material, env);
    if (mesh.material) materialManager.dispose(mesh.material);
    mesh.material = material;
    mesh.material.needsUpdate = true;
  };

  if (activeMesh) {
    applyToMesh(activeMesh);
  } else {
    activeModel.traverse((child) => {
      if (!child.isMesh) return;
      applyToMesh(child);
      if (!activeMesh) activeMesh = child;
    });
  }

  // Step 2: Restore channel maps BEFORE telling the UV editor about the new material.
  // onMaterialPresetApplied calls _applyStickerPBRMaps which captures _origRoughnessMap
  // from material.roughnessMap — that must already be the restored channel map texture.
  _channelMapData.clear();
  if (activeMesh?.material) {
    const savedChannelMaps = materialManager.getPresetChannelMaps(presetName);
    if (savedChannelMaps) await restoreChannelMaps(activeMesh.material, savedChannelMaps);
  }

  // Step 3: Set baseTexture from the restored channel map so the composite
  // renders correctly (channel map underneath decals, not plain material color).
  if (activeMesh?.material) {
    const matMap = activeMesh.material.map || null;
    uvEditor.baseTexture = (matMap && matMap !== uvEditor.liveCanvasTexture) ? matMap : null;
  }

  // Step 4: Tell UV editor about new material — now _origRoughnessMap captures the
  // correct restored map, and baseTexture is already set for the composite render.
  if (activeMesh) uvEditor.onMaterialPresetApplied(activeMesh);

  if (activeMesh?.material) controls.syncMaterialUI(activeMesh.material, getChannelThumbnailOverrides());

  uvEditor.currentMaterialPreset = presetName;
  uvEditor._renderPreview();

  // Sync the custom material dropdown and name field to reflect the applied preset
  controls.setMaterialPresetValue(presetName);
  setMaterialNameField(presetName);

  // Render immediately so transmission materials create their internal
  // render target on the first frame (compile() alone doesn't do this).
  rendererManager.render(sceneManager.getScene(), cameraManager.getCamera());
  markNeedsRender(8);
  log(`Preset: ${presetName}`);
}


const COLOR_CHANNEL_KEYS = new Set(['map', 'emissiveMap', 'sheenColorMap', 'specularColorMap']);

function serializeChannelMaps() {
  if (_channelMapData.size === 0) return null;
  const maps = {};
  for (const [key, dataUrl] of _channelMapData) maps[key] = dataUrl;
  return maps;
}

// Returns a channel → (dataURL | null) map for syncMaterialUI channel thumbnails.
// Channels with user uploads get the data URL. Channels that are sticker-PBR-owned
// (internal composites) get explicit null so the sticker canvas never shows in the UI.
function getChannelThumbnailOverrides() {
  const overrides = Object.fromEntries(_channelMapData);
  // If sticker PBR has replaced roughness/metalness and user didn't upload one, show empty.
  if (uvEditor._liveRoughnessTexture && !('roughnessMap' in overrides)) overrides.roughnessMap = null;
  if (uvEditor._liveMetalnessTexture && !('metalnessMap' in overrides)) overrides.metalnessMap = null;
  // The live decal composite must never show as the base color map slot.
  if (uvEditor.liveCanvasTexture && !('map' in overrides)) overrides.map = null;
  return overrides;
}

// ─── Preset channel map IDB persistence ──────────────────────────────────────
// Channel maps are too large for localStorage (data URLs, 1-3 MB each).
// Each preset is stored as its own entry in the 'materials' IDB store, mirroring
// the backend `materials` table shape so migration is a straight row-by-row upload.
//
// IDB key:   `${projectId}:${presetUuid}`
// IDB value: { id, projectId, name, materialData: { channelMaps: { ch: dataUrl } } }
//
// Backend equivalent:
//   POST /api/projects/:projectId/materials
//   { id, name, materialData: { channelMaps: { ch: storageAssetUuid } } }

async function savePresetChannelMapsToIDB() {
  try {
    const projectId = await getActiveProjectId();
    const allByUuid = materialManager.getAllPresetChannelMaps(); // { uuid: { ch: dataUrl } }
    const allNames  = materialManager.getPresetNamesByCategory().user;

    for (const name of allNames) {
      const uuid = materialManager.getPresetId(name);
      if (!uuid) continue;
      const key = `${projectId}:${uuid}`;
      const channelMaps = allByUuid[uuid] ?? null;
      if (channelMaps) {
        const entry = { id: uuid, projectId, name, materialData: { channelMaps } };
        await IDBStorage.put('materials', key, entry);
      } else {
        // No channel maps for this preset — remove any stale entry
        await IDBStorage.del('materials', key);
      }
    }
  } catch (e) { log(`Failed to save preset channel maps: ${e.message}`, true); }
}

async function loadPresetChannelMapsFromIDB(projectId) {
  try {
    const allKeys = await IDBStorage.getAllKeys('materials');
    const prefix  = `${projectId}:`;
    const relevant = allKeys.filter(k => k.startsWith(prefix));
    // Rebuild the { uuid: channelMaps } map that applyPresetChannelMaps expects
    const channelMapsById = {};
    for (const key of relevant) {
      const entry = await IDBStorage.get('materials', key);
      if (entry?.id && entry?.materialData?.channelMaps) {
        channelMapsById[entry.id] = entry.materialData.channelMaps;
      }
    }
    if (Object.keys(channelMapsById).length > 0) {
      materialManager.applyPresetChannelMaps(channelMapsById);
    }
  } catch (e) { log(`Failed to load preset channel maps: ${e.message}`, true); }
}

async function restoreChannelMaps(mat, maps) {
  if (!maps) return;
  const loader = new THREE.TextureLoader();
  for (const [key, dataUrl] of Object.entries(maps)) {
    _channelMapData.set(key, dataUrl);
    await new Promise(resolve => {
      loader.load(dataUrl, (tex) => {
        tex.colorSpace = COLOR_CHANNEL_KEYS.has(key) ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
        applyTexQuality(tex);
        const old = mat[key];
        if (old?.isTexture) old.dispose();
        mat[key] = tex;
        mat.needsUpdate = true;
        resolve();
      }, undefined, resolve);
    });
  }
}

// Extract material properties with sticker PBR overrides temporarily restored
// so the saved preset reflects real values, not the sticker-overridden ones.
function extractPropertiesForPreset(mat) {
  const stickerActive = uvEditor._origMetalness !== null;
  if (stickerActive) {
    mat.metalness = uvEditor._origMetalness;
    mat.roughness = uvEditor._origRoughness;
    if (uvEditor._origTransmission !== null) mat.transmission = uvEditor._origTransmission;
    if (uvEditor._origColor && mat.color) mat.color.set(uvEditor._origColor);
  }
  const props = materialManager.extractProperties(mat);
  if (stickerActive) {
    mat.metalness = 1.0;
    mat.roughness = 1.0;
    if (uvEditor._origTransmission > 0) mat.transmission = 1.0;
    if (mat.color) mat.color.set(0xffffff);
  }
  return props;
}


function updateMaterialProperty(property, value) {
  if (!activeMesh?.material) return;
  const mat = activeMesh.material;
  const colorProps = ['color', 'specularColor', 'sheenColor', 'emissive', 'attenuationColor'];
  if (colorProps.includes(property)) {
    if (property === 'color') { const h = uvEditor.updateMaterialColor(value); if (!h) mat.color.set(value); }
    else mat[property].set(value);
  } else if (property === 'normalScale') {
    if (mat.normalScale) mat.normalScale.set(value, value);
  } else {
    const h = uvEditor.updateMaterialPBR(property, value);
    if (!h) mat[property] = value;
  }
  if (property === 'opacity')      mat.transparent = value < 1.0;
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
    markNeedsRender(4);
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
  dofMaxBlur: 0.01,
  dofRings: 6,
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
  markNeedsRender(4);
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

  function applyDOF() {
    rendererManager.setDOF(camState.dofEnabled, camState.dofFocus, camState.dofAperture, camState.dofMaxBlur, camState.dofRings);
    markNeedsRender(4);
  }

  // DOF toggle
  const dofToggle = document.getElementById('cam-toggle-dof');
  if (dofToggle) {
    dofToggle.addEventListener('change', (e) => {
      camState.dofEnabled = e.target.checked;
      applyDOF();
    });
  }

  // DOF focus distance
  link('cam-dof-focus-slider', 'cam-dof-focus-input', (v) => {
    camState.dofFocus = v;
    applyDOF();
  });

  // DOF aperture/strength
  link('cam-dof-strength-slider', 'cam-dof-strength-input', (v) => {
    camState.dofAperture = v;
    applyDOF();
  });

  // DOF max blur
  link('cam-dof-maxblur-slider', 'cam-dof-maxblur-input', (v) => {
    camState.dofMaxBlur = v;
    applyDOF();
  });

  // DOF rings (sample quality)
  link('cam-dof-rings-slider', 'cam-dof-rings-input', (v) => {
    camState.dofRings = Math.round(v);
    applyDOF();
  });

  // DOF focus buttons
  const dofFocusObjBtn = document.getElementById('cam-dof-focus-object');
  if (dofFocusObjBtn) {
    dofFocusObjBtn.addEventListener('click', () => {
      if (!activeMesh) return;
      const target = new THREE.Vector3();
      activeMesh.getWorldPosition(target);
      const dist = cameraManager.getCamera().position.distanceTo(target);
      const clamped = Math.min(Math.max(dist, 0.1), 50);
      camState.dofFocus = clamped;
      const focusSlider = document.getElementById('cam-dof-focus-slider');
      const focusInput  = document.getElementById('cam-dof-focus-input');
      if (focusSlider) focusSlider.value = clamped;
      if (focusInput)  focusInput.value  = clamped.toFixed(1);
      applyDOF();
    });
  }

  const dofResetBtn = document.getElementById('cam-dof-reset-focus');
  if (dofResetBtn) {
    dofResetBtn.addEventListener('click', () => {
      camState.dofFocus = 5.0;
      const focusSlider = document.getElementById('cam-dof-focus-slider');
      const focusInput  = document.getElementById('cam-dof-focus-input');
      if (focusSlider) focusSlider.value = 5.0;
      if (focusInput)  focusInput.value  = '5.0';
      applyDOF();
    });
  }

  const dofResetAllBtn = document.getElementById('cam-dof-reset-all');
  if (dofResetAllBtn) {
    dofResetAllBtn.addEventListener('click', () => {
      camState.dofFocus    = 5.0;
      camState.dofAperture = 0.25;
      camState.dofMaxBlur  = 0.01;
      camState.dofRings    = 6;
      const set = (id, v) => {
        const el = document.getElementById(id);
        if (el) el.value = v;
      };
      set('cam-dof-focus-slider',    5.0);
      set('cam-dof-focus-input',     '5.0');
      set('cam-dof-strength-slider', 0.25);
      set('cam-dof-strength-input',  '0.25');
      set('cam-dof-maxblur-slider',  0.01);
      set('cam-dof-maxblur-input',   '0.010');
      set('cam-dof-rings-slider',    6);
      set('cam-dof-rings-input',     '6');
      applyDOF();
    });
  }

  // Apply initial camera settings from UI defaults
  applyCameraSettings();
}

//═══════════════════════════════════════════════════════════════
// UI CONTROLS
//═══════════════════════════════════════════════════════════════

const controls = new ControlsManager({
  onGridChange: (field, value) => {
    // Grid size input is in display units (cm or in); convert to Three.js units (1 unit = 1 cm)
    tfGridCfg[field] = (field === 'size' && measureUnit === 'in') ? value * 2.54 : value;
    rebuildGrid();
    if (tfSnapOn) {
      propManager.setSnapEnabled(true, gridSnapStep());
    }
  },

  onModelChange: (name) => {
    pushSceneHistory(`Object → ${name}`);
    loadModel(name);
  },

  onPartChange: (partName) => {
    if (!partName) return;
    const mesh = meshMap[partName];
    if (mesh) selectPart(mesh);
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
    uvEditor.commitMaterialChange();
    materialState.push('Material change');
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
      window.selectModelInDropdown(result.name);
    } else {
      logError(`Import failed: ${result.error}`);
    }
  },

  onChannelTextureUpload: (channel, file) => {
    if (!activeMesh?.material) { logError('No active mesh'); return; }
    const COLOR_CHANNELS = new Set(['map', 'emissiveMap', 'sheenColorMap', 'specularColorMap', 'attenuationColorMap']);
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      _channelMapData.set(channel, dataUrl);
      const loader = new THREE.TextureLoader();
      loader.load(dataUrl, (tex) => {
        tex.colorSpace = COLOR_CHANNELS.has(channel) ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
        applyTexQuality(tex);
        const old = activeMesh.material[channel];
        if (old && old.isTexture) old.dispose();
        activeMesh.material[channel] = tex;
        activeMesh.material.needsUpdate = true;
        // Sync UV editor so decals and channel maps don't conflict
        if (channel === 'map' && uvEditor.overlayImages?.length > 0) {
          uvEditor.notifyBaseMapChanged(tex);
        } else if ((channel === 'roughnessMap' || channel === 'metalnessMap' || channel === 'transmissionMap') && uvEditor._liveRoughnessTexture) {
          uvEditor.notifyPBRMapChanged(channel, tex);
        }
        controls.syncMaterialUI(activeMesh.material, getChannelThumbnailOverrides());
        log(`Channel "${channel}" texture set: ${file.name}`);
      }, undefined, () => logError(`Failed to load texture: ${file.name}`));
    };
    reader.readAsDataURL(file);
  },

  onChannelTextureClear: (channel) => {
    if (!activeMesh?.material) return;
    _channelMapData.delete(channel);
    const old = activeMesh.material[channel];
    if (old && old.isTexture) old.dispose();
    activeMesh.material[channel] = null;
    activeMesh.material.needsUpdate = true;
    // Sync UV editor so decals and channel maps don't conflict
    if (channel === 'map' && uvEditor.overlayImages?.length > 0) {
      uvEditor.notifyBaseMapChanged(null);
    } else if ((channel === 'roughnessMap' || channel === 'metalnessMap' || channel === 'transmissionMap') && uvEditor._liveRoughnessTexture) {
      uvEditor.notifyPBRMapChanged(channel, null);
    }
    controls.syncMaterialUI(activeMesh.material, getChannelThumbnailOverrides());
    log(`Channel "${channel}" texture cleared`);
  },

  onClearCustom: async () => {
    if (!confirm('Clear all custom models? This cannot be undone!')) return;
    const result = await modelManager.clearAllCustomModels();
    if (result.success) {
      logSuccess(`Cleared ${result.count} custom model(s)`);
      await updateModelList();

      controls.setMaterialPresetValue('Default — White');

      // Load the first built-in model — this applies the Default preset
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
  // Skip expensive raycast during orbit drag on high-poly models
  if (performanceModeEnabled && _isOrbiting) { clearHighlight(); return; }
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

function _snapshotCurrentPart() {
  // Snapshot the active part's state into _partCache before switching parts.
  // We store the live overlay array (already-decoded Image objects) and channel maps
  // so switching back is instant and saveCustomModelHandler can collect all parts.
  if (!activeMesh) return;
  _partCache[activeMesh.name] = {
    channelMaps:   serializeChannelMaps() || null,
    // Store overlay entries with live Image objects — no re-decode needed on restore
    overlayImages: uvEditor.overlayImages.map(img => ({ ...img })),
    materialPreset:   uvEditor.currentMaterialPreset,
    materialPresetId: materialManager.getPresetId(uvEditor.currentMaterialPreset),
    isCustomMaterial: materialManager.isUserPreset(uvEditor.currentMaterialPreset),
  };
}

async function selectPart(mesh) {
  if (!mesh) return;
  _snapshotCurrentPart();
  clearHighlight();
  activeMesh = mesh;

  if (activeMesh.material) {
    controls.syncMaterialUI(activeMesh.material, getChannelThumbnailOverrides());
    if (activeMesh.material.name) {
      const validPresets = materialManager.getPresetNames();
      const presetToShow = validPresets.includes(activeMesh.material.name)
        ? activeMesh.material.name
        : 'Default — White';
      controls.setMaterialPresetValue(presetToShow);
      setMaterialNameField(presetToShow);
    }
  }

  // Restore channel maps for this part from cache
  const cached = _partCache[mesh.name];
  _channelMapData.clear();
  if (cached?.channelMaps && activeMesh.material) {
    await restoreChannelMaps(activeMesh.material, cached.channelMaps);
    controls.syncMaterialUI(activeMesh.material, getChannelThumbnailOverrides());
  }

  // Pass cached overlays (already-decoded Image objects) — skips IDB read
  const preloadedOverlays = cached ? cached.overlayImages : null;
  await uvEditor.open(activeMesh, getCurrentModelName(), getCurrentMaterialPreset(), preloadedOverlays);

  cameraManager.reframeObject(activeMesh);
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
  return controls.getMaterialPresetValue();
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
      activeCustomScene: document.getElementById('scene-select')?.value || null,
      materialPreset: uvEditor.currentMaterialPreset || getCurrentMaterialPreset() || null,
      isCustomMaterial: materialManager.isUserPreset(uvEditor.currentMaterialPreset || getCurrentMaterialPreset()),
      materialProperties: (() => {
        if (!activeMesh?.material) return null;
        const mat = activeMesh.material;
        const stickerActive = uvEditor._origMetalness !== null;
        if (stickerActive) {
          mat.metalness = uvEditor._origMetalness;
          mat.roughness = uvEditor._origRoughness;
          if (uvEditor._origTransmission !== null) mat.transmission = uvEditor._origTransmission;
          if (uvEditor._origColor && mat.color) mat.color.set(uvEditor._origColor);
        }
        const props = materialManager.extractProperties(mat);
        props.channelMaps = serializeChannelMaps();
        if (stickerActive) {
          mat.metalness = 1.0;
          mat.roughness = 1.0;
          if (uvEditor._origTransmission > 0) mat.transmission = 1.0;
          if (mat.color) mat.color.set(0xffffff);
        }
        return props;
      })(),
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
      rendererState: rendererManager.getState(),
    };
    // Fast startup hint (sync read/write, tiny payload)
    try {
      localStorage.setItem(sessionBootKey(getActiveProjectIdSync()), JSON.stringify({
        version: 1,
        savedAt: state.savedAt,
        modelName: state.modelName,
        partName: state.partName,
        sceneName: state.sceneName,
        materialPreset: state.materialPreset,
        camera: state.camera,
        rendererState: state.rendererState,
      }));
    } catch (_) {
      // ignore localStorage quota/availability failures
    }
    // Persist in IndexedDB so larger state (overlay images) survives reload reliably.
    IDBStorage.put('metadata', sessionStorageKey(getActiveProjectIdSync()), state).catch((err) => {
      console.warn('Session state write failed:', err);
    });
  } catch (err) {
    console.warn('Session save failed:', err);
  }
}

async function restoreSessionState() {
  let state = null;
  try {
    const pid = await getActiveProjectId();
    state = await IDBStorage.get('metadata', sessionStorageKey(pid));
    if (!state || state.version !== 1) return false;
  } catch (err) {
    console.warn('Session parse failed:', err);
    return false;
  }

  try {
    // Sync the custom scene dropdown — the UI is already built by the time restore runs
    if (state.activeCustomScene) {
      const sel = document.getElementById('scene-select');
      if (sel && sel.querySelector(`option[value="${state.activeCustomScene}"]`)) {
        sel.value = state.activeCustomScene;
      }
    }

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
    if (bgSelect && currentGradientBg) { bgSelect.value = currentGradientBg; syncBgCards(currentGradientBg); }
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
    // Prefer the localStorage boot key's preset (sync write, always up-to-date)
    // over IDB state which may be stale if the async write didn't finish before unload.
    let restoredPreset = state.materialPreset;
    try {
      const bootRaw = localStorage.getItem(sessionBootKey(getActiveProjectIdSync()));
      if (bootRaw) {
        const boot = JSON.parse(bootRaw);
        if (boot?.materialPreset) restoredPreset = boot.materialPreset;
      }
    } catch (_) { /* ignore */ }
    if (restoredPreset) {
      const alreadyCorrect = activeMesh?.material?.name === restoredPreset;
      if (!alreadyCorrect) {
        await applyMaterialPreset(restoredPreset);
      } else {
        controls.setMaterialPresetValue(restoredPreset);
      }
    }
    if (state.materialProperties && activeMesh?.material) {
      materialManager.applySavedProperties(activeMesh.material, state.materialProperties);
      // Use the saved color rather than material.color — sticker mode sets material.color
      // to white, so reading it here would overwrite _origColor with white.
      const savedColor = state.materialProperties.color;
      if (savedColor) uvEditor.updateMaterialColor(savedColor);
      if (state.materialProperties.channelMaps) {
        await restoreChannelMaps(activeMesh.material, state.materialProperties.channelMaps);
        // Re-sync UV editor — restoreChannelMaps may overwrite material slots that
        // openWithPreloadedData already composited (channel map over decals bug).
        const cm = state.materialProperties.channelMaps;
        if ('map' in cm && uvEditor.overlayImages?.length > 0) {
          uvEditor.notifyBaseMapChanged(activeMesh.material.map ?? null);
        }
        if ('roughnessMap' in cm && uvEditor._liveRoughnessTexture) {
          uvEditor.notifyPBRMapChanged('roughnessMap', activeMesh.material.roughnessMap ?? null);
        }
        if ('metalnessMap' in cm && uvEditor._liveMetalnessTexture) {
          uvEditor.notifyPBRMapChanged('metalnessMap', activeMesh.material.metalnessMap ?? null);
        }
        if ('transmissionMap' in cm && uvEditor._liveTransmissionTexture) {
          uvEditor.notifyPBRMapChanged('transmissionMap', activeMesh.material.transmissionMap ?? null);
        }
      }
      activeMesh.material.needsUpdate = true;
      controls.syncMaterialUI(activeMesh.material, getChannelThumbnailOverrides());
      markNeedsRender(4);
    }

    // Restore unsaved design editor overlays
    if (state.uvEditor) {
      await uvEditor.restoreSessionState(state.uvEditor);
    }

    // Restore props (re-download any Sketchfab props first)
    if (state.props?.length) {
      await ensureSketchfabPropsRegistered(state.props);
      await propManager.loadSceneData(state.props);
    }

    // Restore renderer/post-FX settings from the authoritative IDB state.
    // Also syncs DOM sliders/checkboxes to match.
    if (state.rendererState) {
      rendererManager.restoreState(state.rendererState);
      rendererManager.syncUI();
      // _syncPasses is not called here — initComposer already ran with the
      // correct state from the localStorage boot key (which is written in sync).
      // If for any reason they differ, the next _syncPasses call will rebuild.
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

/** @param {string} presetName */
function getMaterialThumbnail(presetName) {
  return _matThumbCache.get(presetName) ?? null;
}

// Tracks pending idle-callback / timeout IDs per preset name so rapid slider
// moves cancel the previous pending render and only fire once after settling.
const _pendingThumbUpdates = new Map();

/**
 * Schedule a thumbnail render during browser idle time.
 * - Pass a live material reference to pick up its current values.
 * - Pass null/undefined to create a fresh preset copy (used for standard presets).
 * Multiple calls for the same name cancel the previous pending render.
 *
 * @param {string}           name - preset name
 * @param {THREE.Material=}  mat  - live material (optional; created fresh if omitted)
 */
// disposeAfter: true when mat is a temporary clone that should be disposed after rendering
function scheduleThumbnailUpdate(name, mat, disposeAfter = false) {
  // Cancel any outstanding request for this name
  if (_pendingThumbUpdates.has(name)) {
    const pending = _pendingThumbUpdates.get(name);
    if (typeof cancelIdleCallback === 'function') cancelIdleCallback(pending);
    else clearTimeout(pending);
  }

  const render = () => {
    _pendingThumbUpdates.delete(name);
    _ensureThumbRenderer();
    const m = mat ?? materialManager.createFreshPreset(name);
    _thumbSphereMesh.material = m;
    _thumbRenderer.render(_thumbScene, _thumbCamera);
    const dataUrl = _thumbRenderer.domElement.toDataURL();
    _matThumbCache.set(name, dataUrl);
    IDBStorage.put('blobs', THUMB_IDB_PREFIX + name, dataUrl).catch(() => {});
    if (!mat || disposeAfter) m.dispose();
    updateMaterialPresetList();
  };

  let id;
  if (typeof requestIdleCallback === 'function') {
    id = requestIdleCallback(render, { timeout: 1500 });
  } else {
    id = setTimeout(render, 500);
  }
  _pendingThumbUpdates.set(name, id);
}

/**
 * Schedule thumbnail generation for every preset that currently has no cached
 * thumbnail. Spreads the work across idle frames so the UI stays responsive.
 * Called after restoring standard presets or any bulk list change.
 */
function scheduleAllMissingThumbnails() {
  for (const name of materialManager.getPresetNames()) {
    if (!_matThumbCache.has(name)) {
      scheduleThumbnailUpdate(name, null);
    }
  }
}

function updateMaterialPresetList() {
  controls.updateMaterialPresetSelect(
    materialManager.getPresetNamesByCategory(),
    getMaterialThumbnail,
    () => currentEnvironment
  );
}

// ── Material preset buttons: New / Rename / Delete ───────────────────────────
document.getElementById('add-new-material')?.addEventListener('click', () => {
  if (!activeMesh?.material) return;
  const sourceName = activeMesh.material.name || 'Custom';
  const newName = materialManager.generateUserPresetName(sourceName);
  const forked  = materialManager.forkMaterial(activeMesh.material, newName);
  const env     = sceneManager.getScene().environment;
  materialManager.applyEnvironment(forked, env);
  activeMesh.material = forked;
  materialManager.addUserPreset(newName, { ...extractPropertiesForPreset(forked), _channelMaps: serializeChannelMaps() || undefined });
  savePresetChannelMapsToIDB();
  updateMaterialPresetList();
  controls.setMaterialPresetValue(newName);
  setMaterialNameField(newName);
  controls.syncMaterialUI(activeMesh.material, getChannelThumbnailOverrides());
  // Clone with channel map but no decal for thumbnail; dispose the clone after render
  scheduleThumbnailUpdate(newName, uvEditor.getCleanMaterialForThumbnail(), true);
  log(`New material: "${newName}"`);
});

// ── Inline rename form ────────────────────────────────────────────────────────
// The form is always visible. setMaterialNameField() is called from
// applyMaterialPreset() and selectPart() to keep the input in sync.
const _renameInput   = document.getElementById('rename-material-input');
const _renameConfirm = document.getElementById('rename-material-confirm');
const _renameClear   = document.getElementById('rename-material-clear');

function setMaterialNameField(name) {
  if (_renameInput) _renameInput.value = name ?? '';
}

function _resetRenameField() {
  setMaterialNameField(activeMesh?.material?.name ?? '');
}

function _commitRename() {
  const current = controls.getMaterialPresetValue();
  const newName = _renameInput.value.trim();
  if (!newName || !current || newName === current) { _resetRenameField(); return; }
  if (materialManager.getPresetNames().includes(newName)) {
    _renameInput.style.borderColor = '#c06060';
    _renameInput.select();
    setTimeout(() => { _renameInput.style.borderColor = ''; }, 1000);
    return;
  }

  if (materialManager.isStandardPreset(current)) {
    // Fork the standard preset under the chosen name
    const forked = materialManager.forkMaterial(activeMesh.material, newName);
    materialManager.applyEnvironment(forked, sceneManager.getScene().environment);
    activeMesh.material = forked;
    materialManager.addUserPreset(newName, { ...extractPropertiesForPreset(forked), _channelMaps: serializeChannelMaps() || undefined });
    savePresetChannelMapsToIDB();
    scheduleThumbnailUpdate(newName, uvEditor.getCleanMaterialForThumbnail(), true);
    log(`Forked "${current}" → "${newName}"`);
  } else {
    // User preset — rename in place
    materialManager.renamePreset(current, newName);
    if (_matThumbCache.has(current)) {
      const dataUrl = _matThumbCache.get(current);
      _matThumbCache.set(newName, dataUrl);
      _matThumbCache.delete(current);
      IDBStorage.put('blobs', THUMB_IDB_PREFIX + newName, dataUrl).catch(() => {});
      IDBStorage.del('blobs', THUMB_IDB_PREFIX + current).catch(() => {});
    }
    log(`Renamed "${current}" → "${newName}"`);
  }

  updateMaterialPresetList();
  controls.setMaterialPresetValue(newName);
  setMaterialNameField(newName);
  uvEditor.currentMaterialPreset = newName;
}

// Rename button → focus + select so the user can start typing immediately
document.getElementById('rename-material')?.addEventListener('click', () => {
  _renameInput?.focus();
  _renameInput?.select();
});

_renameConfirm?.addEventListener('click', _commitRename);
_renameClear  ?.addEventListener('click', () => { _renameInput.value = ''; _renameInput.focus(); });

_renameInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter')  { e.preventDefault(); _commitRename(); }
  if (e.key === 'Escape') { e.preventDefault(); _resetRenameField(); _renameInput.blur(); }
});

document.getElementById('delete-current-material')?.addEventListener('click', () => {
  const current = controls.getMaterialPresetValue();
  if (!current) return;
  if (!confirm(`Remove "${current}" from the list?`)) return;

  const fallback = materialManager.getPresetNames().find(n => n !== current);
  if (fallback) applyMaterialPreset(fallback);

  if (materialManager.isStandardPreset(current)) {
    materialManager.hideStandardPreset(current);
  } else if (!materialManager.deleteUserPreset(current)) {
    materialManager.dispose(activeMesh?.material);
  }
  savePresetChannelMapsToIDB();
  _matThumbCache.delete(current);
  IDBStorage.del('blobs', THUMB_IDB_PREFIX + current).catch(() => {});
  updateMaterialPresetList();
  log(`Removed material: "${current}"`);
});

document.getElementById('load-standard-materials')?.addEventListener('click', () => {
  materialManager.restoreAllStandardPresets();
  updateMaterialPresetList();
  scheduleAllMissingThumbnails();
  log('Standard materials restored');
});

document.getElementById('reset-cache-btn')?.addEventListener('click', () => {
  if (!confirm('Clear all caches? This will remove custom materials and saved models. The page will reload.')) return;
  localStorage.removeItem('rd_user_presets');
  localStorage.removeItem('rd_hidden_presets');
  localStorage.removeItem('rd_session_boot');
  indexedDB.deleteDatabase('renderDeck_customModels');
  // Clear persisted thumbnail cache from IDB
  IDBStorage.getAllKeys('blobs').then(keys => {
    keys.filter(k => k.startsWith('thumb:')).forEach(k => IDBStorage.del('blobs', k).catch(() => {}));
  }).catch(() => {});
  location.reload();
});

document.getElementById('reset-all-data-btn')?.addEventListener('click', () => {
  if (!confirm('Delete ALL custom data?\n\nThis will permanently remove:\n• All custom models\n• All custom materials\n• All saved scenes and projects\n• All uploaded props and channel maps\n• All session state\n\nThis cannot be undone. The page will reload.')) return;
  // Wipe both IDB databases (current + legacy)
  indexedDB.deleteDatabase('renderdeck_db');
  indexedDB.deleteDatabase('renderDeck_customModels');
  // Wipe all localStorage — clears session boot keys, user presets, hidden presets, everything
  localStorage.clear();
  location.reload();
});

window.updateModelSelect = updateModelList;

// ── Multi-part custom model save ──────────────────────────────────────────────
// Collects all parts' state (channel maps + decals + material) into the v3 parts
// schema and delegates to CustomModelStorage.saveCustomModel.
window.saveCustomModelHandler = async function() {
  if (!activeModel) return;

  // Snapshot the currently active part before collecting all parts
  _snapshotCurrentPart();

  // Prompt for name if not yet saved as a custom model
  let customName = uvEditor.customModelName;
  if (!customName) {
    const baseName = uvEditor.activeModelName || getCurrentModelName();
    customName = prompt('Enter a name for your custom model:', `${baseName} (Custom)`);
    if (!customName) { log('Save cancelled'); return; }
    uvEditor.customModelName = customName;
  }

  // Build parts map from _partCache (all visited parts) + any unvisited meshes
  const parts = {};
  for (const [partName, mesh] of Object.entries(meshMap)) {
    const cached = _partCache[partName];
    const mat = mesh.material;

    // Extract material properties (undo sticker-PBR overrides if active for this mesh)
    const stickerActive = activeMesh === mesh && uvEditor._origMetalness !== null;
    if (stickerActive) {
      mat.metalness = uvEditor._origMetalness;
      mat.roughness = uvEditor._origRoughness;
      if (uvEditor._origTransmission !== null) mat.transmission = uvEditor._origTransmission;
      if (uvEditor._origColor && mat.color) mat.color.set(uvEditor._origColor);
    }
    const matProps = materialManager.extractProperties(mat);
    if (stickerActive) {
      mat.metalness = 1.0; mat.roughness = 1.0;
      if (uvEditor._origTransmission > 0) mat.transmission = 1.0;
      if (mat.color) mat.color.set(0xffffff);
    }

    const channelMaps = cached?.channelMaps || null;
    if (channelMaps) matProps.channelMaps = channelMaps;

    // Serialize decals to dataURLs from cached overlay Image objects
    const decals = await Promise.all((cached?.overlayImages || []).map(async img => {
      const c = document.createElement('canvas');
      c.width = img.image.width; c.height = img.image.height;
      c.getContext('2d').drawImage(img.image, 0, 0);
      return {
        name:        img.name,
        type:        img.type        || 'image',
        textData:    img.textData    ? { ...img.textData } : null,
        position:    { ...img.position },
        size:        { ...img.size },
        rotation:    img.rotation,
        aspectRatio: img.aspectRatio,
        flipH:       img.flipH       ?? false,
        flipV:       img.flipV       ?? false,
        imageData:   c.toDataURL('image/png'),
      };
    }));

    // Use cached preset if available; otherwise fall back to 'Default — White'.
    // mat.name may be a raw GLB material name ("Coffee", "Glass") which is not a
    // valid RenderDeck preset — normalise those to 'Default — White' so they don't
    // leak into the preset dropdown on reload.
    const rawPreset = cached?.materialPreset || mat.name;
    const validPresets = materialManager.getPresetNames();
    const presetName = (rawPreset && validPresets.includes(rawPreset)) ? rawPreset : 'Default — White';
    parts[partName] = {
      materialPreset:   presetName,
      materialPresetId: cached?.materialPresetId || materialManager.getPresetId(presetName) || null,
      isCustomMaterial: cached?.isCustomMaterial ?? materialManager.isUserPreset(presetName),
      materialData:     matProps,
      decals,
    };
  }

  await modelManager.saveCustomModel(customName, {
    basedOn:    uvEditor.activeModelName,
    customName,
    sourceType: 'standard',
    sceneState: uvEditor.sceneState || null,
    parts,
  });

  log(`Saved: ${customName}`);
  await updateModelList();
  window.selectModelInDropdown?.(customName);
};

window.switchToModel = (name) => {
  const sel = document.getElementById('object-select') || document.getElementById('model-select');
  if (sel) { sel.value = name; loadModel(name); }
};
window.selectModelInDropdown = (name) => {
  const sel = document.getElementById('object-select') || document.getElementById('model-select');
  if (sel) sel.value = name;
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
    // Sync to the checkbox's actual DOM state on init
    rm.setPostFXEnabled(globalToggle.checked);
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

  // Color picker + hex sync
  const vColorPicker = document.getElementById('vignette-color-picker');
  const vColorHex    = document.getElementById('vignette-color-hex');
  const vColorSwatch = document.getElementById('vignette-color-swatch');
  const syncVignetteColor = (hex) => {
    rm.setVignetteColor(hex);
    if (vColorPicker) vColorPicker.value = hex;
    if (vColorHex)    vColorHex.value    = hex;
    if (vColorSwatch) vColorSwatch.style.backgroundColor = hex;
    markNeedsRender(4);
  };
  vColorPicker?.addEventListener('input',  e => syncVignetteColor(e.target.value));
  vColorHex?.addEventListener('change', e => {
    const v = e.target.value.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(v)) syncVignetteColor(v);
  });
  syncVignetteColor('#000000'); // initialize swatch

  // Blend mode
  document.getElementById('vignette-blend-mode')?.addEventListener('change', e => {
    rm.setVignetteBlendMode(parseInt(e.target.value, 10));
    markNeedsRender(4);
  });

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
let gridHelper    = null;
let gridSubHelper = null;   // dashed subdivision lines
let axesHelper    = null;

// Grid toolbar state (shared between setupTransformToolbar and Controls callbacks)
let tfGridOn  = false;
let tfSnapOn  = false;
const tfGridCfg = { size: 10, divisions: 10, subdivisions: 5 };
let measureUnit = 'cm'; // 'cm' | 'in'  — 1 Three.js unit = 1 cm

function gridSnapStep() {
  const { size, divisions, subdivisions } = tfGridCfg;
  const totalDivs = subdivisions > 0 ? divisions * subdivisions : divisions;
  return size / totalDivs;
}

function rebuildGrid() {
  const scene = sceneManager.getScene();
  if (gridHelper)    { scene.remove(gridHelper);    gridHelper.geometry?.dispose();    gridHelper.material?.dispose();    gridHelper    = null; }
  if (gridSubHelper) { scene.remove(gridSubHelper); gridSubHelper.geometry?.dispose(); gridSubHelper.material?.dispose(); gridSubHelper = null; }
  if (!tfGridOn) { markNeedsRender(4); return; }

  const { size, divisions, subdivisions } = tfGridCfg;
  const canvas = rendererManager.getRenderer().domElement;

  // Main grid — thick white lines via LineSegments2 (true pixel linewidth)
  {
    const half = size / 2;
    const step = size / divisions;
    const positions = [];
    for (let i = 0; i <= divisions; i++) {
      const p = -half + i * step;
      positions.push(-half, 0, p,  half, 0, p); // line along X
      positions.push(p, 0, -half,  p, 0,  half); // line along Z
    }
    const geo = new LineSegmentsGeometry();
    geo.setPositions(positions);
    const mat = new LineMaterial({
      color: 0xffffff,
      linewidth: 1.25,
      resolution: new THREE.Vector2(canvas.width, canvas.height),
    });
    gridHelper = new LineSegments2(geo, mat);
    gridHelper.position.y = -0.01;
    scene.add(gridHelper);
  }

  // Subdivision grid — grey semi-transparent GridHelper lines
  if (subdivisions > 0) {
    const totalDivs = divisions * subdivisions;
    gridSubHelper = new THREE.GridHelper(size, totalDivs, 0x7f7f7f, 0x7f7f7f);
    // Remove lines that overlap with main grid so only subdivision lines show
    const posAttr = gridSubHelper.geometry.getAttribute('position');
    const colorAttr = gridSubHelper.geometry.getAttribute('color');
    const step = size / divisions;
    const half = size / 2;
    const eps  = 1e-4;
    for (let i = 0; i < posAttr.count; i += 2) {
      const x0 = posAttr.getX(i), z0 = posAttr.getZ(i);
      const x1 = posAttr.getX(i + 1), z1 = posAttr.getZ(i + 1);
      // A main-grid line is axis-aligned and sits exactly on a main-division offset
      const onMainX = Math.abs(((z0 + half) % step)) < eps || Math.abs(((z0 + half) % step) - step) < eps;
      const onMainZ = Math.abs(((x0 + half) % step)) < eps || Math.abs(((x0 + half) % step) - step) < eps;
      const isMainLine = (Math.abs(x0 - x1) < eps && onMainZ) || (Math.abs(z0 - z1) < eps && onMainX);
      if (isMainLine) {
        // Zero-out the segment so it renders as a degenerate (invisible) line
        colorAttr.setXYZ(i,     0, 0, 0);
        colorAttr.setXYZ(i + 1, 0, 0, 0);
      }
    }
    colorAttr.needsUpdate = true;
    gridSubHelper.material.transparent = true;
    gridSubHelper.material.opacity = 0.4;
    gridSubHelper.material.vertexColors = true;
    gridSubHelper.position.y = -0.009;
    scene.add(gridSubHelper);
  }
  markNeedsRender(4);
}

function setupPreviewQualityUI() {
  const renderer = rendererManager.getRenderer();
  const scene = sceneManager.getScene();
  // ── Resolution select (temporarily disabled — moved to Rendering tab) ──
  // The select is in Setting7 with disabled attribute. When re-enabled, uncomment:
  // const resolutionSelect = document.getElementById('resolution-select');
  // if (resolutionSelect) {
  //   resolutionSelect.addEventListener('change', (e) => {
  //     const val = e.target.value;
  //     if (!val) return;
  //     const [w, h] = val.split('x').map(Number);
  //     rendererManager.setCustomResolution(w, h);
  //     const cam = cameraManager.getCamera();
  //     cam.aspect = w / h;
  //     cam.updateProjectionMatrix();
  //     markNeedsRender(4);
  //     log(`Resolution: ${w}x${h}`);
  //   });
  // }

  // ── Current Resolution display (Preview Quality tab) ──
  function updateResolutionDisplay() {
    const display = document.getElementById('current-resolution-display');
    if (!display) return;
    const canvas = rendererManager.getDomElement();
    if (canvas) {
      display.textContent = `${canvas.width} × ${canvas.height}`;
    }
  }
  updateResolutionDisplay();

  // ResizeObserver fires after CSS layout is committed, so clientWidth/clientHeight
  // are already the new values. We render immediately here rather than via markNeedsRender
  // to avoid the one-frame blank caused by setSize() clearing the canvas before the
  // animation loop gets a chance to redraw.
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      rendererManager.resize();
      const cam = cameraManager.getCamera();
      cam.aspect = container.clientWidth / Math.max(1, container.clientHeight);
      cam.updateProjectionMatrix();
      rendererManager.render(sceneManager.getScene(), cam);
      updateResolutionDisplay();
      // Keep LineMaterial resolution in sync so thick grid lines stay sharp
      if (gridHelper?.material?.resolution) {
        const c = rendererManager.getRenderer().domElement;
        gridHelper.material.resolution.set(c.width, c.height);
      }
    }).observe(container);
  } else {
    window.addEventListener('resize', () => {
      const cam = cameraManager.getCamera();
      cam.aspect = container.clientWidth / Math.max(1, container.clientHeight);
      cam.updateProjectionMatrix();
      markNeedsRender(4);
      updateResolutionDisplay();
      if (gridHelper?.material?.resolution) {
        const c = rendererManager.getRenderer().domElement;
        gridHelper.material.resolution.set(c.width, c.height);
      }
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
    rendererManager.setAA(v);
    markNeedsRender(4);
    log(`Anti-aliasing: ${v}`);
  });

  // ── Shadow Quality ──
  setupButtonRow('shadow-quality-buttons', (v) => {
    const sizes = { off: 0, low: 256, medium: 1024, high: 4096, ultra: 8192 };
    const size = sizes[v] || 2048;
    const dirLight = sceneManager.directionalLight;
    if (v === 'off') {
      renderer.shadowMap.enabled = false;
      if (dirLight) dirLight.intensity = 0;
    } else {
      renderer.shadowMap.enabled = true;
      if (dirLight) dirLight.intensity = 0.5;
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
    renderer.shadowMap.needsUpdate = true;
    scene.traverse((obj) => {
      if (obj.isMesh && obj.material) {
        obj.material.needsUpdate = true;
      }
    });
    markNeedsRender(4);
    log(`Shadow quality: ${v}`);
  });

  // ── Texture Filtering ──
  setupButtonRow('texture-filtering-buttons', (v) => {
    const levels = { low: 1, medium: 8, high: 16 };
    const aniso = levels[v] || 16;
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const clamped = Math.min(aniso, maxAniso);
    currentAnisotropy = clamped; // remember for future texture loads
    scene.traverse((obj) => {
      if (obj.isMesh && obj.material) {
        const mat = obj.material;
        const textures = [mat.map, mat.normalMap, mat.roughnessMap, mat.metalnessMap,
                          mat.aoMap, mat.emissiveMap, mat.displacementMap, mat.alphaMap];
        textures.forEach((tex) => {
          if (tex) { tex.anisotropy = clamped; tex.needsUpdate = true; }
        });
      }
    });
    log(`Texture filtering: Aniso ${clamped}`);
  });

  // ── Performance mode toggle ──
  const perfToggle = document.getElementById('perf-mode-toggle');
  if (perfToggle) {
    perfToggle.addEventListener('change', (e) => {
      performanceModeEnabled = e.target.checked;
      if (!performanceModeEnabled) {
        rendererManager.exitOrbitPerfMode();
      }
      updatePerfModeUI();
      log(`Performance mode: ${performanceModeEnabled ? 'on' : 'off'}`);
    });
  }

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

  // Gradient preset cards
  const bgSelect = document.getElementById('background-select');
  if (bgSelect) {
    bgSelect.addEventListener('change', e => {
      currentGradientBg = e.target.value;
      applyBackground();
      pushSceneHistory(`Background: ${e.target.value || 'none'}`);
    });
  }

  document.querySelectorAll('.bg-preset-card').forEach(card => {
    card.addEventListener('click', () => {
      const bgSelect = document.getElementById('background-select');
      if (!bgSelect) return;
      bgSelect.value = card.dataset.value;
      bgSelect.dispatchEvent(new Event('change'));
      syncBgCards(card.dataset.value);
    });
  });
}

//═══════════════════════════════════════════════════════════════
// PROPS UI
//═══════════════════════════════════════════════════════════════

async function setupPropsUI() {
  const propsSelect   = document.getElementById('props-select');
  const addPropBtn      = document.getElementById('add-prop-btn');
  const importPropBtn   = document.getElementById('import-prop-btn');
  const propFileInput   = document.getElementById('prop-file-input');
  const deletePropBtn   = document.getElementById('delete-prop-btn');
  const clearPropsBtn   = document.getElementById('clear-props-btn');
  const myPropsSection  = document.getElementById('my-props-section');
  const myPropsList     = document.getElementById('my-props-list');

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

  // Helper: ensure the "Custom" optgroup exists in the dropdown so uploaded
  // props appear there. Returns the optgroup element.
  function ensureCustomOptgroup() {
    let g = propsSelect.querySelector('optgroup[label="Custom"]');
    if (!g) {
      g = document.createElement('optgroup');
      g.label = 'Custom';
      propsSelect.appendChild(g);
    }
    return g;
  }

  // Add a row to the "My Props" library list (cloud-only). Returns the row
  // so callers can remove it on delete.
  function addLibraryRow(propAsset) {
    if (!myPropsList) return null;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; align-items:center; gap:8px; padding:4px 6px; border-radius:4px;';
    row.dataset.propAssetId = propAsset.id;
    row.dataset.name = propAsset.name;

    const nameSpan = document.createElement('span');
    nameSpan.textContent = propAsset.name;
    nameSpan.style.cssText = 'flex:1; cursor:pointer; font-size:12px;';
    nameSpan.title = 'Click to add to scene';
    nameSpan.addEventListener('click', async () => {
      const target = cameraManager.getControls().target;
      await propManager.addProp(`custom_${propAsset.name}`, { x: target.x, y: target.y, z: target.z });
      pushSceneHistory(`Added prop from library: ${propAsset.name}`);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = '✕';
    deleteBtn.title = 'Delete from library';
    deleteBtn.style.cssText = 'background:none; border:none; cursor:pointer; color:#c44; font-size:14px; padding:0 6px;';
    deleteBtn.addEventListener('click', async () => {
      if (!confirm(`Delete "${propAsset.name}" from your library?`)) return;
      const projectId = getActiveProjectIdSync();
      try {
        await deletePropAsset(projectId, propAsset.id);
        propManager.unregisterCustomProp(propAsset.name);
        // Remove from dropdown Custom optgroup
        const customGroup = propsSelect.querySelector('optgroup[label="Custom"]');
        const opt = customGroup?.querySelector(`option[value="custom_${propAsset.name}"]`);
        if (opt) opt.remove();
        if (customGroup && !customGroup.children.length) customGroup.remove();
        // Remove from library list
        row.remove();
        if (myPropsList && !myPropsList.children.length && myPropsSection) {
          myPropsSection.style.display = 'none';
        }
        log(`Deleted from library: ${propAsset.name}`);
      } catch (err) {
        logError(`Delete failed: ${err.message}`);
      }
    });

    row.appendChild(nameSpan);
    row.appendChild(deleteBtn);
    myPropsList.appendChild(row);
    if (myPropsSection) myPropsSection.style.display = '';
    return row;
  }

  // Populate the cloud library asynchronously without blocking event-handler
  // setup below — built-in props are usable immediately; library entries
  // appear incrementally as their signed URLs resolve. No-op for guests
  // (listPropAssets returns []).
  async function loadCloudLibrary() {
    const projectId = getActiveProjectIdSync();
    if (!projectId) return;
    const propAssets = await listPropAssets(projectId);
    if (!propAssets.length) return;
    const customGroup = ensureCustomOptgroup();
    for (const propAsset of propAssets) {
      try {
        const url = await getAssetSignedUrl(propAsset.assetId);
        propManager.registerCloudPropAsset(propAsset, url);
        if (!customGroup.querySelector(`option[value="custom_${propAsset.name}"]`)) {
          const opt = document.createElement('option');
          opt.value = `custom_${propAsset.name}`;
          opt.textContent = propAsset.name;
          customGroup.appendChild(opt);
        }
        addLibraryRow(propAsset);
      } catch (err) {
        logError(`Failed to load prop "${propAsset.name}": ${err.message}`);
      }
    }
  }
  loadCloudLibrary().catch(err => logError(`Library load failed: ${err.message}`));

  addPropBtn?.addEventListener('click', async () => {
    const propId = propsSelect.value;
    if (!propId) return;
    const target = cameraManager.getControls().target;
    await propManager.addProp(propId, { x: target.x, y: target.y, z: target.z });
    propsSelect.value = '';
    pushSceneHistory(`Added prop: ${propId}`);
  });

  importPropBtn?.addEventListener('click', () => propFileInput?.click());

  propFileInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const customId = await propManager.uploadCustomProp(file);
    if (!customId) { propFileInput.value = ''; return; }
    const name = customId.replace('custom_', '');

    // Cloud users: also push to the backend library so the prop persists
    // across sessions and devices. Guest users get a no-op (null returned).
    let propAsset = null;
    try {
      const projectId = getActiveProjectIdSync();
      propAsset = await uploadPropAsset(projectId, name, file);
    } catch (err) {
      logError(`Library upload failed (kept locally): ${err.message}`);
    }
    if (propAsset) {
      const entry = propManager.customProps.get(name);
      if (entry) entry.propAssetId = propAsset.id;
      addLibraryRow(propAsset);
    }

    // Add to dropdown so the new prop appears
    const customGroup = ensureCustomOptgroup();
    const opt = document.createElement('option');
    opt.value = customId;
    opt.textContent = name;
    customGroup.appendChild(opt);

    // Select it in dropdown and add to scene
    propsSelect.value = customId;
    const target = cameraManager.getControls().target;
    await propManager.addProp(customId, { x: target.x, y: target.y, z: target.z });
    pushSceneHistory(`Imported prop: ${name}`);
    propFileInput.value = '';
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

  // Sketchfab import
  const sketchfabModal = new SketchfabModal(sketchfabAPI, {
    onImportProp: async (uid, name) => {
      // 1. Get download URLs from Sketchfab
      const downloads = await sketchfabAPI.getDownloadUrls(uid);
      const info = downloads.glb ?? downloads.gltf ?? downloads.source;
      if (!info?.url) throw new Error('No downloadable format available for this model.');

      // 2. Fetch the ZIP/GLB
      const zipData = await sketchfabAPI.fetchZip(info.url);

      // 3. Extract GLB/GLTF and get a blob URL
      const blobUrl = await extractModelFromZip(zipData);

      // 4. Register as a custom prop keyed by UID so it can be re-downloaded on reload
      const propId = propManager.registerBlobProp(`sketchfab_${uid}`, blobUrl, 'gltf', uid, name);
      const target   = cameraManager.getControls().target;
      await propManager.addProp(propId, { x: target.x, y: target.y, z: target.z });

      // 5. Add to dropdown under "Sketchfab" group
      let sfGroup = propsSelect.querySelector('optgroup[label="Sketchfab"]');
      if (!sfGroup) {
        sfGroup = document.createElement('optgroup');
        sfGroup.label = 'Sketchfab';
        propsSelect.appendChild(sfGroup);
      }
      const opt = document.createElement('option');
      opt.value = propId;
      opt.textContent = name;
      sfGroup.appendChild(opt);

      pushSceneHistory(`Imported Sketchfab prop: ${name}`);
    },
  });

  document.getElementById('sketchfab-prop-btn')?.addEventListener('click', () => sketchfabModal.open());
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

  btnSnap?.addEventListener('click', () => {
    tfSnapOn = !tfSnapOn;
    propManager.setSnapEnabled(tfSnapOn, gridSnapStep());
    btnSnap.classList.toggle('tf-btn--active', tfSnapOn);
  });

  // ── Edit-mode lock ──────────────────────────────────────────────
  const btnEditMode   = document.getElementById('tf-editmode');
  const toolbar       = document.getElementById('transform-toolbar');
  let editModeOn = true; // starts enabled (matches current default)

  function applyEditMode(on) {
    editModeOn = on;
    propManager.setEditMode(on);
    btnEditMode?.classList.toggle('tf-btn--active', on);
    toolbar?.classList.toggle('tf-locked', !on);
  }

  btnEditMode?.addEventListener('click', () => applyEditMode(!editModeOn));
  applyEditMode(true); // sync PropManager state with the button's default active state

  // ── Measure unit (cm / in) ───────────────────────────────────
  function applyMeasureUnit(unit) {
    measureUnit = unit;
    propManager.setMeasureUnit(unit);

    const gridSizeInput  = document.getElementById('grid-size-input');
    const gridSizeLabel  = document.getElementById('grid-size-unit-label');

    // Keep the same display number but re-interpret it in the new unit.
    // e.g. "10 cm" → "10 in": each cell now represents 1 inch = 2.54 Three.js units.
    const displayVal = parseFloat(gridSizeInput?.value) || 10;
    tfGridCfg.size = unit === 'in' ? displayVal * 2.54 : displayVal;

    if (gridSizeLabel) gridSizeLabel.textContent = unit === 'in' ? 'in' : 'cm';

    document.getElementById('unit-cm')?.classList.toggle('unit-btn--active', unit === 'cm');
    document.getElementById('unit-in')?.classList.toggle('unit-btn--active', unit === 'in');

    rebuildGrid();
    if (tfSnapOn) propManager.setSnapEnabled(true, gridSnapStep());
  }

  document.getElementById('unit-cm')?.addEventListener('click', () => applyMeasureUnit('cm'));
  document.getElementById('unit-in')?.addEventListener('click', () => applyMeasureUnit('in'));

  // ── Dimension label toggle + settings popup ──────────────────
  const btnDimensions  = document.getElementById('tf-dimensions');
  const btnDimSettings = document.getElementById('tf-dim-settings');
  const dimPopup       = document.getElementById('dim-settings-popup');
  let dimLabelsOn = true;

  btnDimensions?.addEventListener('click', () => {
    dimLabelsOn = !dimLabelsOn;
    propManager.setShowLabels(dimLabelsOn);
    btnDimensions.classList.toggle('tf-btn--active', dimLabelsOn);
  });

  btnDimSettings?.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = dimPopup?.style.display !== 'none';
    if (dimPopup) dimPopup.style.display = open ? 'none' : 'block';
    btnDimSettings.classList.toggle('tf-btn--active', !open);
  });

  document.addEventListener('click', (e) => {
    if (dimPopup && dimPopup.style.display !== 'none' &&
        !dimPopup.contains(e.target) && e.target !== btnDimSettings) {
      dimPopup.style.display = 'none';
      btnDimSettings?.classList.remove('tf-btn--active');
    }
  });

  // Label style: Default vs Parallel
  const btnStyleDefault  = document.getElementById('dim-style-default');
  const btnStyleParallel = document.getElementById('dim-style-parallel');

  function applyLabelStyle(parallel) {
    propManager.setLabelsParallel(parallel);
    btnStyleDefault?.classList.toggle('unit-btn--active', !parallel);
    btnStyleParallel?.classList.toggle('unit-btn--active', parallel);
  }

  btnStyleDefault?.addEventListener('click',  () => applyLabelStyle(false));
  btnStyleParallel?.addEventListener('click', () => applyLabelStyle(true));

  // ── Grid toggle (on/off) — settings wiring is in Controls.js ────
  const btnGrid = document.getElementById('tf-grid');
  btnGrid?.addEventListener('click', () => {
    tfGridOn = !tfGridOn;
    rebuildGrid();
    btnGrid.classList.toggle('tf-btn--active', tfGridOn);
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

// Re-downloads and registers any Sketchfab props found in a props array before loading.
// Must be called before propManager.loadSceneData() so blob URLs are available.
async function ensureSketchfabPropsRegistered(propsData) {
  const sfProps = (propsData ?? []).filter(p => p.sketchfabUid);
  for (const p of sfProps) {
    const uid  = p.sketchfabUid;
    const key  = `sketchfab_${uid}`;
    if (propManager.customProps.has(key)) continue; // already registered this session
    try {
      const downloads = await sketchfabAPI.getDownloadUrls(uid);
      const info = downloads.glb ?? downloads.gltf ?? downloads.source;
      if (!info?.url) throw new Error('No download URL');
      const zipData = await sketchfabAPI.fetchZip(info.url);
      const blobUrl = await extractModelFromZip(zipData);
      propManager.registerBlobProp(key, blobUrl, 'gltf', uid, p.displayName ?? null);
    } catch (e) {
      log(`Could not restore Sketchfab prop "${p.displayName ?? uid}": ${e.message}`, true);
    }
  }
}

// loadSceneSetup — restores a full saved scene (env, props, model+transform, camera)
// Camera is restored INSIDE the model onLoaded callback so it runs after centerAndFrameModel.
async function loadSceneSetup(sceneData) {
  // 1. Restore environment
  if (sceneData.environment?.hdr) {
    const sel = document.getElementById('environment-select');
    if (sel) { sel.value = sceneData.environment.hdr; syncEnvCards(sceneData.environment.hdr); }
    loadScene(sceneData.environment.hdr, (name, texture) => {
      currentEnvTexture = texture;
      currentEnvironment = name;
      sceneManager.setEnvironment(texture);
      applyBackground();
      log(`Scene: ${name}`);
    });
  }

  // 2. Restore props (re-download any Sketchfab props first)
  if (sceneData.props) {
    await ensureSketchfabPropsRegistered(sceneData.props);
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
    if (envSel) { envSel.value = defaultEnv.label; syncEnvCards(defaultEnv.label); }
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
  if (bgSelect)     { bgSelect.value = ''; syncBgCards(''); }
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
    sceneSelect.innerHTML = '<option value="default">Default (no props)</option>';
    const projectId = getActiveProjectIdSync();
    if (!projectId) return;
    const names = await listSceneNames(projectId);
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
    if (value === 'default') { propManager.clearAllProps(); return; }
    if (!value.startsWith('custom:')) return;
    const projectId = getActiveProjectIdSync();
    const sceneData = await loadSceneRecord(projectId, value.replace('custom:', ''));
    if (sceneData) await loadSceneSetup(sceneData);
  });

  saveSceneBtn?.addEventListener('click', async () => {
    const name = prompt('Enter scene name:');
    if (!name?.trim()) return;
    const projectId = getActiveProjectIdSync();
    const cam    = cameraManager.getCamera();
    const orbit  = cameraManager.getControls();
    const sceneData = {
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
    };
    await persistScene(projectId, { name: name.trim(), sceneData });
    await populateScenesDropdown();
    log(`Scene saved: ${name.trim()}`);
  });

  exportSceneBtn?.addEventListener('click', async () => {
    const value = sceneSelect?.value;
    if (!value?.startsWith('custom:')) { log('Select a scene to export'); return; }
    const projectId = getActiveProjectIdSync();
    const name = value.replace('custom:', '');
    const scene = await loadSceneRecord(projectId, name);
    if (!scene) { logError(`Scene not found: ${name}`); return; }
    const exportPayload = { ...scene, exportedAt: Date.now(), exportVersion: 1 };
    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.renderdeck-scene.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  importSceneBtn?.addEventListener('click', () => sceneFileInput?.click());
  sceneFileInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const projectId = getActiveProjectIdSync();
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.name) throw new Error('Invalid scene file: missing name');
      const existing = await loadSceneRecord(projectId, data.name);
      if (existing && !confirm(`Scene "${data.name}" already exists. Overwrite?`)) {
        return;
      }
      await persistScene(projectId, {
        name: data.name,
        sceneData: {
          environment: data.environment,
          props:       data.props,
          camera:      data.camera,
          model:       data.model || null,
        },
      });
      await populateScenesDropdown();
      log(`Scene imported: ${data.name}`);
    } catch (err) { logError(`Scene import failed: ${err.message}`); }
    sceneFileInput.value = '';
  });

  clearScenesBtn?.addEventListener('click', async () => {
    if (!confirm('Delete all custom scenes? This cannot be undone!')) return;
    const projectId = getActiveProjectIdSync();
    const names = await listSceneNames(projectId);
    for (const name of names) {
      await removeScene(projectId, name);
    }
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
    if (propManager.hasOutlines()) propManager.updateOutlines(performanceModeEnabled);
    rendererManager.render(sceneManager.getScene(), cameraManager.getCamera());
    _renderBurst--;
  }
}
// Restore renderer state from the last session (sync localStorage read) before
// building the composer, so only the passes the user had enabled get compiled.
try {
  const raw = localStorage.getItem(sessionBootKey(getActiveProjectIdSync()));
  if (raw) {
    const boot = JSON.parse(raw);
    if (boot?.rendererState) rendererManager.restoreState(boot.rendererState);
  }
} catch (_) { /* ignore malformed/blocked localStorage */ }

animate();

// Pre-build the EffectComposer with only the restored passes and compile
// their shaders before the first rendered frame.
rendererManager.initComposer(sceneManager.getScene(), cameraManager.getCamera());

//═══════════════════════════════════════════════════════════════
// VALUE-INPUT SPINNER ARROWS
//═══════════════════════════════════════════════════════════════

function setupValueInputSpinners() {
  const upSVG = '<svg viewBox="0 0 10 6"><path d="M1 5L5 1L9 5" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>';
  const downSVG = '<svg viewBox="0 0 10 6"><path d="M1 1L5 5L9 1" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>';

  document.querySelectorAll('input.value-input[type="number"]').forEach(input => {
    if (input.closest('.value-input-wrap')) return;

    const wrap = document.createElement('div');
    wrap.className = 'value-input-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    const arrows = document.createElement('div');
    arrows.className = 'value-input-arrows';

    const btnUp = document.createElement('button');
    btnUp.className = 'value-input-arrow';
    btnUp.innerHTML = upSVG;
    btnUp.tabIndex = -1;
    btnUp.type = 'button';

    const btnDown = document.createElement('button');
    btnDown.className = 'value-input-arrow';
    btnDown.innerHTML = downSVG;
    btnDown.tabIndex = -1;
    btnDown.type = 'button';

    arrows.appendChild(btnUp);
    arrows.appendChild(btnDown);
    wrap.appendChild(arrows);

    const inputStep = input.step && input.step !== 'any' ? parseFloat(input.step) : null;

    function getStep(val) {
      if (inputStep) return inputStep;
      const s = val.replace(/^-/, '');
      const dot = s.indexOf('.');
      if (dot === -1) return 1;
      const decimals = s.length - dot - 1;
      return Math.pow(10, -decimals);
    }

    function getDecimals(delta) {
      const s = String(delta);
      const dot = s.indexOf('.');
      return dot === -1 ? 0 : s.length - dot - 1;
    }

    function step(dir) {
      const raw = input.value || '0';
      const current = parseFloat(raw);
      if (isNaN(current)) return;
      const delta = getStep(raw);
      let next = current + delta * dir;
      const decimals = Math.max(getDecimals(delta), (raw.indexOf('.') !== -1) ? raw.replace(/^-/, '').split('.')[1].length : 0);
      next = parseFloat(next.toFixed(decimals));
      const min = input.min !== '' ? parseFloat(input.min) : -Infinity;
      const max = input.max !== '' ? parseFloat(input.max) : Infinity;
      next = Math.max(min, Math.min(max, next));
      input.value = decimals > 0 ? next.toFixed(decimals) : String(next);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    btnUp.addEventListener('mousedown', e => { e.preventDefault(); step(1); });
    btnDown.addEventListener('mousedown', e => { e.preventDefault(); step(-1); });
  });
}

//═══════════════════════════════════════════════════════════════
// DEBUG INSPECTOR
//═══════════════════════════════════════════════════════════════

function _dbgBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(2) + ' MB';
}

function _dbgFmtVal(val) {
  if (val === null || val === undefined) return '<span class="dbg-val-null">null</span>';
  if (typeof val === 'boolean') return `<span class="dbg-val-bool">${val}</span>`;
  if (typeof val === 'number')  return `<span class="dbg-val-num">${Number.isInteger(val) ? val : val.toFixed(4)}</span>`;
  if (typeof val === 'object')  return `<span class="dbg-val-obj">{…}</span>`;
  const s = String(val);
  // hex color swatch
  if (/^#[0-9a-fA-F]{6}$/.test(s)) {
    return `<span class="dbg-color-swatch" style="background:${s}"></span><span class="dbg-val-str">${s}</span>`;
  }
  const display = s.length > 72 ? s.slice(0, 69) + '…' : s;
  return `<span class="dbg-val-str" title="${s.replace(/"/g,'&quot;')}">${display}</span>`;
}

function _dbgKVRows(obj) {
  if (!obj || typeof obj !== 'object') return '<div class="dbg-empty">—</div>';
  return '<div class="dbg-kv">' +
    Object.entries(obj).map(([k, v]) =>
      `<div class="dbg-row"><span class="dbg-key">${k}</span><span class="dbg-val">${_dbgFmtVal(v)}</span></div>`
    ).join('') +
  '</div>';
}

async function refreshDebugPanel() {

  // ── Active model ──────────────────────────────────────────────
  const modelEl    = document.getElementById('dbg-model-table');
  const modelBadge = document.getElementById('dbg-model-badge');
  if (modelEl) {
    let meshCount = 0, vertCount = 0, triCount = 0;
    if (activeModel) {
      activeModel.traverse(c => {
        if (!c.isMesh) return;
        meshCount++;
        const pos = c.geometry?.attributes?.position;
        if (pos) vertCount += pos.count;
        const idx = c.geometry?.index;
        triCount += idx ? idx.count / 3 : (pos ? pos.count / 3 : 0);
      });
    }
    if (modelBadge) modelBadge.textContent = activeModel ? activeModel.name || 'unnamed' : 'none';
    modelEl.innerHTML = _dbgKVRows({
      name:         activeModel?.name             ?? null,
      meshCount:    activeModel ? meshCount        : null,
      vertices:     activeModel ? vertCount        : null,
      triangles:    activeModel ? Math.round(triCount) : null,
      activeMesh:   activeMesh?.name              ?? null,
      material:     activeMesh?.material?.name    ?? null,
      transmission: activeMesh?.material?.transmission ?? null,
      metalness:    activeMesh?.material?.metalness    ?? null,
      roughness:    activeMesh?.material?.roughness    ?? null,
    });
  }

  // ── Session state (IDB) ───────────────────────────────────────
  const sessionEl = document.getElementById('dbg-session-table');
  if (sessionEl) {
    try {
      const s = await IDBStorage.get('metadata', sessionStorageKey(getActiveProjectIdSync()));
      sessionEl.innerHTML = s ? _dbgKVRows({
        version:            s.version,
        savedAt:            s.savedAt ? new Date(s.savedAt).toLocaleString() : null,
        modelName:          s.modelName,
        partName:           s.partName,
        sceneName:          s.sceneName,
        activeCustomScene:  s.activeCustomScene,
        materialPreset:     s.materialPreset,
        isCustomMaterial:   s.isCustomMaterial,
        showEnvBackground:  s.showEnvBackground,
        gradientBgEnabled:  s.gradientBgEnabled,
        currentGradientBg:  s.currentGradientBg,
        hasMaterialProps:   !!s.materialProperties,
        channelMapCount:    Object.keys(s.materialProperties?.channelMaps ?? {}).length,
        hasUVEditor:        !!s.uvEditor,
        propCount:          s.props?.length ?? 0,
        hasRendererState:   !!s.rendererState,
        'cam.type':         s.camState?.type,
        'cam.focalLength':  s.camState?.focalLength,
        'cam.toneMapping':  s.camState?.toneMapping,
        'cam.dofEnabled':   s.camState?.dofEnabled,
      }) : '<div class="dbg-empty">No session state in IDB</div>';
    } catch (e) {
      sessionEl.innerHTML = `<div class="dbg-error">${e.message}</div>`;
    }
  }

  // ── Camera state ──────────────────────────────────────────────
  const cameraEl = document.getElementById('dbg-camera-table');
  if (cameraEl) cameraEl.innerHTML = _dbgKVRows(camState);

  // ── Renderer / post-FX state ──────────────────────────────────
  const rendererEl = document.getElementById('dbg-renderer-table');
  if (rendererEl) {
    const rs = rendererManager.getState();
    rendererEl.innerHTML = _dbgKVRows({
      postFXEnabled:           rs.postFXEnabled,
      aaMode:                  rs.aaMode,
      bloomEnabled:            rs.bloomEnabled,
      vignetteEnabled:         rs.vignetteEnabled,
      ssaoEnabled:             rs.ssaoEnabled,
      motionBlurEnabled:       rs.motionBlurEnabled,
      'bloom.strength':        rs.params.bloom.strength,
      'bloom.radius':          rs.params.bloom.radius,
      'bloom.threshold':       rs.params.bloom.threshold,
      'vignette.intensity':    rs.params.vignette.intensity,
      'vignette.softness':     rs.params.vignette.softness,
      'vignette.color':        rs.params.vignette.color,
      'vignette.blendMode':    rs.params.vignette.blendMode,
      'ssao.intensity':        rs.params.ssao.intensity,
      'ssao.radius':           rs.params.ssao.radius,
      'motionBlur.strength':   rs.params.motionBlur.strength,
    });
  }

  // ── Thumbnail cache ───────────────────────────────────────────
  const thumbGrid  = document.getElementById('dbg-thumb-grid');
  const thumbBadge = document.getElementById('dbg-thumb-badge');
  if (thumbGrid) {
    if (thumbBadge) thumbBadge.textContent = `${_matThumbCache.size} cached`;
    thumbGrid.innerHTML = _matThumbCache.size === 0
      ? '<div class="dbg-empty">No thumbnails in memory</div>'
      : [..._matThumbCache.entries()].map(([name, url]) =>
          `<div class="dbg-thumb-item">
            <img src="${url}" class="dbg-thumb-img" title="${name}">
            <div class="dbg-thumb-label">${name}</div>
          </div>`
        ).join('');
  }

  // ── Active channel maps ───────────────────────────────────────
  const channelsEl    = document.getElementById('dbg-channels-table');
  const channelsBadge = document.getElementById('dbg-channels-badge');
  if (channelsEl) {
    if (channelsBadge) channelsBadge.textContent = `${_channelMapData.size} active`;
    if (_channelMapData.size === 0) {
      channelsEl.innerHTML = '<div class="dbg-empty">No channel maps loaded</div>';
    } else {
      channelsEl.innerHTML = '<div class="dbg-kv">' +
        [..._channelMapData.entries()].map(([key, dataUrl]) => {
          const bytes = _dbgBytes(Math.round(dataUrl.length * 0.75));
          const fmt   = dataUrl.slice(5, dataUrl.indexOf(';')) || 'unknown';
          return `<div class="dbg-row">
            <span class="dbg-key">${key}</span>
            <span class="dbg-val">
              <img src="${dataUrl}" class="dbg-channel-preview">
              <span class="dbg-val-num">${bytes}</span>
              <span class="dbg-val-null"> · ${fmt}</span>
            </span>
          </div>`;
        }).join('') +
      '</div>';
    }
  }

  // ── IndexedDB inspector ───────────────────────────────────────
  const idbEl = document.getElementById('dbg-idb-content');
  if (idbEl) {
    try {
      const [modelKeys, blobKeys, metaKeys] = await Promise.all([
        IDBStorage.getAllKeys('models'),
        IDBStorage.getAllKeys('blobs'),
        IDBStorage.getAllKeys('metadata'),
      ]);
      const thumbKeys = blobKeys.filter(k => k.startsWith('thumb:'));
      const otherBlob = blobKeys.filter(k => !k.startsWith('thumb:'));

      const storeBlock = (name, badge, rows) =>
        `<div class="dbg-idb-store">
          <div class="dbg-store-header">
            <span class="dbg-store-name">${name}</span>
            <span class="dbg-badge dbg-badge-idb">${badge}</span>
          </div>
          ${rows}
        </div>`;

      const keyRows = (keys, valLabel) => keys.length
        ? '<div class="dbg-kv">' + keys.map(k =>
            `<div class="dbg-row">
              <span class="dbg-key">${k}</span>
              <span class="dbg-val dbg-val-null">${valLabel}</span>
            </div>`).join('') + '</div>'
        : '<div class="dbg-empty">empty</div>';

      idbEl.innerHTML =
        storeBlock('models', `${modelKeys.length} entries`,
          keyRows(modelKeys, 'custom model binary')) +
        storeBlock('blobs', `${blobKeys.length} entries`,
          `<div class="dbg-store-subheader">material thumbnails (${thumbKeys.length})</div>` +
          keyRows(thumbKeys, 'dataURL · 64×64 PNG') +
          `<div class="dbg-store-subheader">other blobs (${otherBlob.length})</div>` +
          keyRows(otherBlob, 'blob')) +
        storeBlock('metadata', `${metaKeys.length} entries`,
          keyRows(metaKeys, 'JSON'));
    } catch (e) {
      idbEl.innerHTML = `<div class="dbg-error">${e.message}</div>`;
    }
  }

  // ── LocalStorage ──────────────────────────────────────────────
  const lsEl = document.getElementById('dbg-ls-table');
  if (lsEl) {
    const LS_KEYS = [
      { key: sessionBootKey(getActiveProjectIdSync()), label: 'session:boot (active project)' },
      { key: 'rd_user_presets',             label: 'rd_user_presets' },
      { key: 'rd_hidden_presets',           label: 'rd_hidden_presets' },
      { key: 'renderdeck_sketchfab_token',  label: 'renderdeck_sketchfab_token', mask: true },
    ];
    lsEl.innerHTML = '<div class="dbg-kv">' +
      LS_KEYS.map(({ key, label, mask }) => {
        const raw = localStorage.getItem(key);
        let display;
        if (raw === null) {
          display = '<span class="dbg-val-null">not set</span>';
        } else if (mask) {
          display = `<span class="dbg-val-str">${raw.slice(0, 8)}… <span class="dbg-val-null">(${_dbgBytes(raw.length)})</span></span>`;
        } else {
          let parsed = null;
          try { parsed = JSON.parse(raw); } catch (_) {}
          const size = _dbgBytes(raw.length);
          if (parsed && typeof parsed === 'object') {
            const count = Array.isArray(parsed) ? `${parsed.length} items` : `${Object.keys(parsed).length} keys`;
            display = `<span class="dbg-val-obj">${count} <span class="dbg-val-null">· ${size}</span></span>`;
          } else {
            display = `<span class="dbg-val-str">${size}</span>`;
          }
        }
        return `<div class="dbg-row"><span class="dbg-key">${label}</span><span class="dbg-val">${display}</span></div>`;
      }).join('') +
    '</div>';
  }
}

function setupDebugPanel() {
  document.getElementById('dbg-refresh-btn')?.addEventListener('click', refreshDebugPanel);
  // Auto-refresh when the debug tab is opened
  document.querySelector('button[title="Debug"]')
    ?.addEventListener('click', () => setTimeout(refreshDebugPanel, 60));
}

//═══════════════════════════════════════════════════════════════
// INITIAL SETUP
//═══════════════════════════════════════════════════════════════

// Saved camera from the last session, used to skip centerAndFrameModel on boot.
let _bootCamera = null;

// ─── Auth header (Phase 2 bootstrap) ──────────────────────────────────────────
// Renders Login/Sign Up vs Log Out based on Supabase session, and reloads the
// page on any auth state change for a clean transition. Cloud-aware data
// loading (project list, materials, etc.) is Phase 3 — until then a logged-in
// user still sees their guest IDB workspace; only the header reflects auth.
async function setupAuthHeader() {
  initAuth();

  const guestBtns = document.getElementById('auth-buttons-guest');
  const userBtns  = document.getElementById('auth-buttons-user');
  const emailSpan = document.getElementById('auth-user-email');
  const logoutBtn = document.getElementById('auth-logout-btn');
  if (!guestBtns || !userBtns || !logoutBtn) return;

  function render(user) {
    const loggedIn = !!user;
    guestBtns.style.display = loggedIn ? 'none' : 'flex';
    userBtns.style.display  = loggedIn ? 'flex' : 'none';
    emailSpan.textContent   = loggedIn ? (user.email || '') : '';
  }

  render(await getUser());

  onAuthChange((event) => {
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
      clearSignedUrls();
      location.reload();
    }
  });

  logoutBtn.addEventListener('click', async () => {
    try { await signOut(); }
    catch (err) { console.error('Sign out failed:', err); }
    // onAuthChange will fire SIGNED_OUT and reload us.
  });
}

async function initializeApp() {
  // Render auth header as early as possible so the Log Out button appears
  // immediately for logged-in users. Doesn't block the rest of bootstrap.
  setupAuthHeader();

  // Resolve the active project up front. Cloud users need this BEFORE any
  // project-keyed reads below (session boot, scene dropdown, model list,
  // material presets) — otherwise those would call the backend with a
  // stale guest UUID and 404. setActiveProjectId writes the localStorage
  // mirror synchronously so getActiveProjectIdSync sees it immediately.
  const activeProject = await ensureActiveProject();

  // Fast path: preload last edited model immediately (sync localStorage read).
  try {
    const raw = localStorage.getItem(sessionBootKey(getActiveProjectIdSync()));
    if (raw) {
      const boot = JSON.parse(raw);
      const bootName = boot?.modelName;
      if (boot?.camera) _bootCamera = boot.camera;
      if (bootName) {
        const modelSel = document.getElementById('object-select') || document.getElementById('model-select');
        if (modelSel) modelSel.value = bootName;
        loadModel(bootName);
      }
    }
  } catch (_) {
    // ignore malformed/blocked localStorage
  }

  // Load persisted thumbnails before building the preset list so they appear
  // immediately without waiting for warmupAndGenerateThumbnails to re-render them.
  await loadCachedThumbnails();

  await materialPresetsReady;
  warmupAndGenerateThumbnails();
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
  setupValueInputSpinners();
  setupDebugPanel();
  initDebugPanelWidth();
  initObjectPropsTabs();

  // Apply initial renderer tone mapping
  rendererManager.getRenderer().toneMapping = THREE.ACESFilmicToneMapping;
  rendererManager.getRenderer().toneMappingExposure = 1.0;

  // Active project was resolved at the top of this function; now wire the
  // header button and load project-scoped material data.
  const projectBtn = document.getElementById('project-btn');
  if (projectBtn && activeProject) {
    projectBtn.querySelector('#project-name').textContent = activeProject.name;
    projectBtn.addEventListener('click', async () => {
      await _saveThumbnailToProject(activeProject.id);
      window.location.href = 'projects.html';
    });
  }
  // Reload material presets now that the active project ID is confirmed
  materialManager.reloadUserPresetsForProject(activeProject.id);
  // Load preset channel maps from IDB (too large for localStorage)
  await loadPresetChannelMapsFromIDB(activeProject.id);

  const restored = await restoreSessionState();
  if (!restored && STANDARD_OBJECTS.length > 0) {
    setTimeout(() => loadModel(STANDARD_OBJECTS[0].label), 100);
  }

  // Let the restored frame render, then fade out the loading overlay
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
      overlay.classList.add('fade-out');
      overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
    }
  }));

  // ── Half-res orbit performance mode ──────────────────────────
  const orbitControls = cameraManager.getControls();
  if (orbitControls) {
    orbitControls.addEventListener('start', () => {
      _isOrbiting = true;
      if (performanceModeEnabled) rendererManager.enterOrbitPerfMode();
    });
    orbitControls.addEventListener('end', () => {
      _isOrbiting = false;
      rendererManager.exitOrbitPerfMode();
    });
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


