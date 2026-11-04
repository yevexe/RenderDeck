import { restoreControlPreferences, bindControlPreferences } from '../ui/panels/ControlPreferences.js';
import { loadNodeGraphs, saveNodeGraph } from '../storage/NodeGraphStorage.js';
// MAIN.JS - Application Orchestrator

import * as THREE from 'three';

// Core
import { SceneManager } from '../engine/Scene.js';
import { RendererManager } from '../engine/Renderer.js';
import { CameraManager } from '../engine/Camera.js';
import { markNeedsRender, getRenderBurst, ensureRenderBurst, consumeRenderBurst } from '../engine/renderRequest.js';
import { applyTexQuality, setTextureQualityRenderer } from '../engine/textureQuality.js';
import { setupButtonRow as setupButtonRowImpl } from '../ui/widgets/buttonRow.js';
import { setupValueInputSpinners } from '../ui/widgets/valueSpinners.js';
import { setupDebugPanel } from '../ui/panels/debugPanel.js';
import { setupPostProcessingPanel } from '../ui/panels/postProcessingPanel.js';
import { setupCameraPanel } from '../ui/panels/cameraPanel.js';
import { setupExportPanel } from '../ui/panels/exportPanel.js';
import { setupEnvironmentPanel } from '../ui/panels/environmentPanel.js';
import { setupSavedScenesPanel } from '../ui/panels/savedScenesPanel.js';
import { handleGridChange, setupPreviewQualityPanel } from '../ui/panels/previewQualityPanel.js';
import { setupPropsPanel } from '../ui/panels/propsPanel.js';
import { setupMaterialsPanel } from '../ui/panels/materialsPanel.js';
import { setupModelPanel } from '../ui/panels/modelPanel.js';
import { setupModelLibraryPanel } from '../ui/panels/modelLibraryPanel.js';
import { createViewportSelection } from '../ui/panels/viewportSelection.js';
import { setupDragAndDrop } from '../ui/panels/dragAndDrop.js';

import { MaterialManager } from '../domain/materials/MaterialManager.js';
import { MaterialLibrary, textureToDataURL } from '../domain/materials/MaterialLibrary.js';
import { ModelManager } from '../domain/models/ModelManager.js';
import { createModelLoading } from '../domain/models/modelLoading.js';
import { createDesignLayers } from '../ui/designEditor/designLayers.js';

import { UVEditor } from '../ui/designEditor/UVEditor.js';
import { ControlsManager } from '../ui/panels/ControlsManager.js';
import { CompactColorPicker } from '../ui/widgets/CompactColorPicker.js';
import { initDebugPanelWidth, initObjectPropsTabs } from '../ui/panels/panelLayout.js';
import { NodeEditorManager } from '../ui/nodeEditor/NodeEditorManager.js';
import * as IDBStorage from '../storage/indexedDBStorage.js';
import {
  partMaterialKey, sessionKey, designMetaKey, designBlobKey, designBlobPartPrefix, designThumbKey,
  materialThumbKey, materialThumbPrefix, partMaterialPrefix,
  APP_SETTINGS_KEY, projectSettingsKey,
} from '../storage/storageKeys.js';
import { scheduleWrite, flushWrites, getFailedWrites, retryFailedWrites, onWriteStateChange, getWriteState, cancelWrite, cancelWritesWithPrefix, cancelAllWrites } from '../storage/pendingWrites.js';
import { loadAppSettings, loadProjectSettings, setAppSetting } from '../storage/SettingsStorage.js';
import { runMigrations } from '../storage/migrations.js';
import { migrateMaterialLibrary } from '../domain/materials/materialLibraryMigration.js';

// Utils
import { log, logError, logSuccess, logWarn } from '../utils/logger.js';

import { cleanupObject } from '../utils/helpers.js';

// Sketchfab integration
import { SketchfabAPI }    from '../io/sketchfab/SketchfabAPI.js';
import { extractModelFromZip } from '../io/sketchfab/SketchfabLoader.js';

// Config
import { STANDARD_OBJECTS, STANDARD_MATERIALS, STANDARD_ENVIRONMENTS } from '../config.js';

// Props
import { PropManager } from '../domain/props/PropManager.js';
import { CustomSceneStorage } from '../storage/CustomSceneStorage.js';
import { ensureActiveProject, getActiveProject, getActiveProjectIdSync, updateProject } from '../storage/ProjectStorage.js';

// Export
import { exportModelData, exportSingleModel, importCustomModels } from '../io/files/customModelFile.js';

// Scenes
import { initEnvironments, loadEnvironment, getEnvironmentNames } from '../domain/scenes/EnvironmentLoader.js';

