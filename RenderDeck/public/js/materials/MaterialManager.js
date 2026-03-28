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
    // JSON-based presets loaded from asset files — shown in UI dropdown
    this.presets = {};
    this._jsonPresetNames = [];

    // Legacy procedural presets — not shown in UI but used as fallback
    // (custom models may reference old preset names like 'Wood')
    this._legacyPresets = this._initializeLegacyPresets();

    // Raw params for each JSON preset — used to reset cached instances to defaults
    this._presetParams = {};

    // One material instance per preset, reused across switches.
    // Reusing the same object means WebGLProgram.getUniforms() stays cached after
    // the first render (warmup), so subsequent material switches have zero stall.
    this._instanceCache = new Map();

    // User-created presets — stored in localStorage, prepended to the UI list
    this._userPresetNames = [];  // ordered list, newest first
    this._userPresetParams = {}; // name → params
    this._loadUserPresetsFromStorage();

    // Standard presets the user has hidden ("deleted") — persisted in localStorage
    this._hiddenStandardPresets = new Set();
    this._loadHiddenFromStorage();
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
   * Fetch and register JSON material presets from the STANDARD_MATERIALS config array.
   * Call once after construction (async). Replaces the UI preset list.
   * @param {Array} standardMaterials - from config.js STANDARD_MATERIALS
   */
  async loadPresetsFromManifest(standardMaterials) {
    this.presets = {};
    this._jsonPresetNames = [];
    this._presetParams = {};
    for (const mat of standardMaterials) {
      if (!mat.path || !mat.label) continue;
      if (!mat.path.endsWith('.json')) continue; // skip MTL entries
      try {
        const res = await fetch(`./${mat.path}`);
        if (!res.ok) { console.warn(`MaterialManager: HTTP ${res.status} for ${mat.label}`); continue; }
        const json = await res.json();
        const params = json.params || {};
        const label = mat.label;
        this._presetParams[label] = params;
        this.presets[label] = () => this.createMaterial(label, params);
        this._jsonPresetNames.push(label);
      } catch (e) {
        console.warn(`MaterialManager: failed to load preset "${mat.label}"`, e);
      }
    }

    // Re-register user presets — their factories were wiped when this.presets
    // was reset above. Without this, getPreset() falls back to the first standard
    // preset and assigns its name to activeMesh.material, making delete impossible.
    for (const name of this._userPresetNames) {
      const params = this._userPresetParams[name];
      if (!params) continue;
      this._presetParams[name] = { ...params };
      this.presets[name] = () => this.createMaterial(name, params);
    }
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
   * Return the cached material instance for a preset, resetting it to preset defaults first.
   * Creates and caches the instance on first call.
   *
   * Reusing the same object is the key to avoiding WebGLProgram.getUniforms() stalls:
   * once the warmup renders the instance, Three.js caches all uniform locations on it,
   * and subsequent renders of that same object skip the expensive first-use path entirely.
   */
  getPreset(name) {
    if (this._instanceCache.has(name)) {
      const mat = this._instanceCache.get(name);
      this._resetToPreset(mat, name);
      return mat;
    }
    const mat = this._createFresh(name);
    this._instanceCache.set(name, mat);
    return mat;
  }

  /** Create a brand-new material instance (bypasses the cache). Public alias for thumbnail use. */
  createFreshPreset(name) { return this._createFresh(name); }

  _createFresh(name) {
    if (this.presets[name]) return this.presets[name]();
    if (this._legacyPresets[name]) return this._legacyPresets[name]();
    const first = this._jsonPresetNames[0];
    if (first) { console.warn(`Preset "${name}" not found, using "${first}"`); return this.presets[first](); }
    console.warn(`Preset "${name}" not found, using Wood`);
    return this._legacyPresets.Wood();
  }

  /**
   * Reset a cached material instance to its preset defaults, then re-apply preset params.
   * Legacy presets (Wood/Metal/Glass/Plastic) have no stored params so they are left
   * as-is — their procedural textures are created once and preserved in the instance.
   */
  _resetToPreset(material, name) {
    if (!(name in this._presetParams)) {
      // Legacy preset — no stored scalar params; return as-is
      material.needsUpdate = true;
      return;
    }

    // Reset every property to createMaterial() defaults
    material.color.set(0xffffff);
    material.metalness         = 0.0;
    material.roughness         = 0.5;
    material.clearcoat         = 0.0;
    material.clearcoatRoughness = 0.1;
    material.specularIntensity  = 1.0;
    material.specularColor.set(0xffffff);
    material.transmission      = 0.0;
    material.ior               = 1.5;
    material.thickness         = 0.0;
    material.sheen             = 0.0;
    material.sheenRoughness    = 1.0;
    material.sheenColor.set(0xffffff);
    material.emissive.set(0x000000);
    material.emissiveIntensity  = 0.0;
    material.attenuationDistance = Infinity;
    material.attenuationColor.set(0xffffff);
    material.envMapIntensity   = 1.0;
    material.opacity           = 1.0;
    material.transparent       = false;
    material.map               = null;

    // Re-apply preset-specific values on top
    const params = this._presetParams[name];
    this.applySavedProperties(material, params);
    // applySavedProperties handles string colors; also cover hex-number colors from JSON
    if (params.color !== undefined && typeof params.color === 'number') material.color.set(params.color);
    if (params.map !== undefined) material.map = params.map;

    material.needsUpdate = true;
  }

  /** Returns user presets first, then visible standard presets. */
  getPresetNames() {
    const standard = (this._jsonPresetNames.length > 0
      ? [...this._jsonPresetNames]
      : Object.keys(this._legacyPresets)
    ).filter(n => !this._hiddenStandardPresets.has(n));
    return [...this._userPresetNames, ...standard];
  }

  /** All standard preset names regardless of hidden state. */
  getAllStandardPresetNames() {
    return this._jsonPresetNames.length > 0
      ? [...this._jsonPresetNames]
      : Object.keys(this._legacyPresets);
  }

  /** Hide a standard preset from the list (soft-delete). */
  hideStandardPreset(name) {
    this._hiddenStandardPresets.add(name);
    this._saveHiddenToStorage();
  }

  /** Restore all hidden standard presets back to the list. */
  restoreAllStandardPresets() {
    this._hiddenStandardPresets.clear();
    this._saveHiddenToStorage();
  }

  _saveHiddenToStorage() {
    try {
      localStorage.setItem('rd_hidden_presets', JSON.stringify([...this._hiddenStandardPresets]));
    } catch (_) {}
  }

  _loadHiddenFromStorage() {
    try {
      const raw = localStorage.getItem('rd_hidden_presets');
      if (!raw) return;
      JSON.parse(raw).forEach(n => this._hiddenStandardPresets.add(n));
    } catch (_) {}
  }

  /** True when the named preset is a standard (read-only) preset. */
  isStandardPreset(name) {
    return this._jsonPresetNames.includes(name) || name in this._legacyPresets;
  }

  /** True when the named preset was created by the user. */
  isUserPreset(name) {
    return this._userPresetNames.includes(name);
  }

  /** Create a deep copy of a material and return it as a standalone instance (NOT cached). */
  forkMaterial(sourceMat, newName) {
    const copy = sourceMat.clone();
    copy.name = newName;
    copy.needsUpdate = true;
    return copy;
  }

  /** Generate a unique user preset name based on a base name. */
  generateUserPresetName(baseName) {
    let name = `${baseName} (custom)`;
    let i = 2;
    while (this._userPresetNames.includes(name) || this._jsonPresetNames.includes(name)) {
      name = `${baseName} (custom ${i++})`;
    }
    return name;
  }

  /** Register a user preset from the given property object (no Three.js material needed). */
  addUserPreset(name, params) {
    // Remove if already exists (re-add at top)
    this._userPresetNames = this._userPresetNames.filter(n => n !== name);
    this._userPresetNames.unshift(name);
    this._userPresetParams[name] = { ...params };
    this._presetParams[name] = { ...params };
    this.presets[name] = () => this.createMaterial(name, params);
    this._saveUserPresetsToStorage();
  }

  /**
   * Update a user preset's stored params in-place (no reordering, no cached instance reset).
   * Used to persist live slider edits so switching away and back keeps the edits.
   */
  updateUserPresetParams(name, params) {
    if (!this._userPresetNames.includes(name)) return;
    this._userPresetParams[name] = { ...params };
    this._presetParams[name] = { ...params };
    this.presets[name] = () => this.createMaterial(name, params);
    this._saveUserPresetsToStorage();
  }

  /** Rename a user preset. Returns false if not found or name taken. */
  renamePreset(oldName, newName) {
    if (!this.isUserPreset(oldName)) return false;
    if (this.getPresetNames().includes(newName)) return false;
    const params = this._userPresetParams[oldName];
    // Update all tracking structures
    const idx = this._userPresetNames.indexOf(oldName);
    this._userPresetNames[idx] = newName;
    delete this._userPresetParams[oldName];
    this._userPresetParams[newName] = params;
    delete this._presetParams[oldName];
    this._presetParams[newName] = params;
    delete this.presets[oldName];
    this.presets[newName] = () => this.createMaterial(newName, params);
    // Move cached instance if any
    if (this._instanceCache.has(oldName)) {
      const mat = this._instanceCache.get(oldName);
      mat.name = newName;
      this._instanceCache.delete(oldName);
      this._instanceCache.set(newName, mat);
    }
    this._saveUserPresetsToStorage();
    return true;
  }

  /** Delete a user preset. Returns false if it's a standard preset. */
  deleteUserPreset(name) {
    if (!this.isUserPreset(name)) return false;
    this._userPresetNames = this._userPresetNames.filter(n => n !== name);
    delete this._userPresetParams[name];
    delete this._presetParams[name];
    delete this.presets[name];
    if (this._instanceCache.has(name)) {
      this._instanceCache.get(name).dispose();
      this._instanceCache.delete(name);
    }
    this._saveUserPresetsToStorage();
    return true;
  }

  _saveUserPresetsToStorage() {
    try {
      localStorage.setItem('rd_user_presets', JSON.stringify({
        names:  this._userPresetNames,
        params: this._userPresetParams,
      }));
    } catch (_) { /* quota exceeded — ignore */ }
  }

  _loadUserPresetsFromStorage() {
    try {
      const raw = localStorage.getItem('rd_user_presets');
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data?.names || !data?.params) return;
      for (const name of data.names) {
        const params = data.params[name];
        if (!params) continue;
        this._userPresetNames.push(name);
        this._userPresetParams[name] = params;
        this._presetParams[name] = params;
        this.presets[name] = () => this.createMaterial(name, params);
      }
    } catch (_) { /* corrupt data — ignore */ }
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

  /** True if this material is owned by the preset instance cache (must not be disposed). */
  isOwned(material) {
    for (const mat of this._instanceCache.values()) {
      if (mat === material) return true;
    }
    return false;
  }

  dispose(material) {
    if (!material) return;
    // Never dispose cached preset instances — they are reused across material switches
    if (this.isOwned(material)) return;
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
