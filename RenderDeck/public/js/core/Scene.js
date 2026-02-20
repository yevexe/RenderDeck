
// SCENE.JS - Scene Management

import * as THREE from 'three';
import { CONFIG } from '../config.js';

export class SceneManager {
  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(CONFIG.SCENE.BACKGROUND_COLOR);
    this.setupLighting();
  }

  /**
   * Setup scene lighting (ambient + directional with shadows)
   */
  setupLighting() {
    // Ambient light - illuminates everything equally
    const ambient = new THREE.AmbientLight(
      0xffffff, 
      CONFIG.LIGHTING.AMBIENT_INTENSITY
    );
    this.scene.add(ambient);

    // Directional light - simulates sunlight with shadows
    const directional = new THREE.DirectionalLight(
      0xffffff, 
      CONFIG.LIGHTING.DIRECTIONAL_INTENSITY
    );
    
    directional.position.set(
      CONFIG.LIGHTING.DIRECTIONAL_POSITION.x,
      CONFIG.LIGHTING.DIRECTIONAL_POSITION.y,
      CONFIG.LIGHTING.DIRECTIONAL_POSITION.z
    );
    
    directional.castShadow = true;
    
    // Configure shadow camera
    const shadowSize = CONFIG.LIGHTING.SHADOW_CAMERA_SIZE;
    directional.shadow.camera.left = -shadowSize;
    directional.shadow.camera.right = shadowSize;
    directional.shadow.camera.top = shadowSize;
    directional.shadow.camera.bottom = -shadowSize;
    directional.shadow.mapSize.width = CONFIG.LIGHTING.SHADOW_MAP_SIZE;
    directional.shadow.mapSize.height = CONFIG.LIGHTING.SHADOW_MAP_SIZE;
    
    this.scene.add(directional);

    // Store references
    this.ambientLight = ambient;
    this.directionalLight = directional;
  }

  /**
   * Set environment map (HDR)
   * @param {THREE.Texture} texture - Environment texture
   */
  setEnvironment(texture) {
    this.scene.environment = texture;
  }

  /**
   * Set background color
   * @param {number|string} color - Color (hex or THREE.Color)
   */
  setBackground(color) {
    if (typeof color === 'string' || typeof color === 'number') {
      this.scene.background = new THREE.Color(color);
    } else {
      this.scene.background = color;
    }
  }

  /**
   * Add object to scene
   * @param {THREE.Object3D} object
   */
  add(object) {
    this.scene.add(object);
  }

  /**
   * Remove object from scene
   * @param {THREE.Object3D} object
   */
  remove(object) {
    this.scene.remove(object);
  }

  /**
   * Get the Three.js scene
   * @returns {THREE.Scene}
   */
  getScene() {
    return this.scene;
  }

  /**
   * Update lighting intensity
   * @param {number} ambientIntensity
   * @param {number} directionalIntensity
   */
  updateLighting(ambientIntensity, directionalIntensity) {
    if (this.ambientLight) {
      this.ambientLight.intensity = ambientIntensity;
    }
    if (this.directionalLight) {
      this.directionalLight.intensity = directionalIntensity;
    }
  }

  /**
   * Clear all objects from scene (except lights and camera)
   */
  clear() {
    const objectsToRemove = [];
    this.scene.traverse((object) => {
      if (object !== this.scene && 
          !object.isLight && 
          !object.isCamera) {
        objectsToRemove.push(object);
      }
    });
    objectsToRemove.forEach(obj => this.scene.remove(obj));
  }
}