export function startup({ appState, createHistory, createProjectSettings, startRenderLoop }) {
IDBStorage.startPersistentStorageRequests();

//═══════════════════════════════════════════════════════════════
// INITIALIZATION
//═══════════════════════════════════════════════════════════════

const container = document.getElementById('scene-view-placeholder');

const sceneManager = appState.sceneManager = new SceneManager();
const rendererManager = appState.rendererManager = new RendererManager(container);
setTextureQualityRenderer(rendererManager);
const cameraManager = appState.cameraManager = new CameraManager(container);
cameraManager.setupControls(rendererManager.getDomElement());
const camState = appState.cameraState;
let restoreCameraSettings;

const materialManager = appState.materialManager = new MaterialManager();
const modelManager = appState.modelManager = new ModelManager(log);
// One library per project; holds every material rule. loadProject() runs in initializeApp.
const materialLibrary = new MaterialLibrary(materialManager, {
  standardObjects: STANDARD_OBJECTS,
  loadNativeSources: loadNativeSourcesFromFile,
});
let _resolveLibraryReady;
const materialLibraryReady = new Promise(resolve => { _resolveLibraryReady = resolve; });
modelManager.storage.materialLibrary = materialLibrary;
modelManager.onCatalogAdded = (catalog) => {
  materialLibrary.noteCatalog(catalog);
  updateMaterialPresetList();
  scheduleAllMissingThumbnails();
};

const nodeEditorManager = new NodeEditorManager();
nodeEditorManager.onGraphChanged = (key, graph) => {
  const pid = getActiveProjectIdSync();
  if (!_persistenceReady || !pid) return;
  scheduleWrite(`node:${pid}:${key}`, () => saveNodeGraph(pid, key, graph), { label: 'node graph' });
};
nodeEditorManager.onImageUpload = async (key, graph) => {
  const pid = getActiveProjectIdSync();
  await flushWrites();
  await saveNodeGraph(pid, key, graph);
};
nodeEditorManager.onCollectionsChanged = collections => setAppSetting('nodeCollections', collections);

nodeEditorManager.setMaterialOutputHandler((prop, val) => {
  if (prop === 'map' || prop.endsWith('Map')) {
    // Texture property — load dataUrl as a Three.js texture
    applyNodeEditorTexture(prop, val);
    return; // applyNodeEditorTexture calls markNeedsRender internally
  }
  if (prop === 'attenuationDistance') {
    updateMaterialProperty('attenuationDistance', val === 0 ? Infinity : val);
  } else if (prop === 'iridescenceThicknessRange_min' || prop === 'iridescenceThicknessRange_max') {
    const range = [...(activeMesh?.material?.iridescenceThicknessRange || [100, 400])];
    range[prop.endsWith('_min') ? 0 : 1] = val;
    updateMaterialProperty('iridescenceThicknessRange', range);
  } else {
    updateMaterialProperty(prop, val);
  }
  schedulePartMaterialSave();
  controls.syncOneMaterialProp(prop, val);
  markNeedsRender();
});
document.getElementById('open-node-graph-btn')?.addEventListener('click', () => {
  nodeEditorManager.open();
});
const uvEditor = appState.uvEditor = new UVEditor(rendererManager, log, modelManager, materialManager);
const designLayers = createDesignLayers({
  IDBStorage,
  designMetaKey,
  designBlobKey,
  designBlobPartPrefix,
  designThumbKey,
  getActiveProjectIdSync,
  getCurrentModelName,
  getActiveMesh: () => activeMesh,
  getMeshMap: () => meshMap,
  getUVEditor: () => uvEditor,
  getControls: () => controls,
  scheduleWrite,
  log,
});
// Persist design layers to IDB on every change (debounced per model part)
uvEditor.onLayersSaved((layers) => scheduleDesignLayerSave(layers));
// Undo can change a part other than the active one; keep its cache and saved layers in step
uvEditor.onPartLayersRestored = (mesh, layers) => {
  if (_partCache[mesh.name]) _partCache[mesh.name].overlayImages = layers;
  scheduleDesignLayerSave(layers, mesh.name);
};
uvEditor.commitImageLayer = async layers => {
  const pid = getActiveProjectIdSync(), model = getCurrentModelName(), part = activeMesh.name, parts = Object.keys(meshMap);
  await flushWrites();
  await designLayers.writeDesignLayers(pid, model, part, layers, parts);
};
// Wrap / lock-aspect toggles are UI preferences in settings/${pid}
uvEditor.onPrefsChanged = () => scheduleProjectSettingsSave();

const propManager = appState.propManager = new PropManager(
  sceneManager.getScene(),
  cameraManager.getCamera(),
  rendererManager.getRenderer(),
  cameraManager.getControls(),
  log
);

// Writes of session/settings stay off until startup has applied the stored values
let _persistenceReady = false;
// True once the current load's original materials have been captured

// Props added, moved or removed → the session record (props in scene)
propManager.onChange = () => scheduleSessionSave();

let activeModel = appState.activeModel = null;
let activeMesh = appState.activeMesh = null;
const previewQualityState = appState.previewQuality;
let previewQualityPanel;
let materialsPanel;
let modelPanel;
let viewportSelection;
let modelLoading;
appState.channelMapData = new Map(); // channel → data URL of the active part's material (a view of its definition)
let meshMap = {}; // name → mesh reference for multi‑part models

// Per-part state cache — populated when switching parts so each part's decal overlays
// survive while another part is active. Materials are in the library, per mesh state
// of the design in UVEditor.
// Shape: { [partName]: { overlayImages: [...] } }
let _partCache = {};

// Custom materials as they were when a part loaded, so "Restore Original" can return to them.
const _originalCustomDefinitions = new Map(); // library id → entry snapshot

// ── Performance mode ──────────────────────────────────────────
const HIGH_POLY_THRESHOLD = 100_000; // faces
let _activeModelFaceCount  = 0;
let _isOrbiting = false; // true while OrbitControls drag is active

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

  const physical = new THREE.MeshPhysicalMaterial(props);
  physical.userData = { ...sourceMat.userData }; // keeps the library id
  return physical;
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
let syncBackgroundCards = () => {};
let syncEnvironmentCards = () => {};

const sceneStorage   = new CustomSceneStorage();
const sketchfabAPI   = new SketchfabAPI();

//═══════════════════════════════════════════════════════════════
// STATE EDITORS — three independent undo/redo stacks
//═══════════════════════════════════════════════════════════════

let projectSettings;
function scheduleSessionSave() { return projectSettings?.scheduleSessionSave(); }
function scheduleProjectSettingsSave() { return projectSettings?.scheduleProjectSettingsSave(); }
function scheduleModelTransformSave() { return projectSettings?.scheduleModelTransformSave(); }
function flushAllWrites() { return projectSettings?.flushAllWrites(); }
function restoreProjectSettings(settings) { return projectSettings?.restoreProjectSettings(settings); }
function restorePreviewSettings(settings) { return projectSettings?.restorePreviewSettings(settings); }
function restoreSessionState(state) { return projectSettings?.restoreSessionState(state); }
function modelExists(name) { return projectSettings?.modelExists(name); }

const history = createHistory({
  propManager,
  sceneManager,
  loadEnvironment,
  applyBackground,
  markNeedsRender,
  getEnvironmentState: () => ({ currentEnvironment, currentEnvTexture, showEnvBackground, gradientBgEnabled, currentGradientBg }),
  setEnvironmentState: updates => {
    if ('currentEnvironment' in updates) { currentEnvironment = updates.currentEnvironment; syncEnvironmentCards(currentEnvironment); }
    if ('currentEnvTexture' in updates) currentEnvTexture = updates.currentEnvTexture;
    if ('showEnvBackground' in updates) showEnvBackground = updates.showEnvBackground;
    if ('gradientBgEnabled' in updates) gradientBgEnabled = updates.gradientBgEnabled;
    if ('currentGradientBg' in updates) currentGradientBg = updates.currentGradientBg;
  },
  getCurrentModelName,
  loadModel,
  uvEditor,
  getMaterialsPanel: () => materialsPanel,
  getActiveMesh: () => activeMesh,
  libIdOf,
  scheduleThumbnailUpdate,
  schedulePartMaterialSave,
  scheduleSessionSave,
  scheduleProjectSettingsSave,
  getMeshMap: () => meshMap,
  materialLibrary,
  materialManager,
  logError,
});
const { sceneState, designState, materialState, materialActions, pushSceneHistory } = history;
function setupHistoryUI() { history.setupHistoryUI(scheduleModelTransformSave); }

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

function scheduleDesignLayerSave(layers, partName) {
  return designLayers.scheduleDesignLayerSave(layers, partName);
}

function loadDesignLayersFromCache(pid, modelName, partName) {
  return designLayers.loadDesignLayersFromCache(pid, modelName, partName);
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
  // Every environment/background change passes through here (incl. scene undo)
  scheduleProjectSettingsSave();
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
    syncEnvironmentCards(sceneState.sceneName);
    loadEnvironment(sceneState.sceneName, (name, texture) => {
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
  if (bgSelect && sceneState.currentGradientBg) { bgSelect.value = sceneState.currentGradientBg; syncBackgroundCards(sceneState.currentGradientBg); }
  applyBackground();
}

//═══════════════════════════════════════════════════════════════
// SCENE SETUP
//═══════════════════════════════════════════════════════════════

log('RenderDeck initialized.');

// The first environment is loaded by initializeApp() once settings/${pid} is read,
// so a saved environment doesn't download the default HDR first.
function loadInitialEnvironment(savedName) {
  currentEnvironment = savedName || STANDARD_ENVIRONMENTS[0]?.label;
  const onLoad = (name, texture) => {
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
    syncEnvironmentCards(name);
    const sel = document.getElementById('environment-select');
    if (sel) sel.value = name;
    log(`Scene: ${name}`);
  };
  if (savedName && getEnvironmentNames().includes(savedName)) loadEnvironment(savedName, onLoad);
  else initEnvironments(onLoad);
}

registerBuiltInModels();

function registerBuiltInModels() {
  STANDARD_OBJECTS.forEach(obj => {
    modelManager.registerModel(obj.label, { objPath: obj.objPath, mtlPath: obj.mtlPath });
  });
}

/** Load JSON material presets from assets, then refresh the UI dropdown. */
async function initMaterialPresets() {
  await materialManager.loadPresetsFromManifest(STANDARD_MATERIALS);
}
const materialPresetsReady = initMaterialPresets();

//═══════════════════════════════════════════════════════════════
// MODEL LOADING
//═══════════════════════════════════════════════════════════════

async function readMissingStandardCatalogs() {
  return modelLoading.readMissingStandardCatalogs();
}

async function backfillUploadedCatalogs() {
  return modelLoading.backfillUploadedCatalogs();
}

async function loadNativeSourcesFromFile(objectName) {
  return modelLoading.loadNativeSourcesFromFile(objectName);
}

async function prefetchStandardModels() {
  return modelLoading.prefetchStandardModels();
}

function loadModel(name, onLoaded = null) {
  return modelLoading.loadModel(name, onLoaded);
}

async function _collectModelParts() {
  return modelLoading.collectModelParts();
}

async function _restoreDesignLayersForPart(partName) {
  return modelLoading.restoreDesignLayersForPart(partName);
}

function schedulePartMaterialSave() {
  return modelLoading?.schedulePartMaterialSave();
}

function syncChannelView() {
  return materialsPanel?.syncChannelView();
}

function syncMaterialDropdown() {
  return modelPanel?.syncMaterialDropdown();
}

function syncActiveMaterialView() {
  return materialsPanel?.syncActiveMaterialView();
}

function updatePerfModeUI() {
  return modelPanel?.updatePerfModeUI();
}

function updatePolyWarning(faceCount) {
  return modelPanel?.updatePolyWarning(faceCount);
}

function checkAndApplyPolyPerf(model) {
  return modelPanel?.checkAndApplyPolyPerf(model);
}

function libIdOf(mesh) {
  return mesh?.material?.userData?.libId ?? null;
}

/**
 * Capture the centre square of the current WebGL viewport as a compressed JPEG
 * thumbnail and persist it to the project record in IndexedDB.
 * @returns {Promise<boolean>} whether the thumbnail was saved
 */
async function _saveThumbnailToProject(projectId) {
  try {
    const canvas = rendererManager.getRenderer()?.domElement;
    if (!canvas || !projectId) return false;

    const THUMB_SIZE = 400;
    const side = Math.min(canvas.width, canvas.height);
    const tmp = document.createElement('canvas');
    tmp.width  = THUMB_SIZE;
    tmp.height = THUMB_SIZE;
    tmp.getContext('2d').drawImage(
      canvas,
      (canvas.width - side) / 2, (canvas.height - side) / 2, side, side,
      0, 0, THUMB_SIZE, THUMB_SIZE
    );
    const dataUrl = tmp.toDataURL('image/jpeg', 0.5);

    await updateProject(projectId, { thumbnail: dataUrl });
    return true;
  } catch (err) {
    console.warn('Thumbnail capture failed:', err);
    return false;
  }
}

function cleanupActiveModel() {
  if (activeModel) {
    // Clear every part's design before disposing meshes so its textures and canvases don't leak
    uvEditor.clearAllPartDesigns();
    // Channel view, part cache and file textures belong to the model being unloaded.
    materialsPanel?.clearChannelMapData();
    _partCache = {};
    materialActions.clearPendingOtherPartEdits();
    materialLibrary.releaseSources();

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
    activeModel = appState.activeModel = null;
    activeMesh = appState.activeMesh = null;
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
async function loadCachedThumbnails(pid) {
  return materialsPanel?.loadCachedThumbnails(pid);
}

function getMaterialThumbnail(id) {
  return materialsPanel?.getMaterialThumbnail(id) ?? null;
}

function scheduleThumbnailUpdate(id) {
  return materialsPanel?.scheduleThumbnailUpdate(id);
}

function scheduleAllMissingThumbnails() {
  return materialsPanel?.scheduleAllMissingThumbnails();
}

function updateMaterialPresetList() {
  return materialsPanel?.updateMaterialPresetList();
}

function scheduleMatThumbUpdate(modelName, partName) {
  return materialsPanel?.scheduleMatThumbUpdate(modelName, partName);
}

function clearMaterialThumbnail(id) {
  materialsPanel?.deleteThumbnail(id);
}

async function warmupAndGenerateThumbnails() {
  return materialsPanel?.warmupAndGenerateThumbnails();
}

async function applyMaterialPreset(id, options) {
  return materialsPanel?.applyMaterialPreset(id, options) ?? false;
}

function commitActiveDefinition() {
  return materialsPanel?.commitActiveDefinition();
}

async function setDefinitionChannel(id, channel, value) {
  return materialsPanel?.setDefinitionChannel(id, channel, value) ?? false;
}

async function updateMaterialProperty(property, value) {
  return materialsPanel?.updateMaterialProperty(property, value);
}

function flushOtherPartEdits() {
  return materialsPanel?.flushOtherPartEdits();
}

function scheduleLibraryWrite(id) {
  const pid = getActiveProjectIdSync();
  const entry = materialLibrary.get(id);
  if (!_persistenceReady || !pid || !entry) return;
  scheduleWrite(`material:${pid}:${id}`, () => materialLibrary.persist(id), { label: `material "${entry.name}"` });
}

// Extract material properties with sticker PBR overrides temporarily restored
// so the saved preset reflects real values, not the sticker-overridden ones.
function extractPropertiesForPreset(mat) {
  return uvEditor.withOriginalMaterialValues(activeMesh, () => materialManager.extractProperties(mat));
}


// Called by the node editor when an Image node is wired to a texture port.
// Loads the dataUrl as a Three.js texture, applies it to the material slot,
// then refreshes the Material Editor thumbnails.
async function applyNodeEditorTexture(channel, dataUrl) {
  return materialsPanel?.applyNodeEditorTexture(channel, dataUrl);
}

//═══════════════════════════════════════════════════════════════
// BUTTON-ROW HELPER
//═══════════════════════════════════════════════════════════════

const setupButtonRow = (groupId, callback) =>
  setupButtonRowImpl(groupId, callback, scheduleProjectSettingsSave);

//═══════════════════════════════════════════════════════════════
// UI CONTROLS
//═══════════════════════════════════════════════════════════════

const modelLibraryCallbacks = setupModelLibraryPanel({
  modelManager,
  getActiveModel: () => activeModel,
  log,
  logSuccess,
  logWarn,
  logError,
  updateModelList,
  loadModel,
  getCurrentModelName,
  exportSingleModel,
  exportModelData,
  importCustomModels,
  uvEditor,
  collectModelParts: _collectModelParts,
  flushWrites,
  updateMaterialPresetList,
  scheduleAllMissingThumbnails,
  selectModelInDropdown: name => modelPanel?.selectModelInDropdown(name),
  deleteModelsFromLibrary,
  registerBuiltInModels,
  materialLibrary,
  clearMaterialThumbnail,
});

const controls = new ControlsManager({
  onGridChange: (field, value) => {
    handleGridChange(field, value, {
      panel: previewQualityPanel,
      measureUnit: previewQualityState.measureUnit,
      markNeedsRender,
      scheduleProjectSettingsSave,
    });
  },

  onModelChange: name => modelPanel?.onModelChange(name),
  onPartChange: partName => modelPanel?.onPartChange(partName),
  onMaterialChange: preset => materialsPanel?.applyMaterialPreset(preset),
  onMaterialPropertyChange: (property, value) => materialsPanel?.handleMaterialPropertyChange(property, value),
  onMaterialPropertyCommit: () => materialsPanel?.commitMaterialChange(),
  onResetTexture: () => materialsPanel?.resetTexture(),
  onChannelTextureUpload: (channel, file) => materialsPanel?.handleChannelTextureUpload(channel, file),
  onChannelTextureClear: channel => materialsPanel?.handleChannelTextureClear(channel),
  onChannelTextureMove: (fromChannel, toChannel) => materialsPanel?.handleChannelTextureMove(fromChannel, toChannel),
  ...modelLibraryCallbacks,
});

modelPanel = setupModelPanel({
  controls,
  uvEditor,
  getMeshMap: () => meshMap,
  getActiveMesh: () => activeMesh,
  libIdOf,
  nodeEditorManager,
  previewQualityState,
  rendererManager,
  scheduleSessionSave,
  selectPart,
  pushSceneHistory,
  loadModel,
  setActiveModelFaceCount: value => { _activeModelFaceCount = value; },
  getActiveModelFaceCount: () => _activeModelFaceCount,
  highPolyThreshold: HIGH_POLY_THRESHOLD,
  serializeLayerImage: img => uvEditor.encodeLayerImage(img),
});

materialsPanel = setupMaterialsPanel({
  actions: materialActions,
  materialLibrary,
  materialManager,
  getActiveMesh: () => activeMesh,
  getActiveModel: () => activeModel,
  getMeshMap: () => meshMap,
  libIdOf,
  uvEditor,
  nodeEditorManager,
  rendererManager,
  sceneManager,
  cameraManager,
  controls,
  markNeedsRender,
  getCurrentModelName,
  syncMaterialDropdown: modelPanel.syncMaterialDropdown,
  scheduleLibraryWrite,
  schedulePartMaterialSave,
  materialState,
  originalCustomDefinitions: _originalCustomDefinitions,
  extractPropertiesForPreset,
  getPartMaterialPrefix: partMaterialPrefix,
  loadThumbnailRecords: async pid => {
    const prefix = materialThumbPrefix(pid);
    const keys = await IDBStorage.getAllKeys('blobs', prefix);
    return Promise.all(keys.map(async key => [
      decodeURIComponent(key.slice(prefix.length)),
      await IDBStorage.get('blobs', key),
    ]));
  },
  loadPartMaterialRecords: async (pid, modelName) => {
    const prefix = partMaterialPrefix(pid, modelName);
    const keys = await IDBStorage.getAllKeys('metadata', prefix).catch(() => []);
    return Promise.all(keys.map(async key => {
      try {
        return { key, record: await IDBStorage.get('metadata', key) };
      } catch (_) {
        return { key, record: null };
      }
    }));
  },
  storeThumbnail: (id, dataUrl) => {
    const pid = getActiveProjectIdSync();
    if (pid) IDBStorage.put('blobs', materialThumbKey(pid, id), dataUrl).catch(() => {});
  },
  requestPersistentStorage: () => IDBStorage.requestPersistentStorage(),
  textureToDataURL,
  log,
  logError,
  flushWrites,
  updateModelList,
  getCurrentEnvironment: () => currentEnvironment,
});

modelLoading = createModelLoading({
  modelManager,
  materialManager,
  materialLibrary,
  materialLibraryReady,
  materialPresetsReady,
  materialState,
  designState,
  sceneManager,
  cameraManager,
  rendererManager,
  propManager,
  uvEditor,
  getActiveProjectIdSync,
  getMeshMap: () => meshMap,
  setMeshMap: value => { meshMap = value; },
  getActiveMesh: () => activeMesh,
  setActiveMesh: value => { activeMesh = appState.activeMesh = value; },
  getActiveModel: () => activeModel,
  setActiveModel: value => { activeModel = appState.activeModel = value; },
  getPartCache: () => _partCache,
  setPartCache: value => { _partCache = value; },
  getOriginalCustomDefinitions: () => _originalCustomDefinitions,
  getPersistenceReady: () => _persistenceReady,
  scheduleWrite,
  commitActiveDefinition,
  getBootCamera: () => _bootCamera,
  setBootCamera: value => { _bootCamera = value; },
  loadDesignLayersFromCache,
  restoreSceneState,
  convertObjectToPhysical,
  convertToPhysical,
  applyTexQualityToObject,
  clearHighlight,
  cleanupActiveModel,
  updatePartSelection: names => modelPanel.updatePartSelection(names),
  clearPartSelection: () => modelPanel.clearPartSelection(),
  setActivePartName: name => modelPanel.setActivePartName(name),
  setSelectedModel: name => modelPanel.setSelectedModel(name),
  syncActiveMaterialView,
  syncChannelView,
  clearChannelMapData: () => materialsPanel.clearChannelMapData(),
  updateMaterialPresetList,
  scheduleThumbnailUpdate,
  scheduleAllMissingThumbnails,
  scheduleMatThumbUpdate,
  checkAndApplyPolyPerf,
  onModelReady: (object, name, mesh) => modelPanel.onModelReady(object, name, mesh),
  onModelLoadMessage: message => log(message),
  onModelLoadWarning: message => logWarn(message),
  onModelLoadError: message => logError(message),
  getCurrentModelName,
  snapshotCurrentPart: _snapshotCurrentPart,
  serializeDecal: img => modelPanel.serializeDecal(img),
  markNeedsRender,
  log,
  logError,
  logWarn,
});

// Delete models and everything stored for them (one transaction), then update
// memory and the UI. Library deletes can't be undone, so scene history is reset
// and no undo step points at a model that no longer exists.
async function deleteModelsFromLibrary(names) {
  const pid = getActiveProjectIdSync();
  const wasActive = names.includes(getCurrentModelName());

  // Let in-flight and pending writes finish first so none of them re-creates a
  // deleted record afterwards
  await flushWrites();
  let libraryChange;
  try {
    // Materials of a deleted upload that other objects use become custom materials
    const uploaded = names.filter(name => ['uploaded', 'uploaded-glb'].includes(modelManager.models.get(name)?.type));
    libraryChange = await materialLibrary.prepareObjectDeletion(uploaded, names);
    await modelManager.deleteModels(names, libraryChange.ops);
    libraryChange.commit();
  } catch (err) {
    log(IDBStorage.isQuotaError(err)
      ? `Could not delete ${names.join(', ')}: storage is full`
      : `Could not delete ${names.join(', ')}: ${err.message}`, true);
    return false;
  }
  // Writes scheduled for these models while the delete ran must not land
  for (const name of names) {
    cancelWritesWithPrefix(`part-material:${pid}:${name}:`);
    cancelWritesWithPrefix(`design:${pid}:${name}:`);
    cancelWritesWithPrefix(`node:${pid}:${name}|`);
    cancelWrite(`transform:${pid}:${name}`);
    nodeEditorManager.removeGraphsForObject(name);
  }

  for (const [oldId, newId] of libraryChange.idMap) {
    for (const mesh of materialActions.partsUsing(oldId)) mesh.material.userData.libId = newId;
    scheduleThumbnailUpdate(newId);
  }
  if (libraryChange.idMap.size) materialState.init('After delete');
  updateMaterialPresetList();
  await updateModelList();
  if (wasActive && STANDARD_OBJECTS.length > 0) {
    // loadModel disposes the deleted model's meshes, materials and textures
    await loadModel(STANDARD_OBJECTS[0].label);
    try { await waitForModelReady(); } catch (_) { /* fallback failed to load */ }
  }
  sceneState.init('After delete');
  scheduleSessionSave();
  return true;
}

// start with part selector hidden/disabled until model loaded
controls.setEnabled('objectPartSelect', false);
controls.setVisible('objectPartSelect', false);

// --- hover highlighting and click-to-select ---
viewportSelection = createViewportSelection({
  rendererManager,
  cameraManager,
  getMeshMap: () => meshMap,
  getActiveMesh: () => activeMesh,
  setActiveMesh: mesh => { activeMesh = appState.activeMesh = mesh; },
  getIsOrbiting: () => _isOrbiting,
  getPerformanceModeEnabled: () => previewQualityState.performanceModeEnabled,
  getBackfaceCullingEnabled: () => previewQualityState.backfaceCullingOn,
  controls,
  uvEditor,
  getCurrentModelName,
  libIdOf,
  snapshotCurrentPart: _snapshotCurrentPart,
  getPartCache: () => _partCache,
  restoreDesignLayersForPart: _restoreDesignLayersForPart,
  nodeEditorManager,
  syncChannelView,
  syncMaterialDropdown,
  syncActiveMaterialView,
  applyFrontBackShader: _applyFrontBackShader,
  scheduleSessionSave,
  markNeedsRender,
});
viewportSelection.attach();

function clearHighlight() {
  return viewportSelection?.clearHighlight();
}

function _snapshotCurrentPart() {
  // Snapshot the active part's layers into _partCache before switching parts (live
  // Image objects, so switching back is instant and saveCustomModelHandler can collect all
  // parts). Materials are in the library; base textures and sticker state in UVEditor.
  // Mid-switch the editor still holds the previous part's layers — don't file them here.
  if (!activeMesh || uvEditor.activeMesh !== activeMesh) return;
  _partCache[activeMesh.name] = {
    overlayImages: uvEditor.overlayImages.map(img => ({ ...img })),
  };
}

function _applyFrontBackShader(mesh) {
  const mat = mesh.material;
  const baseMap = uvEditor.getPartBaseTexture(mesh);
  if (!baseMap || !uvEditor.hasPartDesign(mesh)) return;
  mat._rdFrontBack = true;
  // customProgramCacheKey defaults to onBeforeCompile.toString() in r183 —
  // setting a new onBeforeCompile automatically busts the shader cache.
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.u_baseMap = { value: baseMap };
    shader.fragmentShader = 'uniform sampler2D u_baseMap;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      'texture2D( map, vMapUv )',
      'texture2D( gl_FrontFacing ? map : u_baseMap, vMapUv )'
    );
  };
  mat.needsUpdate = true;
}

function _clearFrontBackShader(mat) {
  if (mat._rdFrontBack) {
    delete mat.onBeforeCompile; // restores prototype default, auto-busts cache via customProgramCacheKey
    delete mat._rdFrontBack;
    mat.needsUpdate = true;
  }
}

async function selectPart(mesh) {
  return viewportSelection.selectPart(mesh);
}


function getCurrentModelName() {
  return document.getElementById('object-select')?.value
    || document.getElementById('model-select')?.value || '';
}

function waitForModelReady() {
  return modelLoading?.getModelRequest()?.promise || Promise.resolve(false);
}

// ─── Session and project settings ────────────────────────────────────────────
// metadata session:${pid} → what was open:
//   { version: 2, modelName, partName, activeCustomScene, props, mainModelTransform }
// settings/${pid}          → { camera, view, renderer, preview, background, environment, ui }
// Both are written a short time after each change and flushed when the page is
// hidden. Writes stay off (_persistenceReady) until startup has applied the stored
// values, so the defaults built during startup never overwrite them.

projectSettings = createProjectSettings({
  getActiveProjectIdSync,
  getPersistenceReady: () => _persistenceReady,
  getCurrentModelName,
  getActiveMesh: () => activeMesh,
  getMeshMap: () => meshMap,
  getPropManager: () => propManager,
  getCameraManager: () => cameraManager,
  getCameraState: () => camState,
  getRendererManager: () => rendererManager,
  getPreviewQualityState: () => previewQualityState,
  getBackgroundState: () => ({ currentEnvironment, showEnvBackground, gradientBgEnabled, currentGradientBg }),
  setBackgroundState: state => {
    currentEnvironment = state.currentEnvironment;
    showEnvBackground = state.showEnvBackground;
    gradientBgEnabled = state.gradientBgEnabled;
    currentGradientBg = state.currentGradientBg;
  },
  getUVEditor: () => uvEditor,
  getActiveModel: () => activeModel,
  getRestoreCameraSettings: () => restoreCameraSettings,
  getModelManager: () => modelManager,
  getModelLoading: () => modelLoading,
  getStandardObjects: () => STANDARD_OBJECTS,
  loadModel,
  selectPart,
  ensureSketchfabPropsRegistered,
  checkAndApplyPolyPerf,
  restoreUiPreferences,
  applyBackground,
  syncBackgroundCards: name => syncBackgroundCards(name),
  scheduleWrite,
  flushWrites,
  log,
});

async function updateModelList() {
  const categories = await modelManager.getModelNamesByCategory();
  const pid = getActiveProjectIdSync();
  const designThumbs = {};
  const matThumbs = {}; // modelName → [{ partName, dataUrl }]
  if (pid) {
    const allNames = [
      ...(categories.builtin  || []),
      ...(categories.custom   || []),
      ...(categories.uploaded || []),
    ];
    await Promise.all(allNames.map(async name => {
      try {
        const blob = await IDBStorage.get('blobs', designThumbKey(pid, name));
        if (blob) designThumbs[name] = await IDBStorage.blobToDataURL(blob);
      } catch (_) {}

      const entries = await materialsPanel.getModelMaterialThumbnails(pid, name);
      if (entries.length) matThumbs[name] = entries;
    }));
  }
  modelPanel.updateModelSelect(categories, designThumbs, matThumbs);
}

// Reset Cache — clears derived data only (rendered thumbnails and environment
// previews); they are regenerated on next load. User data is not touched.
const CACHE_BLOB_PREFIXES = ['preset-thumb:', 'env-preview:'];

document.getElementById('reset-cache-btn')?.addEventListener('click', async () => {
  if (!confirm('Clear cached thumbnails and environment previews?\n\nYour models, materials, scenes and settings are kept. The page will reload.')) return;
  await flushWrites();
  try {
    await IDBStorage.batchWithoutOutbox(CACHE_BLOB_PREFIXES.map(prefix => ({ type: 'delPrefix', store: 'blobs', prefix })));
  } catch (err) {
    log(`Could not clear cache: ${err.message}`, true);
    return;
  }
  location.reload();
});

document.getElementById('reset-all-data-btn')?.addEventListener('click', async () => {
  if (!confirm('Delete ALL custom data?\n\nThis will permanently remove:\n• All custom models\n• All custom materials\n• All saved scenes and projects\n• All uploaded props and channel maps\n• All session state\n\nThis cannot be undone. The page will reload.')) return;

  // Nothing may be written once the database is gone
  _persistenceReady = false;
  cancelAllWrites();
  await flushWrites(); // wait for writes already in progress
  try {
    await IDBStorage.deleteDatabase();
  } catch (err) {
    log(`Could not delete data: ${err.message}. It is deleted once other RenderDeck tabs are closed — then reload this page.`, true);
    return;
  }
  // Databases from older RenderDeck versions
  await Promise.all(['renderDeck_customModels', 'RenderDeckScenes'].map(name => new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  })));
  try { localStorage.clear(); } catch (_) { /* nothing stored there any more */ }
  location.reload();
});

uvEditor.setCallbacks({ onModelListChanged: updateModelList });

uvEditor.setCallbacks({ onSaveCustomModel: async function() {
  if (!activeModel) return;

  const openCustomName = uvEditor.customModelName;
  const baseName = uvEditor.activeModelName || getCurrentModelName();
  const customName = prompt('Enter a name for your custom model:', openCustomName || `${baseName} (Custom)`)?.trim();
  if (!customName) { log('Save cancelled'); return; }

  const existing = await modelManager.getModelNamesByCategory();
  if (existing.builtin.includes(customName) || existing.uploaded.includes(customName)) {
    logError(`"${customName}" is the name of a standard or uploaded model. Choose another name.`);
    return;
  }
  const replacesOther = customName !== openCustomName && existing.custom.includes(customName);
  if (replacesOther && !confirm(`A custom model named "${customName}" already exists. Replace it?`)) {
    log('Save cancelled');
    return;
  }

  const parts = await _collectModelParts();

  const saved = await modelManager.saveCustomModel(customName, {
    basedOn:    uvEditor.activeModelName,
    customName,
    sourceType: 'standard',
    sceneState: uvEditor.sceneState || null,
    parts,
  }, { replaceWorkingState: replacesOther });
  if (!saved) return; // CustomModelStorage already logged the error

  uvEditor.customModelName = customName;
  await updateModelList();
  uvEditor.onSelectModel?.(customName);
} });

function selectModelInDropdown(name) {
  modelPanel.selectModelInDropdown(name);
}
uvEditor.setCallbacks({ onSelectModel: selectModelInDropdown });

//═══════════════════════════════════════════════════════════════
// DRAG & DROP
//═══════════════════════════════════════════════════════════════

setupDragAndDrop({
  container,
  modelManager,
  updateModelList,
  loadModel,
  getActiveMesh: () => activeMesh,
  uvEditor,
  logError,
  logWarn,
});


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

  // Keyboard handler — only active in design mode, skip when focus is inside a text field
  document.addEventListener('keydown', (e) => {
    const toolbar = document.querySelector('.editor-stage-toolbar');
    if (!toolbar?.classList.contains('editor-stage-toolbar-design')) return;
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

// Apply settings/${pid}.ui by driving the toolbar controls whose state differs,
// so each control's own handler applies the value.
function restoreUiPreferences(ui) {
  const click = (id) => document.getElementById(id)?.click();
  if (ui.measureUnit && ui.measureUnit !== previewQualityState.measureUnit) click(ui.measureUnit === 'in' ? 'unit-in' : 'unit-cm');
  const gridFields = { size: 'grid-size', divisions: 'grid-divisions', subdivisions: 'grid-subdivisions' };
  for (const [field, base] of Object.entries(gridFields)) {
    const value = ui.gridInputs?.[field];
    const input = document.getElementById(`${base}-input`);
    if (value == null || !input || input.value === String(value)) continue;
    const slider = document.getElementById(`${base}-slider`);
    if (slider) slider.value = value;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  if (typeof ui.gridOn     === 'boolean' && ui.gridOn     !== previewQualityState.tfGridOn)     click('tf-grid');
  if (typeof ui.snapGrid   === 'boolean' && ui.snapGrid   !== previewQualityState.tfSnapGrid)   click('snap-grid-btn');
  if (typeof ui.snapVertex === 'boolean' && ui.snapVertex !== previewQualityState.tfSnapVertex) click('snap-vertex-btn');
  if (typeof ui.snapOn     === 'boolean' && ui.snapOn     !== previewQualityState.tfSnapOn)     click('tf-snap');
  if (typeof ui.dimLabels  === 'boolean' && ui.dimLabels  !== previewQualityState.tfDimLabelsOn) click('tf-dimensions');
  if (typeof ui.labelsParallel === 'boolean' && ui.labelsParallel !== previewQualityState.tfLabelsParallel) {
    click(ui.labelsParallel ? 'dim-style-parallel' : 'dim-style-default');
  }
  if (typeof ui.editMode   === 'boolean' && ui.editMode   !== previewQualityState.tfEditModeOn) click('tf-editmode');
  if (typeof ui.wrapImages === 'boolean' && ui.wrapImages !== uvEditor._wrapImages) click('wrap-uv-btn');
  if (typeof ui.lockAspectRatio === 'boolean') {
    uvEditor._lockAspectRatio = ui.lockAspectRatio;
    const lockAspect = document.getElementById('lock-aspect-ratio');
    if (lockAspect) lockAspect.checked = ui.lockAspectRatio;
  }
}

//═══════════════════════════════════════════════════════════════
// Shared scene restore support
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
      const propId = await propManager.saveBlobProp(key, blobUrl, uid, p.displayName ?? null);
      const select = document.getElementById('props-select');
      if (select && propId && ![...select.options].some(option => option.value === propId)) {
        let group = select.querySelector('optgroup[label="Sketchfab"]');
        if (!group) { group = document.createElement('optgroup'); group.label = 'Sketchfab'; select.appendChild(group); }
        const option = document.createElement('option');
        option.value = propId;
        option.textContent = p.displayName || uid;
        group.appendChild(option);
      }
      URL.revokeObjectURL(blobUrl);
    } catch (e) {
      log(`Could not restore Sketchfab prop "${p.displayName ?? uid}": ${e.message}`, true);
    }
  }
}

//═══════════════════════════════════════════════════════════════
// ANIMATION LOOP
//═══════════════════════════════════════════════════════════════

// Demand rendering — only render when something changed.
// markNeedsRender(frames) schedules N frames of rendering (default 4).
// Camera movement/damping also triggers continuous rendering while active.
// The composer is built by initializeApp() once settings/${pid}.renderer is loaded,
// so only the passes the user had enabled get compiled.
startRenderLoop({
  cameraManager,
  propManager,
  rendererManager,
  sceneManager,
  getPerformanceModeEnabled: () => previewQualityState.performanceModeEnabled,
  markNeedsRender,
  getRenderBurst,
  ensureRenderBurst,
  consumeRenderBurst,
});

//═══════════════════════════════════════════════════════════════
// INITIAL SETUP
//═══════════════════════════════════════════════════════════════

// Saved camera from the last session, used to skip centerAndFrameModel on boot.
let _bootCamera = null;

async function initializeApp() {
  // 1. Active project — everything else is keyed by its id
  let activeProject;
  try {
    activeProject = await ensureActiveProject();
  } catch (err) {
    log(`Could not open project storage: ${err.message}`, true);
    return;
  }
  const pid = activeProject.id;

  // 2. One-time moves from localStorage and old key formats
  try {
    await runMigrations(pid);
  } catch (err) {
    log(`Storage migration failed — old data left in place: ${err.message}`, true);
  }
  await materialPresetsReady;
  try {
    await migrateMaterialLibrary(materialManager);
  } catch (err) {
    log(`Material library migration failed — old data left in place: ${err.message}`, true);
  }

  // 3. Read everything the UI is built from
  const [appSettings, projectSettings, session] = await Promise.all([
    loadAppSettings().catch((err) => { log(`Could not load app settings: ${err.message}`, true); return {}; }),
    loadProjectSettings(pid).catch((err) => { log(`Could not load project settings: ${err.message}`, true); return {}; }),
    IDBStorage.get('metadata', sessionKey(pid)).catch((err) => { log(`Could not load session: ${err.message}`, true); return null; }),
  ]);

  // Renderer passes before the composer is compiled
  if (projectSettings.renderer) rendererManager.applyState(projectSettings.renderer);
  rendererManager.initComposer(sceneManager.getScene(), cameraManager.getCamera());
  loadInitialEnvironment(projectSettings.environment);

  CompactColorPicker.setSharedCollections(appSettings.swatchCollections);
  await CompactColorPicker.restoreExtractorImage();
  sketchfabAPI.load().catch(() => {});

  try {
    await materialLibrary.loadProject(pid);
  } catch (err) {
    log(`Could not load materials: ${err.message}`, true);
  }
  // Every in-memory material cache now holds this project's data, and only that
  await loadCachedThumbnails(pid);
  _resolveLibraryReady();
  await modelManager.ready;
  await backfillUploadedCatalogs();
  // Not awaited: the list fills in as soon as each file's first bytes arrive
  readMissingStandardCatalogs();

  // Node graphs must be loaded before setSelection runs for the restored model
  nodeEditorManager.loadGraphData(await loadNodeGraphs(pid));
  nodeEditorManager.setCollections(appSettings.nodeCollections);

  // Fast path: start loading the last model while the rest of the UI is built
  if (projectSettings.view?.position) _bootCamera = projectSettings.view;
  if (session?.modelName && await modelExists(session.modelName)) {
    const modelSel = document.getElementById('object-select') || document.getElementById('model-select');
    if (modelSel) modelSel.value = session.modelName;
    loadModel(session.modelName);
  }

  warmupAndGenerateThumbnails();
  await updateModelList();
  updateMaterialPresetList();
  restoreCameraSettings = setupCameraPanel({
    cameraManager,
    rendererManager,
    cameraState: camState,
    setupButtonRow,
    markNeedsRender,
    scheduleProjectSettingsSave,
    log,
  });
  setupPostProcessingPanel({
    rendererManager,
    markNeedsRender,
    scheduleProjectSettingsSave,
    log,
  });
  previewQualityPanel = setupPreviewQualityPanel({
    rendererManager,
    sceneManager,
    propManager,
    cameraManager,
    container,
    getActiveModel: () => activeModel,
    setupButtonRow,
    markNeedsRender,
    setPerformanceModeOverride: value => { previewQualityState.performanceModeOverride = value; },
    getPerformanceModeEnabled: () => previewQualityState.performanceModeEnabled,
    setPerformanceModeEnabled: value => { previewQualityState.performanceModeEnabled = value; },
    updatePerfModeUI,
    clearFrontBackShader: _clearFrontBackShader,
    applyFrontBackShader: _applyFrontBackShader,
    scheduleProjectSettingsSave,
    log,
  });
  ({ syncEnvironmentCards, syncBackgroundCards } = setupEnvironmentPanel({
    environmentNames: getEnvironmentNames(),
    currentEnvironment,
    setBackgroundState: updates => {
      if ('showEnvBackground' in updates) showEnvBackground = updates.showEnvBackground;
      if ('gradientBgEnabled' in updates) gradientBgEnabled = updates.gradientBgEnabled;
      if ('currentGradientBg' in updates) currentGradientBg = updates.currentGradientBg;
    },
    applyBackground,
    pushSceneHistory,
    onEnvironmentChange: sceneName => {
      currentEnvironment = sceneName;
      scheduleProjectSettingsSave();
      loadEnvironment(sceneName, (name, texture) => {
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
  }));
  setupExportPanel({
    rendererManager,
    sceneManager,
    cameraManager,
    getGradientBackground: scene => !scene.background && gradientBgEnabled ? GRADIENT_PRESETS[currentGradientBg] : null,
    getExportOverlays: () => [...previewQualityPanel.getGridHelpers(), ...propManager.getOverlayObjects()].filter(Boolean),
    markNeedsRender,
    log,
    logError,
    logSuccess,
    logWarn,
    getActiveProject,
    getActiveProjectIdSync,
    saveThumbnailToProject: _saveThumbnailToProject,
    getActiveModel: () => activeModel,
    clearHighlight,
    getCurrentModelName,
    standardEnvironments: STANDARD_ENVIRONMENTS,
    getCurrentEnvironment: () => currentEnvironment,
    uvEditor,
    materialLibrary,
    libIdOf,
    materialManager,
    scheduleSessionSave,
    scheduleProjectSettingsSave,
    flushWrites,
    getFailedWrites,
    retryFailedWrites,
    onWriteStateChange,
    getWriteState,
  });
  setupDesignShortcuts();
  await propManager.loadStoredProps();
  const refreshPropsSelect = setupPropsPanel({
    propManager,
    cameraManager,
    sketchfabAPI,
    pushSceneHistory,
    logError,
    scheduleProjectSettingsSave,
    previewQualityPanel,
  });
  await setupSavedScenesPanel({
    sceneStorage,
    getActiveProjectIdSync,
    modelManager,
    propManager,
    refreshPropsSelect,
    materialLibrary,
    updateMaterialPresetList,
    scheduleAllMissingThumbnails,
    updateModelList,
    standardObjects: STANDARD_OBJECTS,
    standardEnvironments: STANDARD_ENVIRONMENTS,
    loadEnvironment,
    syncEnvironmentCards,
    syncBackgroundCards,
    getSceneState: () => ({ currentEnvTexture, currentEnvironment, showEnvBackground, gradientBgEnabled, currentGradientBg }),
    setSceneState: updates => {
      if ('currentEnvTexture' in updates) currentEnvTexture = updates.currentEnvTexture;
      if ('currentEnvironment' in updates) currentEnvironment = updates.currentEnvironment;
      if ('showEnvBackground' in updates) showEnvBackground = updates.showEnvBackground;
      if ('gradientBgEnabled' in updates) gradientBgEnabled = updates.gradientBgEnabled;
      if ('currentGradientBg' in updates) currentGradientBg = updates.currentGradientBg;
    },
    restoreProjectSettings,
    sceneManager,
    applyBackground,
    scheduleProjectSettingsSave,
    scheduleSessionSave,
    cameraManager,
    rendererManager,
    camState,
    getActiveModel: () => activeModel,
    getCurrentModelName,
    ensureSketchfabPropsRegistered,
    loadModel,
    scheduleModelTransformSave,
    cleanupActiveModel,
    log,
    logError,
    logSuccess,
    logWarn,
    flushWrites,
  });
  setupHistoryUI();
  setupValueInputSpinners();
  setupDebugPanel({
    IDBStorage,
    getActiveProjectIdSync,
    sessionKey,
    partMaterialKey,
    APP_SETTINGS_KEY,
    projectSettingsKey,
  });
  initDebugPanelWidth();
  initObjectPropsTabs();

  // Update the header button
  const projectBtn = document.getElementById('project-btn');
  if (projectBtn) {
    projectBtn.querySelector('#project-name').textContent = activeProject.name;
    projectBtn.addEventListener('click', async () => {
      await _saveThumbnailToProject(pid);
      window.location.href = 'projects.html';
    });
  }

  // 4. Apply stored settings to the controls built above
  restoreProjectSettings(projectSettings);

  const restored = await restoreSessionState(session);
  if (!restored && STANDARD_OBJECTS.length > 0) {
    await loadModel(STANDARD_OBJECTS[0].label);
    try { await waitForModelReady(); } catch (_) { /* model failed to load */ }
  }

  // Preview toggles (wireframe etc.) act on the loaded model; the saved view goes last
  restorePreviewSettings(projectSettings.preview);
  _bootCamera = null;
  const view = projectSettings.view;
  if (view?.position) cameraManager.setPosition(view.position.x, view.position.y, view.position.z);
  if (view?.target)   cameraManager.setTarget(view.target.x, view.target.y, view.target.z);

  restoreControlPreferences(projectSettings.controls);
  const savedTransformMode = projectSettings.ui?.transformMode;
  if (['translate', 'rotate', 'scale'].includes(savedTransformMode)) {
    propManager.setTransformMode(savedTransformMode);
    for (const mode of ['translate', 'rotate', 'scale']) {
      document.getElementById(`tf-${mode}`)?.classList.toggle('tf-btn--active', mode === savedTransformMode);
    }
  }
  bindControlPreferences(scheduleProjectSettingsSave);
  document.addEventListener('extractor-preferences-changed', scheduleProjectSettingsSave);

  // The first model is showing, so the rest can download without slowing it down
  prefetchStandardModels();

  // From here on every change is written to IndexedDB
  _persistenceReady = true;
  schedulePartMaterialSave();
  scheduleSessionSave();
  scheduleProjectSettingsSave();

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
      if (previewQualityState.performanceModeEnabled) rendererManager.enterOrbitPerfMode();
    });
    orbitControls.addEventListener('end', () => {
      _isOrbiting = false;
      rendererManager.exitOrbitPerfMode();
      scheduleProjectSettingsSave(); // camera view
    });
  }

  // Record initial history states after everything is loaded
  setTimeout(() => {
    designState.init('Initial state');
    materialState.init('Initial state');
    sceneState.init('Initial state');
  }, 500);
}

// Debounced writes must not be lost when the tab is hidden or closed
window.addEventListener('beforeunload', flushAllWrites);
window.addEventListener('pagehide', flushAllWrites);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushAllWrites();
});

initializeApp();
//
}
