import * as THREE from 'three';

export function createViewportSelection({
  rendererManager,
  cameraManager,
  getMeshMap,
  getActiveMesh,
  setActiveMesh,
  getIsOrbiting,
  getPerformanceModeEnabled,
  getBackfaceCullingEnabled,
  controls,
  uvEditor,
  getCurrentModelName,
  libIdOf,
  snapshotCurrentPart,
  getPartCache,
  restoreDesignLayersForPart,
  nodeEditorManager,
  syncChannelView,
  syncMaterialDropdown,
  syncActiveMaterialView,
  applyFrontBackShader,
  scheduleSessionSave,
  markNeedsRender,
}) {
  const canvas = rendererManager.getDomElement();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let hoveredMesh = null;

  function setHighlight(mesh) {
    if (!mesh || mesh === hoveredMesh) return;
    clearHighlight();
    hoveredMesh = mesh;
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
    if (getPerformanceModeEnabled() && getIsOrbiting()) { clearHighlight(); return; }
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, cameraManager.getCamera());
    const intersects = raycaster.intersectObjects(Object.values(getMeshMap()), true);
    if (intersects.length > 0) {
      const mesh = intersects[0].object;
      if (mesh !== getActiveMesh()) {
        setHighlight(mesh);
      } else {
        clearHighlight();
      }
    } else {
      clearHighlight();
    }
  }

  function onCanvasClick() {
    if (hoveredMesh) selectPart(hoveredMesh);
  }

  async function selectPart(mesh) {
    if (!mesh) return;
    snapshotCurrentPart();
    clearHighlight();
    setActiveMesh(mesh);

    syncChannelView();
    syncMaterialDropdown();

    const cached = getPartCache()[mesh.name];
    const preloadedOverlays = cached ? cached.overlayImages : null;
    await uvEditor.open(mesh, getCurrentModelName(), libIdOf(mesh), preloadedOverlays);
    if (!cached && getActiveMesh() === mesh) await restoreDesignLayersForPart(mesh.name);
    if (getActiveMesh() !== mesh) return;

    const sel = controls.elements.objectPartSelect;
    if (sel) sel.value = mesh.name;
    const designSel = document.getElementById('design-part-select');
    if (designSel) designSel.value = mesh.name;
    nodeEditorManager.setSelection(getCurrentModelName(), mesh.name);
    syncActiveMaterialView();

    if (!getBackfaceCullingEnabled() && getActiveMesh()?.material) {
      applyFrontBackShader(mesh);
    }
    scheduleSessionSave();
  }

  function attach() {
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointermove', () => markNeedsRender(4), { passive: true });
    canvas.addEventListener('wheel', () => markNeedsRender(8), { passive: true });
    canvas.addEventListener('pointerleave', clearHighlight);
    canvas.addEventListener('click', onCanvasClick);
    canvas.addEventListener('pointerdown', () => markNeedsRender(4));
  }

  return { attach, clearHighlight, selectPart };
}
