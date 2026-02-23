
// SCENES.JS - HDR Environment Loader

import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { SCENE_PATHS } from './config.js';

/**
 * Initialize HDR scenes
 * @param {Function} onLoad - Callback when scene loads: (name, texture) => void
 */
export function initScenes(onLoad) {
  const loader = new RGBELoader();
  
  // Get first scene from config
  const sceneNames = Object.keys(SCENE_PATHS.ENVIRONMENTS);
  if (sceneNames.length === 0) {
    console.warn('No scenes configured in SCENE_PATHS');
    return;
  }
  
  const firstSceneName = sceneNames[0];
  const filename = SCENE_PATHS.ENVIRONMENTS[firstSceneName];
  const path = SCENE_PATHS.BASE_PATH + filename;
  
  loader.load(
    path,
    (texture) => {
      texture.mapping = THREE.EquirectangularReflectionMapping;
      if (onLoad) {
        onLoad(firstSceneName, texture);
      }
    },
    undefined,
    (err) => {
      console.error(`Failed to load HDR scene: ${err}`);
    }
  );
}

/**
 * Load a specific scene by name
 * @param {string} name - Scene name from SCENE_PATHS
 * @param {Function} onLoad - Callback when loaded
 */
export function loadScene(name, onLoad) {
  const filename = SCENE_PATHS.ENVIRONMENTS[name];
  if (!filename) {
    console.error(`Scene not found: ${name}`);
    return;
  }
  
  const loader = new RGBELoader();
  const path = SCENE_PATHS.BASE_PATH + filename;
  
  loader.load(
    path,
    (texture) => {
      texture.mapping = THREE.EquirectangularReflectionMapping;
      if (onLoad) {
        onLoad(name, texture);
      }
    },
    undefined,
    (err) => {
      console.error(`Failed to load scene ${name}: ${err}`);
    }
  );
}

/**
 * Get all available scene names
 * @returns {string[]}
 */
export function getSceneNames() {
  return Object.keys(SCENE_PATHS.ENVIRONMENTS);
}