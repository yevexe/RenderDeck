import { buildSceneFile, importSceneFile } from '../../io/files/sceneFile.js';
import { downloadBlob, safeFileName } from '../../utils/helpers.js';

export async function setupSavedScenesPanel({
  sceneStorage,
  getActiveProjectIdSync,
  modelManager,
  propManager,
  refreshPropsSelect,
  materialLibrary,
  updateMaterialPresetList,
  scheduleAllMissingThumbnails,
  updateModelList,
  standardObjects,
  standardEnvironments,
  loadEnvironment,
  syncEnvironmentCards,
  syncBackgroundCards,
  getSceneState,
  setSceneState,
  restoreProjectSettings,
  sceneManager,
  applyBackground,
  scheduleProjectSettingsSave,
  scheduleSessionSave,
  cameraManager,
  rendererManager,
  camState,
  getActiveModel,
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
}) {
  async function loadSceneSetup(sceneData) {
    const background = sceneData.environment?.background;
    if (typeof background === 'string') setSceneState({ currentGradientBg: background });
    else if (background) {
      setSceneState({
        showEnvBackground: !!background.showEnvBackground,
        gradientBgEnabled: !!background.gradientBgEnabled,
        currentGradientBg: background.currentGradientBg || '',
      });
    }
    // Scenes saved before these fields existed leave the current settings alone
    const currentState = getSceneState();
    restoreProjectSettings({
      background: {
        showEnvBackground: currentState.showEnvBackground,
        gradientBgEnabled: currentState.gradientBgEnabled,
        currentGradientBg: currentState.currentGradientBg,
      },
      camera: sceneData.cameraSettings,
      renderer: sceneData.renderer,
    });
    const skipped = [];
    // 1. Restore environment
    if (sceneData.environment?.hdr && !standardEnvironments.some(env => env.label === sceneData.environment.hdr)) {
      skipped.push(`environment "${sceneData.environment.hdr}"`);
    } else if (sceneData.environment?.hdr) {
      setSceneState({ currentEnvironment: sceneData.environment.hdr });
      scheduleProjectSettingsSave();
      const sel = document.getElementById('environment-select');
      if (sel) { sel.value = sceneData.environment.hdr; syncEnvironmentCards(sceneData.environment.hdr); }
      loadEnvironment(sceneData.environment.hdr, (name, texture) => {
        setSceneState({ currentEnvTexture: texture, currentEnvironment: name });
        sceneManager.setEnvironment(texture);
        applyBackground();
        log(`Scene: ${name}`);
      });
    }

    // 2. Restore props (re-download any Sketchfab props first)
    if (sceneData.props) {
      await ensureSketchfabPropsRegistered(sceneData.props);
      await propManager.loadSceneData(sceneData.props);
      propManager.getUnresolvedProps().forEach(prop => skipped.push(`prop "${prop.displayName || prop.type}"`));
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
    if (sceneData.model?.name && !await modelManager.getModel(sceneData.model.name)) {
      skipped.push(`model "${sceneData.model.name}"`);
      restoreCameraFromScene();
    } else if (sceneData.model?.name) {
      const sel = document.getElementById('object-select') || document.getElementById('model-select');
      if (sel) sel.value = sceneData.model.name;
      await loadModel(sceneData.model.name, () => {
        const activeModel = getActiveModel();
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
    if (skipped.length) logWarn(`This scene uses things this project doesn't have, so they were skipped: ${skipped.join(', ')}`);
  }

  async function _refreshAfterSceneImport(uploadedModels) {
    const pid = getActiveProjectIdSync();
    for (const name of uploadedModels) await modelManager.restoreUploadedModel(name);
    await propManager.loadStoredProps();
    refreshPropsSelect?.();
    await materialLibrary.loadProject(pid);
    updateMaterialPresetList();
    scheduleAllMissingThumbnails();
    await updateModelList();
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
      const state = getSceneState();
      const activeModel = getActiveModel();
      try {
        await sceneStorage.saveScene(name.trim(), {
          environment: { hdr: state.currentEnvironment, background: { showEnvBackground: state.showEnvBackground, gradientBgEnabled: state.gradientBgEnabled, currentGradientBg: state.currentGradientBg } },
          cameraSettings: { ...camState },
          renderer: rendererManager.getState(),
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
      sceneSelect.value = `custom:${name.trim()}`;
      scheduleSessionSave();
      log(`Scene saved: ${name.trim()}`);
    });

    exportSceneBtn?.addEventListener('click', async () => {
      const value = sceneSelect?.value;
      if (!value?.startsWith('custom:')) { log('Select a scene to export'); return; }
      const name = value.replace('custom:', '');
      try {
        await flushWrites();
        downloadBlob(`${safeFileName(name) || 'scene'}.rdscene`, await buildSceneFile(name));
        logSuccess(`Exported: ${name}`);
      } catch (err) {
        logError(`Could not export the scene: ${err.message}`);
        await populateScenesDropdown();
      }
    });

    importSceneBtn?.addEventListener('click', () => sceneFileInput?.click());
    sceneFileInput?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        if (/\.rdscene$/i.test(file.name)) {
          await flushWrites();
          const imported = await importSceneFile(file);
          if (!imported) return;
          await _refreshAfterSceneImport(imported.uploadedModels);
          await populateScenesDropdown();
          sceneSelect.value = `custom:${imported.name}`;
          scheduleSessionSave();
          await loadSceneSetup(await sceneStorage.getScene(imported.name));
          log(`Scene imported: ${imported.name}`);
          return;
        }
        const result = await sceneStorage.importScene(file);
        if (result.success) {
          await populateScenesDropdown();
          sceneSelect.value = `custom:${result.name}`;
          scheduleSessionSave();
          log(`Scene imported: ${result.name}`);
        }
      } catch (err) {
        logError(`Scene import failed: ${err.message}`);
      } finally {
        sceneFileInput.value = '';
      }
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

  async function resetScene() {
    propManager.clearAllProps();

    cleanupActiveModel();
    if (standardObjects.length > 0) {
      const defaultLabel = standardObjects[0].label;
      const sel = document.getElementById('object-select');
      if (sel) sel.value = defaultLabel;
      loadModel(defaultLabel);
    }

    const defaultEnv = standardEnvironments[0];
    if (defaultEnv) {
      const envSel = document.getElementById('environment-select');
      if (envSel) { envSel.value = defaultEnv.label; syncEnvironmentCards(defaultEnv.label); }
      loadEnvironment(defaultEnv.label, (name, texture) => {
        setSceneState({ currentEnvTexture: texture, currentEnvironment: name });
        sceneManager.setEnvironment(texture);
        applyBackground();
      });
    }

    setSceneState({ showEnvBackground: true, gradientBgEnabled: false, currentGradientBg: '' });
    const envBgToggle  = document.getElementById('env-bg-toggle');
    const gradBgToggle = document.getElementById('gradient-bg-toggle');
    const bgSelect     = document.getElementById('background-select');
    if (envBgToggle)  envBgToggle.checked  = true;
    if (gradBgToggle) gradBgToggle.checked = false;
    if (bgSelect)     { bgSelect.value = ''; syncBackgroundCards(''); }
    applyBackground();

    cameraManager.reset();
    log('Scene reset to defaults.');
  }

  await setupSceneSetupUI();
}
