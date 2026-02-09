
// HELPERS.JS - Utility Functions

import * as THREE from 'three';

/**
 * Center camera on object and adjust distance to frame it
 * @param {THREE.Object3D} object - Object to frame
 * @param {CameraManager} cameraManager - Camera manager instance
 */
export function centerAndFrameModel(object, cameraManager) {
  if (!object || !cameraManager) return;
  cameraManager.frameObject(object);
}

/**
 * Cleanup Three.js object and its children (dispose geometries, materials, textures)
 * @param {THREE.Object3D} object - Object to clean up
 */
export function cleanupObject(object) {
  if (!object) return;

  object.traverse((child) => {
    if (child.geometry) {
      child.geometry.dispose();
    }

    if (child.material) {
      if (Array.isArray(child.material)) {
        child.material.forEach(material => disposeMaterial(material));
      } else {
        disposeMaterial(child.material);
      }
    }
  });
}

/**
 * Dispose a material and its textures
 * @param {THREE.Material} material
 */
function disposeMaterial(material) {
  if (!material) return;

  // Dispose all texture maps
  const textureProperties = [
    'map', 'normalMap', 'roughnessMap', 'metalnessMap', 
    'aoMap', 'emissiveMap', 'bumpMap', 'displacementMap',
    'alphaMap', 'lightMap', 'envMap'
  ];

  textureProperties.forEach(prop => {
    if (material[prop]) {
      material[prop].dispose();
    }
  });

  material.dispose();
}

/**
 * Read file as text
 * @param {File} file
 * @returns {Promise<string>}
 */
export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = (e) => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

/**
 * Read file as data URL
 * @param {File} file
 * @returns {Promise<string>}
 */
export function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = (e) => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Download data as file
 * @param {string} filename - File name
 * @param {string} content - File content
 * @param {string} mimeType - MIME type (default: text/plain)
 */
export function downloadFile(filename, content, mimeType = 'text/plain') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Generate unique ID
 * @returns {string}
 */
export function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Clamp value between min and max
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Lerp (linear interpolation) between two values
 * @param {number} start
 * @param {number} end
 * @param {number} t - Interpolation factor (0-1)
 * @returns {number}
 */
export function lerp(start, end, t) {
  return start + (end - start) * t;
}

/**
 * Format bytes to human-readable string
 * @param {number} bytes
 * @param {number} decimals - Decimal places (default: 2)
 * @returns {string}
 */
export function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Debounce function calls
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in ms
 * @returns {Function}
 */
export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Deep clone object (simple version)
 * @param {Object} obj
 * @returns {Object}
 */
export function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj instanceof Date) return new Date(obj);
  if (obj instanceof Array) return obj.map(item => deepClone(item));
  
  const clonedObj = {};
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      clonedObj[key] = deepClone(obj[key]);
    }
  }
  return clonedObj;
}