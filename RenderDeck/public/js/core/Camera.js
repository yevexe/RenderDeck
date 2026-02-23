
// CAMERA.JS - Camera & Controls Management

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CONFIG } from '../config.js';

export class CameraManager {
  constructor(container) {
    this.container = container;
    
    const aspect = container.clientWidth / container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(
      CONFIG.SCENE.CAMERA_FOV,
      aspect,
      CONFIG.SCENE.CAMERA_NEAR,
      CONFIG.SCENE.CAMERA_FAR
    );

    this.camera.position.set(
      CONFIG.SCENE.CAMERA_POSITION.x,
      CONFIG.SCENE.CAMERA_POSITION.y,
      CONFIG.SCENE.CAMERA_POSITION.z
    );

    this.setupResizeListener();
  }

  /**
   * Setup OrbitControls
   * @param {HTMLElement} domElement - Renderer DOM element
   */
  setupControls(domElement) {
    this.controls = new OrbitControls(this.camera, domElement);
    this.controls.enableDamping = CONFIG.CONTROLS.DAMPING_ENABLED;
    this.controls.dampingFactor = CONFIG.CONTROLS.DAMPING_FACTOR;
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  /**
   * Setup window resize listener
   */
  setupResizeListener() {
    window.addEventListener('resize', () => {
      const aspect = this.container.clientWidth / this.container.clientHeight;
      this.camera.aspect = aspect;
      this.camera.updateProjectionMatrix();
    });
  }

  /**
   * Update controls (call in animation loop)
   */
  update() {
    if (this.controls) {
      this.controls.update();
    }
  }

  /**
   * Get camera instance
   * @returns {THREE.PerspectiveCamera}
   */
  getCamera() {
    return this.camera;
  }

  /**
   * Get controls instance
   * @returns {OrbitControls}
   */
  getControls() {
    return this.controls;
  }

  /**
   * Frame object in view (center and adjust distance)
   * @param {THREE.Object3D} object
   */
  frameObject(object) {
    if (!object || !this.controls) return;

    const box = new THREE.Box3().setFromObject(object);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    
    // Calculate camera distance to fit object
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = this.camera.fov * (Math.PI / 180);
    let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
    cameraZ *= 2; // Add some padding
    
    // Position camera
    this.camera.position.set(center.x, center.y, center.z + cameraZ);
    this.controls.target.copy(center);
    this.controls.update();
  }

  /**
   * Set camera position
   * @param {number} x
   * @param {number} y
   * @param {number} z
   */
  setPosition(x, y, z) {
    this.camera.position.set(x, y, z);
  }

  /**
   * Set controls target
   * @param {number} x
   * @param {number} y
   * @param {number} z
   */
  setTarget(x, y, z) {
    if (this.controls) {
      this.controls.target.set(x, y, z);
      this.controls.update();
    }
  }

  /**
   * Reset camera to default position
   */
  reset() {
    this.camera.position.set(
      CONFIG.SCENE.CAMERA_POSITION.x,
      CONFIG.SCENE.CAMERA_POSITION.y,
      CONFIG.SCENE.CAMERA_POSITION.z
    );
    if (this.controls) {
      this.controls.target.set(0, 0, 0);
      this.controls.update();
    }
  }

  /**
   * Enable/disable controls
   * @param {boolean} enabled
   */
  setControlsEnabled(enabled) {
    if (this.controls) {
      this.controls.enabled = enabled;
    }
  }
}