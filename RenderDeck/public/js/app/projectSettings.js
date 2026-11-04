import * as IDBStorage from '../storage/indexedDBStorage.js';
import { scheduleProjectSettings } from '../storage/SettingsStorage.js';
import { sessionKey, modelTransformKey } from '../storage/storageKeys.js';
import { CompactColorPicker } from '../ui/widgets/CompactColorPicker.js';
import { collectControlPreferences } from '../ui/panels/ControlPreferences.js';

const PREVIEW_TOGGLES = {
  shadows: 'preview-toggle-shadows',
  wireframe: 'preview-toggle-wireframe',
  helpers: 'preview-toggle-helpers',
  vertexColors: 'preview-toggle-vertexcolors',
  culling: 'preview-toggle-culling',
};
const PREVIEW_BUTTON_ROWS = ['shadow-quality-buttons', 'texture-filtering-buttons', 'max-dpr-buttons', 'render-scale-buttons'];

export function createProjectSettings({
  getActiveProjectIdSync,
  getPersistenceReady,
  getCurrentModelName,
  getActiveMesh,
  getMeshMap,
  getPropManager,
  getCameraManager,
  getCameraState,
  getRendererManager,
  getPreviewQualityState,
  getBackgroundState,
  setBackgroundState,
  getUVEditor,
  getActiveModel,
  getRestoreCameraSettings,
  getModelManager,
  getModelLoading,
  getStandardObjects,
  loadModel,
  selectPart,
  ensureSketchfabPropsRegistered,
  checkAndApplyPolyPerf,
  restoreUiPreferences,
  applyBackground,
  syncBackgroundCards,
  scheduleWrite,
  flushWrites,
  log,
}) {
  function collectSession() {
    const activeMesh = getActiveMesh();
    const propManager = getPropManager();
    return {
      version: 2,
      modelName: getCurrentModelName() || null,
      partName: activeMesh?.name || null,
      activeCustomScene: document.getElementById('scene-select')?.value || null,
      props: propManager.getSceneData(),
      mainModelTransform: propManager.getMainModelTransform(),
    };
  }

  function scheduleModelTransformSave() {
    const pid = getActiveProjectIdSync();
    const name = getCurrentModelName();
    const transform = getPropManager().getMainModelTransform();
    if (!getPersistenceReady() || !pid || !name || !transform) return;
    scheduleWrite(`transform:${pid}:${name}`, () => IDBStorage.put('metadata', modelTransformKey(pid, name), transform), { label: 'model transform' });
  }

  function scheduleSessionSave() {
    const pid = getActiveProjectIdSync();
    if (!getPersistenceReady() || !pid) return;
    scheduleWrite(`session:${pid}`,
      () => IDBStorage.put('metadata', sessionKey(pid), collectSession()),
      { label: 'session' });
  }

  function selectedButtonValue(groupId) {
    return document.querySelector(`#${groupId} button.button-selected`)?.dataset.value ?? null;
  }

  function collectProjectSettings() {
    const cameraManager = getCameraManager();
    const cam = cameraManager.getCamera();
    const orbit = cameraManager.getControls();
    const previewQualityState = getPreviewQualityState();
    const backgroundState = getBackgroundState();
    const uvEditor = getUVEditor();
    const propManager = getPropManager();
    const preview = { buttons: {} };
    for (const [name, id] of Object.entries(PREVIEW_TOGGLES)) {
      const el = document.getElementById(id);
      if (el) preview[name] = el.checked;
    }
    for (const id of PREVIEW_BUTTON_ROWS) preview.buttons[id] = selectedButtonValue(id);
    const inputVal = id => document.getElementById(id)?.value ?? null;

    return {
      camera: { ...getCameraState() },
      view: {
        position: { x: cam.position.x, y: cam.position.y, z: cam.position.z },
        target: orbit ? { x: orbit.target.x, y: orbit.target.y, z: orbit.target.z } : null,
      },
      renderer: getRendererManager().getState(),
      preview,
      controls: collectControlPreferences(),
      performanceModeOverride: previewQualityState.performanceModeOverride,
      background: {
        showEnvBackground: backgroundState.showEnvBackground,
        gradientBgEnabled: backgroundState.gradientBgEnabled,
        currentGradientBg: backgroundState.currentGradientBg,
      },
      environment: document.getElementById('environment-select')?.value || backgroundState.currentEnvironment,
      ui: {
        transformMode: propManager.transformMode,
        extractor: CompactColorPicker.getExtractorPreferences(),
        gridOn: previewQualityState.tfGridOn,
        gridInputs: { size: inputVal('grid-size-input'), divisions: inputVal('grid-divisions-input'), subdivisions: inputVal('grid-subdivisions-input') },
        snapOn: previewQualityState.tfSnapOn,
        snapGrid: previewQualityState.tfSnapGrid,
        snapVertex: previewQualityState.tfSnapVertex,
        measureUnit: previewQualityState.measureUnit,
        dimLabels: previewQualityState.tfDimLabelsOn,
        labelsParallel: previewQualityState.tfLabelsParallel,
        editMode: previewQualityState.tfEditModeOn,
        wrapImages: uvEditor._wrapImages,
        lockAspectRatio: uvEditor._lockAspectRatio,
      },
    };
  }

  function scheduleProjectSettingsSave() {
    const pid = getActiveProjectIdSync();
    if (!getPersistenceReady() || !pid) return;
    scheduleProjectSettings(pid, collectProjectSettings);
  }

  function flushAllWrites() {
    scheduleSessionSave();
    scheduleProjectSettingsSave();
    flushWrites();
  }

  function restoreProjectSettings(s) {
    if (!s) return;
    const previewQualityState = getPreviewQualityState();
    if (typeof s.performanceModeOverride === 'boolean') {
      previewQualityState.performanceModeOverride = s.performanceModeOverride;
      const activeModel = getActiveModel();
      if (activeModel) checkAndApplyPolyPerf(activeModel);
    }
    if (s.ui?.extractor) CompactColorPicker.setExtractorPreferences(s.ui.extractor);
    if (s.camera) getRestoreCameraSettings()(s.camera);
    if (s.renderer) {
      getRendererManager().applyState(s.renderer);
      getRendererManager().syncUI();
    }
    if (s.background) {
      const state = getBackgroundState();
      if (typeof s.background.showEnvBackground === 'boolean') state.showEnvBackground = s.background.showEnvBackground;
      if (typeof s.background.gradientBgEnabled === 'boolean') state.gradientBgEnabled = s.background.gradientBgEnabled;
      if (typeof s.background.currentGradientBg === 'string') state.currentGradientBg = s.background.currentGradientBg;
      setBackgroundState(state);
      const envBgToggle = document.getElementById('env-bg-toggle');
      if (envBgToggle) envBgToggle.checked = state.showEnvBackground;
      const gradBgToggle = document.getElementById('gradient-bg-toggle');
      if (gradBgToggle) gradBgToggle.checked = state.gradientBgEnabled;
      const bgSelect = document.getElementById('background-select');
      if (bgSelect && state.currentGradientBg) { bgSelect.value = state.currentGradientBg; syncBackgroundCards(state.currentGradientBg); }
      applyBackground();
    }
    if (s.ui) restoreUiPreferences(s.ui);
  }

  function restorePreviewSettings(preview) {
    if (!preview) return;
    for (const id of PREVIEW_BUTTON_ROWS) {
      const value = preview.buttons?.[id];
      if (value == null || selectedButtonValue(id) === value) continue;
      document.querySelector(`#${id} button[data-value="${CSS.escape(value)}"]`)?.click();
    }
    for (const [name, id] of Object.entries(PREVIEW_TOGGLES)) {
      const el = document.getElementById(id);
      if (!el || typeof preview[name] !== 'boolean' || el.checked === preview[name]) continue;
      el.checked = preview[name];
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function modelExists(name) {
    const modelManager = getModelManager();
    if (modelManager.models.has(name)) return Promise.resolve(true);
    return modelManager.storage.getAllCustomModelNames().then(names => names.includes(name));
  }

  async function restoreSessionState(state) {
    if (!state) return false;
    const modelManager = getModelManager();
    const modelLoading = getModelLoading();
    const propManager = getPropManager();
    try {
      if (state.activeCustomScene) {
        const sel = document.getElementById('scene-select');
        if (sel && sel.querySelector(`option[value="${CSS.escape(state.activeCustomScene)}"]`)) {
          sel.value = state.activeCustomScene;
        }
      }

      const name = state.modelName;
      const modelIsAvailable = !!name && await modelExists(name);
      const modelSel = document.getElementById('object-select') || document.getElementById('model-select');
      if (modelSel && modelIsAvailable) modelSel.value = name;

      const currentModelRequest = modelLoading?.getModelRequest();
      const modelReady = modelIsAvailable && await (currentModelRequest?.name === name
        ? currentModelRequest.promise : loadModel(name));
      if (!modelReady) {
        await loadModel(getStandardObjects()[0].label);
      }

      const meshMap = getMeshMap();
      const activeMesh = getActiveMesh();
      if (state.partName && meshMap[state.partName] && activeMesh !== meshMap[state.partName]) {
        await selectPart(meshMap[state.partName]);
      }

      const pid = getActiveProjectIdSync();
      if (state.mainModelTransform && modelIsAvailable && !await IDBStorage.get('metadata', modelTransformKey(pid, name))) {
        propManager.applyMainModelTransform(state.mainModelTransform);
        await IDBStorage.put('metadata', modelTransformKey(pid, name), state.mainModelTransform);
      }

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

  return {
    collectSession,
    scheduleModelTransformSave,
    scheduleSessionSave,
    collectProjectSettings,
    scheduleProjectSettingsSave,
    flushAllWrites,
    restoreProjectSettings,
    restorePreviewSettings,
    restoreSessionState,
    modelExists,
  };
}
