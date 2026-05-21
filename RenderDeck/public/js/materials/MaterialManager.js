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
import { getActiveProjectIdSync } from '../storage/ProjectStorage.js';

export class MaterialManager {
  constructor() {
    // JSON-based presets loaded from asset files — shown in UI dropdown
    this.presets = {};
    this._jsonPresetNames = [];

    // Legacy procedural presets — not shown in UI but used as fallback
    // (custom models may reference old preset names like 'Wood')
    this._legacyPresets = this._initializeLegacyPresets();

    // Raw params for each JSON preset — used by _createFresh to build materials
    this._presetParams = {};

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

  /**
   * Return a fresh material instance for a preset.
   * Each caller gets its own copy — no shared cache, no contamination.
   * Warmup pre-compiles shader variants so fresh instances still skip
   * the WebGLProgram.getUniforms() stall on first render.
   */
  getPreset(name) {
    return this._createFresh(name);
  }

  /** Alias kept for call sites that explicitly want a fresh copy. */
  createFreshPreset(name) { return this._createFresh(name); }

  _createFresh(name) {
    if (this.presets[name]) return this.presets[name]();
    if (this._legacyPresets[name]) return this._legacyPresets[name]();
    const first = this._jsonPresetNames[0];
    if (first) { console.warn(`Preset "${name}" not found, using "${first}"`); return this.presets[first](); }
    console.warn(`Preset "${name}" not found, using Wood`);
    return this._legacyPresets.Wood();
  }

  /** Returns user presets first, then visible standard presets. */
  getPresetNames() {
    const standard = (this._jsonPresetNames.length > 0
      ? [...this._jsonPresetNames]
      : Object.keys(this._legacyPresets)
    ).filter(n => !this._hiddenStandardPresets.has(n));
    return [...this._userPresetNames, ...standard];
  }

  /** Returns { user: string[], standard: string[] } for grouped UI display. */
  getPresetNamesByCategory() {
    const standard = (this._jsonPresetNames.length > 0
      ? [...this._jsonPresetNames]
      : Object.keys(this._legacyPresets)
    ).filter(n => !this._hiddenStandardPresets.has(n));
    return { user: [...this._userPresetNames], standard };
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
    // Preserve existing ID if re-saving, otherwise generate a new one
    const existingId = this._userPresetParams[name]?._id;
    const id = params._id || existingId || crypto.randomUUID();
    // Remove if already exists (re-add at top)
    this._userPresetNames = this._userPresetNames.filter(n => n !== name);
    this._userPresetNames.unshift(name);
    const stored = { ...params, _id: id };
    this._userPresetParams[name] = stored;
    this._presetParams[name] = stored;
    this.presets[name] = () => this.createMaterial(name, params);
    this._saveUserPresetsToStorage();
  }

  /**
   * Update a user preset's stored params in-place (no reordering, no cached instance reset).
   * Used to persist live slider edits so switching away and back keeps the edits.
   * Preserves the existing _id and _channelMaps — only visual params are replaced.
   */
  updateUserPresetParams(name, params) {
    if (!this._userPresetNames.includes(name)) return;
    const existingId = this._userPresetParams[name]?._id;
    const existingChannelMaps = this._userPresetParams[name]?._channelMaps;
    const stored = { ...params, _id: existingId || crypto.randomUUID() };
    if (existingChannelMaps) stored._channelMaps = existingChannelMaps;
    this._userPresetParams[name] = stored;
    this._presetParams[name] = stored;
    this.presets[name] = () => this.createMaterial(name, params);
    this._saveUserPresetsToStorage();
  }

  /** Rename a user preset. Returns false if not found or name taken. */
  renamePreset(oldName, newName) {
    if (!this.isUserPreset(oldName)) return false;
    if (this.getPresetNames().includes(newName)) return false;
    const params = this._userPresetParams[oldName]; // _id is preserved inside params
    // Update all tracking structures
    const idx = this._userPresetNames.indexOf(oldName);
    this._userPresetNames[idx] = newName;
    delete this._userPresetParams[oldName];
    this._userPresetParams[newName] = params;
    delete this._presetParams[oldName];
    this._presetParams[newName] = params;
    delete this.presets[oldName];
    this.presets[newName] = () => this.createMaterial(newName, params);
    this._saveUserPresetsToStorage();
    return true;
  }

  /** Return the stable UUID for a user preset (null for standard presets). */
  getPresetId(name) {
    return this._userPresetParams[name]?._id ?? null;
  }

  /** Find a user preset name by its stable UUID. Returns null if not found. */
  getPresetNameById(id) {
    if (!id) return null;
    for (const [name, params] of Object.entries(this._userPresetParams)) {
      if (params._id === id) return name;
    }
    return null;
  }

  /** Return saved channel maps for a user preset (null if none). */
  getPresetChannelMaps(name) {
    return this._userPresetParams[name]?._channelMaps ?? null;
  }

  /** Attach channel maps to an existing user preset without changing its params or order. */
  setPresetChannelMaps(name, channelMaps) {
    if (!this._userPresetParams[name]) return;
    this._userPresetParams[name]._channelMaps = channelMaps || null;
    this._saveUserPresetsToStorage();
  }

  /** Delete a user preset. Returns false if it's a standard preset. */
  deleteUserPreset(name) {
    if (!this.isUserPreset(name)) return false;
    this._userPresetNames = this._userPresetNames.filter(n => n !== name);
    delete this._userPresetParams[name];
    delete this._presetParams[name];
    delete this.presets[name];
    this._saveUserPresetsToStorage();
    return true;
  }

  _presetsKey(projectId) {
    return projectId ? `rd_user_presets:${projectId}` : null;
  }

  _saveUserPresetsToStorage() {
    try {
      const projectId = getActiveProjectIdSync();
      const key = this._presetsKey(projectId);
      if (!key) return;
      // Strip _channelMaps — they contain large data URLs that overflow localStorage quota.
      // Channel maps are stored separately in IDB (see savePresetChannelMapsToIDB in main.js).
      const paramsForStorage = {};
      for (const [name, params] of Object.entries(this._userPresetParams)) {
        const { _channelMaps, ...rest } = params;
        paramsForStorage[name] = rest;
      }
      localStorage.setItem(key, JSON.stringify({
        names:  this._userPresetNames,
        params: paramsForStorage,
      }));
    } catch (_) { /* quota exceeded — ignore */ }
  }

  /** Returns {presetId: channelMaps} for all user presets that have channel maps. */
  getAllPresetChannelMaps() {
    const result = {};
    for (const params of Object.values(this._userPresetParams)) {
      if (params._id && params._channelMaps) {
        result[params._id] = params._channelMaps;
      }
    }
    return result;
  }

  /** Merges channel maps (keyed by preset ID) back into in-memory params after IDB load. */
  applyPresetChannelMaps(channelMapsById) {
    for (const params of Object.values(this._userPresetParams)) {
      if (params._id && channelMapsById[params._id]) {
        params._channelMaps = channelMapsById[params._id];
      }
    }
  }

  _loadUserPresetsFromStorage() {
    try {
      const projectId = getActiveProjectIdSync();
      const key = this._presetsKey(projectId);
      // Try project-scoped key first, fall back to legacy key for migration
      const raw = (key ? localStorage.getItem(key) : null)
               ?? localStorage.getItem('rd_user_presets');
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data?.names || !data?.params) return;
      let needsResave = !key || !localStorage.getItem(key); // legacy migration
      for (const name of data.names) {
        const params = data.params[name];
        if (!params) continue;
        // Assign stable ID to presets that predate the ID system
        if (!params._id) { params._id = crypto.randomUUID(); needsResave = true; }
        this._userPresetNames.push(name);
        this._userPresetParams[name] = params;
        this._presetParams[name] = params;
        this.presets[name] = () => this.createMaterial(name, params);
      }
      if (needsResave) this._saveUserPresetsToStorage();
    } catch (_) { /* corrupt data — ignore */ }
  }

  // Called from main.js after ensureActiveProject() resolves.
  // Reloads user presets for the now-known active project.
  reloadUserPresetsForProject(projectId) {
    // Clear in-memory state
    for (const name of this._userPresetNames) {
      delete this._presetParams[name];
      delete this.presets[name];
    }
    this._userPresetNames = [];
    this._userPresetParams = {};

    try {
      const key = this._presetsKey(projectId);
      const raw = (key ? localStorage.getItem(key) : null)
               ?? localStorage.getItem('rd_user_presets');
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data?.names || !data?.params) return;
      let needsResave = false;
      for (const name of data.names) {
        const params = data.params[name];
        if (!params) continue;
        if (!params._id) { params._id = crypto.randomUUID(); needsResave = true; }
        this._userPresetNames.push(name);
        this._userPresetParams[name] = params;
        this._presetParams[name] = params;
        this.presets[name] = () => this.createMaterial(name, params);
      }
      // Migrate from legacy key or assign missing IDs
      if ((key && !localStorage.getItem(key)) || needsResave) {
        this._saveUserPresetsToStorage();
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
    if (properties.reflectivity !== undefined) material.reflectivity = properties.reflectivity;
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
