import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { appState } from '../../app/appState.js';
import { setTextureAnisotropy } from '../../engine/textureQuality.js';

const state = appState.previewQuality;

export function handleGridChange(field, value, {
  panel,
  measureUnit,
  markNeedsRender,
  scheduleProjectSettingsSave,
}) {
  state.tfGridCfg[field] = (field === 'size' && measureUnit === 'in') ? value * 2.54 : value;
  if (panel) {
    panel.rebuildGrid();
    if (state.tfSnapOn) panel.applySnapState();
  } else {
    markNeedsRender(4);
  }
  scheduleProjectSettingsSave();
}

export function setupPreviewQualityPanel({
  rendererManager,
  sceneManager,
  propManager,
  cameraManager,
  container,
  getActiveModel,
  setupButtonRow,
  markNeedsRender,
  setPerformanceModeOverride,
  getPerformanceModeEnabled,
  setPerformanceModeEnabled,
  updatePerfModeUI,
  clearFrontBackShader,
  applyFrontBackShader,
  scheduleProjectSettingsSave,
  log,
}) {
  const renderer = rendererManager.getRenderer();
  const scene = sceneManager.getScene();

  function gridSnapStep() {
    const { size, divisions, subdivisions } = state.tfGridCfg;
    const totalDivs = subdivisions > 0 ? divisions * subdivisions : divisions;
    return size / totalDivs;
  }

  function applySnapState() {
    propManager.setSnapEnabled(state.tfSnapOn && state.tfSnapGrid, gridSnapStep());
    propManager.setVertexSnapEnabled(state.tfSnapOn && state.tfSnapVertex);
  }

  function rebuildGrid() {
    if (state.gridHelper) { scene.remove(state.gridHelper); state.gridHelper.geometry?.dispose(); state.gridHelper.material?.dispose(); state.gridHelper = null; }
    if (state.gridSubHelper) { scene.remove(state.gridSubHelper); state.gridSubHelper.geometry?.dispose(); state.gridSubHelper.material?.dispose(); state.gridSubHelper = null; }
    if (!state.tfGridOn) { markNeedsRender(4); return; }

    const { size, divisions, subdivisions } = state.tfGridCfg;
    const canvas = rendererManager.getRenderer().domElement;

    {
      const half = size / 2;
      const step = size / divisions;
      const positions = [];
      for (let i = 0; i <= divisions; i++) {
        const p = -half + i * step;
        positions.push(-half, 0, p,  half, 0, p);
        positions.push(p, 0, -half,  p, 0,  half);
      }
      const geo = new LineSegmentsGeometry();
      geo.setPositions(positions);
      const mat = new LineMaterial({
        color: 0xffffff,
        linewidth: 1.25,
        resolution: new THREE.Vector2(canvas.width, canvas.height),
      });
      state.gridHelper = new LineSegments2(geo, mat);
      state.gridHelper.position.y = -0.01;
      scene.add(state.gridHelper);
    }

    if (subdivisions > 0) {
      const totalDivs = divisions * subdivisions;
      state.gridSubHelper = new THREE.GridHelper(size, totalDivs, 0x7f7f7f, 0x7f7f7f);
      const posAttr = state.gridSubHelper.geometry.getAttribute('position');
      const colorAttr = state.gridSubHelper.geometry.getAttribute('color');
      const step = size / divisions;
      const half = size / 2;
      const eps  = 1e-4;
      for (let i = 0; i < posAttr.count; i += 2) {
        const x0 = posAttr.getX(i), z0 = posAttr.getZ(i);
        const x1 = posAttr.getX(i + 1), z1 = posAttr.getZ(i + 1);
        const onMainX = Math.abs(((z0 + half) % step)) < eps || Math.abs(((z0 + half) % step) - step) < eps;
        const onMainZ = Math.abs(((x0 + half) % step)) < eps || Math.abs(((x0 + half) % step) - step) < eps;
        const isMainLine = (Math.abs(x0 - x1) < eps && onMainZ) || (Math.abs(z0 - z1) < eps && onMainX);
        if (isMainLine) {
          colorAttr.setXYZ(i,     0, 0, 0);
          colorAttr.setXYZ(i + 1, 0, 0, 0);
        }
      }
      colorAttr.needsUpdate = true;
      state.gridSubHelper.material.transparent = true;
      state.gridSubHelper.material.opacity = 0.4;
      state.gridSubHelper.material.vertexColors = true;
      state.gridSubHelper.position.y = -0.009;
      scene.add(state.gridSubHelper);
    }
    markNeedsRender(4);
  }

  function updateResolutionDisplay() {
    const display = document.getElementById('current-resolution-display');
    if (!display) return;
    const canvas = rendererManager.getDomElement();
    if (canvas) display.textContent = `${canvas.width} × ${canvas.height}`;
  }
  updateResolutionDisplay();

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      rendererManager.resize();
      const cam = cameraManager.getCamera();
      cam.aspect = container.clientWidth / Math.max(1, container.clientHeight);
      cam.updateProjectionMatrix();
      rendererManager.render(sceneManager.getScene(), cam);
      updateResolutionDisplay();
      if (state.gridHelper?.material?.resolution) {
        const c = rendererManager.getRenderer().domElement;
        state.gridHelper.material.resolution.set(c.width, c.height);
      }
    }).observe(container);
  } else {
    window.addEventListener('resize', () => {
      const cam = cameraManager.getCamera();
      cam.aspect = container.clientWidth / Math.max(1, container.clientHeight);
      cam.updateProjectionMatrix();
      markNeedsRender(4);
      updateResolutionDisplay();
      if (state.gridHelper?.material?.resolution) {
        const c = rendererManager.getRenderer().domElement;
        state.gridHelper.material.resolution.set(c.width, c.height);
      }
    });
  }

  const shadowsToggle = document.getElementById('preview-toggle-shadows');
  if (shadowsToggle) shadowsToggle.addEventListener('change', (e) => {
    renderer.shadowMap.enabled = e.target.checked;
    const activeModel = getActiveModel();
    if (activeModel) {
      activeModel.traverse((child) => {
        if (child.isMesh && child.material) child.material.needsUpdate = true;
      });
    }
    log(`Shadows: ${e.target.checked ? 'on' : 'off'}`);
    scheduleProjectSettingsSave();
  });

  const wireframeToggle = document.getElementById('preview-toggle-wireframe');
  if (wireframeToggle) wireframeToggle.addEventListener('change', (e) => {
    const activeModel = getActiveModel();
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

  const helpersToggle = document.getElementById('preview-toggle-helpers');
  if (helpersToggle) helpersToggle.addEventListener('change', (e) => {
    if (e.target.checked) {
      if (!state.gridHelper) {
        state.gridHelper = new THREE.GridHelper(10, 10, 0x888888, 0x444444);
        state.gridHelper.position.y = -0.01;
      }
      if (!state.axesHelper) state.axesHelper = new THREE.AxesHelper(2);
      scene.add(state.gridHelper);
      scene.add(state.axesHelper);
      log('Helpers: on');
      scheduleProjectSettingsSave();
    } else {
      if (state.gridHelper) scene.remove(state.gridHelper);
      if (state.axesHelper) scene.remove(state.axesHelper);
      log('Helpers: off');
      scheduleProjectSettingsSave();
    }
  });

  const vertexColorsToggle = document.getElementById('preview-toggle-vertexcolors');
  if (vertexColorsToggle) vertexColorsToggle.addEventListener('change', (e) => {
    const activeModel = getActiveModel();
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

  const cullingToggle = document.getElementById('preview-toggle-culling');
  if (cullingToggle) cullingToggle.addEventListener('change', (e) => {
    state.backfaceCullingOn = e.target.checked;
    const activeModel = getActiveModel();
    if (activeModel) {
      activeModel.traverse((child) => {
        if (!child.isMesh || !child.material) return;
        if (state.backfaceCullingOn) {
          clearFrontBackShader(child.material);
          child.material.side = THREE.FrontSide;
        } else {
          child.material.side = THREE.DoubleSide;
          applyFrontBackShader(child);
        }
        child.material.needsUpdate = true;
      });
    }
    log(`Back-face culling: ${e.target.checked ? 'on' : 'off'}`);
    scheduleProjectSettingsSave();
  });

  setupButtonRow('render-scale-buttons', (v) => {
    const scale = parseFloat(v);
    rendererManager.setRenderScale(scale);
    updateResolutionDisplay();
    markNeedsRender(4);
    log(`Render scale: ${(scale * 100).toFixed(0)}%`);
  });

  setupButtonRow('dpr-cap-buttons', (v) => {
    rendererManager.setMaxDPR(v === 'auto' ? null : parseFloat(v));
    updateResolutionDisplay();
    markNeedsRender(4);
    log(`Max DPR: ${v}`);
  });

  setupButtonRow('aa-mode-buttons', (v) => {
    rendererManager.setAA(v);
    markNeedsRender(4);
    log(`Anti-aliasing: ${v}`);
  });

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
      if (obj.isMesh && obj.material) obj.material.needsUpdate = true;
    });
    markNeedsRender(4);
    log(`Shadow quality: ${v}`);
  });

  setupButtonRow('texture-filtering-buttons', (v) => {
    const levels = { low: 1, medium: 8, high: 16 };
    const aniso = levels[v] || 16;
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const clamped = Math.min(aniso, maxAniso);
    setTextureAnisotropy(clamped);
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

  const perfToggle = document.getElementById('perf-mode-toggle');
  if (perfToggle) perfToggle.addEventListener('change', (e) => {
    setPerformanceModeOverride(e.target.checked);
    setPerformanceModeEnabled(e.target.checked);
    scheduleProjectSettingsSave();
    if (!getPerformanceModeEnabled()) rendererManager.exitOrbitPerfMode();
    updatePerfModeUI();
    log(`Performance mode: ${getPerformanceModeEnabled() ? 'on' : 'off'}`);
  });

  log('Preview quality UI ready.');
  return {
    gridSnapStep,
    applySnapState,
    rebuildGrid,
    getGridHelpers: () => [state.gridHelper, state.gridSubHelper, state.axesHelper],
  };
}
