import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

// ─────────────────────────────────────────────
// SCENE / ENVIRONMENT REGISTRY
// To add a new scene: drop the .hdr into ../scenes/
// and add an entry here.
//   key  — label in the dropdown
//   file — filename inside ../scenes/
// ─────────────────────────────────────────────
const SCENES = {
  'Studio Kominka':   'studio_kominka_02_2k.hdr',
  'Lebombo':          'lebombo_2k.hdr',
};

// ─────────────────────────────────────────────
// INIT
//   scene         — the THREE.Scene
//   renderer      — the WebGLRenderer
//   getActiveMesh — () => current mesh
//   log           — debug log fn from main.js
// ─────────────────────────────────────────────
export function initScenes(scene, renderer, getActiveMesh, log) {

  // Tone mapping — required for HDR data to render correctly
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  // Lazy-init: PMREMGenerator is heavy, create it on first load only
  let pmremGenerator = null;
  function getPMREM() {
    if (!pmremGenerator) {
      pmremGenerator = new THREE.PMREMGenerator(renderer);
      pmremGenerator.compileEquirectangularShader();
    }
    return pmremGenerator;
  }

  const hdrLoader = new RGBELoader();

  // ─── populate the dropdown from the registry ───
  const sceneSelect = document.getElementById('scene-select');
  Object.keys(SCENES).forEach((name, i) => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    if (i === 0) opt.selected = true;
    sceneSelect.appendChild(opt);
  });

  // ─── loader ─────────────────────────────────
  function loadScene(name) {
    const file = SCENES[name];
    if (!file) { log(`Unknown scene: ${name}`, true); return; }

    log(`Loading scene: ${name}…`);

    hdrLoader.load(
      `../scenes/${file}`,
      (texture) => {
        try {
          const envMap = getPMREM().fromEquirectangular(texture).texture;

          scene.background  = envMap;
          scene.environment = envMap;

          const mesh = getActiveMesh();
          if (mesh) {
            // Find the top-level object for this mesh (child of scene)
            let top = mesh;
            while (top.parent && top.parent !== scene) {
              top = top.parent;
            }

            // Traverse the whole model and apply envMap to all materials
            top.traverse((child) => {
              if (child.isMesh && child.material) {
                const mats = Array.isArray(child.material) ? child.material : [child.material];
                mats.forEach(mat => {
                  mat.envMap = envMap;
                  mat.needsUpdate = true;
                });
              }
            });
          }

          texture.dispose();
          log(`Scene set to: ${name}`);
        } catch (e) {
          log(`Scene processing error: ${e.message}`, true);
        }
      },
      undefined,
      (err) => {
        log(`Failed to load scene ${name}: ${err}`, true);
      }
    );
  }

  // ─── events ─────────────────────────────────
  sceneSelect.addEventListener('change', (e) => {
    loadScene(e.target.value);
  });

  // Load the default on startup
  loadScene(sceneSelect.value);

  return { loadScene };
}