import { countModelFaces } from '../../domain/models/modelLoading.js';
import { FALLBACK_ID } from '../../domain/materials/MaterialLibrary.js';

export function setupModelPanel({
  controls,
  uvEditor,
  getMeshMap,
  getActiveMesh,
  libIdOf,
  nodeEditorManager,
  previewQualityState,
  rendererManager,
  scheduleSessionSave,
  selectPart,
  pushSceneHistory,
  loadModel,
  setActiveModelFaceCount,
  getActiveModelFaceCount,
  highPolyThreshold,
  serializeLayerImage,
}) {
  function clearPartSelection() {
    controls.updatePartSelect([]);
    controls.setEnabled('objectPartSelect', false);
    controls.setVisible('objectPartSelect', false);
  }

  function updatePartSelection(names) {
    const meshMap = getMeshMap();
    controls.updatePartSelect(names);
    uvEditor.setPartNames(names, name => selectPart(meshMap[name]));
    const multi = names.length > 1;
    controls.setEnabled('objectPartSelect', multi);
    controls.setVisible('objectPartSelect', multi);
  }

  function setActivePartName(name) {
    if (controls.elements.objectPartSelect) controls.elements.objectPartSelect.value = name;
    const designPartSelect = document.getElementById('design-part-select');
    if (designPartSelect) designPartSelect.value = name;
  }

  function setSelectedModel(name) {
    const select = document.getElementById('object-select') || document.getElementById('model-select');
    if (select && select.value !== name) select.value = name;
  }

  function selectModelInDropdown(name) {
    const select = document.getElementById('object-select') || document.getElementById('model-select');
    if (select) select.value = name;
  }

  function onModelChange(name) {
    pushSceneHistory(`Object → ${name}`);
    loadModel(name);
  }

  function onPartChange(partName) {
    if (!partName) return;
    const mesh = getMeshMap()[partName];
    if (mesh) selectPart(mesh);
  }

  function updateModelSelect(categories, designThumbs, materialThumbs) {
    controls.updateModelSelect(categories, designThumbs, materialThumbs);
  }

  function syncMaterialDropdown() {
    const id = libIdOf(getActiveMesh());
    if (!id) return;
    controls.setMaterialPresetValue(id, id === FALLBACK_ID ? 'White (no material)' : null);
  }

  function onModelReady(object, modelName, activeMesh) {
    nodeEditorManager.setSelection(modelName, activeMesh?.name || '—');
    const wire = document.getElementById('preview-toggle-wireframe')?.checked;
    const vcol = document.getElementById('preview-toggle-vertexcolors')?.checked;
    if (wire || vcol) {
      object.traverse(child => {
        if (!child.isMesh || !child.material) return;
        if (wire) child.material.wireframe = true;
        if (vcol) child.material.vertexColors = true;
        child.material.needsUpdate = true;
      });
    }
    scheduleSessionSave();
  }

  function updatePerfModeUI() {
    const label = document.getElementById('perf-mode-label');
    if (label) label.style.display = previewQualityState.performanceModeEnabled ? '' : 'none';
    const tabWarning = document.getElementById('perf-warning-tab');
    if (tabWarning) tabWarning.style.display = getActiveModelFaceCount() > highPolyThreshold ? '' : 'none';
  }

  function updatePolyWarning(faceCount) {
    const banner = document.getElementById('high-poly-warning');
    if (!banner) return;
    if (faceCount > highPolyThreshold) {
      banner.style.display = '';
      banner.querySelector('#poly-count-display').textContent = `${faceCount.toLocaleString()} faces`;
    } else {
      banner.style.display = 'none';
    }
  }

  function checkAndApplyPolyPerf(model) {
    const faceCount = countModelFaces(model);
    setActiveModelFaceCount(faceCount);
    const toggle = document.getElementById('perf-mode-toggle');
    previewQualityState.performanceModeEnabled = previewQualityState.performanceModeOverride ?? (faceCount > highPolyThreshold);
    if (toggle) toggle.checked = previewQualityState.performanceModeEnabled;
    if (!previewQualityState.performanceModeEnabled) rendererManager.exitOrbitPerfMode();
    updatePolyWarning(faceCount);
    updatePerfModeUI();
  }

  function serializeDecal(img) {
    const canvas = document.createElement('canvas');
    canvas.width = img.image.width;
    canvas.height = img.image.height;
    canvas.getContext('2d').drawImage(img.image, 0, 0);
    return serializeLayerImage(img);
  }

  return {
    clearPartSelection,
    updatePartSelection,
    setActivePartName,
    setSelectedModel,
    selectModelInDropdown,
    onModelChange,
    onPartChange,
    updateModelSelect,
    syncMaterialDropdown,
    onModelReady,
    updatePerfModeUI,
    updatePolyWarning,
    checkAndApplyPolyPerf,
    serializeDecal,
  };
}
