
// RENDERER.JS - Renderer Management

import * as THREE from 'three';

export class RendererManager {
  constructor(container) {
    this.container = container;
    this.canvas = document.createElement('canvas');
    container.appendChild(this.canvas);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true
    });

    this.resize();
    this.setupShadows();
    this.setupResizeListener();
  }

  /**
   * Resize renderer to match container
   */
  resize() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(window.devicePixelRatio);
  }

  /**
   * Setup shadow rendering
   */
  setupShadows() {
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }

  /**
   * Setup window resize listener
   */
  setupResizeListener() {
    window.addEventListener('resize', () => this.resize());
  }

  /**
   * Render scene
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   */
  render(scene, camera) {
    this.renderer.render(scene, camera);
  }

  /**
   * Get renderer instance
   * @returns {THREE.WebGLRenderer}
   */
  getRenderer() {
    return this.renderer;
  }

  /**
   * Get renderer DOM element
   * @returns {HTMLCanvasElement}
   */
  getDomElement() {
    return this.renderer.domElement;
  }

  /**
   * Set clear color
   * @param {number} color - Hex color
   * @param {number} alpha - Alpha value (0-1)
   */
  setClearColor(color, alpha = 1) {
    this.renderer.setClearColor(color, alpha);
  }

  /**
   * Take screenshot
   * @returns {string} Data URL of screenshot
   */
  getScreenshot() {
    return this.renderer.domElement.toDataURL('image/png');
  }

  /**
   * Download screenshot
   * @param {string} filename
   */
  downloadScreenshot(filename = 'renderdeck-screenshot.png') {
    const dataURL = this.getScreenshot();
    const link = document.createElement('a');
    link.download = filename;
    link.href = dataURL;
    link.click();
  }

  /**
   * Dispose renderer
   */
  dispose() {
    this.renderer.dispose();
    if (this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
  }
}
