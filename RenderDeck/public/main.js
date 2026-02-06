import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { initScenes } from './scenes.js';
import { ModelManager } from './modelManager.js';
import { UVEditor } from './uvEditor.js';

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
  
  // Auto-scroll debug panel
  debug.scrollTop = debug.scrollHeight;
}

// Catch any uncaught errors and show them in the debug panel
window.addEventListener('error', (e) => { log(`ERROR: ${e.message} (${e.filename}:${e.lineno})`, true); });
window.addEventListener('unhandledrejection', (e) => { log(`UNHANDLED: ${e.reason}`, true); });

// ─────────────────────────────────────────────
// MODEL MANAGER INITIALIZATION
// ─────────────────────────────────────────────
const modelManager = new ModelManager();

// Register built-in models
const BUILT_IN_MODELS = {
  'Plain Mug': {
    folder: 'plain_mug',
    obj: 'mug.obj',
    mtl: null
  },
  'Simple Pen': {
    folder: 'simple_pen',
    obj: 'pen.obj',
    mtl: 'pen.mtl'
  },
};

Object.entries(BUILT_IN_MODELS).forEach(([name, config]) => {
  modelManager.registerModel(name, config);
});

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
// UV EDITOR INITIALIZATION
// ─────────────────────────────────────────────
const uvEditor = new UVEditor(renderer, log, modelManager);

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
// POPULATE MODEL SELECT
// ─────────────────────────────────────────────
const modelSelect = document.getElementById('model-select');

function updateModelSelect() {
  modelSelect.innerHTML = '';
  const categories = modelManager.getModelNamesByCategory();
  
  // Built-in models
  if (categories.builtin.length > 0) {
    const builtinGroup = document.createElement('optgroup');
    builtinGroup.label = 'Built-in Models';
    categories.builtin.forEach((name) => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      builtinGroup.appendChild(opt);
    });
    modelSelect.appendChild(builtinGroup);
  }
  
  // User uploaded models
  if (categories.uploaded.length > 0) {
    const uploadedGroup = document.createElement('optgroup');
    uploadedGroup.label = 'Uploaded Models';
    categories.uploaded.forEach((name) => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      uploadedGroup.appendChild(opt);
    });
    modelSelect.appendChild(uploadedGroup);
  }
  
  // Custom models
  if (categories.custom.length > 0) {
    const customGroup = document.createElement('optgroup');
    customGroup.label = 'Custom Models';
    categories.custom.forEach((name) => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      customGroup.appendChild(opt);
    });
    modelSelect.appendChild(customGroup);
  }
  
  // Select first option
  if (modelSelect.options.length > 0) {
    modelSelect.options[0].selected = true;
  }
}

// Make updateModelSelect globally accessible for uvEditor
window.updateModelSelect = updateModelSelect;

// Make switchToModel globally accessible for uvEditor
window.switchToModel = function(modelName) {
  modelSelect.value = modelName;
  loadModel(modelName);
};

// Initial population
updateModelSelect();

// ─────────────────────────────────────────────
// LOAD OBJ MODEL (with optional MTL materials)
// ─────────────────────────────────────────────
let activeMesh = null;
let activeModel = null;
let originalMaterials = [];

const objLoader = new OBJLoader();
const mtlLoader = new MTLLoader();

function loadModel(name) {
  const loadingPaths = modelManager.getLoadingPaths(name);
  if (!loadingPaths) { log(`Model not found: ${name}`, true); return; }

  // Clean up previous model
  if (activeModel) {
    scene.remove(activeModel);
    activeModel.traverse((child) => {
      if (child.isMesh) {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach(mat => {
              if (mat.map) mat.map.dispose();
              mat.dispose();
            });
          } else {
            if (child.material.map) child.material.map.dispose();
            child.material.dispose();
          }
        }
      }
    });
    activeModel = null;
    activeMesh = null;
    originalMaterials = [];
  }

  log(`Loading ${name}…`);

  // Function to load the OBJ (with or without materials)
  function loadOBJ(materials = null) {
    if (materials) {
      objLoader.setMaterials(materials);
    }

    const objPath = loadingPaths.type === 'path' 
      ? loadingPaths.basePath + loadingPaths.obj
      : loadingPaths.obj;

    objLoader.load(
      objPath,
      (object) => {
        object.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            
            if (!activeMesh) {
              activeMesh = child;
            }
            
            if (child.material) {
              const matClone = Array.isArray(child.material)
                ? child.material.map(m => m.clone())
                : child.material.clone();
              originalMaterials.push({ mesh: child, material: matClone });
            }
          }
        });

        scene.add(object);
        activeModel = object;

        // Center model at origin
        const box = new THREE.Box3().setFromObject(object);
        const center = box.getCenter(new THREE.Vector3());
        object.position.sub(center);

        box.setFromObject(object);
        const newCenter = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());

        controls.target.copy(newCenter);

        const maxDim = Math.max(size.x, size.y, size.z);
        camera.position.set(0, newCenter.y + maxDim * 0.05, maxDim * 2.5);
        camera.lookAt(newCenter);
        controls.update();

        applyPreset(document.getElementById('texture-select').value);

        log(`${name} loaded successfully.`);
      },
      (xhr) => {
        if (xhr.lengthComputable && xhr.total > 0) {
          const percent = ((xhr.loaded / xhr.total) * 100).toFixed(0);
          log(`Loading OBJ… ${percent}%`);
        }
      },
      (err) => {
        log(`Failed to load OBJ ${name}: ${err}`, true);
      }
    );
  }

  // Load MTL first if it exists, then load OBJ
  if (loadingPaths.mtl) {
    if (loadingPaths.type === 'path') {
      mtlLoader.setPath(loadingPaths.basePath);
      mtlLoader.load(
        loadingPaths.mtl,
        (materials) => {
          materials.preload();
          log(`Materials loaded for ${name}.`);
          loadOBJ(materials);
        },
        undefined,
        (err) => {
          log(`MTL load failed, loading OBJ without materials: ${err}`, true);
          loadOBJ();
        }
      );
    } else {
      // For blob URLs, load the MTL directly
      fetch(loadingPaths.mtl)
        .then(response => response.text())
        .then(mtlText => {
          const materials = mtlLoader.parse(mtlText, '');
          materials.preload();
          log(`Materials loaded for ${name}.`);
          loadOBJ(materials);
        })
        .catch(err => {
          log(`MTL load failed: ${err}`, true);
          loadOBJ();
        });
    }
  } else {
    loadOBJ();
  }
}

