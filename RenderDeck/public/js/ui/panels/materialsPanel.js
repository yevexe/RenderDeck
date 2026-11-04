import * as THREE from 'three';
import { appState } from '../../app/appState.js';
import { FALLBACK_ID, DEFAULT_STANDARD_ID } from '../../domain/materials/MaterialLibrary.js';

export function setupMaterialsPanel({
  actions,
  materialLibrary,
  materialManager,
  getActiveMesh,
  getActiveModel,
  getMeshMap,
  libIdOf,
  uvEditor,
  nodeEditorManager,
  rendererManager,
  sceneManager,
  cameraManager,
  controls,
  markNeedsRender,
  getCurrentModelName,
  syncMaterialDropdown,
  scheduleLibraryWrite,
  schedulePartMaterialSave,
  materialState,
  originalCustomDefinitions,
  extractPropertiesForPreset,
  getPartMaterialPrefix,
  loadThumbnailRecords,
  loadPartMaterialRecords,
  storeThumbnail,
  requestPersistentStorage,
  textureToDataURL,
  log,
  logError,
  flushWrites,
  updateModelList,
  getCurrentEnvironment,
}) {
  const matThumbCache = appState.materialThumbCache;
  const channelMapData = appState.channelMapData;
  let warmupScene = null;
  let warmupCamera = null;
  let warmupSphereMesh = null;
  let thumbRenderer = null;
  let thumbScene = null;
  let thumbCamera = null;
  let thumbSphereMesh = null;
  const pendingThumbUpdates = new Map();
  let modelListRefreshTimer = null;

  function syncChannelView() {
    channelMapData.clear();
    const entry = materialLibrary.get(libIdOf(getActiveMesh()));
    for (const [channel, dataUrl] of Object.entries(entry?.channelMaps || {})) channelMapData.set(channel, dataUrl);
  }

  function syncActiveMaterialView() {
    const activeMesh = getActiveMesh();
    if (!activeMesh?.material) return;
    syncChannelView();
    syncMaterialDropdown();
    uvEditor.withOriginalMaterialValues(activeMesh, () => {
      controls.syncMaterialUI(activeMesh.material, getChannelThumbnailOverrides());
    });
    nodeEditorManager.syncMaterialProps(materialLibrary.get(libIdOf(activeMesh))?.params);
  }

  function handleMaterialPropertyChange(property, value) {
    updateMaterialProperty(property, value);
    nodeEditorManager.syncMaterialProp(property, value);
  }

  function commitMaterialChange() {
    actions.flushOtherPartEdits();
    uvEditor.commitMaterialChange();
    materialState.push('Material change');
  }

  function resetTexture() {
    uvEditor.resetTexture();
  }

  function clearChannelMapData() {
    channelMapData.clear();
  }

  function setObjectSelectMatThumb(modelName, partName, dataUrl) {
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

  function scheduleMatThumbUpdate(modelName, partName) {
    const dataUrl = matThumbCache.get(libIdOf(getMeshMap()[partName]));
    if (modelName && partName && dataUrl) setObjectSelectMatThumb(modelName, partName, dataUrl);
  }

  function ensureWarmupScene() {
    if (warmupScene) return;
    warmupCamera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    warmupCamera.position.set(0, 0.3, 3.5);
    warmupCamera.lookAt(0, 0, 0);

    warmupScene = new THREE.Scene();
    const domeMat = new THREE.MeshBasicMaterial({ color: 0x252525, side: THREE.BackSide });
    warmupScene.add(new THREE.Mesh(new THREE.SphereGeometry(8, 32, 16), domeMat));
    warmupSphereMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 48));
    warmupScene.add(warmupSphereMesh);
    const key = new THREE.DirectionalLight(0xffffff, 4); key.position.set(3, 4, 3);
    const fill = new THREE.DirectionalLight(0x7799cc, 1.5); fill.position.set(-3, 0, -2);
    const rim = new THREE.DirectionalLight(0xffffff, 2.5); rim.position.set(-2, 3, -3);
    warmupScene.add(key, fill, rim, new THREE.AmbientLight(0x404040, 2));
  }

  function ensureThumbRenderer() {
    if (thumbRenderer) return;
    thumbRenderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    thumbRenderer.setSize(64, 64, false);
    thumbRenderer.outputColorSpace = THREE.SRGBColorSpace;
    thumbRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    thumbRenderer.toneMappingExposure = 1.4;

    thumbCamera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    thumbCamera.position.set(0, 0.3, 3.5);
    thumbCamera.lookAt(0, 0, 0);
    thumbScene = new THREE.Scene();
    const domeMat = new THREE.MeshBasicMaterial({ color: 0x606060, side: THREE.BackSide });
    thumbScene.add(new THREE.Mesh(new THREE.SphereGeometry(8, 32, 16), domeMat));
    thumbSphereMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 48));
    thumbScene.add(thumbSphereMesh);
    const key = new THREE.DirectionalLight(0xffffff, 4); key.position.set(3, 4, 3);
    const fill = new THREE.DirectionalLight(0x7799cc, 1.5); fill.position.set(-3, 0, -2);
    const rim = new THREE.DirectionalLight(0xffffff, 2.5); rim.position.set(-2, 3, -3);
    thumbScene.add(key, fill, rim, new THREE.AmbientLight(0x404040, 2));
  }

  async function loadCachedThumbnails(pid) {
    matThumbCache.clear();
    try {
      const entries = await loadThumbnailRecords(pid);
      entries.forEach(([id, dataUrl]) => {
        if (materialLibrary.get(id) && dataUrl) matThumbCache.set(id, dataUrl);
      });
    } catch (err) {
      console.warn('Thumbnail cache load failed:', err);
    }
  }

  function storeMaterialThumb(id, dataUrl) {
    storeThumbnail(id, dataUrl);
  }

  async function warmupAndGenerateThumbnails() {
    const renderer = rendererManager.getRenderer();
    if (!renderer) return;
    ensureWarmupScene();
    ensureThumbRenderer();
    const env = sceneManager.getScene().environment;
    warmupScene.environment = env ?? null;
    warmupScene.environmentIntensity = env ? 0.6 : 0;
    thumbScene.environment = env ?? null;
    thumbScene.environmentIntensity = env ? 0.4 : 0;

    for (const id of materialLibrary.listedIds()) {
      const mat = await materialLibrary.createPreview(id);
      if (env) materialManager.applyEnvironment(mat, env);
      warmupSphereMesh.material = mat;
      await renderer.compileAsync(warmupScene, warmupCamera);
      if (!matThumbCache.has(id)) {
        thumbSphereMesh.material = mat;
        thumbRenderer.render(thumbScene, thumbCamera);
        const dataUrl = thumbRenderer.domElement.toDataURL();
        matThumbCache.set(id, dataUrl);
        storeMaterialThumb(id, dataUrl);
      }
      mat.dispose();
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    uvEditor.reapplyDecalState();
    updateMaterialPresetList();
  }

  function getMaterialThumbnail(id) {
    return matThumbCache.get(id) ?? null;
  }

  async function getModelMaterialThumbnails(pid, modelName) {
    const prefix = getPartMaterialPrefix(pid, modelName);
    const records = await loadPartMaterialRecords(pid, modelName);
    return records.map(({ key, record }) => {
      try {
        const dataUrl = record?.materialId ? matThumbCache.get(materialLibrary.resolveId(record.materialId)) : null;
        return dataUrl ? { partName: decodeURIComponent(key.slice(prefix.length)), dataUrl } : null;
      } catch (_) {
        return null;
      }
    }).filter(Boolean);
  }

  function scheduleThumbnailUpdate(id) {
    if (pendingThumbUpdates.has(id)) {
      const pending = pendingThumbUpdates.get(id);
      if (typeof cancelIdleCallback === 'function') cancelIdleCallback(pending);
      else clearTimeout(pending);
    }
    const render = async () => {
      pendingThumbUpdates.delete(id);
      if (!materialLibrary.get(id)) return;
      let material;
      try {
        material = await materialLibrary.createPreview(id);
      } catch (err) {
        console.warn('Thumbnail render failed:', err);
        return;
      }
      ensureThumbRenderer();
      thumbSphereMesh.material = material;
      thumbRenderer.render(thumbScene, thumbCamera);
      const dataUrl = thumbRenderer.domElement.toDataURL();
      material.dispose();
      matThumbCache.set(id, dataUrl);
      storeMaterialThumb(id, dataUrl);
      updateMaterialPresetList();
      const modelName = getCurrentModelName();
      actions.partsUsing(id).forEach(mesh => scheduleMatThumbUpdate(modelName, mesh.name));
      clearTimeout(modelListRefreshTimer);
      modelListRefreshTimer = setTimeout(() => updateModelList(), 1000);
    };
    const id2 = typeof requestIdleCallback === 'function'
      ? requestIdleCallback(render, { timeout: 1500 })
      : setTimeout(render, 500);
    pendingThumbUpdates.set(id, id2);
  }

  function scheduleAllMissingThumbnails() {
    for (const id of materialLibrary.listedIds()) {
      if (!matThumbCache.has(id)) scheduleThumbnailUpdate(id);
    }
  }

  function updateMaterialPresetList() {
    controls.updateMaterialPresetSelect(
      materialLibrary.getSections(),
      getMaterialThumbnail,
      getCurrentEnvironment
    );
    syncMaterialDropdown();
  }

  async function applyMaterialPreset(id, { mesh = getActiveMesh(), persist = true } = {}) {
    const activeModel = getActiveModel();
    if (!activeModel || !mesh) return false;
    const entry = materialLibrary.get(id);
    let instance;
    try {
      if (!entry) throw new Error('it no longer exists');
      instance = await materialLibrary.createInstance(id);
    } catch (err) {
      logError(`Could not assign "${entry?.name ?? id}": ${err.message}`);
      if (mesh === getActiveMesh()) syncMaterialDropdown();
      return false;
    }
    if (!mesh.material) { instance.dispose(); return false; }
    materialManager.applyEnvironment(instance, sceneManager.getScene().environment);
    instance.wireframe = mesh.material.wireframe;
    instance.vertexColors = mesh.material.vertexColors;
    uvEditor.replacePartMaterial(mesh, instance, old => materialManager.dispose(old));
    if (mesh === getActiveMesh()) {
      uvEditor.currentMaterialPreset = id;
      uvEditor._renderPreview();
      syncActiveMaterialView();
      rendererManager.render(sceneManager.getScene(), cameraManager.getCamera());
      if (persist) schedulePartMaterialSave();
    }
    markNeedsRender(8);
    scheduleMatThumbUpdate(getCurrentModelName(), mesh.name);
    log(`Material: ${entry.name}`);
    return true;
  }

  function commitActiveDefinition() {
    const mesh = getActiveMesh();
    const id = libIdOf(mesh);
    if (!id) return;
    if (materialLibrary.setParams(id, extractPropertiesForPreset(mesh.material))) scheduleLibraryWrite(id);
  }

  function captureMaterialState() {
    const mesh = getActiveMesh();
    const id = libIdOf(mesh);
    const entry = materialLibrary.get(id);
    if (!entry) return null;
    return {
      partName: mesh.name,
      materialId: id,
      materialProperties: extractPropertiesForPreset(mesh.material),
      channelMaps: { ...entry.channelMaps },
      clearedChannels: [...entry.clearedChannels],
    };
  }

  async function applyMaterialHistoryState(state) {
    const id = state.materialId;
    if (!materialLibrary.get(id)) return;
    materialLibrary.setParams(id, state.materialProperties);
    materialLibrary.setChannels(id, state.channelMaps, state.clearedChannels);
    const mesh = getMeshMap()[state.partName];
    if (mesh && libIdOf(mesh) !== id) await applyMaterialPreset(id, { mesh, persist: false });
    await actions.applyDefinitionToLiveParts(id);
    scheduleLibraryWrite(id);
    syncActiveMaterialView();
    markNeedsRender(4);
  }

  function getChannelThumbnailOverrides() {
    const overrides = Object.fromEntries(channelMapData);
    if (uvEditor._liveRoughnessTexture && !('roughnessMap' in overrides)) overrides.roughnessMap = null;
    if (uvEditor._liveMetalnessTexture && !('metalnessMap' in overrides)) overrides.metalnessMap = null;
    if (uvEditor.liveCanvasTexture && !('map' in overrides)) overrides.map = null;
    return overrides;
  }

  async function setDefinitionChannel(id, channel, value) {
    if (!await actions.setDefinitionChannel(id, channel, value)) return false;
    syncChannelView();
    scheduleLibraryWrite(id);
    scheduleThumbnailUpdate(id);
    markNeedsRender(4);
    return true;
  }

  async function applyNodeEditorTexture(channel, dataUrl) {
    const id = libIdOf(getActiveMesh());
    if (!id) return;
    if (await setDefinitionChannel(id, channel, dataUrl || null)) {
      syncActiveMaterialView();
      markNeedsRender();
    }
  }

  async function updateMaterialProperty(property, value) {
    const activeMesh = getActiveMesh();
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
    if (property === 'opacity') mat.transparent = value < 1.0;
    if (property === 'transmission') mat.transparent = value > 0;
    mat.needsUpdate = true;
    actions.applyPropertyToOtherParts(libIdOf(activeMesh), property, value, activeMesh);
  }

  async function restoreOriginalMaterial() {
    const mesh = getActiveMesh();
    const id = mesh?.userData.originalMaterialId;
    if (!id) { log('No original material for this part.', true); return; }
    materialState.push('Before restore original');
    await flushWrites();
    try {
      await materialLibrary.restoreOriginal(id, originalCustomDefinitions.get(id));
    } catch (err) {
      log(`Could not restore "${materialLibrary.get(id)?.name ?? id}": ${err.message}`, true);
      return;
    }
    if (!materialLibrary.get(id)) { log('The original material is no longer available.', true); return; }
    matThumbCache.delete(id);
    if (libIdOf(mesh) !== id && !await applyMaterialPreset(id, { mesh })) return;
    await actions.applyDefinitionToLiveParts(id);
    updateMaterialPresetList();
    syncActiveMaterialView();
    scheduleThumbnailUpdate(id);
    materialState.push('Restored original material');
    schedulePartMaterialSave();
    markNeedsRender(4);
    log('Original material restored.');
  }

  async function handleChannelTextureUpload(channel, file) {
    const id = libIdOf(getActiveMesh());
    if (!id) { logError('No active mesh'); return; }
    const reader = new FileReader();
    reader.onload = async (e) => {
      void requestPersistentStorage();
      if (!await setDefinitionChannel(id, channel, e.target.result)) return;
      materialState.push('Channel uploaded');
      syncActiveMaterialView();
      log(`Channel "${channel}" texture set: ${file.name}`);
    };
    reader.readAsDataURL(file);
  }

  async function handleChannelTextureClear(channel) {
    const id = libIdOf(getActiveMesh());
    if (!id) return;
    if (!await setDefinitionChannel(id, channel, null)) return;
    materialState.push('Channel cleared');
    syncActiveMaterialView();
    log(`Channel "${channel}" cleared`);
  }

  async function handleChannelTextureMove(fromChannel, toChannel) {
    const id = libIdOf(getActiveMesh());
    if (!id) return;
    const dataUrl = materialLibrary.get(id).channelMaps[fromChannel]
      ?? textureToDataURL(await materialLibrary.channelTexture(id, fromChannel));
    if (!dataUrl) return;
    materialState.push(`Before move: ${fromChannel} → ${toChannel}`);
    if (!await setDefinitionChannel(id, toChannel, dataUrl)) return;
    await setDefinitionChannel(id, fromChannel, null);
    materialState.push(`Channel moved: ${fromChannel} → ${toChannel}`);
    syncActiveMaterialView();
    log(`Channel "${fromChannel}" moved to "${toChannel}"`);
  }

  document.getElementById('add-new-material')?.addEventListener('click', async () => {
    const id = libIdOf(getActiveMesh());
    if (!id) return;
    commitActiveDefinition();
    let entry;
    try {
      entry = await materialLibrary.createCustomFrom(id);
    } catch (err) {
      log(`Could not create material: ${err.message}`, true);
      return;
    }
    const activeMesh = getActiveMesh();
    activeMesh.material.userData.libId = entry.id;
    activeMesh.material.name = entry.name;
    uvEditor.currentMaterialPreset = entry.id;
    updateMaterialPresetList();
    syncActiveMaterialView();
    schedulePartMaterialSave();
    scheduleThumbnailUpdate(entry.id);
    log(`New material: "${entry.name}"`);
  });

  controls.onMaterialRenameRequest(async (id, newName) => {
    try {
      if (!(await materialLibrary.rename(id, newName))) return;
    } catch (err) {
      log(`Could not rename material: ${err.message}`, true);
      updateMaterialPresetList();
      return;
    }
    actions.partsUsing(id).forEach(mesh => { mesh.material.name = newName; });
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
    matThumbCache.delete(id);
    for (const mesh of actions.partsUsing(id)) await applyMaterialPreset(fallback, { mesh });
    updateMaterialPresetList();
    syncActiveMaterialView();
    await updateModelList();
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
    ids.forEach(id => matThumbCache.delete(id));
    for (const mesh of actions.partsUsing(FALLBACK_ID)) await applyMaterialPreset(DEFAULT_STANDARD_ID, { mesh });
    for (const id of ids) await actions.applyDefinitionToLiveParts(id);
    updateMaterialPresetList();
    syncActiveMaterialView();
    scheduleAllMissingThumbnails();
    materialState.init('After Load Standard');
    log('Standard materials reset to their defaults');
  });

  document.getElementById('restore-original-material-btn')?.addEventListener('click', () => {
    if (!getActiveMesh()) { log('No active part selected.', true); return; }
    restoreOriginalMaterial();
  });

  return {
    applyMaterialPreset,
    commitActiveDefinition,
    captureMaterialState,
    applyMaterialHistoryState,
    getChannelThumbnailOverrides,
    setDefinitionChannel,
    applyNodeEditorTexture,
    updateMaterialProperty,
    handleMaterialPropertyChange,
    commitMaterialChange,
    resetTexture,
    flushOtherPartEdits: actions.flushOtherPartEdits,
    restoreOriginalMaterial,
    handleChannelTextureUpload,
    handleChannelTextureClear,
    handleChannelTextureMove,
    loadCachedThumbnails,
    warmupAndGenerateThumbnails,
    getMaterialThumbnail,
    getModelMaterialThumbnails,
    scheduleThumbnailUpdate,
    scheduleAllMissingThumbnails,
    scheduleMatThumbUpdate,
    updateMaterialPresetList,
    syncChannelView,
    syncMaterialDropdown,
    syncActiveMaterialView,
    clearChannelMapData,
    deleteThumbnail: id => matThumbCache.delete(id),
    getThumbnail: id => matThumbCache.get(id) ?? null,
  };
}
