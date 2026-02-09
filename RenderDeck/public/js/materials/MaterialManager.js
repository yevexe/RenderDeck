
// MATERIALMANAGER.JS - Centralized Material Management

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { 
  createWoodTexture, 
  createMetalTexture, 
  createGlassTexture, 
  createPlasticTexture 
} from './generators.js';

export class MaterialManager {
  constructor() {
    this.presets = this.initializePresets();
    this.cache = new Map(); // Cache created materials
  }

  /**
   * Initialize all material presets
   * @returns {Object} Preset name -> generator function map
   */
  initializePresets() {
    return {
      Wood: () => this.createMaterial('Wood', {
        map: createWoodTexture(),
        ...CONFIG.MATERIALS.WOOD
      }),
      Metal: () => this.createMaterial('Metal', {
        map: createMetalTexture(),
        ...CONFIG.MATERIALS.METAL
      }),
      Glass: () => this.createMaterial('Glass', {
        map: createGlassTexture(),
        ...CONFIG.MATERIALS.GLASS
      }),
      Plastic: () => this.createMaterial('Plastic', {
        map: createPlasticTexture(),
        ...CONFIG.MATERIALS.PLASTIC
      })
    };
  }

  /**
   * Create a material with common defaults
   * @param {string} name - Material name
   * @param {Object} properties - Material properties
   * @returns {THREE.MeshStandardMaterial}
   */
  createMaterial(name, properties) {
    return new THREE.MeshStandardMaterial({
      side: THREE.DoubleSide,
      ...properties,
      name: name // Tag it for debugging
    });
  }

  /**
   * Get a material preset
   * @param {string} name - Preset name (Wood, Metal, Glass, Plastic)
   * @returns {THREE.MeshStandardMaterial}
   */
  getPreset(name) {
    if (!this.presets[name]) {
      console.warn(`Material preset "${name}" not found, using Wood`);
      return this.presets.Wood();
    }
    return this.presets[name]();
  }

  /**
   * Get all preset names
   * @returns {string[]}
   */
  getPresetNames() {
    return Object.keys(this.presets);
  }

  /**
   * Add a custom preset (for future expansion)
   * @param {string} name - Preset name
   * @param {Function} generator - Generator function
   */
  addPreset(name, generator) {
    this.presets[name] = generator;
  }

  /**
   * Apply environment map to material
   * @param {THREE.Material} material
   * @param {THREE.Texture} envMap
   */
  applyEnvironment(material, envMap) {
    if (material && envMap) {
      material.envMap = envMap;
      material.envMapIntensity = 1.0;
      material.needsUpdate = true;
    }
  }

  /**
   * Apply saved properties to material
   * @param {THREE.Material} material
   * @param {Object} properties - Saved material properties
   */
  applySavedProperties(material, properties) {
    if (!properties) return;

    if (properties.opacity !== undefined) material.opacity = properties.opacity;
    if (properties.transparent !== undefined) material.transparent = properties.transparent;
    if (properties.metalness !== undefined) material.metalness = properties.metalness;
    if (properties.roughness !== undefined) material.roughness = properties.roughness;
    if (properties.color) {
      material.color.setRGB(properties.color.r, properties.color.g, properties.color.b);
    }
    material.needsUpdate = true;
  }

  /**
   * Get current material properties (for saving)
   * @param {THREE.Material} material
   * @returns {Object}
   */
  extractProperties(material) {
    if (!material) return {};

    return {
      metalness: material.metalness,
      roughness: material.roughness,
      opacity: material.opacity,
      transparent: material.transparent,
      color: material.color ? {
        r: material.color.r,
        g: material.color.g,
        b: material.color.b
      } : null
    };
  }

  /**
   * Dispose of material and its textures
   * @param {THREE.Material} material
   */
  dispose(material) {
    if (!material) return;

    if (material.map) material.map.dispose();
    if (material.normalMap) material.normalMap.dispose();
    if (material.roughnessMap) material.roughnessMap.dispose();
    if (material.metalnessMap) material.metalnessMap.dispose();
    if (material.envMap) material.envMap.dispose();
    
    material.dispose();
  }
}