// ─────────────────────────────────────────────
// APPLY TEXTURE PRESET
// ─────────────────────────────────────────────
function applyPreset(name) {
  if (!activeModel) return;
  
  activeModel.traverse((child) => {
    if (child.isMesh) {
      const mat = materialPresets[name]();
      
      if (scene.environment) {
        mat.envMap = scene.environment;
        mat.envMapIntensity = 1.0;
      }
      
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose && m.dispose());
        } else {
          child.material.dispose && child.material.dispose();
        }
      }
      
      child.material = mat;
      child.material.needsUpdate = true;
    }
  });
  
  syncSliders();
  log(`Texture preset applied: ${name}`);
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
  if (!activeModel) return;

  const opacity         = parseFloat(transparencySlider.value);
  const shadowIntensity = parseFloat(shadowsSlider.value);
  const reflexivity     = parseFloat(reflexivitySlider.value);

  activeModel.traverse((child) => {
    if (child.isMesh && child.material) {
      child.material.opacity = 1.0 - opacity;
      child.material.transparent = child.material.opacity < 1.0;
      child.material.metalness = reflexivity;
      child.material.needsUpdate = true;
    }
  });

  dirLight.intensity = shadowIntensity * 2.0;
}

transparencySlider.addEventListener('input', () => { updateSliderDisplay(transparencySlider); syncSliders(); });
shadowsSlider.addEventListener('input', () => { updateSliderDisplay(shadowsSlider); syncSliders(); });
reflexivitySlider.addEventListener('input', () => { updateSliderDisplay(reflexivitySlider); syncSliders(); });

document.getElementById('texture-select').addEventListener('change', (e) => { applyPreset(e.target.value); });
modelSelect.addEventListener('change', (e) => { loadModel(e.target.value); });

// ─────────────────────────────────────────────
// DRAG AND DROP / FILE UPLOAD
// ─────────────────────────────────────────────
const dropZone = document.querySelector('.scene-view-placeholder');
const fileInput = document.getElementById('file-upload');

// Prevent default drag behaviors
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
  dropZone.addEventListener(eventName, preventDefaults, false);
  document.body.addEventListener(eventName, preventDefaults, false);
});

function preventDefaults(e) {
  e.preventDefault();
  e.stopPropagation();
}

// Highlight drop zone when item is dragged over it
['dragenter', 'dragover'].forEach(eventName => {
  dropZone.addEventListener(eventName, () => {
    dropZone.style.border = '3px dashed #4CAF50';
  }, false);
});

['dragleave', 'drop'].forEach(eventName => {
  dropZone.addEventListener(eventName, () => {
    dropZone.style.border = '1px solid';
  }, false);
});

// Handle dropped files
dropZone.addEventListener('drop', handleDrop, false);

async function handleDrop(e) {
  const dt = e.dataTransfer;
  const files = dt.files;
  await handleFiles(files);
}

// Handle file input
if (fileInput) {
  fileInput.addEventListener('change', async (e) => {
    await handleFiles(e.target.files);
  });
}

async function handleFiles(files) {
  if (files.length === 0) return;

  log(`Processing ${files.length} file(s)...`);

  const result = await modelManager.addModelFromFiles(files);

  // Log the verification report
  const reportLines = result.report.split('\n');
  reportLines.forEach(line => {
    if (line.includes('❌') || line.includes('ERROR')) {
      log(line, true);
    } else if (line.includes('⚠️') || line.includes('WARNING')) {
      log(line, false);
    } else if (line.trim()) {
      log(line, false);
    }
  });

  if (result.success) {
    log(`✅ Model "${result.name}" added successfully!`);
    updateModelSelect();
    
    // Automatically load the new model
    modelSelect.value = result.name;
    loadModel(result.name);
  } else {
    log(`❌ Failed to add model. Check errors above.`, true);
  }
}

// ─────────────────────────────────────────────
// EDIT TEXTURE BUTTON
// ─────────────────────────────────────────────
const editTextureBtn = document.getElementById('edit-texture-btn');
if (editTextureBtn) {
  editTextureBtn.addEventListener('click', () => {
    if (activeMesh) {
      const currentModelName = modelSelect.value;
      uvEditor.show(activeMesh, currentModelName);
    } else {
      log('No model loaded to edit', true);
      alert('Please load a model first before editing textures.');
    }
  });
}

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
// KICK OFF
// ─────────────────────────────────────────────
try {
  initScenes(scene, renderer, () => activeMesh, log);
} catch (e) {
  log(`initScenes crashed: ${e.message}`, true);
}

// Load first model
if (modelSelect.value) {
  loadModel(modelSelect.value);
}

log('RenderDeck initialized. Drag & drop OBJ files to add models!');