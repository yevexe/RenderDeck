import { SceneStateManager } from '../domain/history/SceneState.js';
import { DesignStateManager } from '../domain/history/DesignState.js';
import { MaterialStateManager } from '../domain/history/MaterialState.js';
import { createMaterialActions } from '../domain/materials/materialActions.js';

export function createHistory({
  propManager,
  sceneManager,
  loadEnvironment,
  applyBackground,
  markNeedsRender,
  getEnvironmentState,
  setEnvironmentState,
  getCurrentModelName,
  loadModel,
  uvEditor,
  getMaterialsPanel,
  getActiveMesh,
  libIdOf,
  scheduleThumbnailUpdate,
  schedulePartMaterialSave,
  scheduleSessionSave,
  scheduleProjectSettingsSave,
  getMeshMap,
  materialLibrary,
  materialManager,
  logError,
}) {
  const sceneState = new SceneStateManager({
    propManager,
    sceneManager,
    loadEnvironment,
    applyBackground,
    markNeedsRender,
    getEnv: getEnvironmentState,
    setEnv: setEnvironmentState,
    getModelName: getCurrentModelName,
    loadModel,
  });

  const designState = new DesignStateManager({ uvEditor });

  const materialState = new MaterialStateManager({
    captureState: () => getMaterialsPanel()?.captureMaterialState(),
    applyState: state => getMaterialsPanel()?.applyMaterialHistoryState(state),
  });
  const materialActions = createMaterialActions({
    getMeshMap,
    libIdOf,
    materialLibrary,
    materialManager,
    uvEditor,
    markNeedsRender,
    logError,
  });

  function pushSceneHistory(label) { sceneState.push(label); }

  materialState.onChanged = () => {
    const id = libIdOf(getActiveMesh());
    if (id) getMaterialsPanel()?.scheduleThumbnailUpdate(id);
    schedulePartMaterialSave();
  };

  sceneState.onChanged = () => {
    scheduleSessionSave();
    scheduleProjectSettingsSave();
  };

  function setupHistoryUI(scheduleModelTransformSave) {
    sceneState.setupUI();
    designState.setupUI();
    materialState.setupUI();

    const modeLabels = { translate: 'Moved prop', rotate: 'Rotated prop', scale: 'Scaled prop' };
    propManager.onMainModelTransform = () => scheduleModelTransformSave();
    propManager.onTransformCommit = mode => {
      scheduleModelTransformSave();
      sceneState.push(modeLabels[mode] || 'Transformed prop');
    };

    const managers = [
      { mgr: sceneState, restore: state => sceneState.restore(state), ui: () => sceneState.updateUI() },
      { mgr: designState, restore: state => designState.restore(state), ui: () => designState.updateUI() },
      { mgr: materialState, restore: state => materialState.restore(state), ui: () => materialState.updateUI() },
    ];

    document.addEventListener('keydown', e => {
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

  return { sceneState, designState, materialState, materialActions, pushSceneHistory, setupHistoryUI };
}
