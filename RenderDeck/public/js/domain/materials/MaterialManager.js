// MATERIALMANAGER.JS - Centralized Material Management
// Uses MeshPhysicalMaterial for full PBR support (clearcoat, transmission, sheen, etc.)

import * as THREE from 'three';
import { CONFIG } from '../../config.js';
import {
  createWoodTexture,
  createMetalTexture,
  createGlassTexture,
  createPlasticTexture
} from './generators.js';

export class MaterialManager {
  constructor() {
    // Shipped standard definitions: [{ id, label, params }]
    this.shippedDefinitions = [];

    // Legacy procedural presets — not listed, but very old custom models may
    // reference names like 'Wood'
    this._legacyPresets = this._initializeLegacyPresets();
  }

  /** Legacy procedural presets kept for backward compatibility. */
  _initializeLegacyPresets() {
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
   * Fetch the shipped standard material definitions from the STANDARD_MATERIALS config
   * array. Call once after construction (async). Never changed afterwards: a project's
   * edits are stored separately by MaterialLibrary.
   * @param {Array} standardMaterials - from config.js STANDARD_MATERIALS
   */
  async loadPresetsFromManifest(standardMaterials) {
    const loaded = await Promise.all(standardMaterials.map(async (mat) => {
      if (!mat.path || !mat.label || !mat.path.endsWith('.json')) return null;
      try {
        const res = await fetch(`./${mat.path}`);
        if (!res.ok) { console.warn(`MaterialManager: HTTP ${res.status} for ${mat.label}`); return null; }
        const json = await res.json();
        return { id: `standard:${mat.id}`, label: mat.label, params: json.params || {} };
      } catch (e) {
        console.warn(`MaterialManager: failed to load preset "${mat.label}"`, e);
        return null;
      }
    }));
    this.shippedDefinitions = loaded.filter(Boolean);
  }

  /**
   * Create a MeshPhysicalMaterial with full defaults
   */
  createMaterial(name, properties) {
    // normalScale must be excluded from the constructor spread — passing a plain
    // number overwrites Three.js's Vector2, breaking .set() calls later.
    const { normalScale: normalScaleValue, ...rest } = properties || {};

    const merged = {
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
      anisotropy: 0.0,
      anisotropyRotation: 0.0,
      iridescence: 0.0,
      iridescenceIOR: 1.3,
      iridescenceThicknessRange: [100, 400],
      dispersion: 0.0,
      reflectivity: 0.5,
      ...rest,
      name,
    };
    // attenuationDistance: 0 is used as a JSON stand-in for Infinity — restore it
    if (merged.attenuationDistance === 0 || merged.attenuationDistance === null) {
      merged.attenuationDistance = Infinity;
    }
    // Transmission materials must be transparent to render correctly
    if (merged.transmission > 0) merged.transparent = true;
    // Opacity < 1 also needs transparent
    if (merged.opacity !== undefined && merged.opacity < 1) merged.transparent = true;
    const mat = new THREE.MeshPhysicalMaterial(merged);
    // Apply normalScale via Vector2.set() to preserve the Three.js type
    if (normalScaleValue !== undefined) mat.normalScale.set(normalScaleValue, normalScaleValue);
    return mat;
  }

  /** Legacy procedural preset (only very old custom models reference these). */
  isLegacyPreset(name) {
    return name in this._legacyPresets;
  }

  createLegacyPreset(name) {
    return this._legacyPresets[name]();
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
    if (properties.transmission !== undefined) {
      material.transmission = properties.transmission;
      if (properties.transmission > 0) material.transparent = true;
    }
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
    if (properties.anisotropy !== undefined) material.anisotropy = properties.anisotropy;
    if (properties.anisotropyRotation !== undefined) material.anisotropyRotation = properties.anisotropyRotation;
    if (properties.iridescence !== undefined) material.iridescence = properties.iridescence;
    if (properties.iridescenceIOR !== undefined) material.iridescenceIOR = properties.iridescenceIOR;
    if (properties.iridescenceThicknessRange !== undefined) material.iridescenceThicknessRange = [...properties.iridescenceThicknessRange];
    if (properties.dispersion !== undefined) material.dispersion = properties.dispersion;
    // MeshPhysicalMaterial derives reflectivity from IOR. Applying both causes
    // a floating-point round trip on every restore; prefer the stored IOR.
    if (properties.reflectivity !== undefined && properties.ior === undefined) material.reflectivity = properties.reflectivity;
    if (properties.normalScale !== undefined && material.normalScale) material.normalScale.set(properties.normalScale, properties.normalScale);
    if (properties.displacementScale !== undefined) material.displacementScale = properties.displacementScale;
    if (properties.displacementBias  !== undefined) material.displacementBias  = properties.displacementBias;

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
      anisotropy: material.anisotropy,
      anisotropyRotation: material.anisotropyRotation,
      iridescence: material.iridescence,
      iridescenceIOR: material.iridescenceIOR,
      iridescenceThicknessRange: [...material.iridescenceThicknessRange],
      dispersion: material.dispersion,
      reflectivity: material.reflectivity,
      normalScale: material.normalScale?.x ?? 1,
      displacementScale: material.displacementScale ?? 1,
      displacementBias:  material.displacementBias  ?? 0,
    };
  }

  dispose(material) {
    if (!material) return;
    // envMap is intentionally excluded — it's the scene's shared HDR texture
    const maps = [
      'map', 'normalMap', 'roughnessMap', 'metalnessMap',
      'aoMap', 'emissiveMap', 'bumpMap', 'displacementMap',
      'alphaMap', 'lightMap', 'clearcoatMap',
      'clearcoatNormalMap', 'clearcoatRoughnessMap',
      'sheenColorMap', 'sheenRoughnessMap',
      'specularIntensityMap', 'specularColorMap',
      'transmissionMap', 'thicknessMap',
    ];
    maps.forEach(prop => { if (material[prop]) material[prop].dispose(); });
    material.dispose();
  }
}
