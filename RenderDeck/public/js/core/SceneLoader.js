
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
