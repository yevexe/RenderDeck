
// SCENELOADER.JS - HDR Environment Loader

import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { STANDARD_ENVIRONMENTS } from '../config.js';

/**
 * Load the first configured environment on startup.
 * @param {Function} onLoad - (label, texture) => void
 */
export function initScenes(onLoad) {
  if (STANDARD_ENVIRONMENTS.length === 0) {
    console.warn('No environments configured in STANDARD_ENVIRONMENTS');
    return;
  }
  const first = STANDARD_ENVIRONMENTS[0];
  _loadHDR(first.path, (texture) => {
    if (onLoad) onLoad(first.label, texture);
  });
}

/**
 * Load an environment by label.
 * @param {string} label - Matches STANDARD_ENVIRONMENTS[].label
 * @param {Function} onLoad - (label, texture) => void
 */
export function loadScene(label, onLoad) {
  const env = STANDARD_ENVIRONMENTS.find(e => e.label === label);
  if (!env) {
    console.error(`Environment not found: ${label}`);
    return;
  }
  _loadHDR(env.path, (texture) => {
    if (onLoad) onLoad(label, texture);
  });
}

/**
 * Return all environment labels for populating the UI select.
 * @returns {string[]}
 */
export function getSceneNames() {
  return STANDARD_ENVIRONMENTS.map(e => e.label);
}

// ── Environment preview cache ────────────────────────────────
const _envPreviewMemCache = new Map();
const _ENV_PREVIEW_LS_PREFIX = 'rd_envpreview_v1_';

function _envCacheKey(path) {
  return _ENV_PREVIEW_LS_PREFIX + path.replace(/[^a-z0-9]/gi, '_');
}

/**
 * Render a tiny HDR environment preview onto a reflective sphere.
 * Results are cached in memory and localStorage — subsequent calls
 * for the same path resolve instantly from cache.
 * @param {string} path - Path to the .hdr file
 * @param {number} [size=128] - Width/height of the output image in pixels
 * @returns {Promise<string|null>} data URL or null on failure
 */
export function generateEnvPreview(path, size = 128) {
  // 1. In-memory cache hit
  if (_envPreviewMemCache.has(path)) {
    return Promise.resolve(_envPreviewMemCache.get(path));
  }

  // 2. localStorage cache hit
  try {
    const stored = localStorage.getItem(_envCacheKey(path));
    if (stored) {
      _envPreviewMemCache.set(path, stored);
      return Promise.resolve(stored);
    }
  } catch (_) { /* localStorage unavailable — proceed to render */ }

  // 3. Render and cache
  return new Promise((resolve) => {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(size, size);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 2.5);

    const geometry = new THREE.SphereGeometry(1, 32, 32);
    const material = new THREE.MeshStandardMaterial({ metalness: 1.0, roughness: 0.05 });
    scene.add(new THREE.Mesh(geometry, material));

    new RGBELoader().load(
      path,
      (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping;
        scene.environment = texture;
        scene.background  = texture;
        renderer.render(scene, camera);
        const dataUrl = renderer.domElement.toDataURL('image/png');
        geometry.dispose();
        material.dispose();
        texture.dispose();
        renderer.dispose();

        _envPreviewMemCache.set(path, dataUrl);
        try { localStorage.setItem(_envCacheKey(path), dataUrl); } catch (_) {}

        resolve(dataUrl);
      },
      undefined,
      () => { renderer.dispose(); resolve(null); }
    );
  });
}

// ── Internal ────────────────────────────────────────────────
function _loadHDR(path, onLoad) {
  const loader = new RGBELoader();
  loader.load(
    path,
    (texture) => {
      texture.mapping = THREE.EquirectangularReflectionMapping;
      onLoad(texture);
    },
    undefined,
    (err) => console.error(`Failed to load HDR: ${path}`, err)
  );
}
