import { collectControlPreferences, restoreControlPreferences, bindControlPreferences } from './ui/ControlPreferences.js';
import { loadNodeGraphs, saveNodeGraph } from './storage/NodeGraphStorage.js';
import { loadDesignImage } from './utils/imageAssets.js';
import { prepareModelParts } from './models/ModelParts.js';
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
import { MaterialLibrary, FALLBACK_ID, DEFAULT_STANDARD_ID, CHANNELS, textureToDataURL } from './materials/MaterialLibrary.js';
import { catalogFromGltf, catalogFromMtl, readGlbJsonFromUrl, tagFileMaterials } from './materials/nativeCatalog.js';
import { ModelManager } from './models/ModelManager.js';

import { UVEditor } from './ui/UVEditor.js';
import { ControlsManager, CompactColorPicker, initDebugPanelWidth, initObjectPropsTabs } from './ui/Controls.js';
import { NodeEditorManager } from './ui/NodeEditorManager.js';
import { SceneStateManager }    from './stateEditor/SceneState.js';
import { DesignStateManager }   from './stateEditor/DesignState.js';
import { MaterialStateManager } from './stateEditor/MaterialState.js';
import * as IDBStorage from './storage/indexedDBStorage.js';
IDBStorage.startPersistentStorageRequests();
import {
  partMaterialKey, designMetaKey, designBlobKey, designBlobPartPrefix, designThumbKey,
  sessionKey, materialThumbKey, materialThumbPrefix, partMaterialPrefix,
  APP_SETTINGS_KEY, projectSettingsKey, modelTransformKey,
} from './storage/storageKeys.js';
import { scheduleWrite, flushWrites, getFailedWrites, cancelWrite, cancelWritesWithPrefix, cancelAllWrites } from './storage/pendingWrites.js';
import { loadAppSettings, loadProjectSettings, scheduleProjectSettings, setAppSetting } from './storage/SettingsStorage.js';
import { runMigrations, migrateMaterialLibrary, migrateLegacyPart } from './storage/migrations.js';

// Utils
import { log, logError, logSuccess, logWarn } from './utils/logger.js';

import { cleanupObject, downloadBlob, safeFileName } from './utils/helpers.js';

// Sketchfab integration
import { SketchfabAPI }    from './sketchfab/SketchfabAPI.js';
import { SketchfabModal }  from './sketchfab/SketchfabModal.js';
import { extractModelFromZip } from './sketchfab/SketchfabLoader.js';

// Config
import { STANDARD_OBJECTS, STANDARD_MATERIALS, STANDARD_ENVIRONMENTS } from './config.js';

// Props
import { PropManager } from './props/PropManager.js';
import { CustomSceneStorage } from './scenes/CustomSceneStorage.js';
import { ensureActiveProject, getActiveProject, getActiveProjectIdSync, updateProject } from './storage/ProjectStorage.js';

// Export
import { renderImage, renderExr } from './export/imageExport.js';
import { buildModelPackage } from './export/modelExport.js';
import { buildProjectFile, importProjectFile } from './storage/projectFile.js';

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
const uvEditor = new UVEditor(rendererManager, log, modelManager, materialManager);
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
  await _writeDesignLayers(pid, model, part, layers, parts);
};
// Wrap / lock-aspect toggles are UI preferences in settings/${pid}
uvEditor.onPrefsChanged = () => scheduleProjectSettingsSave();

const mtlLoader = new MTLLoader();
const gltfLoader = new GLTFLoader();

const propManager = new PropManager(
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

let activeModel = null;
let activeMesh = null;
const _channelMapData = new Map(); // channel → data URL of the active part's material (a view of its definition)
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
let performanceModeOverride = null;
let performanceModeEnabled = false;  // auto-set on high-poly load; user can override
let _backfaceCullingOn = true;
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

const sceneStorage   = new CustomSceneStorage();
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
  captureState: () => captureMaterialState(),
  applyState:   (state) => applyMaterialHistoryState(state),
});

function pushSceneHistory(label)  { sceneState.push(label); }

// Update the thumbnail and the stored part material whenever material state changes
materialState.onChanged = () => {
  const id = libIdOf(activeMesh);
  if (id) scheduleThumbnailUpdate(id);
  schedulePartMaterialSave();
};

// Scene history push/restore → props, model choice and background changed
sceneState.onChanged = () => {
  scheduleSessionSave();
  scheduleProjectSettingsSave();
};

