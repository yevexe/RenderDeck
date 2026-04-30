// PROPMANAGER.JS - Manages scene props (GLB models)

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { PROP_PATHS } from '../config.js';

export class PropManager {
  constructor(scene, camera, renderer, orbitControls, log) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.orbitControls = orbitControls;
    this.log = log || console.log;

    this.gltfLoader = new GLTFLoader();
    this.objLoader = new OBJLoader();
    this.props = [];
    this.nextPropId = 1;
    this.selectedProp = null;
    this.transformControls = null;
    this.transformMode = 'translate';
    this.snapEnabled = false;
    this._vertexSnapEnabled = false;
    this._vertexCache = [];
    this.collisionEnabled = false;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.customProps = new Map();
    this.mainModel = null;
    this._mainModelHelper = null;
    this.onTransformCommit = null; // set by caller; receives (mode: 'translate'|'rotate'|'scale')
    this._editModeEnabled = true;
    this._showLabels = true;
    this._labelsParallel = false;
    this._measureUnit = 'cm'; // 'cm' | 'in'
    this._labelCanvas = null;
    this._labelCtx = null;
    this._outlineDirty = true;    // recompute OBB on first updateOutlines call
    this._cachedOBBCorners = null; // last computed corners, reused for label projection

    this._setupTransformControls();
    this._setupEventListeners();
  }

  _setupTransformControls() {
    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControls.setMode(this.transformMode);
    this.transformControls.setSize(1.5);
    // r155+: TransformControls is no longer an Object3D.
    // getHelper() returns the visual root that must be added to the scene.
    this._tcHelper = this.transformControls.getHelper();
    this.scene.add(this._tcHelper);

    this._gizmoWasActive = false;

    this.transformControls.addEventListener('dragging-changed', (event) => {
      if (this.orbitControls) {
        this.orbitControls.enabled = !event.value;
      }
      // When gizmo interaction ends, block the canvas click handler
      // from immediately deselecting the prop
      if (!event.value) {
        this._gizmoWasActive = true;
        requestAnimationFrame(() => { this._gizmoWasActive = false; });
        this.onTransformCommit?.(this.transformMode);
      }
    });

    this.transformControls.addEventListener('objectChange', () => {
      if (this.selectedProp) {
        if (this._vertexSnapEnabled && this.transformMode === 'translate') {
          const snapped = this._snapToNearestVertex(this.selectedProp.object3D.position);
          if (snapped) this.selectedProp.object3D.position.copy(snapped);
        }
        this._updatePropTransform(this.selectedProp);
      }
      this._outlineDirty = true;
      window.markNeedsRender?.(4);
    });
  }

  _setupEventListeners() {
    this.renderer.domElement.addEventListener('click', (e) => this._onCanvasClick(e));
    window.addEventListener('keydown', (e) => this._onKeyDown(e));
  }

  _onCanvasClick(event) {
    if (!this._editModeEnabled) return;
    if (this.transformControls.dragging) return;
    if (this._gizmoWasActive) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    const propObjects = this.props.map(p => p.object3D).filter(Boolean);
    const allMeshes = [];
    propObjects.forEach(obj => {
      obj.traverse(child => {
        if (child.isMesh) allMeshes.push(child);
      });
    });

    const intersects = this.raycaster.intersectObjects(allMeshes, false);

    if (intersects.length > 0) {
      // Hit a prop
      const prop = this._findPropByMesh(intersects[0].object);
      if (prop) {
        this._deselectMainModel();
        this.selectProp(prop.id);
      }
    } else if (this.mainModel) {
      // Check main model
      const mainMeshes = [];
      this.mainModel.traverse(c => { if (c.isMesh) mainMeshes.push(c); });
      const mainHit = this.raycaster.intersectObjects(mainMeshes, false);
      if (mainHit.length > 0) {
        this.deselectProp();
        this._selectMainModel();
      } else {
        this.deselectProp();
        this._deselectMainModel();
      }
    } else {
      this.deselectProp();
    }
  }

  _findPropByMesh(mesh) {
    for (const prop of this.props) {
      let found = false;
      prop.object3D?.traverse(child => {
        if (child === mesh) found = true;
      });
      if (found) return prop;
    }
    return null;
  }

  _onKeyDown(event) {
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;

    switch (event.key.toLowerCase()) {
      case 'g':
        this.setTransformMode('translate');
        break;
      case 'r':
        this.setTransformMode('rotate');
        break;
      case 's':
        if (!event.ctrlKey && !event.metaKey) this.setTransformMode('scale');
        break;
      case 'delete':
      case 'backspace':
        if (this.selectedProp) this.removeProp(this.selectedProp.id);
        break;
      case 'escape':
        this.deselectProp();
        break;
      case 'd':
        if ((event.ctrlKey || event.metaKey) && this.selectedProp) {
          event.preventDefault();
          this.duplicateProp(this.selectedProp.id);
        }
        break;
    }
  }

  getAvailableProps() {
    const props = [];

    Object.entries(PROP_PATHS).forEach(([key, cfg]) => {
      if (key !== 'BASE_PATH' && cfg.file) {
        props.push({
          id: key,
          name: cfg.displayName || key.split('_').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' '),
          category: cfg.category || 'Uncategorized',
          type: 'builtin'
        });
      }
    });

    this.customProps.forEach((_url, name) => {
      props.push({ id: `custom_${name}`, name, category: 'Custom', type: 'custom' });
    });

    return props;
  }

  async addProp(propId, position = { x: 0, y: 0, z: 0 }) {
    let url, displayName, format = 'gltf';

    if (propId.startsWith('custom_')) {
      const name = propId.replace('custom_', '');
      const entry = this.customProps.get(name);
      if (!entry) {
        this.log(`Custom prop not found: ${name}`, true);
        return null;
      }
      // Support legacy string entries and new { url, format } objects
      if (typeof entry === 'string') {
        url = entry;
      } else {
        url = entry.url;
        format = entry.format || 'gltf';
      }
      displayName = (typeof entry === 'object' && entry.displayName) ? entry.displayName : name;
    } else {
      const cfg = PROP_PATHS[propId];
      if (!cfg || !cfg.file) {
        this.log(`Prop not found: ${propId}`, true);
        return null;
      }
      url = PROP_PATHS.BASE_PATH + cfg.file;
      displayName = cfg.displayName || propId;
    }

    this.log(`Loading prop: ${displayName}...`);

    return new Promise((resolve, reject) => {
      const onLoad = (object) => {
        object.position.set(position.x, position.y, position.z);

        object.traverse(child => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });

        const box = new THREE.Box3().setFromObject(object);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const autoScale = maxDim > 0 ? 1.0 / maxDim : 1.0;
        object.scale.setScalar(autoScale);

        const prop = {
          id: `prop_${this.nextPropId++}`,
          type: propId,
          displayName,
          object3D: object,
          position: { ...position },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: autoScale, y: autoScale, z: autoScale },
          locked: false
        };

        this.scene.add(object);
        this.props.push(prop);
        object.updateMatrixWorld(true);
        this.selectProp(prop.id);

        this.log(`Prop added: ${displayName}`);
        this._updatePropsList();
        resolve(prop);
      };

      const onError = (error) => {
        this.log(`Failed to load prop: ${error.message}`, true);
        reject(error);
      };

      if (format === 'obj') {
        this.objLoader.load(url, onLoad, undefined, onError);
      } else {
        this.gltfLoader.load(url, (gltf) => onLoad(gltf.scene), undefined, onError);
      }
    });
  }

  removeProp(propId) {
    const index = this.props.findIndex(p => p.id === propId);
    if (index === -1) return;

    const prop = this.props[index];
    if (this.selectedProp?.id === propId) this.deselectProp();

    this.scene.remove(prop.object3D);
    prop.object3D.traverse(child => {
      if (child.isMesh) {
        child.geometry?.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose());
        } else {
          child.material?.dispose();
        }
      }
    });

    this.props.splice(index, 1);
    this.log(`Prop removed: ${prop.displayName}`);
    this._updatePropsList();
  }

  async duplicateProp(propId) {
    const prop = this.props.find(p => p.id === propId);
    if (!prop) return;

    const newPosition = {
      x: prop.position.x + 0.5,
      y: prop.position.y,
      z: prop.position.z + 0.5
    };

    const newProp = await this.addProp(prop.type, newPosition);
    if (newProp) {
      newProp.object3D.rotation.set(
        THREE.MathUtils.degToRad(prop.rotation.x),
        THREE.MathUtils.degToRad(prop.rotation.y),
        THREE.MathUtils.degToRad(prop.rotation.z)
      );
      newProp.object3D.scale.set(prop.scale.x, prop.scale.y, prop.scale.z);
      this._updatePropTransform(newProp);
    }
  }

  setMainModel(object) {
    this._deselectMainModel();
    this.mainModel = object;
  }

  _selectMainModel() {
    if (!this.mainModel) return;
    this._outlineDirty = true;
    if (this._mainModelHelper) {
      this.scene.remove(this._mainModelHelper);
      this._disposeThickOutline(this._mainModelHelper);
      this._mainModelHelper = null;
    }
    this._mainModelHelper = this._createThickOutline(this.mainModel, 0x00d4ff); // cyan-white
    this.scene.add(this._mainModelHelper);
    this.transformControls.attach(this.mainModel);
    if (this._tcHelper) this._tcHelper.visible = this._editModeEnabled;
    this.log('Selected: Main Model');
  }

  _deselectMainModel() {
    if (this._mainModelHelper) {
      this.scene.remove(this._mainModelHelper);
      this._disposeThickOutline(this._mainModelHelper);
      this._mainModelHelper = null;
    }
    if (this.transformControls?.object === this.mainModel) {
      this.transformControls.detach();
      if (this._tcHelper) this._tcHelper.visible = false;
    }
    this._clearSizeLabels();
  }

  selectProp(propId) {
    const prop = this.props.find(p => p.id === propId);
    if (!prop || prop.locked) return;

    this._deselectMainModel();
    if (this.selectedProp) this._removeOutline(this.selectedProp);

    this.selectedProp = prop;
    this._outlineDirty = true;
    this._addOutline(prop);
    this.transformControls.attach(prop.object3D);
    if (this._tcHelper) this._tcHelper.visible = this._editModeEnabled;
    if (this._vertexSnapEnabled) this._buildVertexCache();

    this._updatePropsList();
    this.log(`Selected: ${prop.displayName}`);
  }

  deselectProp() {
    if (this.selectedProp) {
      this._removeOutline(this.selectedProp);
      this.selectedProp = null;
    }
    this.transformControls.detach();
    if (this._tcHelper) this._tcHelper.visible = false;
    this._updatePropsList();
  }

  // ── Thick-outline helpers (LineSegments2 gives true pixel linewidth) ──

  /** Compute 8 OBB corners in world space — box is tight in the object's LOCAL space
   *  so it rotates/scales with the object rather than expanding as an AABB. */
  _getOBBCorners(object3D) {
    object3D.updateMatrixWorld(true);
    const invWorld = new THREE.Matrix4().copy(object3D.matrixWorld).invert();
    const localBox = new THREE.Box3();
    object3D.traverse(child => {
      if (!child.isMesh || !child.geometry) return;
      child.geometry.computeBoundingBox();
      const gb = child.geometry.boundingBox.clone();
      gb.applyMatrix4(new THREE.Matrix4().multiplyMatrices(invWorld, child.matrixWorld));
      localBox.union(gb);
    });
    const { min: n, max: x } = localBox;
    const wm = object3D.matrixWorld;
    return [
      new THREE.Vector3(n.x, n.y, n.z).applyMatrix4(wm), // 0 bottom-front-left
      new THREE.Vector3(x.x, n.y, n.z).applyMatrix4(wm), // 1 bottom-front-right
      new THREE.Vector3(x.x, n.y, x.z).applyMatrix4(wm), // 2 bottom-back-right
      new THREE.Vector3(n.x, n.y, x.z).applyMatrix4(wm), // 3 bottom-back-left
      new THREE.Vector3(n.x, x.y, n.z).applyMatrix4(wm), // 4 top-front-left
      new THREE.Vector3(x.x, x.y, n.z).applyMatrix4(wm), // 5 top-front-right
      new THREE.Vector3(x.x, x.y, x.z).applyMatrix4(wm), // 6 top-back-right
      new THREE.Vector3(n.x, x.y, x.z).applyMatrix4(wm), // 7 top-back-left
    ];
  }

  _boxPositionsFromCorners(c) {
    const edges = [
      [0,1],[1,2],[2,3],[3,0],
      [4,5],[5,6],[6,7],[7,4],
      [0,4],[1,5],[2,6],[3,7],
    ];
    const pos = [];
    for (const [a, b] of edges) {
      pos.push(c[a].x, c[a].y, c[a].z, c[b].x, c[b].y, c[b].z);
    }
    return pos;
  }

  _boxPositions(object3D) {
    const c = this._getOBBCorners(object3D);
    // 12 edges as segment pairs
    const edges = [
      [0,1],[1,2],[2,3],[3,0], // bottom face
      [4,5],[5,6],[6,7],[7,4], // top face
      [0,4],[1,5],[2,6],[3,7], // vertical edges
    ];
    const pos = [];
    for (const [a, b] of edges) {
      pos.push(c[a].x, c[a].y, c[a].z, c[b].x, c[b].y, c[b].z);
    }
    return pos;
  }

  /** Return { dw, dh, cw, ch, linewidth } needed for LineMaterial consistency. */
  _outlineMetrics() {
    const canvas = this.renderer.domElement;
    const gl     = this.renderer.getContext();
    const dw = gl.drawingBufferWidth  || canvas.width  || 800;
    const dh = gl.drawingBufferHeight || canvas.height || 600;
    const cw = canvas.clientWidth  || dw;
    const ch = canvas.clientHeight || dh;
    // Scale linewidth so the outline always appears ~3 CSS pixels wide
    // regardless of the render buffer / display size ratio.
    const linewidth = 3 * (dh / ch);
    return { dw, dh, cw, ch, linewidth };
  }

  _createThickOutline(object3D, colorHex) {
    const { dw, dh, linewidth } = this._outlineMetrics();
    const geo = new LineSegmentsGeometry();
    geo.setPositions(this._boxPositions(object3D));
    const mat = new LineMaterial({ color: colorHex, linewidth, resolution: new THREE.Vector2(dw, dh) });
    const outline = new LineSegments2(geo, mat);
    outline.userData.trackedObject = object3D;
    return outline;
  }

  _disposeThickOutline(outline) {
    if (!outline) return;
    outline.geometry?.dispose();
    outline.material?.dispose();
  }

  _createLabelCanvas() {
    const parent = this.renderer.domElement.parentElement;
    if (!parent) return;
    const canvas = document.createElement('canvas');
    canvas.setAttribute('data-size-labels', '1');
    canvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:10;';
    parent.appendChild(canvas);
    this._labelCanvas = canvas;
    this._labelCtx = canvas.getContext('2d');
  }

  _formatSize(cm) {
    // cm is Three.js units (1 unit = 1 cm)
    if (this._measureUnit === 'in') {
      const inches = cm / 2.54;
      return `${inches.toFixed(inches >= 10 ? 1 : 2)}"`;
    }
    if (cm >= 10) return `${cm.toFixed(0)} cm`;
    if (cm >= 1)  return `${cm.toFixed(1)} cm`;
    return `${(cm * 10).toFixed(1)} mm`;
  }

  _updateSizeLabels(c) {
    if (!this._labelCanvas) this._createLabelCanvas();
    if (!this._labelCanvas) return;

    const domEl = this.renderer.domElement;
    const w = domEl.clientWidth  || domEl.width;
    const h = domEl.clientHeight || domEl.height;
    const lc = this._labelCanvas;
    if (lc.width !== w || lc.height !== h) { lc.width = w; lc.height = h; }

    const ctx = this._labelCtx;
    ctx.clearRect(0, 0, w, h);
    // Measure along OBB local axes (world distances between adjacent corners)
    const W = c[0].distanceTo(c[1]);
    const H = c[0].distanceTo(c[4]);
    const D = c[0].distanceTo(c[3]);

    // Representative edges: one per axis, on the front/visible face
    const labelEdges = [
      { p1: c[0], p2: c[1], text: `W: ${this._formatSize(W)}` },
      { p1: c[1], p2: c[5], text: `H: ${this._formatSize(H)}` },
      { p1: c[1], p2: c[2], text: `D: ${this._formatSize(D)}` },
    ];

    ctx.font = 'bold 11px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const pad = 4;
    const bh = 16;

    for (const { p1, p2, text } of labelEdges) {
      const mid3D = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
      const pm = mid3D.clone().project(this.camera);
      if (pm.z >= 1) continue;

      const sx = (pm.x *  0.5 + 0.5) * w;
      const sy = (pm.y * -0.5 + 0.5) * h;

      if (this._labelsParallel) {
        const pp1 = p1.clone().project(this.camera);
        const pp2 = p2.clone().project(this.camera);
        let angle = Math.atan2(-(pp2.y - pp1.y) * h, (pp2.x - pp1.x) * w);
        // Keep text right-side up
        if (angle >  Math.PI / 2) angle -= Math.PI;
        if (angle < -Math.PI / 2) angle += Math.PI;
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(angle);
        const tw = ctx.measureText(text).width;
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillRect(-tw / 2 - pad, -bh / 2, tw + pad * 2, bh);
        ctx.fillStyle = '#00d4ff';
        ctx.fillText(text, 0, 0);
        ctx.restore();
      } else {
        const tw = ctx.measureText(text).width;
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillRect(sx - tw / 2 - pad, sy - bh / 2, tw + pad * 2, bh);
        ctx.fillStyle = '#00d4ff';
        ctx.fillText(text, sx, sy);
      }
    }
  }

  _clearSizeLabels() {
    if (!this._labelCanvas) return;
    this._labelCtx.clearRect(0, 0, this._labelCanvas.width, this._labelCanvas.height);
  }

  /** Returns true if there are any active outlines (used to skip updateOutlines when idle) */
  hasOutlines() {
    return !!(this.selectedProp?._outlineHelper || this._mainModelHelper);
  }

  setShowLabels(visible) {
    this._showLabels = visible;
    if (!visible) this._clearSizeLabels();
    window.markNeedsRender?.(4);
  }

  setLabelsParallel(parallel) {
    this._labelsParallel = parallel;
    window.markNeedsRender?.(4);
  }

  setMeasureUnit(unit) {
    this._measureUnit = unit; // 'cm' | 'in'
    window.markNeedsRender?.(4);
  }

  /** Call every frame from the animate loop to keep outlines tracking moving objects */
  updateOutlines(perfMode = false) {
    const { dw, dh, linewidth } = this._outlineMetrics();
    const obbRecomputed = perfMode ? this._outlineDirty : true;
    let labelTarget = null;
    const refresh = (outline) => {
      if (!outline) return;
      const obj = outline.userData?.trackedObject;
      if (!obj) return;
      // Only recompute OBB geometry when the object has actually moved
      if (obbRecomputed) {
        this._cachedOBBCorners = this._getOBBCorners(obj);
        outline.geometry.setPositions(this._boxPositionsFromCorners(this._cachedOBBCorners));
      }
      outline.material.resolution.set(dw, dh);
      outline.material.linewidth = linewidth;
      labelTarget = obj;
    };
    if (this.selectedProp?._outlineHelper) refresh(this.selectedProp._outlineHelper);
    if (this._mainModelHelper)             refresh(this._mainModelHelper);
    this._outlineDirty = false;

    if (labelTarget && this._editModeEnabled && this._showLabels && this._cachedOBBCorners) {
      // Always re-project cached corners to screen space — cheap matrix math, no vertex traversal
      this._updateSizeLabels(this._cachedOBBCorners);
    } else {
      this._clearSizeLabels();
    }
  }

  _addOutline(prop) {
    const outline = this._createThickOutline(prop.object3D, 0x39ff14); // neon green
    outline.userData.isOutline = true;
    this.scene.add(outline);
    prop._outlineHelper = outline;
  }

  _removeOutline(prop) {
    if (prop._outlineHelper) {
      this.scene.remove(prop._outlineHelper);
      this._disposeThickOutline(prop._outlineHelper);
      prop._outlineHelper = null;
    }
    this._clearSizeLabels();
  }

  _updatePropTransform(prop) {
    const p = prop.object3D.position;
    // Guard: TransformControls can produce NaN/Infinity at degenerate camera angles
    if (!isFinite(p.x) || !isFinite(p.y) || !isFinite(p.z)) {
      prop.object3D.position.set(prop.position.x, prop.position.y, prop.position.z);
      return;
    }
    prop.position.x = p.x;
    prop.position.y = p.y;
    prop.position.z = p.z;
    prop.rotation.x = THREE.MathUtils.radToDeg(prop.object3D.rotation.x);
    prop.rotation.y = THREE.MathUtils.radToDeg(prop.object3D.rotation.y);
    prop.rotation.z = THREE.MathUtils.radToDeg(prop.object3D.rotation.z);
    prop.scale.x = prop.object3D.scale.x;
    prop.scale.y = prop.object3D.scale.y;
    prop.scale.z = prop.object3D.scale.z;

    if (this.collisionEnabled) this._checkCollisions(prop);
    this._updatePropsList();
  }

  setTransformMode(mode) {
    if (!['translate', 'rotate', 'scale'].includes(mode)) return;
    this.transformMode = mode;
    this.transformControls.setMode(mode);
    this.log(`Transform mode: ${mode}`);
  }

  setSnapEnabled(enabled, translationSnap = 1) {
    this.snapEnabled = enabled;
    if (enabled) {
      this.transformControls.setTranslationSnap(translationSnap);
      this.transformControls.setRotationSnap(THREE.MathUtils.degToRad(15));
      this.transformControls.setScaleSnap(0.1);
    } else {
      this.transformControls.setTranslationSnap(null);
      this.transformControls.setRotationSnap(null);
      this.transformControls.setScaleSnap(null);
    }
  }

  setVertexSnapEnabled(enabled) {
    this._vertexSnapEnabled = enabled;
    if (enabled) this._buildVertexCache();
  }

  _buildVertexCache() {
    this._vertexCache = [];
    const MAX_VERTS = 2000;
    const excluded = this.selectedProp?.object3D ?? null;
    const sources = [this.mainModel, ...this.props.map(p => p.object3D)].filter(Boolean);
    const tempVec = new THREE.Vector3();

    for (const root of sources) {
      if (root === excluded) continue;
      root.traverse(child => {
        if (this._vertexCache.length >= MAX_VERTS) return;
        if (!child.isMesh || !child.geometry) return;
        const pos = child.geometry.attributes.position;
        if (!pos) return;
        const step = Math.max(1, Math.floor(pos.count / Math.ceil(MAX_VERTS / sources.length)));
        for (let i = 0; i < pos.count && this._vertexCache.length < MAX_VERTS; i += step) {
          tempVec.fromBufferAttribute(pos, i);
          this._vertexCache.push(child.localToWorld(tempVec.clone()));
        }
      });
    }
  }

  _snapToNearestVertex(position, threshold = 0.5) {
    let nearest = null;
    let nearestDistSq = threshold * threshold;
    for (const v of this._vertexCache) {
      const dSq = position.distanceToSquared(v);
      if (dSq < nearestDistSq) { nearestDistSq = dSq; nearest = v; }
    }
    return nearest;
  }

  setEditMode(enabled) {
    this._editModeEnabled = enabled;
    if (this.transformControls) this.transformControls.enabled = enabled;
    if (this._tcHelper) {
      this._tcHelper.visible = enabled && !!this.transformControls.object;
    }
    if (this._mainModelHelper) this._mainModelHelper.visible = enabled;
    if (this.selectedProp?._outlineHelper) this.selectedProp._outlineHelper.visible = enabled;
    if (!enabled || !this._showLabels) this._clearSizeLabels();
    window.markNeedsRender?.(4);
  }

  setCollisionEnabled(enabled) {
    this.collisionEnabled = enabled;
  }

  _checkCollisions(prop) {
    const box1 = new THREE.Box3().setFromObject(prop.object3D);
    for (const other of this.props) {
      if (other.id === prop.id) continue;
      const box2 = new THREE.Box3().setFromObject(other.object3D);
      if (box1.intersectsBox(box2)) {
        this.log(`Collision: ${prop.displayName} <-> ${other.displayName}`);
      }
    }
  }

  registerBlobProp(name, blobUrl, format = 'gltf', sketchfabUid = null, displayName = null) {
    this.customProps.set(name, { url: blobUrl, format, ...(sketchfabUid ? { sketchfabUid } : {}), ...(displayName ? { displayName } : {}) });
    return `custom_${name}`;
  }

  async uploadCustomProp(file) {
    const ext = file.name.match(/\.(glb|gltf|obj)$/i);
    if (!ext) {
      this.log('Only GLB/GLTF/OBJ files are supported for props', true);
      return null;
    }
    const name = file.name.replace(/\.(glb|gltf|obj)$/i, '');
    const url = URL.createObjectURL(file);
    const format = ext[1].toLowerCase() === 'obj' ? 'obj' : 'gltf';
    this.customProps.set(name, { url, format });
    this.log(`Custom prop uploaded: ${name}`);
    return `custom_${name}`;
  }

  clearAllProps() {
    while (this.props.length > 0) {
      this.removeProp(this.props[0].id);
    }
    this.log('All props cleared');
  }

  _updatePropsList() {
    const list = document.getElementById('props-list');
    if (!list) return;

    list.innerHTML = '';
    if (this.props.length === 0) {
      list.innerHTML = '<p class="empty-message">No props added</p>';
      return;
    }

    this.props.forEach(prop => {
      const item = document.createElement('div');
      item.className = 'prop-item' + (this.selectedProp?.id === prop.id ? ' selected' : '');
      item.dataset.propId = prop.id;

      const name = document.createElement('span');
      name.className = 'prop-item-name';
      name.textContent = prop.displayName;

      const coords = document.createElement('span');
      coords.className = 'prop-item-coords';
      coords.textContent = `(${prop.position.x.toFixed(1)}, ${prop.position.y.toFixed(1)}, ${prop.position.z.toFixed(1)})`;

      item.appendChild(name);
      item.appendChild(coords);
      item.addEventListener('click', () => this.selectProp(prop.id));
      list.appendChild(item);
    });
  }

  getSceneData() {
    return this.props.map(prop => {
      const entry = prop.type.startsWith('custom_')
        ? this.customProps.get(prop.type.replace('custom_', ''))
        : null;
      return {
        type: prop.type,
        displayName: prop.displayName,
        position: { ...prop.position },
        rotation: { ...prop.rotation },
        scale: { ...prop.scale },
        ...(entry?.sketchfabUid ? { sketchfabUid: entry.sketchfabUid } : {}),
      };
    });
  }

  getMainModelTransform() {
    if (!this.mainModel) return null;
    const p = this.mainModel.position;
    const r = this.mainModel.rotation;
    const s = this.mainModel.scale;
    return {
      position: { x: p.x, y: p.y, z: p.z },
      rotation: { x: THREE.MathUtils.radToDeg(r.x), y: THREE.MathUtils.radToDeg(r.y), z: THREE.MathUtils.radToDeg(r.z) },
      scale:    { x: s.x, y: s.y, z: s.z },
    };
  }

  applyMainModelTransform(data) {
    if (!this.mainModel || !data) return;
    this.mainModel.position.set(data.position.x, data.position.y, data.position.z);
    this.mainModel.rotation.set(
      THREE.MathUtils.degToRad(data.rotation.x),
      THREE.MathUtils.degToRad(data.rotation.y),
      THREE.MathUtils.degToRad(data.rotation.z)
    );
    this.mainModel.scale.set(data.scale.x, data.scale.y, data.scale.z);
    this.mainModel.updateMatrixWorld(true);
  }

  async loadSceneData(propsData) {
    this.clearAllProps();
    for (const data of propsData) {
      const prop = await this.addProp(data.type, data.position);
      if (prop) {
        prop.object3D.rotation.set(
          THREE.MathUtils.degToRad(data.rotation.x),
          THREE.MathUtils.degToRad(data.rotation.y),
          THREE.MathUtils.degToRad(data.rotation.z)
        );
        prop.object3D.scale.set(data.scale.x, data.scale.y, data.scale.z);
        this._updatePropTransform(prop);
        window.markNeedsRender?.(4);
      }
    }
    this.deselectProp();
  }

  dispose() {
    this.clearAllProps();
    this.transformControls.dispose();
    this.scene.remove(this._tcHelper);
    this.customProps.forEach(url => URL.revokeObjectURL(url));
    this.customProps.clear();
  }
}
