import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { initScenes } from './scenes.js';

// ─────────────────────────────────────────────
// DEBUG LOG HELPER
// Defined first — everything else may call it.
// ─────────────────────────────────────────────
function log(msg, isError = false) {
  const debug = document.querySelector('.debug');
  const p = document.createElement('p');
  p.style.cssText = isError
    ? 'color:#ff6b6b; margin-bottom:4px; font-size:14px;'
    : 'color:#aaa; margin-bottom:4px; font-size:14px;';
  p.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  debug.appendChild(p);
}


window.addEventListener('error', (e) => { log(`ERROR: ${e.message} (${e.filename}:${e.lineno})`, true); });
window.addEventListener('unhandledrejection', (e) => { log(`UNHANDLED: ${e.reason}`, true); });

// ─────────────────────────────────────────────
// SCENE SETUP
// ─────────────────────────────────────────────
const container = document.querySelector('.scene-view-placeholder');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const camera = new THREE.PerspectiveCamera(
  45,
  container.clientWidth / container.clientHeight,
  0.1,
  100
);
camera.position.set(0, 1.5, 3.5);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.innerHTML = '';
container.appendChild(renderer.domElement);

// ─────────────────────────────────────────────
// LIGHTING
// ─────────────────────────────────────────────
const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(5, 8, 5);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(1024, 1024);
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 20;
scene.add(dirLight);

const fillLight = new THREE.DirectionalLight(0x8899aa, 0.3);
fillLight.position.set(-3, 2, -2);
scene.add(fillLight);

const sideLight = new THREE.PointLight(0xffddaa, 1.2, 20);
sideLight.position.set(4, 1.5, -1);
scene.add(sideLight);

// ─────────────────────────────────────────────
// ORBIT CONTROLS
// ─────────────────────────────────────────────
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.5, 0);
controls.minDistance = 0.01;
controls.maxDistance = Infinity;
controls.minPolarAngle = 0.2;
controls.maxPolarAngle = Math.PI / 2;
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.update();

// ─────────────────────────────────────────────
// PROCEDURAL TEXTURE GENERATORS
// ─────────────────────────────────────────────
function createTextureFromCanvas(drawFn, size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  drawFn(ctx, size);
  return new THREE.CanvasTexture(canvas);
}

function woodTexture() {
  return createTextureFromCanvas((ctx, s) => {
    ctx.fillStyle = '#6b3a2a';
    ctx.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 6 + Math.random() * 8) {
      const shade = Math.random();
      ctx.strokeStyle = shade > 0.5
        ? `rgba(90, 55, 30, ${0.3 + Math.random() * 0.4})`
        : `rgba(120, 75, 45, ${0.2 + Math.random() * 0.3})`;
      ctx.lineWidth = 1 + Math.random() * 3;
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x < s; x += 20) {
        ctx.lineTo(x, y + Math.sin(x * 0.05) * 3 + (Math.random() - 0.5) * 2);
      }
      ctx.stroke();
    }
    const kx = s * 0.3, ky = s * 0.6;
    ctx.fillStyle = 'rgba(50, 28, 15, 0.7)';
    ctx.beginPath();
    ctx.ellipse(kx, ky, 12, 8, 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(75, 40, 20, 0.6)';
    ctx.beginPath();
    ctx.ellipse(kx, ky, 6, 4, 0.2, 0, Math.PI * 2);
    ctx.fill();
  });
}