function setupHistoryUI() {
  sceneState.setupUI();
  designState.setupUI();
  materialState.setupUI();

  // Save prop transform to scene history when user releases gizmo
  const modeLabels = { translate: 'Moved prop', rotate: 'Rotated prop', scale: 'Scaled prop' };
  propManager.onMainModelTransform = () => scheduleModelTransformSave();
  propManager.onTransformCommit = (mode) => {
    scheduleModelTransformSave();
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

function _setObjectSelectThumb(modelName, dataUrl) {
  const opt = controls?._objSelect?._dropdown?.querySelector(`[data-value="${CSS.escape(modelName)}"]`);
  if (!opt) return;
  const labelRow = opt.querySelector('.custom-select__option-label-row');
  if (!labelRow) return;
  let img = opt.querySelector('.custom-select__option-design-thumb');
  if (!img) {
    img = document.createElement('img');
    img.className = 'custom-select__option-design-thumb';
    img.alt = '';
    labelRow.appendChild(img);
  }
  img.src = dataUrl;
}

// ─── Per-part material thumbnails in the object dropdown ─────────────────────

function _setObjectSelectMatThumb(modelName, partName, dataUrl) {
  const opt = controls?._objSelect?._dropdown?.querySelector(`[data-value="${CSS.escape(modelName)}"]`);
  if (!opt) return;
  let container = opt.querySelector('.custom-select__option-mat-thumbs');
  if (!container) {
    container = document.createElement('span');
    container.className = 'custom-select__option-mat-thumbs';
    const labelRow = opt.querySelector('.custom-select__option-label-row');
    if (labelRow) labelRow.appendChild(container);
  }
  let img = container.querySelector(`[data-part="${CSS.escape(partName)}"]`);
  if (!img) {
    img = document.createElement('img');
    img.className = 'custom-select__option-mat-thumb';
    img.dataset.part = partName;
    img.alt = '';
    container.appendChild(img);
  }
  img.src = dataUrl;
}

// A part's thumbnail is its material's thumbnail, so an edit reaches every object.
function scheduleMatThumbUpdate(modelName, partName) {
  const dataUrl = _matThumbCache.get(libIdOf(meshMap[partName]));
  if (modelName && partName && dataUrl) _setObjectSelectMatThumb(modelName, partName, dataUrl);
}

// ─── Design layer persistence ────────────────────────────────────────────────
// Layers are stored per model part:
//   metadata design-meta:${pid}:${model}:${part}           → layer metadata array
//   blobs    design-blob:${pid}:${model}:${part}:${layerId} → image Blob
//   blobs    design-thumb:${pid}:${model}                   → first image (object dropdown)
// Model and part are captured when the change happens and the write is debounced
// per part, so switching parts before it runs can't misfile or drop the change.

function scheduleDesignLayerSave(layers, partName = activeMesh?.name) {
  const pid = getActiveProjectIdSync();
  const modelName = getCurrentModelName();
  if (!pid || !modelName || !partName) return;
  const partNames = Object.keys(meshMap);
  scheduleWrite(`design:${pid}:${modelName}:${partName}`,
    () => _writeDesignLayers(pid, modelName, partName, layers, partNames),
    { label: `design layers (${partName})` });
}

async function _writeDesignLayers(pid, modelName, partName, layers, partNames) {
  const meta = layers.map(l => ({
    id:          l.id,
    name:        l.name,
    type:        l.type,
    textData:    l.textData,
    position:    l.position,
    size:        l.size,
    rotation:    l.rotation,
    aspectRatio: l.aspectRatio,
    flipH:       l.flipH,
    flipV:       l.flipV,
  }));

  // Encode images synchronously (canvas → data URL → Blob, no fetch) so a write
  // flushed while the page is being hidden reaches the transaction without
  // waiting on anything that may never run.
  const dataURLs = layers.map(l => uvEditor.encodeLayerImage(l));
  const blobs = dataURLs.map(d => (d ? IDBStorage.dataURLToBlobSync(d) : null));

  // Model-level thumbnail: first image of this part, otherwise of another part
  const firstIdx = blobs.findIndex(Boolean);
  let thumbBlob = firstIdx >= 0 ? blobs[firstIdx] : null;
  if (!thumbBlob) {
    for (const p of partNames) {
      if (p === partName) continue;
      const otherMeta = await IDBStorage.get('metadata', designMetaKey(pid, modelName, p)).catch(() => null);
      const first = Array.isArray(otherMeta) ? otherMeta.find(e => e.id != null) : null;
      if (!first) continue;
      thumbBlob = await IDBStorage.get('blobs', designBlobKey(pid, modelName, p, first.id)).catch(() => null);
      if (thumbBlob) break;
    }
  }

  const ops = [{ type: 'delPrefix', store: 'blobs', prefix: designBlobPartPrefix(pid, modelName, partName) }];
  layers.forEach((l, i) => {
    if (blobs[i]) ops.push({ type: 'put', store: 'blobs', key: designBlobKey(pid, modelName, partName, l.id), value: blobs[i] });
  });
  ops.push(meta.length
    ? { type: 'put', store: 'metadata', key: designMetaKey(pid, modelName, partName), value: meta }
    : { type: 'del', store: 'metadata', key: designMetaKey(pid, modelName, partName) });
  ops.push(thumbBlob
    ? { type: 'put', store: 'blobs', key: designThumbKey(pid, modelName), value: thumbBlob }
    : { type: 'del', store: 'blobs', key: designThumbKey(pid, modelName) });
  await IDBStorage.batch(ops); // throws → pendingWrites reports it with log(…, true)

  // The dropdown thumbnail follows only once the write committed
  if (thumbBlob) {
    _setObjectSelectThumb(modelName, firstIdx >= 0 ? dataURLs[firstIdx] : await IDBStorage.blobToDataURL(thumbBlob));
  } else {
    const opt = controls?._objSelect?._dropdown?.querySelector(`[data-value="${CSS.escape(modelName)}"]`);
    opt?.querySelector('.custom-select__option-design-thumb')?.remove();
  }
}

async function loadDesignLayersFromCache(pid, modelName, partName) {
  try {
    const meta = await IDBStorage.get('metadata', designMetaKey(pid, modelName, partName));
    if (!Array.isArray(meta) || meta.length === 0) return null;

    const results = await Promise.all(meta.map(async (entry) => {
      try {
        const blob = await IDBStorage.get('blobs', designBlobKey(pid, modelName, partName, entry.id));
        if (!blob) return null;
        const dataURL = await IDBStorage.blobToDataURL(blob);
        return { ...entry, imageData: dataURL };
      } catch (_) {
        return null;
      }
    }));

    const valid = results.filter(Boolean);
    return valid.length > 0 ? valid : null;
  } catch (err) {
    log(`Could not load design layers for ${partName}: ${err.message}`, true);
    return null;
  }
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
    syncEnvCards(name);
    const sel = document.getElementById('environment-select');
    if (sel) sel.value = name;
    log(`Scene: ${name}`);
  };
  if (savedName && getSceneNames().includes(savedName)) loadScene(savedName, onLoad);
  else initScenes(onLoad);
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

// List native materials of standard objects without downloading the files. Only those
// not already stored are read, and only as far as each file's JSON chunk.
async function readMissingStandardCatalogs() {
  let added = false;
  for (const object of STANDARD_OBJECTS) {
    if (materialLibrary.hasCatalog(object.label)) continue;
    try {
      if (object.objPath.endsWith('.glb')) {
        await materialLibrary.addCatalog(catalogFromGltf(object.label, await readGlbJsonFromUrl(object.objPath)));
      } else if (object.mtlPath) {
        const response = await fetch(object.mtlPath);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await materialLibrary.addCatalog(catalogFromMtl(object.label, await response.text()));
      } else {
        continue; // no material file, so no native materials
      }
      added = true;
    } catch (err) {
      logError(`Could not list materials of ${object.label}: ${err.message}`);
    }
  }
  if (added) {
    updateMaterialPresetList();
    scheduleAllMissingThumbnails();
  }
}

// Uploads stored before native materials were listed
async function backfillUploadedCatalogs() {
  const categories = await modelManager.getModelNamesByCategory();
  for (const name of categories.uploaded || []) {
    if (materialLibrary.hasCatalog(name)) continue;
    try {
      const catalog = await modelManager.readUploadedCatalog(name);
      // Only the list is written; a material deleted earlier stays deleted by its override
      if (catalog) await materialLibrary.addCatalog(catalog);
    } catch (err) {
      logError(`Could not list materials of ${name}: ${err.message}`);
    }
  }
}

// Load an object's file for its materials alone (assigning one to another object).
async function loadNativeSourcesFromFile(objectName) {
  const paths = await modelManager.getLoadingPaths(objectName);
  const catalog = materialLibrary.getCatalog(objectName);
  if (!paths || !catalog) throw new Error(`${objectName} is not available`);
  const sources = new Map();
  if (paths.type === 'glb-path' || paths.type === 'glb-blob') {
    const gltf = await gltfLoader.loadAsync(paths.obj);
    tagFileMaterials(gltf.scene, catalog, gltf.parser.associations);
    convertObjectToPhysical(gltf.scene);
    gltf.scene.traverse(child => {
      if (!child.isMesh) return;
      child.geometry?.dispose();
      const material = child.material;
      if (material?.userData.libId && !sources.has(material.userData.libId)) sources.set(material.userData.libId, material);
    });
    return sources;
  }
  if (!paths.mtl) throw new Error(`${objectName} has no material file`);
  const response = await fetch(paths.mtl);
  if (!response.ok) throw new Error(`Material download failed: ${response.status}`);
  const materials = mtlLoader.parse(await response.text(), paths.type === 'path' ? paths.mtl.slice(0, paths.mtl.lastIndexOf('/') + 1) : '');
  materials.preload();
  for (const item of catalog.materials) {
    const material = convertToPhysical(materials.create(item.name));
    material.userData.libId = item.id;
    sources.set(item.id, material);
  }
  return sources;
}

// Tag the materials of a just-loaded file with their library ids, before anything clones them.
async function tagLoadedFile(object, objectName, parser, mtlText) {
  await materialLibraryReady;
  if (!materialLibrary.hasCatalog(objectName)) {
    const catalog = parser ? catalogFromGltf(objectName, parser.json) : (mtlText ? catalogFromMtl(objectName, mtlText) : null);
    if (catalog) {
      await materialLibrary.addCatalog(catalog);
      updateMaterialPresetList();
    }
  }
  const catalog = materialLibrary.getCatalog(objectName);
  if (catalog) tagFileMaterials(object, catalog, parser?.associations);
}

// Keeps the standard objects' files in IndexedDB, so opening one later doesn't download it.
// Not awaited by anything: a failure only means that model still comes from the network.
async function prefetchStandardModels() {
  try {
    await IDBStorage.del('metadata', 'standard-models-prefetched'); // flag of the old browser-cache prefetch
    void IDBStorage.requestPersistentStorage();
    await modelManager.storeStandardModels();
  } catch (err) {
    if (IDBStorage.isQuotaError(err)) logWarn('Storage is full, so standard models will keep downloading when opened.');
    else console.warn('Standard model prefetch failed:', err);
  }
}

let modelRequest = null;
const pendingModelLoads = new Map();
let modelCommit = Promise.resolve();

function disposeLoadedModel(object) {
  const resources = new Set();
  object?.traverse(child => {
    if (child.geometry) resources.add(child.geometry);
    for (const material of [child.material].flat().filter(Boolean)) {
      resources.add(material);
      Object.values(material).forEach(value => { if (value?.isTexture) resources.add(value); });
    }
  });
  resources.forEach(resource => resource.dispose());
}

function checkModelRequest(request) {
  if (request !== modelRequest) throw new Error('Superseded model load');
}

function loadModel(name, onLoaded = null) {
  if (pendingModelLoads.has(name)) {
    modelRequest = pendingModelLoads.get(name);
    const request = modelRequest;
    return onLoaded ? request.promise.then(ready => {
      if (ready && request === modelRequest) onLoaded(activeModel);
      return ready;
    }) : request.promise;
  }
  const request = { name };
  pendingModelLoads.set(name, request);
  modelRequest = request;
  console.log(`Loading ${name}`);
  request.promise = (async () => {
    let object;
    try {
      request.data = await modelManager.getModel(name);
      if (!request.data) throw new Error(`Model not found: ${name}`);
      const paths = await modelManager.getLoadingPaths(name);
      checkModelRequest(request);
      const glb = paths.type === 'glb-path' || paths.type === 'glb-blob';
      const requestOBJLoader = new OBJLoader().setMaterials(null);
      let mtlText = null;
      let parser = null;
      if (!glb) {
        if (paths.mtl) {
          try {
            const text = await fetch(paths.mtl).then(response => {
              if (!response.ok) throw new Error(`Material download failed: ${response.status}`);
              return response.text();
            });
            mtlText = text;
            const materials = mtlLoader.parse(text, paths.type === 'path' ? paths.mtl.slice(0, paths.mtl.lastIndexOf('/') + 1) : '');
            materials.preload();
            requestOBJLoader.setMaterials(materials);
          } catch (err) {
            logWarn(`MTL could not be loaded: ${err.message}; using the default material.`);
            paths.mtl = null;
          }
        }
      }
      if (glb) {
        const gltf = await gltfLoader.loadAsync(paths.obj);
        object = gltf.scene;
        parser = gltf.parser;
      } else {
        object = await requestOBJLoader.loadAsync(paths.obj);
      }
      request.object = object;
      request.paths = paths;
      const previousCommit = modelCommit;
      let release;
      modelCommit = new Promise(resolve => { release = resolve; });
      await previousCommit;
      try {
        checkModelRequest(request);
        await tagLoadedFile(object, request.data.type === 'custom' ? request.data.basedOn : name, parser, mtlText);
        checkModelRequest(request);
        prepareModelParts(object);
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

        const modelData = request.data;
        if (!modelData) { logError(`Model not found: ${name}`); return; }

        // Keep the object selector in sync with whatever is actually loading
        const _sel = document.getElementById('object-select') || document.getElementById('model-select');
        if (_sel && _sel.value !== name) _sel.value = name;

        cleanupActiveModel();

        if (modelData.type === 'custom') {
          await loadCustomModel(name, modelData, onLoaded, request);
        } else {
          await loadRegularModel(name, modelData, onLoaded, request);
        }

        checkModelRequest(request);
        materialState.init('Initial state');
        designState.init('Initial state');
        return true;
      } finally { release(); }
    } catch (err) {
      if (request !== modelRequest) {
        if (object && object === activeModel) cleanupActiveModel();
        else disposeLoadedModel(object);
        return false;
      }
      console.warn(`Model load failed: ${name}`, err);
      console.log(`Could not load ${name}: ${err.message}`);
      modelRequest = null;
      return false;
    }
  })();
  request.promise.finally(() => pendingModelLoads.delete(name));
  return request.promise;
}

// Decode a saved decals array (with imageData strings) into live overlay objects
// with decoded HTMLImageElement instances. Returns a Promise<overlay[]>.
async function _decodeDecals(decals) {
  return (await Promise.all((decals || []).map(async (saved, index) => {
    try {
      const image = await loadDesignImage(saved.imageData);
      return { ...saved, id: saved.id ?? index + 1, image, _originalDataURL: saved.imageData };
    } catch (err) { logError(`Could not restore design "${saved.name}": ${err.message}`); return null; }
  }))).filter(Boolean);
}

async function loadCustomModel(name, modelData, onLoaded = null, request) {
  log(`Loading custom model: ${name}…`);
  const loadingPaths = await modelManager.getLoadingPaths(modelData.basedOn);
  checkModelRequest(request);
  if (!loadingPaths) { logError(`Base model not found: ${modelData.basedOn}`); return; }

  await materialPresetsReady;
  checkModelRequest(request);

  // ── Determine schema version ──────────────────────────────────────────────
  const isV3 = !!(modelData.parts && modelData.version >= 3);

  // For v2 compat: pre-decode the single overlay set in parallel with geometry load
  const v2OverlayPreload = (!isV3 && modelData.overlayImages?.length > 0)
    ? _decodeDecals(modelData.overlayImages) : Promise.resolve([]);

  // For v3: pre-decode decals for every part in parallel with geometry load.
  // Unsaved design edits stored per part (design-meta) take precedence over the
  // decals saved in the custom model.
  const pid = getActiveProjectIdSync();
  const v3DecalPreload = isV3
    ? Object.fromEntries(await Promise.all(
        Object.entries(modelData.parts).map(async ([pName, pData]) => {
          const working = pid ? await loadDesignLayersFromCache(pid, name, pName) : null;
          checkModelRequest(request);
          const decals = await _decodeDecals(working || pData.decals);
          checkModelRequest(request);
          return [pName, decals];
        })
      ))
    : {};

  // ── Load base geometry ────────────────────────────────────────────────────
  const normalizePartNames = STANDARD_OBJECTS.some(model => model.objPath.endsWith('.glb') && model.objPath === loadingPaths.sourcePath);
  const object = request.object;
  checkModelRequest(request);

  convertObjectToPhysical(object);

  // ── Name the parts; bindLoadedParts assigns their materials ───────────────
  const meshList = [];
  _partCache = {}; // clear stale part cache from previous model

  object.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;
    child.userData.isCustomModel = true;

    let baseName = (normalizePartNames ? child.name.replace(/_1$/, '') : child.name) || 'Part';
    let uniqueName = baseName;
    let idx = 1;
    while (meshMap[uniqueName]) uniqueName = `${baseName}_${idx++}`;
    child.name = uniqueName;

    meshList.push(child);
    meshMap[child.name] = child;
    if (!activeMesh) activeMesh = child;
  });

  sceneManager.add(object);
  activeModel = object;
  propManager.setMainModel(activeModel);
  activeMesh = meshList.find(mesh => v3DecalPreload[mesh.name]?.length) || meshList[0] || null;

  const names = meshList.map(m => m.name);
  controls.updatePartSelect(names);
  uvEditor.setPartNames(names, (n) => selectPart(meshMap[n]));
  if (activeMesh) {
    controls.elements.objectPartSelect.value = activeMesh.name;
    const designPartSelect = document.getElementById('design-part-select');
    if (designPartSelect) designPartSelect.value = activeMesh.name;
  }
  const multi = names.length > 1;
  controls.setEnabled('objectPartSelect', multi);
  controls.setVisible('objectPartSelect', multi);

  // ── Link every part to the library + open UV editor ──────────────────────
  _channelMapData.clear();

  if (isV3) {
    // Pre-populate _partCache for all parts so selectPart can restore them immediately
    for (const partName of Object.keys(modelData.parts)) {
      _partCache[partName] = { overlayImages: v3DecalPreload[partName] || [] };
    }
  }
  const savedParts = isV3 ? modelData.parts : null;
  const legacyWhole = { materialId: modelData.materialId, materialPreset: modelData.materialPreset, materialData: modelData.materialProperties };
  await bindLoadedParts(name, request, partName => (isV3 ? savedParts[partName] : legacyWhole));
  checkModelRequest(request);

  if (activeMesh) {
    const overlays = isV3 ? (_partCache[activeMesh.name]?.overlayImages || []) : await v2OverlayPreload;
    checkModelRequest(request);
    updateMaterialPresetList();
    syncActiveMaterialView();
    uvEditor.activeModelName = modelData.basedOn;
    uvEditor.customModelName = name;
    // Open UV editor with pre-decoded overlays for first part
    uvEditor.openWithPreloadedData(activeMesh, name, { basedOn: modelData.basedOn }, overlays, libIdOf(activeMesh));
    syncActiveMaterialView();
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

  // Capture initial mat-thumbs for all parts so the dropdown shows them immediately
  const _loadedModelName = name;
  Object.keys(meshMap).forEach(pn => scheduleMatThumbUpdate(_loadedModelName, pn));

  await restoreModelTransform(name, object, request);
  _onModelReady(object);
  if (onLoaded) onLoaded(object);
}

// ─── Per-part material link ──────────────────────────────────────────────────
// metadata part-material:${pid}:${model}:${part} → { version: 2, materialId, fromFile }
// Only the link is stored per part; definitions are in the library. fromFile: the part
// still uses what its file gave it, so it follows if that material comes back.

function libIdOf(mesh) {
  return mesh?.material?.userData?.libId ?? null;
}

function schedulePartMaterialSave() {
  if (!_persistenceReady) return;
  const pid = getActiveProjectIdSync();
  const modelName = getCurrentModelName();
  const mesh = activeMesh;
  const materialId = libIdOf(mesh);
  if (!pid || !modelName || !materialId) return;
  const record = { version: 2, materialId, fromFile: materialId === mesh.userData.fileMaterialId };
  scheduleWrite(`part-material:${pid}:${modelName}:${mesh.name}`,
    () => IDBStorage.put('metadata', partMaterialKey(pid, modelName, mesh.name), record),
    { label: `material (${mesh.name})` });
  commitActiveDefinition();
}

async function _loadPartMaterial(pid, modelName, partName) {
  try {
    return await IDBStorage.get('metadata', partMaterialKey(pid, modelName, partName));
  } catch (err) {
    log(`Could not load material for ${partName}: ${err.message}`, true);
    return null;
  }
}

// Give a just-loaded part the instance its library entry calls for.
async function _bindPart(mesh, id, fileId) {
  const entry = materialLibrary.get(id);
  if (id === fileId) {
    // The file's own material is already on the part; put this project's changes on it
    materialManager.applySavedProperties(mesh.material, entry.params);
    mesh.material.name = entry.name;
    for (const channel of new Set([...Object.keys(entry.channelMaps), ...entry.clearedChannels])) {
      mesh.material[channel] = await materialLibrary.channelTexture(id, channel);
    }
    mesh.material.needsUpdate = true;
    return;
  }
  let instance;
  try {
    instance = await materialLibrary.createInstance(id);
  } catch (err) {
    logError(`Could not load textures of "${entry.name}": ${err.message}`);
    instance = await materialLibrary.createPreview(id);
  }
  materialManager.applyEnvironment(instance, sceneManager.getScene().environment);
  materialManager.dispose(mesh.material);
  mesh.material = instance;
}

// Link every part of a just-loaded model to the library. In order: the part's saved
// link, then the saved custom model's part, then the file's own material, then the fallback.
async function bindLoadedParts(modelName, request, savedPart = () => null) {
  const pid = getActiveProjectIdSync();
  _originalCustomDefinitions.clear();
  const meshes = Object.entries(meshMap);

  // The file's pristine materials: base values, and textures for anything built on them
  for (const [, mesh] of meshes) {
    const fileId = libIdOf(mesh);
    mesh.userData.fileMaterialId = fileId;
    if (fileId && !materialLibrary.hasSource(fileId)) {
      materialLibrary.registerSource(fileId, mesh.material.clone());
      scheduleThumbnailUpdate(fileId); // now with the real textures
    }
  }

  const ops = [];
  const migratedModelParts = {};
  const links = [];
  for (const [partName, mesh] of meshes) {
    const fileId = mesh.userData.fileMaterialId;
    const record = pid ? await _loadPartMaterial(pid, modelName, partName) : null;
    checkModelRequest(request);
    const saved = savedPart(partName);
    const defaultId = saved?.materialId ?? fileId ?? materialLibrary.fallbackId();

    let desired;
    if (record?.materialId !== undefined && record?.materialId !== null) {
      desired = record.fromFile ? (fileId ?? record.materialId) : record.materialId;
    } else if (record) {
      desired = migrateLegacyPart(materialLibrary, defaultId, record, partName, ops);
    } else if (saved && saved.materialId === undefined && saved.materialData) {
      // A custom model part that used its file's material before the library
      const { channelMaps, ...props } = saved.materialData;
      desired = migrateLegacyPart(materialLibrary, fileId ?? materialLibrary.fallbackId(), { props, channelMaps }, partName, ops);
      migratedModelParts[partName] = desired;
    } else {
      desired = defaultId;
    }
    const id = materialLibrary.resolveId(desired);
    links.push({ partName, mesh, fileId, id, record });

    mesh.userData.originalMaterialId = migratedModelParts[partName] ?? saved?.materialId ?? fileId ?? materialLibrary.fallbackId();
  }
  // Any new custom materials are stored before a record points at them
  if (ops.length) await IDBStorage.batch(ops);

  const linkOps = [];
  for (const { partName, mesh, fileId, id, record } of links) {
    await _bindPart(mesh, id, fileId);
    checkModelRequest(request);
    const fromFile = id === fileId;
    if (pid && (record?.materialId !== id || record?.fromFile !== fromFile)) {
      linkOps.push({ type: 'put', store: 'metadata', key: partMaterialKey(pid, modelName, partName), value: { version: 2, materialId: id, fromFile } });
    }
    const entry = materialLibrary.get(mesh.userData.originalMaterialId);
    if (entry?.origin === 'custom' && !_originalCustomDefinitions.has(entry.id)) {
      _originalCustomDefinitions.set(entry.id, structuredClone(entry));
    }
    scheduleThumbnailUpdate(id);
  }
  if (linkOps.length) await IDBStorage.batch(linkOps);
  if (Object.keys(migratedModelParts).length) await modelManager.storage.setPartMaterialIds(modelName, migratedModelParts);
  updateMaterialPresetList();
  syncChannelView();
}

// The dropdown and channel slots show the active part's material.
function syncChannelView() {
  _channelMapData.clear();
  const entry = materialLibrary.get(libIdOf(activeMesh));
  for (const [channel, dataUrl] of Object.entries(entry?.channelMaps || {})) _channelMapData.set(channel, dataUrl);
}

function syncMaterialDropdown() {
  const id = libIdOf(activeMesh);
  if (!id) return;
  controls.setMaterialPresetValue(id, id === FALLBACK_ID ? 'White (no material)' : null);
}

// Everything that shows the active part's material, reading real values rather than
// sticker overrides.
function syncActiveMaterialView() {
  if (!activeMesh?.material) return;
  syncChannelView();
  syncMaterialDropdown();
  uvEditor.withOriginalMaterialValues(activeMesh, () => {
    controls.syncMaterialUI(activeMesh.material, getChannelThumbnailOverrides());
  });
  nodeEditorManager.syncMaterialProps(materialLibrary.get(libIdOf(activeMesh))?.params);
}

async function _restoreDesignLayersForPart(partName) {
  const pid = getActiveProjectIdSync();
  const modelName = getCurrentModelName();
  if (!pid || !modelName || !partName) return;
  const layers = await loadDesignLayersFromCache(pid, modelName, partName);
  if (!layers || activeMesh?.name !== partName) return;
  await uvEditor.restoreSessionState({
    overlayImages: layers,
    selectedImageId: null,
    nextImageId: layers.reduce((m, l) => Math.max(m, l.id + 1), 0),
  });
}

// Runs once a loaded model is in the scene
async function restoreModelTransform(name, object, request) {
  const pid = getActiveProjectIdSync();
  const transform = pid ? await IDBStorage.get('metadata', modelTransformKey(pid, name)) : null;
  checkModelRequest(request);
  if (transform && object === activeModel) propManager.applyMainModelTransform(transform);
}

function _onModelReady(object) {
  nodeEditorManager.setSelection(getCurrentModelName(), activeMesh?.name || '—');
  // Wireframe / vertex-colour toggles apply to whatever model is loaded
  const wire = document.getElementById('preview-toggle-wireframe')?.checked;
  const vcol = document.getElementById('preview-toggle-vertexcolors')?.checked;
  if (wire || vcol) {
    object.traverse((child) => {
      if (!child.isMesh || !child.material) return;
      if (wire) child.material.wireframe = true;
      if (vcol) child.material.vertexColors = true;
      child.material.needsUpdate = true;
    });
  }
  scheduleSessionSave();
}

async function loadRegularModel(name, _modelData, onLoaded = null, request) {
  log(`Loading ${name}…`);
  const loadingPaths = await modelManager.getLoadingPaths(name);
  checkModelRequest(request);
  if (!loadingPaths) { logError(`No paths for ${name}`); return; }

  const normalizePartNames = STANDARD_OBJECTS.some(model => model.objPath.endsWith('.glb') && model.objPath === loadingPaths.sourcePath);

  // ── GLB/GLTF branch ───────────────────────────────────────────
  if (loadingPaths.type === 'glb-path' || loadingPaths.type === 'glb-blob') {
    {
      const object = request.object;
      checkModelRequest(request);
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
        let baseName = (normalizePartNames ? child.name.replace(/_1$/, '') : child.name) || 'Part';
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
      await bindLoadedParts(name, request);
      checkModelRequest(request);
      syncActiveMaterialView();
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
      if (activeMesh) {
        await uvEditor.open(activeMesh, name, libIdOf(activeMesh));
        checkModelRequest(request);
        await _restoreDesignLayersForPart(activeMesh.name);
        checkModelRequest(request);
      }
      markNeedsRender(60);
      await restoreModelTransform(name, object, request);
      _onModelReady(object);
      if (onLoaded) onLoaded(object);
    }
    return;
  }

  async function loadOBJ(materials = null) {
    const hasMtl = !!materials; // track whether MTL materials were provided

    {
      const object = request.object;
      checkModelRequest(request);
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

      convertObjectToPhysical(object);
      // With an MTL its materials are the parts' native materials. Without one the
      // parts have none, and bindLoadedParts links them to the fallback.
      if (hasMtl) convertObjectToPhysical(object);
      applyTexQualityToObject(object);
      await bindLoadedParts(name, request);
      checkModelRequest(request);
      syncActiveMaterialView();

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
        await uvEditor.open(activeMesh, name, libIdOf(activeMesh));
        checkModelRequest(request);
        await _restoreDesignLayersForPart(activeMesh.name);
        checkModelRequest(request);
      }
      markNeedsRender(60);
      await restoreModelTransform(name, object, request);
      _onModelReady(object);
      if (onLoaded) onLoaded(object);
    }
  }

  await loadOBJ(loadingPaths.mtl ? true : null);
  checkModelRequest(request);
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
  performanceModeEnabled = performanceModeOverride ?? (_activeModelFaceCount > HIGH_POLY_THRESHOLD);
  if (toggle) toggle.checked = performanceModeEnabled;
  if (!performanceModeEnabled) rendererManager.exitOrbitPerfMode();
  updatePolyWarning(_activeModelFaceCount);
  updatePerfModeUI();
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
    _channelMapData.clear();
    _partCache = {};
    _pendingOtherPartEdits.clear();
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

const _matThumbCache = new Map(); // library id → dataUrl, for the current project only

// Thumbnails persist across page loads under blobs preset-thumb:${pid}:${enc(id)}: every
// material of every origin, per project. They are derived data, so a failed write only
// costs a re-render.
async function loadCachedThumbnails(pid) {
  _matThumbCache.clear();
  try {
    const prefix = materialThumbPrefix(pid);
    const keys = await IDBStorage.getAllKeys('blobs', prefix);
    await Promise.all(keys.map(async (key) => {
      const id = decodeURIComponent(key.slice(prefix.length));
      const dataUrl = materialLibrary.get(id) ? await IDBStorage.get('blobs', key) : null;
      if (dataUrl) _matThumbCache.set(id, dataUrl);
    }));
  } catch (err) {
    console.warn('Thumbnail cache load failed:', err);
  }
}

function _storeMaterialThumb(id, dataUrl) {
  const pid = getActiveProjectIdSync();
  if (pid) IDBStorage.put('blobs', materialThumbKey(pid, id), dataUrl).catch(() => {});
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

  for (const id of materialLibrary.listedIds()) {
    // Assign a preview material and compile its shader asynchronously.
    // compileAsync uses KHR_parallel_shader_compile if available: the GPU links
    // the program in parallel while JS is suspended, then the Promise resolves.
    // On browsers without the extension it falls back to synchronous compile.
    const mat = await materialLibrary.createPreview(id);
    if (env) materialManager.applyEnvironment(mat, env);
    _warmupSphereMesh.material = mat;
    await renderer.compileAsync(_warmupScene, _warmupCamera);

    // Thumbnail — skip if already loaded from IDB cache
    if (!_matThumbCache.has(id)) {
      _thumbSphereMesh.material = mat;
      _thumbRenderer.render(_thumbScene, _thumbCamera);
      const dataUrl = _thumbRenderer.domElement.toDataURL();
      _matThumbCache.set(id, dataUrl);
      _storeMaterialThumb(id, dataUrl);
    }
    mat.dispose();

    // Yield to keep the render loop responsive between presets
    await new Promise(resolve => requestAnimationFrame(resolve));
  }

  // Warmup resets cached preset instances — re-apply sticker state
  uvEditor.reapplyDecalState();

  // All thumbnails are now cached — refresh the material list so they appear.
  updateMaterialPresetList();
}

// Assign a library material to a part (the active one by default). Other parts keep theirs.
// If its textures can't be loaded the part stays as it was. Returns whether it changed.
async function applyMaterialPreset(id, { mesh = activeMesh, persist = true } = {}) {
  if (!activeModel || !mesh) return false;
  const entry = materialLibrary.get(id);
  let instance;
  try {
    if (!entry) throw new Error('it no longer exists');
    instance = await materialLibrary.createInstance(id);
  } catch (err) {
    logError(`Could not assign "${entry?.name ?? id}": ${err.message}`);
    if (mesh === activeMesh) syncMaterialDropdown();
    return false;
  }
  if (!mesh.material) { instance.dispose(); return false; } // the model was unloaded meanwhile

  materialManager.applyEnvironment(instance, sceneManager.getScene().environment);
  instance.wireframe = mesh.material.wireframe;
  instance.vertexColors = mesh.material.vertexColors;
  // A logo stays on the part and is composited over the new material
  uvEditor.replacePartMaterial(mesh, instance, old => materialManager.dispose(old));

  if (mesh === activeMesh) {
    uvEditor.currentMaterialPreset = id;
    uvEditor._renderPreview();
    syncActiveMaterialView();
    // Render immediately so transmission materials create their internal
    // render target on the first frame (compile() alone doesn't do this).
    rendererManager.render(sceneManager.getScene(), cameraManager.getCamera());
    if (persist) schedulePartMaterialSave();
  }
  markNeedsRender(8);
  scheduleMatThumbUpdate(getCurrentModelName(), mesh.name);
  log(`Material: ${entry.name}`);
  return true;
}

// ─── Applying definitions across parts ──────────────────────────────────────
function partsUsing(id) {
  return Object.values(meshMap).filter(mesh => libIdOf(mesh) === id);
}

function setPartChannel(mesh, channel, texture) {
  mesh.material[channel] = texture;
  mesh.material.needsUpdate = true;
  // On a part with a logo this makes the texture its clean base and re-composites over it
  uvEditor.notifyPartChannelChanged(mesh, channel, texture);
}

// Put a whole definition on every loaded part using it.
async function applyDefinitionToLiveParts(id) {
  const entry = materialLibrary.get(id);
  if (!entry) return;
  const applySaved = (material, params) => materialManager.applySavedProperties(material, params);
  for (const mesh of partsUsing(id)) {
    uvEditor.applyPartDefinition(mesh, entry.params, applySaved);
    mesh.material.name = entry.name;
    for (const channel of CHANNELS) {
      let texture;
      try {
        texture = await materialLibrary.channelTexture(id, channel);
      } catch (err) {
        logError(`Could not load ${channel} of "${entry.name}": ${err.message}`);
        continue;
      }
      if (mesh.material && texture !== uvEditor.getPartCleanChannel(mesh, channel)) setPartChannel(mesh, channel, texture ?? null);
    }
  }
  markNeedsRender(8);
}

// Change one texture channel of a definition, on every loaded part using it.
// value: data URL = uploaded, null = cleared, undefined = back to what the file has.
async function setDefinitionChannel(id, channel, value) {
  const entry = materialLibrary.get(id);
  if (!entry) return false;
  const previous = entry.channelMaps[channel] ?? (entry.clearedChannels.includes(channel) ? null : undefined);
  materialLibrary.setChannel(id, channel, value);
  let texture;
  try {
    texture = await materialLibrary.channelTexture(id, channel);
  } catch (err) {
    materialLibrary.setChannel(id, channel, previous);
    logError(`Could not load texture for "${entry.name}": ${err.message}`);
    return false;
  }
  for (const mesh of partsUsing(id)) setPartChannel(mesh, channel, texture ?? null);
  syncChannelView();
  scheduleLibraryWrite(id);
  scheduleThumbnailUpdate(id);
  markNeedsRender(4);
  return true;
}

function scheduleLibraryWrite(id) {
  const pid = getActiveProjectIdSync();
  const entry = materialLibrary.get(id);
  if (!_persistenceReady || !pid || !entry) return;
  scheduleWrite(`material:${pid}:${id}`, () => materialLibrary.persist(id), { label: `material "${entry.name}"` });
}

// The active part's values become its material's definition. Called after every committed
// change; the record holds only what differs from the shipped or file values.
function commitActiveDefinition() {
  const id = libIdOf(activeMesh);
  if (!id) return;
  if (materialLibrary.setParams(id, extractPropertiesForPreset(activeMesh.material))) scheduleLibraryWrite(id);
}

// ─── Material history ───────────────────────────────────────────────────────
function captureMaterialState() {
  const id = libIdOf(activeMesh);
  const entry = materialLibrary.get(id);
  if (!entry) return null;
  return {
    partName: activeMesh.name,
    materialId: id,
    materialProperties: extractPropertiesForPreset(activeMesh.material),
    channelMaps: { ...entry.channelMaps },
    clearedChannels: [...entry.clearedChannels],
  };
}

// Undo and redo change the definition, so every part linked to it follows, and put the
// part back on the material it had then.
async function applyMaterialHistoryState(state) {
  const id = state.materialId;
  if (!materialLibrary.get(id)) return;
  materialLibrary.setParams(id, state.materialProperties);
  materialLibrary.setChannels(id, state.channelMaps, state.clearedChannels);
  const mesh = meshMap[state.partName];
  if (mesh && libIdOf(mesh) !== id) await applyMaterialPreset(id, { mesh, persist: false });
  await applyDefinitionToLiveParts(id);
  scheduleLibraryWrite(id);
  syncActiveMaterialView();
  markNeedsRender(4);
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

// Restores the active part to the material it loaded with, and that material to its
// original values, so every part linked to it follows. Brings it back if it was deleted.
// Pushes undo history so the user can revert the restore with Ctrl+Z.
async function restoreOriginalMaterial() {
  const mesh = activeMesh;
  const id = mesh?.userData.originalMaterialId;
  if (!id) { log('No original material for this part.', true); return; }
  materialState.push('Before restore original');

  await flushWrites();
  try {
    await materialLibrary.restoreOriginal(id, _originalCustomDefinitions.get(id));
  } catch (err) {
    log(`Could not restore "${materialLibrary.get(id)?.name ?? id}": ${err.message}`, true);
    return;
  }
  if (!materialLibrary.get(id)) { log('The original material is no longer available.', true); return; }
  _matThumbCache.delete(id);
  if (libIdOf(mesh) !== id && !await applyMaterialPreset(id, { mesh })) return;
  await applyDefinitionToLiveParts(id);
  updateMaterialPresetList();
  syncActiveMaterialView();
  scheduleThumbnailUpdate(id);

  materialState.push('Restored original material');
  schedulePartMaterialSave();
  markNeedsRender(4);
  log('Original material restored.');
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
  const id = libIdOf(activeMesh);
  if (!id) return;
  // Disconnecting an image clears the channel
  if (await setDefinitionChannel(id, channel, dataUrl || null)) {
    syncActiveMaterialView();
    markNeedsRender();
  }
}

// Parts with a logo re-composite at full size, so a slider's stream of values reaches
// those a moment later; everything else is immediate.
const _pendingOtherPartEdits = new Map(); // mesh → { property: value }
let _otherPartEditTimer = null;

function flushOtherPartEdits() {
  clearTimeout(_otherPartEditTimer);
  _otherPartEditTimer = null;
  for (const [mesh, edits] of _pendingOtherPartEdits) {
    if (!mesh.material) continue;
    for (const [property, value] of Object.entries(edits)) uvEditor.updatePartMaterial(mesh, property, value);
  }
  _pendingOtherPartEdits.clear();
}

function applyPropertyToOtherParts(id, property, value) {
  for (const mesh of partsUsing(id)) {
    if (mesh === activeMesh) continue;
    if (!uvEditor.hasPartDesign(mesh)) {
      uvEditor.updatePartMaterial(mesh, property, value);
      continue;
    }
    _pendingOtherPartEdits.set(mesh, { ...(_pendingOtherPartEdits.get(mesh) || {}), [property]: value });
    if (!_otherPartEditTimer) _otherPartEditTimer = setTimeout(flushOtherPartEdits, 100);
  }
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
  // The edit is to the material, so every part linked to it shows it live
  applyPropertyToOtherParts(libIdOf(activeMesh), property, value);
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
    scheduleProjectSettingsSave();
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
  // Helpers: link slider ↔ input (each change is saved to settings/${pid})
  const link = (sliderId, inputId, callback) => {
    const s = document.getElementById(sliderId);
    const i = document.getElementById(inputId);
    if (!s || !i) return;
    s.addEventListener('input', () => { i.value = s.value; callback(parseFloat(s.value)); scheduleProjectSettingsSave(); });
    i.addEventListener('input', () => {
      const v = parseFloat(i.value);
      if (!isNaN(v)) { s.value = v; callback(v); scheduleProjectSettingsSave(); }
    });
  };

  // Camera type
  const typeSelect = document.getElementById('camera-type-select');
  if (typeSelect) {
    typeSelect.addEventListener('change', (e) => {
      camState.type = e.target.value;
      _applyCameraType();
      scheduleProjectSettingsSave();
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

  const applyDOF = () => {
    _applyCameraDOF();
    scheduleProjectSettingsSave();
  };

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

function _applyCameraType() {
  // Orthographic camera swap would need deeper integration;
  // for now we just update FOV approach or set very high FOV
  if (camState.type === 'orthographic') {
    cameraManager.getCamera().fov = 1; // Near-orthographic
  } else {
    cameraManager.getCamera().fov = computeFOV(camState.focalLength, camState.sensorKey);
  }
  cameraManager.getCamera().updateProjectionMatrix();
}

function _applyCameraDOF() {
  rendererManager.setDOF(camState.dofEnabled, camState.dofFocus, camState.dofAperture, camState.dofMaxBlur, camState.dofRings);
  markNeedsRender(4);
}

// Apply a saved camState (settings/${pid}.camera) and bring every camera control in line
function restoreCameraSettings(saved) {
  if (!saved || typeof saved !== 'object') return;
  Object.assign(camState, saved);
  const setVal = (id, v) => { const el = document.getElementById(id); if (el && v !== undefined) el.value = v; };
  const selectButton = (groupId, value) => {
    document.getElementById(groupId)?.querySelectorAll('button').forEach(b => {
      b.classList.toggle('button-selected', parseFloat(b.dataset.value) === parseFloat(value) || b.dataset.value === String(value));
    });
  };
  setVal('camera-type-select', camState.type);
  setVal('lens-mm-slider', camState.focalLength);           setVal('lens-mm-input', camState.focalLength);
  selectButton('lens-mm-buttons', camState.focalLength);
  selectButton('film-gauge-buttons', camState.sensorKey);
  setVal('near-slider', camState.near);                     setVal('near-input', camState.near);
  setVal('far-slider', camState.far);                       setVal('far-input', camState.far);
  selectButton('tone-mapping-buttons', camState.toneMapping);
  setVal('exposure-slider', camState.exposure);             setVal('exposure-input', camState.exposure);
  const dofToggle = document.getElementById('cam-toggle-dof');
  if (dofToggle) dofToggle.checked = !!camState.dofEnabled;
  setVal('cam-dof-focus-slider', camState.dofFocus);        setVal('cam-dof-focus-input', camState.dofFocus);
  setVal('cam-dof-strength-slider', camState.dofAperture);  setVal('cam-dof-strength-input', camState.dofAperture);
  setVal('cam-dof-maxblur-slider', camState.dofMaxBlur);    setVal('cam-dof-maxblur-input', camState.dofMaxBlur);
  setVal('cam-dof-rings-slider', camState.dofRings);        setVal('cam-dof-rings-input', camState.dofRings);
  applyCameraSettings();
  _applyCameraType();
  _applyCameraDOF();
}

//═══════════════════════════════════════════════════════════════
// UI CONTROLS
//═══════════════════════════════════════════════════════════════

const controls = new ControlsManager({
  onGridChange: (field, value) => {
    // Grid size input is in display units (cm or in); convert to Three.js units (1 unit = 1 cm)
    tfGridCfg[field] = (field === 'size' && measureUnit === 'in') ? value * 2.54 : value;
    rebuildGrid();
    if (tfSnapOn) applySnapState();
    scheduleProjectSettingsSave();
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
    currentEnvironment = sceneName;
    scheduleProjectSettingsSave();
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
    nodeEditorManager.syncMaterialProp(property, value);
  },

  onMaterialPropertyCommit: () => {
    flushOtherPartEdits();
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
    // An import may overwrite a model and its working state — let pending writes land first
    await flushWrites();
    const result = await modelManager.importCustomModel(file);
    if (result.success) {
      logSuccess(`Imported: ${result.name}`);
      updateMaterialPresetList();
      scheduleAllMissingThumbnails();
      await updateModelList();
      loadModel(result.name);
      window.selectModelInDropdown(result.name);
    } else {
      logError(`Import failed: ${result.error}`);
    }
  },

  onChannelTextureUpload: (channel, file) => {
    const id = libIdOf(activeMesh);
    if (!id) { logError('No active mesh'); return; }
    const reader = new FileReader();
    reader.onload = async (e) => {
      void IDBStorage.requestPersistentStorage();
      if (!await setDefinitionChannel(id, channel, e.target.result)) return;
      materialState.push('Channel uploaded');
      syncActiveMaterialView();
      log(`Channel "${channel}" texture set: ${file.name}`);
    };
    reader.readAsDataURL(file);
  },

  onChannelTextureClear: async (channel) => {
    const id = libIdOf(activeMesh);
    if (!id) return;
    if (!await setDefinitionChannel(id, channel, null)) return;
    materialState.push('Channel cleared');
    syncActiveMaterialView();
    log(`Channel "${channel}" cleared`);
  },

  onChannelTextureMove: async (fromChannel, toChannel) => {
    const id = libIdOf(activeMesh);
    if (!id) return;
    // Prefer the uploaded data URL; otherwise extract from the channel's texture (GLB-embedded etc.)
    const dataUrl = materialLibrary.get(id).channelMaps[fromChannel]
      ?? textureToDataURL(await materialLibrary.channelTexture(id, fromChannel));
    if (!dataUrl) return;
    materialState.push(`Before move: ${fromChannel} → ${toChannel}`);
    if (!await setDefinitionChannel(id, toChannel, dataUrl)) return;
    await setDefinitionChannel(id, fromChannel, null);
    materialState.push(`Channel moved: ${fromChannel} → ${toChannel}`);
    syncActiveMaterialView();
    log(`Channel "${fromChannel}" moved to "${toChannel}"`);
  },

  onClearCustom: async () => {
    const names = await modelManager.storage.getAllCustomModelNames();
    if (names.length === 0) { log('No custom models to clear'); return; }
    if (!confirm(`Delete all ${names.length} custom model(s) and their saved designs and materials? This cannot be undone!`)) return;
    if (await deleteModelsFromLibrary(names)) logSuccess(`Cleared ${names.length} custom model(s)`);
  },

  onDeleteModel: async (name) => {
    // Custom models built on this one can't load without it — they go too
    const dependents = await modelManager.getCustomModelsBasedOn(name);
    const extra = dependents.length
      ? `\n\nThese custom models are based on it and will also be deleted:\n${dependents.map(n => `• ${n}`).join('\n')}`
      : '';
    if (!confirm(`Delete "${name}" and its saved designs and materials?${extra}\n\nThis cannot be undone.`)) return;
    if (await deleteModelsFromLibrary([name, ...dependents])) logSuccess(`Deleted: ${[name, ...dependents].join(', ')}`);
  },

  onRestoreStandard: async () => {
    registerBuiltInModels();
    await flushWrites();
    let restored = [];
    try {
      restored = await materialLibrary.restoreDeletedNatives();
    } catch (err) {
      logError(`Could not restore object materials: ${err.message}`);
    }
    restored.forEach(id => _matThumbCache.delete(id));
    updateMaterialPresetList();
    scheduleAllMissingThumbnails();
    await updateModelList();
    logSuccess('Standard objects restored');
  },
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
    for (const mesh of partsUsing(oldId)) mesh.material.userData.libId = newId;
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
  if (!mesh) return;
  _snapshotCurrentPart();
  clearHighlight();
  activeMesh = mesh;

  syncChannelView();
  syncMaterialDropdown();

  // Pass cached overlays (already-decoded Image objects) — skips IDB read
  const cached = _partCache[mesh.name];
  const preloadedOverlays = cached ? cached.overlayImages : null;
  await uvEditor.open(activeMesh, getCurrentModelName(), libIdOf(activeMesh), preloadedOverlays);
  // If this part hasn't been visited this session, restore its design layers from IDB
  if (!cached && activeMesh === mesh) await _restoreDesignLayersForPart(mesh.name);
  if (activeMesh !== mesh) return;

  const sel = controls.elements.objectPartSelect;
  if (sel) sel.value = mesh.name;
  const designSel = document.getElementById('design-part-select');
  if (designSel) designSel.value = mesh.name;
  nodeEditorManager.setSelection(getCurrentModelName(), mesh.name);
  // After open(): a part with a design keeps its sticker overrides on the material
  syncActiveMaterialView();

  if (!_backfaceCullingOn && activeMesh?.material) {
    _applyFrontBackShader(activeMesh);
  }
  scheduleSessionSave();
}


function getCurrentModelName() {
  return document.getElementById('object-select')?.value
    || document.getElementById('model-select')?.value || '';
}

function waitForModelReady() {
  return modelRequest?.promise || Promise.resolve(false);
}

// ─── Session and project settings ────────────────────────────────────────────
// metadata session:${pid} → what was open:
//   { version: 2, modelName, partName, activeCustomScene, props, mainModelTransform }
// settings/${pid}          → { camera, view, renderer, preview, background, environment, ui }
// Both are written a short time after each change and flushed when the page is
// hidden. Writes stay off (_persistenceReady) until startup has applied the stored
// values, so the defaults built during startup never overwrite them.

function collectSession() {
  return {
    version:   2,
    modelName: getCurrentModelName() || null,
    partName:  activeMesh?.name || null,
    activeCustomScene: document.getElementById('scene-select')?.value || null,
    props:     propManager.getSceneData(),
    mainModelTransform: propManager.getMainModelTransform(),
  };
}

function scheduleModelTransformSave() {
  const pid = getActiveProjectIdSync();
  const name = getCurrentModelName();
  const transform = propManager.getMainModelTransform();
  if (!_persistenceReady || !pid || !name || !transform) return;
  scheduleWrite(`transform:${pid}:${name}`, () => IDBStorage.put('metadata', modelTransformKey(pid, name), transform), { label: 'model transform' });
}

function scheduleSessionSave() {
  const pid = getActiveProjectIdSync();
  if (!_persistenceReady || !pid) return;
  scheduleWrite(`session:${pid}`,
    () => IDBStorage.put('metadata', sessionKey(pid), collectSession()),
    { label: 'session' });
}

// Preview-quality controls captured in settings/${pid}.preview
const PREVIEW_TOGGLES = {
  shadows:      'preview-toggle-shadows',
  wireframe:    'preview-toggle-wireframe',
  helpers:      'preview-toggle-helpers',
  vertexColors: 'preview-toggle-vertexcolors',
  culling:      'preview-toggle-culling',
};
const PREVIEW_BUTTON_ROWS = ['shadow-quality-buttons', 'texture-filtering-buttons', 'max-dpr-buttons', 'render-scale-buttons'];

function _selectedButtonValue(groupId) {
  return document.querySelector(`#${groupId} button.button-selected`)?.dataset.value ?? null;
}

function collectProjectSettings() {
  const cam = cameraManager.getCamera();
  const orbit = cameraManager.getControls();
  const preview = { buttons: {} };
  for (const [name, id] of Object.entries(PREVIEW_TOGGLES)) {
    const el = document.getElementById(id);
    if (el) preview[name] = el.checked;
  }
  for (const id of PREVIEW_BUTTON_ROWS) preview.buttons[id] = _selectedButtonValue(id);
  const inputVal = (id) => document.getElementById(id)?.value ?? null;

  return {
    camera:   { ...camState },
    view: {
      position: { x: cam.position.x, y: cam.position.y, z: cam.position.z },
      target:   orbit ? { x: orbit.target.x, y: orbit.target.y, z: orbit.target.z } : null,
    },
    renderer: rendererManager.getState(),
    preview,
    controls: collectControlPreferences(),
    performanceModeOverride,
    background: { showEnvBackground, gradientBgEnabled, currentGradientBg },
    environment: document.getElementById('environment-select')?.value || currentEnvironment,
    ui: {
      transformMode: propManager.transformMode,
      extractor: CompactColorPicker.getExtractorPreferences(),
      gridOn:         tfGridOn,
      gridInputs:     { size: inputVal('grid-size-input'), divisions: inputVal('grid-divisions-input'), subdivisions: inputVal('grid-subdivisions-input') },
      snapOn:         tfSnapOn,
      snapGrid:       tfSnapGrid,
      snapVertex:     tfSnapVertex,
      measureUnit,
      dimLabels:      tfDimLabelsOn,
      labelsParallel: tfLabelsParallel,
      editMode:       tfEditModeOn,
      wrapImages:      uvEditor._wrapImages,
      lockAspectRatio: uvEditor._lockAspectRatio,
    },
  };
}

function scheduleProjectSettingsSave() {
  const pid = getActiveProjectIdSync();
  if (!_persistenceReady || !pid) return;
  scheduleProjectSettings(pid, collectProjectSettings);
}

// Page hidden or closing — capture the latest state and run every pending write now
function flushAllWrites() {
  scheduleSessionSave();
  scheduleProjectSettingsSave();
  flushWrites();
}

// Apply settings/${pid} to the scene and every control (preview settings are
// applied separately, once a model is loaded — see restorePreviewSettings).
function restoreProjectSettings(s) {
  if (!s) return;
  if (typeof s.performanceModeOverride === 'boolean') {
    performanceModeOverride = s.performanceModeOverride;
    if (activeModel) checkAndApplyPolyPerf(activeModel);
  }
  if (s.ui?.extractor) CompactColorPicker.setExtractorPreferences(s.ui.extractor);
  if (s.camera) restoreCameraSettings(s.camera);
  if (s.renderer) {
    rendererManager.applyState(s.renderer);
    rendererManager.syncUI();
  }
  if (s.background) {
    if (typeof s.background.showEnvBackground === 'boolean') showEnvBackground = s.background.showEnvBackground;
    if (typeof s.background.gradientBgEnabled === 'boolean') gradientBgEnabled = s.background.gradientBgEnabled;
    if (typeof s.background.currentGradientBg === 'string')  currentGradientBg = s.background.currentGradientBg;
    const envBgToggle = document.getElementById('env-bg-toggle');
    if (envBgToggle) envBgToggle.checked = showEnvBackground;
    const gradBgToggle = document.getElementById('gradient-bg-toggle');
    if (gradBgToggle) gradBgToggle.checked = gradientBgEnabled;
    const bgSelect = document.getElementById('background-select');
    if (bgSelect && currentGradientBg) { bgSelect.value = currentGradientBg; syncBgCards(currentGradientBg); }
    applyBackground();
  }
  if (s.ui) restoreUiPreferences(s.ui);
}

// Drive the existing controls so their handlers apply each saved value.
// Button rows are only clicked when they differ from the current selection, so
// rows the user never touched keep their defaults (render scale vs max DPR).
function restorePreviewSettings(preview) {
  if (!preview) return;
  for (const id of PREVIEW_BUTTON_ROWS) {
    const value = preview.buttons?.[id];
    if (value == null || _selectedButtonValue(id) === value) continue;
    document.querySelector(`#${id} button[data-value="${CSS.escape(value)}"]`)?.click();
  }
  for (const [name, id] of Object.entries(PREVIEW_TOGGLES)) {
    const el = document.getElementById(id);
    if (!el || typeof preview[name] !== 'boolean' || el.checked === preview[name]) continue;
    el.checked = preview[name];
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

function _modelExists(name) {
  if (modelManager.models.has(name)) return Promise.resolve(true);
  return modelManager.storage.getAllCustomModelNames().then(names => names.includes(name));
}

// Re-open what was open last time: model, part, scene dropdown, props, main-model
// transform. Materials and design layers are restored by loadModel itself.
async function restoreSessionState(state) {
  if (!state) return false;

  try {
    // Sync the custom scene dropdown — the UI is already built by the time restore runs
    if (state.activeCustomScene) {
      const sel = document.getElementById('scene-select');
      if (sel && sel.querySelector(`option[value="${CSS.escape(state.activeCustomScene)}"]`)) {
        sel.value = state.activeCustomScene;
      }
    }

    const name = state.modelName;
    const modelExists = !!name && await _modelExists(name);
    const modelSel = document.getElementById('object-select') || document.getElementById('model-select');
    if (modelSel && modelExists) modelSel.value = name;

    const modelReady = modelExists && await (modelRequest?.name === name
      ? modelRequest.promise : loadModel(name));
    if (!modelReady) {
      await loadModel(STANDARD_OBJECTS[0].label);
    }

    // Must be awaited — selectPart calls uvEditor.open() which captures baseTexture
    if (state.partName && meshMap[state.partName] && activeMesh !== meshMap[state.partName]) {
      await selectPart(meshMap[state.partName]);
    }

    if (state.mainModelTransform && modelExists && !await IDBStorage.get('metadata', modelTransformKey(getActiveProjectIdSync(), name))) {
      propManager.applyMainModelTransform(state.mainModelTransform);
      await IDBStorage.put('metadata', modelTransformKey(getActiveProjectIdSync(), name), state.mainModelTransform);
    }

    // Restore props (re-download any Sketchfab props first)
    if (state.props?.length) {
      await ensureSketchfabPropsRegistered(state.props);
      await propManager.loadSceneData(state.props);
    }

    log('Restored previous session.');
    return true;
  } catch (err) {
    log(`Session restore failed: ${err.message}`, true);
    return false;
  }
}

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

      // A part's thumbnail is its material's, so edits show even if the model isn't loaded
      const prefix = partMaterialPrefix(pid, name);
      const keys = await IDBStorage.getAllKeys('metadata', prefix).catch(() => []);
      if (keys.length) {
        const entries = (await Promise.all(keys.map(async k => {
          try {
            const record = await IDBStorage.get('metadata', k);
            const dataUrl = record?.materialId ? _matThumbCache.get(materialLibrary.resolveId(record.materialId)) : null;
            return dataUrl ? { partName: decodeURIComponent(k.slice(prefix.length)), dataUrl } : null;
          } catch (_) { return null; }
        }))).filter(Boolean);
        if (entries.length) matThumbs[name] = entries;
      }
    }));
  }
  controls.updateModelSelect(categories, designThumbs, matThumbs);
}

function updateSceneList() {
  controls.updateSceneSelect(getSceneNames());
  const select = document.getElementById('environment-select');
  if (select && getSceneNames().includes(currentEnvironment)) select.value = currentEnvironment;
  syncEnvCards(currentEnvironment);
}

/** @param {string} id - library id */
function getMaterialThumbnail(id) {
  return _matThumbCache.get(id) ?? null;
}

// Tracks pending idle-callback / timeout IDs per material so rapid slider moves cancel
// the previous pending render and only fire once after settling.
const _pendingThumbUpdates = new Map();
let _modelListRefreshTimer = null;

/**
 * Schedule a thumbnail render during browser idle time, from the material's definition.
 * A material whose object isn't loaded renders from its values, and again with its
 * textures when that object loads. Multiple calls for one material cancel the earlier one.
 */
function scheduleThumbnailUpdate(id) {
  if (_pendingThumbUpdates.has(id)) {
    const pending = _pendingThumbUpdates.get(id);
    if (typeof cancelIdleCallback === 'function') cancelIdleCallback(pending);
    else clearTimeout(pending);
  }

  const render = async () => {
    _pendingThumbUpdates.delete(id);
    if (!materialLibrary.get(id)) return;
    let material;
    try {
      material = await materialLibrary.createPreview(id);
    } catch (err) {
      console.warn('Thumbnail render failed:', err);
      return;
    }
    _ensureThumbRenderer();
    _thumbSphereMesh.material = material;
    _thumbRenderer.render(_thumbScene, _thumbCamera);
    const dataUrl = _thumbRenderer.domElement.toDataURL();
    material.dispose();
    _matThumbCache.set(id, dataUrl);
    _storeMaterialThumb(id, dataUrl);
    updateMaterialPresetList();
    const modelName = getCurrentModelName();
    partsUsing(id).forEach(mesh => scheduleMatThumbUpdate(modelName, mesh.name));
    // Unloaded objects using this material show it in the object list too
    clearTimeout(_modelListRefreshTimer);
    _modelListRefreshTimer = setTimeout(() => updateModelList(), 1000);
  };

  let id2;
  if (typeof requestIdleCallback === 'function') {
    id2 = requestIdleCallback(render, { timeout: 1500 });
  } else {
    id2 = setTimeout(render, 500);
  }
  _pendingThumbUpdates.set(id, id2);
}

/**
 * Schedule thumbnail generation for every material that currently has no cached
 * thumbnail. Spreads the work across idle frames so the UI stays responsive.
 * Called after restoring materials or any bulk list change.
 */
function scheduleAllMissingThumbnails() {
  for (const id of materialLibrary.listedIds()) {
    if (!_matThumbCache.has(id)) scheduleThumbnailUpdate(id);
  }
}

function updateMaterialPresetList() {
  controls.updateMaterialPresetSelect(
    materialLibrary.getSections(),
    getMaterialThumbnail,
    () => currentEnvironment
  );
  syncMaterialDropdown();
}

// ── Material preset buttons: New / Rename / Delete ───────────────────────────
// Each action writes IndexedDB first; the meshes and the list only change once the
// write has succeeded. The rules themselves are in MaterialLibrary.
document.getElementById('add-new-material')?.addEventListener('click', async () => {
  const id = libIdOf(activeMesh);
  if (!id) return;
  commitActiveDefinition();
  let entry;
  try {
    entry = await materialLibrary.createCustomFrom(id);
  } catch (err) {
    log(`Could not create material: ${err.message}`, true);
    return;
  }
  // Only this part moves to the new material; its instance already looks right
  activeMesh.material.userData.libId = entry.id;
  activeMesh.material.name = entry.name;
  uvEditor.currentMaterialPreset = entry.id;
  updateMaterialPresetList();
  syncActiveMaterialView();
  schedulePartMaterialSave();
  scheduleThumbnailUpdate(entry.id);
  log(`New material: "${entry.name}"`);
});

// ── Inline material rename (triggered by pencil icon in the material dropdown) ──
// Works for every origin and is saved per project; no file changes.
controls.onMaterialRenameRequest(async (id, newName) => {
  try {
    if (!(await materialLibrary.rename(id, newName))) return;
  } catch (err) {
    log(`Could not rename material: ${err.message}`, true);
    updateMaterialPresetList();
    return;
  }
  partsUsing(id).forEach(mesh => { mesh.material.name = newName; });
  updateMaterialPresetList();
  log(`Renamed material to "${newName}"`);
});

document.getElementById('delete-current-material')?.addEventListener('click', async () => {
  const id = controls.getMaterialPresetValue();
  if (!id || !materialLibrary.isListed(id)) return;
  const name = materialLibrary.get(id).name;
  if (!confirm(`Delete "${name}"?\n\nEvery part using it, in any object in this project, switches to Default — White.`)) return;

  await flushWrites();
  let fallback;
  try {
    fallback = await materialLibrary.deleteMaterial(id);
  } catch (err) {
    log(`Could not delete "${name}": ${err.message}`, true);
    return;
  }
  if (!fallback) return;
  _matThumbCache.delete(id);
  for (const mesh of partsUsing(id)) await applyMaterialPreset(fallback, { mesh });
  updateMaterialPresetList();
  syncActiveMaterialView();
  await updateModelList();
  // Library deletes can't be undone — no undo step may point at the removed material
  materialState.init('After delete');
  log(`Deleted material: "${name}"`);
});

document.getElementById('load-standard-materials')?.addEventListener('click', async () => {
  if (!confirm('Reset all standard materials in this project to their defaults?\n\nThis discards their edits, renames and textures, and restores any that were deleted.')) return;
  await flushWrites();
  let ids;
  try {
    ids = await materialLibrary.resetStandardMaterials();
  } catch (err) {
    log(`Could not reset standard materials: ${err.message}`, true);
    return;
  }
  ids.forEach(id => _matThumbCache.delete(id));
  for (const mesh of partsUsing(FALLBACK_ID)) await applyMaterialPreset(DEFAULT_STANDARD_ID, { mesh });
  for (const id of ids) await applyDefinitionToLiveParts(id);
  updateMaterialPresetList();
  syncActiveMaterialView();
  scheduleAllMissingThumbnails();
  materialState.init('After Load Standard');
  log('Standard materials reset to their defaults');
});

document.getElementById('restore-original-material-btn')?.addEventListener('click', () => {
  if (!activeMesh) { log('No active part selected.', true); return; }
  restoreOriginalMaterial();
});

// Reset Cache — clears derived data only (rendered thumbnails and environment
// previews); they are regenerated on next load. User data is not touched.
const CACHE_BLOB_PREFIXES = ['preset-thumb:', 'env-preview:'];

document.getElementById('reset-cache-btn')?.addEventListener('click', async () => {
  if (!confirm('Clear cached thumbnails and environment previews?\n\nYour models, materials, scenes and settings are kept. The page will reload.')) return;
  await flushWrites();
  try {
    await IDBStorage.batch(CACHE_BLOB_PREFIXES.map(prefix => ({ type: 'delPrefix', store: 'blobs', prefix })));
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
  }

  // Build parts map from _partCache (all visited parts) + any unvisited meshes
  const parts = {};
  for (const [partName, mesh] of Object.entries(meshMap)) {
    const cached = _partCache[partName];

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
        imageData:   uvEditor.encodeLayerImage(img),
      };
    }));

    // The part refers to its library entry, so later edits still reach this model
    parts[partName] = {
      materialId: libIdOf(mesh),
      decals,
    };
  }

  const saved = await modelManager.saveCustomModel(customName, {
    basedOn:    uvEditor.activeModelName,
    customName,
    sourceType: 'standard',
    sceneState: uvEditor.sceneState || null,
    parts,
  });
  if (!saved) return; // CustomModelStorage already logged the error

  uvEditor.customModelName = customName;
  await updateModelList();
  window.selectModelInDropdown?.(customName);
};

window.switchToModel = (name) => {
  const sel = document.getElementById('object-select') || document.getElementById('model-select');
  if (sel) { sel.value = name; return loadModel(name); }
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
window.addEventListener('dragover', event => {
  if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
}, true);
window.addEventListener('drop', async event => {
  const files = Array.from(event.dataTransfer?.files || []);
  if (!files.length) return;
  event.preventDefault();
  document.querySelectorAll('.drag-over').forEach(element => element.classList.remove('drag-over'));
  const isModel = files.some(file => /\.(obj|mtl|glb)$/i.test(file.name));
  const imagesOnly = files.every(file => /\.(png|jpe?g|svg|webp|gif|bmp)$/i.test(file.name));
  if (isModel || !imagesOnly) {
    event.stopImmediatePropagation();
    if (!isModel) { logError(`Unsupported dropped files: ${files.map(file => file.name).join(', ')}`); return; }
    const result = await modelManager.addModelFromFiles(files);
    if (!result.success) { result.errors.forEach(logError); return; }
    result.warnings.forEach(logWarn);
    await updateModelList();
    await loadModel(result.name);
    return;
  }
  // Existing specialized image zones own their image-only drops.
  if (event.target.closest('#design-preview-canvas, .ne-image-drop, .compact-color-picker__extractor-preview')) return;
  if (container.contains(event.target)) {
    event.stopImmediatePropagation();
    if (!activeMesh) { logError('Select a model part before uploading a design.'); return; }
    for (const file of files) await uvEditor.handleImageUpload(file);
  } else logError('Drop design images onto the viewport or an image upload zone.');
}, true);


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
    s.addEventListener('input', () => { i.value = s.value; callback(parseFloat(s.value)); scheduleProjectSettingsSave(); });
    i.addEventListener('input', () => {
      const v = parseFloat(i.value);
      if (!isNaN(v)) { s.value = v; callback(v); scheduleProjectSettingsSave(); }
    });
  };

  // ── Global post-FX toggle (Setting 5 "Enable Post Effects") ──
  const globalToggle = document.getElementById('preview-toggle-postfx');
  if (globalToggle) {
    globalToggle.addEventListener('change', (e) => {
      rm.setPostFXEnabled(e.target.checked);
      scheduleProjectSettingsSave();
    });
    // Sync to the checkbox's actual DOM state on init
    rm.setPostFXEnabled(globalToggle.checked);
  }

  // ── Individual effect toggles ─────────────────────────────────
  const bloomToggle = document.getElementById('post-toggle-bloom');
  if (bloomToggle) {
    bloomToggle.addEventListener('change', (e) => { rm.setBloom(e.target.checked); scheduleProjectSettingsSave(); });
  }

  const vignetteToggle = document.getElementById('post-toggle-vignette');
  if (vignetteToggle) {
    vignetteToggle.addEventListener('change', (e) => { rm.setVignette(e.target.checked); scheduleProjectSettingsSave(); });
  }

  const aoToggle = document.getElementById('post-toggle-ao');
  if (aoToggle) {
    aoToggle.addEventListener('change', (e) => { rm.setSSAO(e.target.checked); scheduleProjectSettingsSave(); });
  }

  const motionBlurToggle = document.getElementById('post-toggle-motionblur');
  if (motionBlurToggle) {
    motionBlurToggle.addEventListener('change', (e) => { rm.setMotionBlur(e.target.checked); scheduleProjectSettingsSave(); });
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
    scheduleProjectSettingsSave();
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
    scheduleProjectSettingsSave();
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
let tfGridOn     = false;
let tfSnapOn     = false;
let tfSnapGrid   = true;
let tfSnapVertex = false;
let tfEditModeOn     = false;
let tfDimLabelsOn    = false;
let tfLabelsParallel = false;
const tfGridCfg = { size: 10, divisions: 10, subdivisions: 5 };
let measureUnit = 'cm'; // 'cm' | 'in'  — 1 Three.js unit = 1 cm

function gridSnapStep() {
  const { size, divisions, subdivisions } = tfGridCfg;
  const totalDivs = subdivisions > 0 ? divisions * subdivisions : divisions;
  return size / totalDivs;
}

function applySnapState() {
  propManager.setSnapEnabled(tfSnapOn && tfSnapGrid, gridSnapStep());
  propManager.setVertexSnapEnabled(tfSnapOn && tfSnapVertex);
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
      scheduleProjectSettingsSave();
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
      scheduleProjectSettingsSave();
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
        scheduleProjectSettingsSave();
      } else {
        // Remove helpers
        if (gridHelper) scene.remove(gridHelper);
        if (axesHelper) scene.remove(axesHelper);
        log('Helpers: off');
        scheduleProjectSettingsSave();
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
      scheduleProjectSettingsSave();
    });
  }

  // ── Back-face Culling toggle ──
  const cullingToggle = document.getElementById('preview-toggle-culling');
  if (cullingToggle) {
    cullingToggle.addEventListener('change', (e) => {
      _backfaceCullingOn = e.target.checked;
      if (activeModel) {
        activeModel.traverse((child) => {
          if (!child.isMesh || !child.material) return;
          if (_backfaceCullingOn) {
            _clearFrontBackShader(child.material);
            child.material.side = THREE.FrontSide;
          } else {
            child.material.side = THREE.DoubleSide;
            _applyFrontBackShader(child);
          }
          child.material.needsUpdate = true;
        });
      }
      log(`Back-face culling: ${e.target.checked ? 'on' : 'off'}`);
      scheduleProjectSettingsSave();
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
      performanceModeOverride = e.target.checked;
      performanceModeEnabled = e.target.checked;
      scheduleProjectSettingsSave();
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

// The output size in pixels. "Use Selected Resolution" gives exact pixels; otherwise the
// viewport's size, at full device pixel ratio with "Force Full Quality" and at the
// current render scale without it.
function _exportImageSize() {
  const renderer = rendererManager.getRenderer();
  if (document.getElementById('export-use-preview-res')?.checked) {
    const selected = document.getElementById('resolution-select')?.value.match(/^(\d+)x(\d+)$/);
    if (selected) return { width: Number(selected[1]), height: Number(selected[2]) };
  }
  const fullQuality = document.getElementById('export-full-quality')?.checked;
  const pixelRatio = fullQuality ? (window.devicePixelRatio || 1) : renderer.getPixelRatio();
  const size = renderer.getSize(new THREE.Vector2());
  return { width: Math.round(size.x * pixelRatio), height: Math.round(size.y * pixelRatio) };
}

function _exportOverlays() {
  return [gridHelper, gridSubHelper, axesHelper, ...propManager.getOverlayObjects()].filter(Boolean);
}

async function _exportFileName(suffix, ext) {
  const project = await getActiveProject();
  return `renderdeck-${safeFileName(project?.name || 'project')}-${suffix}.${ext}`;
}

async function exportImage(format) {
  const scene = sceneManager.getScene();
  const transparentChecked = !!document.getElementById('export-transparent-bg')?.checked;
  const transparent = transparentChecked && format !== 'jpg';
  // Without an HDR background the viewport shows a CSS background behind the canvas
  const backgroundCss = !scene.background && gradientBgEnabled ? GRADIENT_PRESETS[currentGradientBg] : null;
  const options = {
    format,
    rendererManager,
    scene,
    camera: cameraManager.getCamera(),
    overlays: _exportOverlays(),
    ..._exportImageSize(),
    transparent,
    usePostFX: !!document.getElementById('export-include-postfx')?.checked && rendererManager.postFXEnabled,
    backgroundCss,
  };

  if (format === 'exr' && backgroundCss && !transparent) {
    logWarn('EXR files can\'t include the gradient background: it is left transparent');
  }
  const blob = await (format === 'exr' ? renderExr(options) : renderImage(options));
  markNeedsRender(4);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = await _exportFileName(timestamp, format);
  downloadBlob(filename, blob);
  logSuccess(`Exported: ${filename} (${options.width} × ${options.height})`);
}

async function downloadProjectThumbnail() {
  const pid = getActiveProjectIdSync();
  let dataUrl = (await getActiveProject())?.thumbnail;
  if (!dataUrl) {
    logWarn('This project has no thumbnail yet: press Capture Thumbnail first');
    return;
  }
  let blob = await (await fetch(dataUrl)).blob();
  // Thumbnails saved by older versions are stretched to 16:9: replace them with a square one
  const image = await createImageBitmap(blob);
  const isSquare = image.width === image.height;
  image.close();
  if (!isSquare) {
    if (!await _saveThumbnailToProject(pid)) {
      logError('Could not replace the old thumbnail');
      return;
    }
    dataUrl = (await getActiveProject())?.thumbnail;
    blob = await (await fetch(dataUrl)).blob();
  }
  const filename = await _exportFileName('thumbnail', 'jpg');
  downloadBlob(filename, blob);
  logSuccess(`Exported: ${filename}`);
}

async function exportModelPackage(format) {
  if (!activeModel) {
    logWarn('Load a model before exporting it');
    return;
  }
  clearHighlight();
  const modelName = getCurrentModelName() || 'model';
  const checked = id => !!document.getElementById(id)?.checked;
  const includeDesigns = checked('export-include-decals');
  const environment = checked('export-include-env')
    ? STANDARD_ENVIRONMENTS.find(env => env.label === currentEnvironment)
    : null;

  const { blob, ext, warnings } = await buildModelPackage({
    format,
    model: activeModel,
    baseName: safeFileName(modelName).replace(/\s+/g, '_'),
    getPartMaterial: mesh => ({
      material: uvEditor.getExportMaterial(mesh, includeDesigns),
      presetName: materialLibrary.get(libIdOf(mesh))?.name ?? null,
    }),
    extractProperties: material => materialManager.extractProperties(material),
    embedTextures: checked('export-embed-textures'),
    includeMaterialJson: checked('export-include-material-json'),
    environment: environment
      ? { path: environment.path, fileName: environment.path.split('/').pop() }
      : null,
  });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `renderdeck-${safeFileName(modelName)}-${timestamp}.${ext}`;
  downloadBlob(filename, blob);
  warnings.forEach(warning => logWarn(warning));
  logSuccess(`Exported: ${filename}`);
}

// Which package options affect a format. Pointing at a format button greys out the rest.
function _modelOptionsFor(format) {
  const isZip = format === 'obj' || format === 'zip'
    || (format === 'gltf' && !document.getElementById('export-embed-textures')?.checked);
  return {
    'export-embed-textures': format === 'gltf',
    'export-include-env': isZip,
    'export-include-material-json': isZip,
    'export-include-decals': true,
  };
}

function _setupModelExportButtons() {
  const formats = ['glb', 'gltf', 'obj', 'zip'];
  const buttons = formats.map(format => document.getElementById(`export-${format}-btn`));
  const showOptions = (format) => {
    const applies = format ? _modelOptionsFor(format) : null;
    ['export-embed-textures', 'export-include-env', 'export-include-material-json', 'export-include-decals'].forEach(id => {
      const option = document.getElementById(id);
      if (option) option.disabled = !!applies && !applies[id];
    });
  };
  formats.forEach((format, i) => {
    const button = buttons[i];
    if (!button) return;
    button.addEventListener('pointerenter', () => showOptions(format));
    button.addEventListener('pointerleave', () => showOptions(null));
    button.addEventListener('focus', () => showOptions(format));
    button.addEventListener('blur', () => showOptions(null));
    button.addEventListener('click', async () => {
      showOptions(null);
      buttons.forEach(b => { if (b) b.disabled = true; });
      try {
        await exportModelPackage(format);
      } catch (err) {
        logError(`Export failed: ${err.message}`);
      } finally {
        buttons.forEach(b => { if (b) b.disabled = false; });
      }
    });
  });
}

// Write everything still pending. Returns the labels of anything that couldn't be saved.
async function _flushProjectWrites() {
  scheduleSessionSave();
  scheduleProjectSettingsSave();
  await flushWrites();
  return getFailedWrites();
}

async function saveProject() {
  const failed = await _flushProjectWrites();
  if (failed.length) logError(`Could not save: ${failed.join(', ')}`);
  else logSuccess('Project saved');
}

async function downloadProject() {
  const failed = await _flushProjectWrites();
  if (failed.length) logWarn(`The file won't include unsaved changes to: ${failed.join(', ')}`);
  const project = await getActiveProject();
  const blob = await buildProjectFile(project.id, {
    includeImages: !!document.getElementById('project-include-images')?.checked,
  });
  const filename = `${safeFileName(project.name) || 'project'}.rdo`;
  downloadBlob(filename, blob);
  logSuccess(`Exported: ${filename}`);
}

async function loadProject(file) {
  await _flushProjectWrites();
  const project = await importProjectFile(file);
  logSuccess(`Loaded project: ${project.name}`);
  window.location.href = 'index.html';
}

function _setupProjectButtons() {
  const saveBtn = document.getElementById('save-project-btn');
  const downloadBtn = document.getElementById('download-project-btn');
  const loadBtn = document.getElementById('load-project-btn');
  const fileInput = document.getElementById('project-file-input');
  const buttons = [saveBtn, downloadBtn, loadBtn];
  const run = async (task, failureText) => {
    buttons.forEach(b => { if (b) b.disabled = true; });
    try {
      await task();
    } catch (err) {
      logError(`${failureText}: ${err.message}`);
    } finally {
      buttons.forEach(b => { if (b) b.disabled = false; });
    }
  };
  saveBtn?.addEventListener('click', () => run(saveProject, 'Could not save the project'));
  downloadBtn?.addEventListener('click', () => run(downloadProject, 'Could not download the project'));
  loadBtn?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (file) run(() => loadProject(file), 'Could not load the project');
  });
}

function setupExportUI() {
  _setupModelExportButtons();
  _setupProjectButtons();

  const formats = ['jpg', 'png', 'webp', 'exr'];
  const buttons = formats.map(format => document.getElementById(`export-${format}-btn`));
  formats.forEach((format, i) => {
    buttons[i]?.addEventListener('click', async () => {
      buttons.forEach(b => { if (b) b.disabled = true; });
      try {
        await exportImage(format);
      } catch (err) {
        logError(`Export failed: ${err.message}`);
      } finally {
        buttons.forEach(b => { if (b) b.disabled = false; });
      }
    });
  });

  document.getElementById('capture-thumbnail-btn')?.addEventListener('click', async () => {
    if (await _saveThumbnailToProject(getActiveProjectIdSync())) logSuccess('Thumbnail saved');
    else logError('Could not save the thumbnail');
  });
  document.getElementById('download-thumbnail-btn')?.addEventListener('click', async () => {
    try {
      await downloadProjectThumbnail();
    } catch (err) {
      logError(`Could not download the thumbnail: ${err.message}`);
    }
  });
}

function setupPropsUI() {
  const propsSelect   = document.getElementById('props-select');
  const addPropBtn      = document.getElementById('add-prop-btn');
  const importPropBtn   = document.getElementById('import-prop-btn');
  const propFileInput   = document.getElementById('prop-file-input');
  const deletePropBtn   = document.getElementById('delete-prop-btn');
  const clearPropsBtn   = document.getElementById('clear-props-btn');

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

  importPropBtn?.addEventListener('click', () => propFileInput?.click());

  propFileInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const customId = await propManager.uploadCustomProp(file);
    if (!customId) { propFileInput.value = ''; return; }

    // Re-populate dropdown so the new prop appears
    const name = customId.replace('custom_', '');
    let customGroup = propsSelect.querySelector('optgroup[label="Custom"]');
    if (!customGroup) {
      customGroup = document.createElement('optgroup');
      customGroup.label = 'Custom';
      propsSelect.appendChild(customGroup);
    }
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
      const propId = await propManager.saveBlobProp(`sketchfab_${uid}`, blobUrl, uid, name);
      URL.revokeObjectURL(blobUrl);
      if (!propId) throw new Error('Could not store Sketchfab prop.');
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

  const tsPanel  = document.getElementById('transform-sensitivity-panel');
  const tsModes  = ['translate', 'rotate', 'scale'];
  tsModes.forEach(m => {
    const slider = document.getElementById(`ts-${m}-slider`);
    const label  = document.getElementById(`ts-${m}-value`);
    slider?.addEventListener('input', () => {
      if (label) label.value = parseFloat(slider.value).toFixed(2);
    });
  });

  function closeToolbarPopups() {
    document.querySelectorAll('.toolbar-popup').forEach(p => { p.style.display = 'none'; });
    document.getElementById('tf-grid-settings')?.classList.remove('tf-btn--active');
    document.getElementById('tf-dim-settings')?.classList.remove('tf-btn--active');
    document.getElementById('tf-snap-settings')?.classList.remove('tf-btn--active');
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest('.popup-close-btn')) closeToolbarPopups();
  });

  function activateMode(mode, btn) {
    modeBtns.forEach(b => b?.classList.remove('tf-btn--active'));
    btn?.classList.add('tf-btn--active');
    propManager.setTransformMode(mode);
    scheduleProjectSettingsSave();

    closeToolbarPopups();
    if (tsPanel) {
      tsPanel.style.display = '';
      tsModes.forEach(m => {
        const el = document.getElementById(`ts-${m}`);
        if (el) el.style.display = m === mode ? '' : 'none';
      });
    }
  }

  btnTranslate?.addEventListener('click', () => activateMode('translate', btnTranslate));
  btnRotate?.addEventListener('click',    () => activateMode('rotate',    btnRotate));
  btnScale?.addEventListener('click',     () => activateMode('scale',     btnScale));

  const btnSnapSettings = document.getElementById('tf-snap-settings');
  const snapPopup       = document.getElementById('snap-settings-popup');
  const snapGridBtn     = document.getElementById('snap-grid-btn');
  const snapVertexBtn   = document.getElementById('snap-vertex-btn');

  btnSnap?.addEventListener('click', () => {
    tfSnapOn = !tfSnapOn;
    btnSnap.classList.toggle('tf-btn--active', tfSnapOn);
    applySnapState();
    scheduleProjectSettingsSave();
  });

  btnSnapSettings?.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = snapPopup?.style.display !== 'none';
    closeToolbarPopups();
    if (!open) {
      if (snapPopup) snapPopup.style.display = 'block';
      btnSnapSettings.classList.add('tf-btn--active');
    }
  });

  snapGridBtn?.addEventListener('click', () => {
    tfSnapGrid = !tfSnapGrid;
    snapGridBtn.classList.toggle('unit-btn--active', tfSnapGrid);
    applySnapState();
    scheduleProjectSettingsSave();
  });

  snapVertexBtn?.addEventListener('click', () => {
    tfSnapVertex = !tfSnapVertex;
    snapVertexBtn.classList.toggle('unit-btn--active', tfSnapVertex);
    applySnapState();
    scheduleProjectSettingsSave();
  });

  // ── Edit-mode lock ──────────────────────────────────────────────
  const btnEditMode   = document.getElementById('tf-editmode');
  const toolbar       = document.getElementById('transform-toolbar');

  function applyEditMode(on) {
    tfEditModeOn = on;
    propManager.setEditMode(on);
    btnEditMode?.classList.toggle('tf-btn--active', on);
    toolbar?.classList.toggle('tf-locked', !on);
    scheduleProjectSettingsSave();
  }

  btnEditMode?.addEventListener('click', () => applyEditMode(!tfEditModeOn));
  applyEditMode(false);

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
    scheduleProjectSettingsSave();
  }

  document.getElementById('unit-cm')?.addEventListener('click', () => applyMeasureUnit('cm'));
  document.getElementById('unit-in')?.addEventListener('click', () => applyMeasureUnit('in'));

  // ── Dimension label toggle + settings popup ──────────────────
  const btnDimensions  = document.getElementById('tf-dimensions');
  const btnDimSettings = document.getElementById('tf-dim-settings');
  const dimPopup       = document.getElementById('dim-settings-popup');

  propManager.setShowLabels(false);

  btnDimensions?.addEventListener('click', () => {
    tfDimLabelsOn = !tfDimLabelsOn;
    propManager.setShowLabels(tfDimLabelsOn);
    btnDimensions.classList.toggle('tf-btn--active', tfDimLabelsOn);
    scheduleProjectSettingsSave();
  });

  btnDimSettings?.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = dimPopup?.style.display !== 'none';
    closeToolbarPopups();
    if (!open) {
      if (dimPopup) dimPopup.style.display = 'block';
      btnDimSettings.classList.add('tf-btn--active');
    }
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
    tfLabelsParallel = parallel;
    propManager.setLabelsParallel(parallel);
    btnStyleDefault?.classList.toggle('unit-btn--active', !parallel);
    btnStyleParallel?.classList.toggle('unit-btn--active', parallel);
    scheduleProjectSettingsSave();
  }

  btnStyleDefault?.addEventListener('click',  () => applyLabelStyle(false));
  btnStyleParallel?.addEventListener('click', () => applyLabelStyle(true));

  // ── Grid toggle (on/off) — settings wiring is in Controls.js ────
  const btnGrid = document.getElementById('tf-grid');
  btnGrid?.addEventListener('click', () => {
    tfGridOn = !tfGridOn;
    rebuildGrid();
    btnGrid.classList.toggle('tf-btn--active', tfGridOn);
    scheduleProjectSettingsSave();
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

// Apply settings/${pid}.ui by driving the toolbar controls whose state differs,
// so each control's own handler applies the value.
function restoreUiPreferences(ui) {
  const click = (id) => document.getElementById(id)?.click();
  if (ui.measureUnit && ui.measureUnit !== measureUnit) click(ui.measureUnit === 'in' ? 'unit-in' : 'unit-cm');
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
  if (typeof ui.gridOn     === 'boolean' && ui.gridOn     !== tfGridOn)     click('tf-grid');
  if (typeof ui.snapGrid   === 'boolean' && ui.snapGrid   !== tfSnapGrid)   click('snap-grid-btn');
  if (typeof ui.snapVertex === 'boolean' && ui.snapVertex !== tfSnapVertex) click('snap-vertex-btn');
  if (typeof ui.snapOn     === 'boolean' && ui.snapOn     !== tfSnapOn)     click('tf-snap');
  if (typeof ui.dimLabels  === 'boolean' && ui.dimLabels  !== tfDimLabelsOn) click('tf-dimensions');
  if (typeof ui.labelsParallel === 'boolean' && ui.labelsParallel !== tfLabelsParallel) {
    click(ui.labelsParallel ? 'dim-style-parallel' : 'dim-style-default');
  }
  if (typeof ui.editMode   === 'boolean' && ui.editMode   !== tfEditModeOn) click('tf-editmode');
  if (typeof ui.wrapImages === 'boolean' && ui.wrapImages !== uvEditor._wrapImages) click('wrap-uv-btn');
  if (typeof ui.lockAspectRatio === 'boolean') {
    uvEditor._lockAspectRatio = ui.lockAspectRatio;
    const lockAspect = document.getElementById('lock-aspect-ratio');
    if (lockAspect) lockAspect.checked = ui.lockAspectRatio;
  }
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

// loadSceneSetup — restores a full saved scene (env, props, model+transform, camera)
// Camera is restored INSIDE the model onLoaded callback so it runs after centerAndFrameModel.
async function loadSceneSetup(sceneData) {
  const background = sceneData.environment?.background;
  if (typeof background === 'string') currentGradientBg = background;
  else if (background) {
    showEnvBackground = !!background.showEnvBackground;
    gradientBgEnabled = !!background.gradientBgEnabled;
    currentGradientBg = background.currentGradientBg || '';
  }
  restoreProjectSettings({ background: { showEnvBackground, gradientBgEnabled, currentGradientBg } });
  // 1. Restore environment
  if (sceneData.environment?.hdr) {
    currentEnvironment = sceneData.environment.hdr;
    scheduleProjectSettingsSave();
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
      scheduleModelTransformSave();
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
  const deleteSceneBtn = document.getElementById('delete-scene-btn');
  const resetSceneBtn  = document.getElementById('reset-scene-btn');

  if (!sceneSelect) return;

  async function populateScenesDropdown() {
    sceneSelect.innerHTML = '<option value="default">Default (no props)</option>';
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
    scheduleSessionSave();
    if (value === 'default') { propManager.clearAllProps(); return; }
    if (!value.startsWith('custom:')) return;
    const sceneData = await sceneStorage.getScene(value.replace('custom:', ''));
    if (sceneData) await loadSceneSetup(sceneData);
  });

  saveSceneBtn?.addEventListener('click', async () => {
    const name = prompt('Enter scene name:');
    if (!name?.trim()) return;
    const cam    = cameraManager.getCamera();
    const orbit  = cameraManager.getControls();
    try {
      await sceneStorage.saveScene(name.trim(), {
        environment: { hdr: currentEnvironment, background: { showEnvBackground, gradientBgEnabled, currentGradientBg } },
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
    } catch (err) {
      log(`Could not save scene "${name.trim()}": ${err.message}`, true);
      return;
    }
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
    try {
      await sceneStorage.clearAllScenes();
    } catch (err) {
      log(`Could not delete scenes: ${err.message}`, true);
      await populateScenesDropdown();
      return;
    }
    await populateScenesDropdown();
    scheduleSessionSave();
    log('All custom scenes deleted');
  });

  deleteSceneBtn?.addEventListener('click', async () => {
    const value = sceneSelect.value;
    if (!value?.startsWith('custom:')) { log('Select a saved scene to delete'); return; }
    const name = value.replace('custom:', '');
    if (!confirm(`Delete scene "${name}"? This cannot be undone.`)) return;
    try {
      await sceneStorage.deleteScene(name);
    } catch (err) {
      log(`Could not delete scene "${name}": ${err.message}`, true);
      return;
    }
    await populateScenesDropdown();
    sceneSelect.value = 'default';
    scheduleSessionSave();
    log(`Scene deleted: ${name}`);
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
window.applyTexQuality = applyTexQuality;  // expose for UVEditor canvas textures

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
// The composer is built by initializeApp() once settings/${pid}.renderer is loaded,
// so only the passes the user had enabled get compiled.
animate();

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
      const pid = getActiveProjectIdSync();
      const s = pid ? await IDBStorage.get('metadata', sessionKey(pid)) : null;
      const pm = (pid && s?.modelName && s?.partName)
        ? await IDBStorage.get('metadata', partMaterialKey(pid, s.modelName, s.partName))
        : null;
      sessionEl.innerHTML = s ? _dbgKVRows({
        key:                sessionKey(pid),
        version:            s.version,
        modelName:          s.modelName,
        partName:           s.partName,
        activeCustomScene:  s.activeCustomScene,
        propCount:          s.props?.length ?? 0,
        hasMainTransform:   !!s.mainModelTransform,
        nodeGraphCount:     Object.keys(s.nodeGraph?.graphs ?? {}).length,
        'part.materialId':  pm?.materialId ?? null,
        'part.fromFile':    pm?.fromFile ?? null,
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
      const STORES = [
        ['projects',        'project record'],
        ['models',          'custom model (v3 parts)'],
        ['uploaded-models', 'uploaded model record'],
        ['uploaded-props',  'uploaded prop record'],
        ['uploaded-hdrs',   'uploaded HDR record'],
        ['materials',       'user preset'],
        ['scenes',          'saved scene'],
        ['node-graphs',     'node graph'],
        ['settings',        'settings record'],
        ['metadata',        'JSON'],
        ['blobs',           'blob / data URL'],
      ];
      const allKeys = await Promise.all(STORES.map(([name]) => IDBStorage.getAllKeys(name)));

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
              <span class="dbg-key">${escapeDebugText(k)}</span>
              <span class="dbg-val dbg-val-null">${valLabel}</span>
            </div>`).join('') + '</div>'
        : '<div class="dbg-empty">empty</div>';

      // Group blob keys by their prefix (text before the first ':')
      const blobRows = (keys) => {
        const groups = new Map();
        keys.forEach(k => {
          const g = k.slice(0, k.indexOf(':') + 1) || '(other)';
          if (!groups.has(g)) groups.set(g, []);
          groups.get(g).push(k);
        });
        return [...groups].map(([g, ks]) =>
          `<div class="dbg-store-subheader">${escapeDebugText(g)} (${ks.length})</div>` + keyRows(ks, 'blob')
        ).join('') || '<div class="dbg-empty">empty</div>';
      };

      idbEl.innerHTML = STORES.map(([name, label], i) =>
        storeBlock(name, `${allKeys[i].length} entries`,
          name === 'blobs' ? blobRows(allKeys[i]) : keyRows(allKeys[i], label))
      ).join('');
    } catch (e) {
      idbEl.innerHTML = `<div class="dbg-error">${e.message}</div>`;
    }
  }

  // ── Settings records (IDB settings store) ─────────────────────
  const settingsEl = document.getElementById('dbg-settings-table');
  if (settingsEl) {
    try {
      const pid = getActiveProjectIdSync();
      const [app, proj] = await Promise.all([
        IDBStorage.get('settings', APP_SETTINGS_KEY),
        pid ? IDBStorage.get('settings', projectSettingsKey(pid)) : null,
      ]);
      const token = app?.sketchfabToken;
      settingsEl.innerHTML =
        _dbgKVRows({ storagePersistence: IDBStorage.getPersistentStorageState().status }) +
        `<div class="dbg-store-subheader">settings/app</div>` +
        (app ? _dbgKVRows({
          swatchCollections: app.swatchCollections ? `${app.swatchCollections.length} collections` : null,
          sketchfabToken:    token ? `${token.slice(0, 8)}…` : null,
        }) : '<div class="dbg-empty">not set</div>') +
        `<div class="dbg-store-subheader">settings/${escapeDebugText(pid ?? '—')}</div>` +
        (proj ? _dbgKVRows({
          environment:         proj.environment,
          'camera.focalLength': proj.camera?.focalLength,
          'camera.toneMapping': proj.camera?.toneMapping,
          'camera.dofEnabled':  proj.camera?.dofEnabled,
          hasView:             !!proj.view,
          'renderer.postFX':   proj.renderer?.postFXEnabled,
          'renderer.aaMode':   proj.renderer?.aaMode,
          'background.env':    proj.background?.showEnvBackground,
          'background.preset': proj.background?.currentGradientBg,
          'preview.shadows':   proj.preview?.shadows,
          'preview.wireframe': proj.preview?.wireframe,
          'ui.grid':           proj.ui?.gridOn,
          'ui.snap':           proj.ui?.snapOn,
          'ui.unit':           proj.ui?.measureUnit,
        }) : '<div class="dbg-empty">not set</div>');
    } catch (e) {
      settingsEl.innerHTML = `<div class="dbg-error">${e.message}</div>`;
    }
  }
}

function escapeDebugText(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
  if (session?.modelName && await _modelExists(session.modelName)) {
    const modelSel = document.getElementById('object-select') || document.getElementById('model-select');
    if (modelSel) modelSel.value = session.modelName;
    loadModel(session.modelName);
  }

  warmupAndGenerateThumbnails();
  await updateModelList();
  updateSceneList();
  updateMaterialPresetList();
  setupCameraUI();
  setupPostFXUI();
  setupPreviewQualityUI();
  setupBackgroundUI();
  setupExportUI();
  setupDesignShortcuts();
  await propManager.loadStoredProps();
  setupPropsUI();
  setupTransformToolbar();
  await setupSceneSetupUI();
  setupHistoryUI();
  setupValueInputSpinners();
  setupDebugPanel();
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
      if (performanceModeEnabled) rendererManager.enterOrbitPerfMode();
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


