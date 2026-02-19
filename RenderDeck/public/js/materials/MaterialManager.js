// MATERIALMANAGER.JS - Centralized Material Management
// Uses MeshPhysicalMaterial for full PBR support (clearcoat, transmission, sheen, etc.)

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
    this.cache = new Map();
  }

  /**
   * Initialize all material presets using MeshPhysicalMaterial
   */
  initializePresets() {
    return {
      Wood: () => this.createMaterial('Wood', {
        map: createWoodTexture(),
        roughness: CONFIG.MATERIALS.WOOD.roughness,
        metalness: CONFIG.MATERIALS.WOOD.metalness,
        clearcoat: 0.1,
        clearcoatRoughness: 0.3,
      }),
      Metal: () => this.createMaterial('Metal', {
        map: createMetalTexture(),
        roughness: CONFIG.MATERIALS.METAL.roughness,
        metalness: CONFIG.MATERIALS.METAL.metalness,
        reflectivity: 1.0,
      }),
      Glass: () => this.createMaterial('Glass', {
        map: createGlassTexture(),
        roughness: CONFIG.MATERIALS.GLASS.roughness,
        metalness: CONFIG.MATERIALS.GLASS.metalness,
        opacity: CONFIG.MATERIALS.GLASS.opacity,
        transparent: CONFIG.MATERIALS.GLASS.transparent,
        transmission: 0.9,
        ior: 1.5,
        thickness: 0.5,
        envMapIntensity: 1.5,
      }),
      Plastic: () => this.createMaterial('Plastic', {
        map: createPlasticTexture(),
        roughness: CONFIG.MATERIALS.PLASTIC.roughness,
        metalness: CONFIG.MATERIALS.PLASTIC.metalness,
        clearcoat: 0.4,
        clearcoatRoughness: 0.1,
        specularIntensity: 0.8,
      }),
    };
  }

  /**
   * Create a MeshPhysicalMaterial with full defaults
   */
  createMaterial(name, properties) {
    return new THREE.MeshPhysicalMaterial({
      side: THREE.DoubleSide,
      color: 0xffffff,
      metalness: 0.0,
      roughness: 0.5,
      clearcoat: 0.0,
      clearcoatRoughness: 0.1,
      specularIntensity: 1.0,
      specularColor: new THREE.Color(0xffffff),
      transmission: 0.0,
      ior: 1.5,
      thickness: 0.0,
      sheen: 0.0,
      sheenRoughness: 1.0,
      sheenColor: new THREE.Color(0xffffff),
      emissive: new THREE.Color(0x000000),
      emissiveIntensity: 0.0,
      attenuationDistance: Infinity,
      attenuationColor: new THREE.Color(0xffffff),
      envMapIntensity: 1.0,
      ...properties,
      name,
    });
  }

  /**
   * Get a material preset by name
   */
  getPreset(name) {
    if (!this.presets[name]) {
      console.warn(`Material preset "${name}" not found, using Wood`);
      return this.presets.Wood();
    }
    return this.presets[name]();
  }

  getPresetNames() {
    return Object.keys(this.presets);
  }

  addPreset(name, generator) {
    this.presets[name] = generator;
  }

  applyEnvironment(material, envMap) {
    if (material && envMap) {
      material.envMap = envMap;
      material.envMapIntensity = material.envMapIntensity ?? 1.0;
      material.needsUpdate = true;
    }
  }

  /**
   * Apply saved properties to a MeshPhysicalMaterial
   */
  applySavedProperties(material, properties) {
    if (!properties) return;

    if (properties.color !== undefined) material.color.set(properties.color);
    if (properties.metalness !== undefined) material.metalness = properties.metalness;
    if (properties.roughness !== undefined) material.roughness = properties.roughness;
    if (properties.opacity !== undefined) material.opacity = properties.opacity;
    if (properties.transparent !== undefined) material.transparent = properties.transparent;
    if (properties.clearcoat !== undefined) material.clearcoat = properties.clearcoat;
    if (properties.clearcoatRoughness !== undefined) material.clearcoatRoughness = properties.clearcoatRoughness;
    if (properties.specularIntensity !== undefined) material.specularIntensity = properties.specularIntensity;
    if (properties.specularColor !== undefined) material.specularColor.set(properties.specularColor);
    if (properties.transmission !== undefined) material.transmission = properties.transmission;
    if (properties.ior !== undefined) material.ior = properties.ior;
    if (properties.thickness !== undefined) material.thickness = properties.thickness;
    if (properties.attenuationDistance !== undefined) {
      // 0 is stored in JSON to represent Infinity (JSON can't serialize Infinity)
      material.attenuationDistance = (properties.attenuationDistance === 0 || properties.attenuationDistance === null)
        ? Infinity
        : properties.attenuationDistance;
    }
    if (properties.attenuationColor !== undefined) material.attenuationColor.set(properties.attenuationColor);
    if (properties.sheen !== undefined) material.sheen = properties.sheen;
    if (properties.sheenRoughness !== undefined) material.sheenRoughness = properties.sheenRoughness;
    if (properties.sheenColor !== undefined) material.sheenColor.set(properties.sheenColor);
    if (properties.emissive !== undefined) material.emissive.set(properties.emissive);
    if (properties.emissiveIntensity !== undefined) material.emissiveIntensity = properties.emissiveIntensity;
    if (properties.envMapIntensity !== undefined) material.envMapIntensity = properties.envMapIntensity;

    material.needsUpdate = true;
  }

  /**
   * Extract all physical material properties for saving
   */
  extractProperties(material) {
    if (!material) return {};
    return {
      color: '#' + material.color.getHexString(),
      metalness: material.metalness,
      roughness: material.roughness,
      opacity: material.opacity,
      transparent: material.transparent,
      clearcoat: material.clearcoat,
      clearcoatRoughness: material.clearcoatRoughness,
      specularIntensity: material.specularIntensity,
      specularColor: '#' + material.specularColor.getHexString(),
      transmission: material.transmission,
      ior: material.ior,
      thickness: material.thickness,
      attenuationDistance: (material.attenuationDistance === Infinity ? 0 : material.attenuationDistance),
      attenuationColor: '#' + material.attenuationColor.getHexString(),
      sheen: material.sheen,
      sheenRoughness: material.sheenRoughness,
      sheenColor: '#' + material.sheenColor.getHexString(),
      emissive: '#' + material.emissive.getHexString(),
      emissiveIntensity: material.emissiveIntensity,
      envMapIntensity: material.envMapIntensity,
    };
  }

  dispose(material) {
    if (!material) return;
    const maps = [
      'map', 'normalMap', 'roughnessMap', 'metalnessMap',
      'aoMap', 'emissiveMap', 'bumpMap', 'displacementMap',
      'alphaMap', 'lightMap', 'envMap', 'clearcoatMap',
      'clearcoatNormalMap', 'clearcoatRoughnessMap',
      'sheenColorMap', 'sheenRoughnessMap',
      'specularIntensityMap', 'specularColorMap',
      'transmissionMap', 'thicknessMap',
    ];
    maps.forEach(prop => { if (material[prop]) material[prop].dispose(); });
    material.dispose();
  }
}