function metalTexture() {
  return createTextureFromCanvas((ctx, s) => {
    const grad = ctx.createLinearGradient(0, 0, s, 0);
    grad.addColorStop(0, '#5a5a5a');
    grad.addColorStop(0.3, '#a8a8a8');
    grad.addColorStop(0.5, '#c0c0c0');
    grad.addColorStop(0.7, '#909090');
    grad.addColorStop(1, '#6a6a6a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 2) {
      ctx.strokeStyle = `rgba(${180 + Math.random() * 40}, ${180 + Math.random() * 40}, ${180 + Math.random() * 40}, 0.15)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(s, y);
      ctx.stroke();
    }
    const specGrad = ctx.createLinearGradient(s * 0.4, 0, s * 0.6, 0);
    specGrad.addColorStop(0, 'rgba(255,255,255,0)');
    specGrad.addColorStop(0.5, 'rgba(255,255,255,0.12)');
    specGrad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = specGrad;
    ctx.fillRect(0, 0, s, s);
  });
}

function glassTexture() {
  return createTextureFromCanvas((ctx, s) => {
    ctx.fillStyle = 'rgba(200, 215, 230, 0.15)';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 8; i++) {
      const x = (s / 8) * i + Math.random() * 20 - 10;
      const grad = ctx.createLinearGradient(x, 0, x + 15, 0);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(0.4, 'rgba(220,235,255,0.08)');
      grad.addColorStop(0.6, 'rgba(220,235,255,0.15)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(x - 5, 0, 25, s);
    }
    ctx.strokeStyle = 'rgba(180, 210, 255, 0.1)';
    ctx.lineWidth = 1;
    for (let y = 0; y < s; y += 30 + Math.random() * 20) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x < s; x += 40) {
        ctx.lineTo(x, y + Math.sin(x * 0.08) * 5);
      }
      ctx.stroke();
    }
  });
}

function plasticTexture() {
  return createTextureFromCanvas((ctx, s) => {
    const grad = ctx.createLinearGradient(0, 0, s, s);
    grad.addColorStop(0, '#e84393');
    grad.addColorStop(0.5, '#fd79a8');
    grad.addColorStop(1, '#d63384');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, s, s);
    const glossGrad = ctx.createRadialGradient(s * 0.35, s * 0.25, 10, s * 0.35, s * 0.25, s * 0.55);
    glossGrad.addColorStop(0, 'rgba(255,255,255,0.3)');
    glossGrad.addColorStop(0.6, 'rgba(255,255,255,0.05)');
    glossGrad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glossGrad;
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 600; i++) {
      const x = Math.random() * s;
      const y = Math.random() * s;
      ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.06})`;
      ctx.fillRect(x, y, 1.5, 1.5);
    }
  });
}

// ─────────────────────────────────────────────
// MATERIAL PRESETS
// ─────────────────────────────────────────────
const materialPresets = {
  Wood: () => new THREE.MeshStandardMaterial({
    map: woodTexture(), roughness: 0.85, metalness: 0.0, side: THREE.DoubleSide,
  }),
  Metal: () => new THREE.MeshStandardMaterial({
    map: metalTexture(), roughness: 0.2, metalness: 0.9, side: THREE.DoubleSide,
  }),
  Glass: () => new THREE.MeshStandardMaterial({
    map: glassTexture(), roughness: 0.05, metalness: 0.1, opacity: 0.45, transparent: true, side: THREE.DoubleSide,
  }),
  Plastic: () => new THREE.MeshStandardMaterial({
    map: plasticTexture(), roughness: 0.3, metalness: 0.05, side: THREE.DoubleSide,
  }),
};

// ─────────────────────────────────────────────
// MODEL REGISTRY
// To add a new model: just add an entry here.
//   key   — the label shown in the dropdown
//   file  — filename inside ../models/
// ─────────────────────────────────────────────
const MODELS = {
  'Plain Mug': 'plain_mug.glb',
  'Simple Pen': 'simple_pen.glb',
};

// ─────────────────────────────────────────────
// POPULATE MODEL SELECT FROM REGISTRY
// ─────────────────────────────────────────────
const modelSelect = document.getElementById('model-select');
Object.keys(MODELS).forEach((name, i) => {
  const opt = document.createElement('option');
  opt.value = name;
  opt.textContent = name;
  if (i === 0) opt.selected = true;
  modelSelect.appendChild(opt);
});

// ─────────────────────────────────────────────
// LOAD GLB MODEL
// ─────────────────────────────────────────────
let activeMesh = null;
let activeModel = null;
let originalMaterials = [];

const gltfLoader = new GLTFLoader();

function loadModel(name) {
  const file = MODELS[name];
  if (!file) { log(`Unknown model: ${name}`, true); return; }

  if (activeModel) {
    scene.remove(activeModel);
    activeModel.traverse((child) => {
      if (child.isMesh && child.geometry) child.geometry.dispose();
    });
    activeModel = null;
    activeMesh = null;
    originalMaterials = [];
  }

  log(`Loading ${name}…`);

  gltfLoader.load(
    `../models/${file}`,
    (gltf) => {
      const model = gltf.scene;

      model.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          activeMesh = child;
          originalMaterials.push({ mesh: child, material: child.material.clone() });
        }
      });

      scene.add(model);
      activeModel = model;

      // Center model at origin
      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      model.position.sub(center);

      // Recompute after centering
      box.setFromObject(model);
      const newCenter = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());

      controls.target.copy(newCenter);

      const maxDim = Math.max(size.x, size.y, size.z);
      camera.position.set(0, newCenter.y - maxDim * 0.05, maxDim * 2.2);
      camera.lookAt(newCenter);
      controls.update();

      applyPreset(document.getElementById('texture-select').value);

      log(`${name} loaded.`);
    },
    (xhr) => {
      if (xhr.total > 0) log(`Loading… ${((xhr.loaded / xhr.total) * 100).toFixed(0)}%`);
    },
    (err) => {
      log(`Failed to load ${name}: ${err.message}`, true);
    }
  );
}

// ─────────────────────────────────────────────
// APPLY TEXTURE PRESET
// ─────────────────────────────────────────────
function applyPreset(name) {
  if (!activeMesh) return;
  const mat = materialPresets[name]();
  // Carry over current environment map so reflections persist
  if (scene.environment) mat.envMap = scene.environment;
  if (activeMesh.material && activeMesh.material.dispose) activeMesh.material.dispose();
  activeMesh.material = mat;
  syncSliders();
  log(`Texture set to: ${name}`);
}

// ─────────────────────────────────────────────
// SLIDER WIRING
// ─────────────────────────────────────────────
const transparencySlider = document.getElementById('transparency-slider');
const shadowsSlider       = document.getElementById('shadows-slider');
const reflexivitySlider   = document.getElementById('reflexivity-slider');

function updateSliderDisplay(slider) {
  const display = slider.nextElementSibling;
  if (display && display.classList.contains('slider-value')) {
    display.textContent = parseFloat(slider.value).toFixed(2);
  }
}

function syncSliders() {
  if (!activeMesh) return;

  const opacity         = parseFloat(transparencySlider.value);
  const shadowIntensity = parseFloat(shadowsSlider.value);
  const reflexivity     = parseFloat(reflexivitySlider.value);

  activeMesh.material.opacity = 1.0 - opacity;
  activeMesh.material.transparent = activeMesh.material.opacity < 1.0;
  dirLight.intensity = shadowIntensity * 2.0;
  activeMesh.material.metalness = reflexivity;
  activeMesh.material.needsUpdate = true;
}

transparencySlider.addEventListener('input', () => { updateSliderDisplay(transparencySlider); syncSliders(); });
shadowsSlider.addEventListener('input', () => { updateSliderDisplay(shadowsSlider); syncSliders(); });
reflexivitySlider.addEventListener('input', () => { updateSliderDisplay(reflexivitySlider); syncSliders(); });

document.getElementById('texture-select').addEventListener('change', (e) => { applyPreset(e.target.value); });
modelSelect.addEventListener('change', (e) => { loadModel(e.target.value); });

// ─────────────────────────────────────────────
// RESIZE HANDLER
// ─────────────────────────────────────────────
window.addEventListener('resize', () => {
  const w = container.clientWidth;
  const h = container.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
});

// ─────────────────────────────────────────────
// ANIMATION LOOP
// ─────────────────────────────────────────────
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();

// ─────────────────────────────────────────────
// KICK OFF — everything defined above, safe to run
// ─────────────────────────────────────────────
try {
  initScenes(scene, renderer, () => activeMesh, log);
} catch (e) {
  log(`initScenes crashed: ${e.message}`, true);
}
loadModel(modelSelect.value);