// RENDERER.JS - Renderer Management with EffectComposer post-processing

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { AfterimagePass } from 'three/addons/postprocessing/AfterimagePass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { VignetteShader } from 'three/addons/shaders/VignetteShader.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export class RendererManager {
  constructor(container) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
    });

    container.appendChild(this.renderer.domElement);

    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    // Post-processing passes
    this.composer       = null;
    this.renderPass     = null;
    this.bloomPass      = null;
    this.ssaoPass       = null;
    this.afterimagePass = null;
    this.vignettePass   = null;
    this.fxaaPass       = null;
    this.outputPass     = null;

    // Effect state
    this.postFXEnabled      = false;
    this.bloomEnabled       = false;
    this.vignetteEnabled    = false;
    this.ssaoEnabled        = false;
    this.motionBlurEnabled  = false;

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  // ─── Resize renderer + composer ──────────────────────────────
  resize() {
    const w = this.container.clientWidth  || 1;
    const h = this.container.clientHeight || 1;

    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    if (this.composer) this.composer.setSize(w, h);

    if (this.fxaaPass) {
      const pr = this.renderer.getPixelRatio();
      this.fxaaPass.material.uniforms['resolution'].value.set(1 / (w * pr), 1 / (h * pr));
    }

    if (this.ssaoPass) this.ssaoPass.setSize(w, h);
  }

  // ─── Build EffectComposer (called once on first render) ──────
  buildComposer(scene, camera) {
    const w = this.container.clientWidth  || 1;
    const h = this.container.clientHeight || 1;

    this.composer = new EffectComposer(this.renderer);

    // 1. Standard scene render
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    // 2. SSAO
    this.ssaoPass = new SSAOPass(scene, camera, w, h);
    this.ssaoPass.kernelRadius = 16;
    this.ssaoPass.minDistance  = 0.005;
    this.ssaoPass.maxDistance  = 0.1;
    this.ssaoPass.enabled = false;
    this.composer.addPass(this.ssaoPass);

    // 3. Bloom
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.35, 0.20, 0.85);
    this.bloomPass.enabled = false;
    this.composer.addPass(this.bloomPass);

    // 4. Motion blur (afterimage)
    this.afterimagePass = new AfterimagePass(0.88);
    this.afterimagePass.enabled = false;
    this.composer.addPass(this.afterimagePass);

    // 5. Vignette
    this.vignettePass = new ShaderPass(VignetteShader);
    this.vignettePass.uniforms['offset'].value   = 0.75;
    this.vignettePass.uniforms['darkness'].value = 1.25;
    this.vignettePass.enabled = false;
    this.composer.addPass(this.vignettePass);

    // 6. FXAA (anti-aliasing post pass)
    this.fxaaPass = new ShaderPass(FXAAShader);
    const pr = this.renderer.getPixelRatio();
    this.fxaaPass.material.uniforms['resolution'].value.set(1 / (w * pr), 1 / (h * pr));
    this.fxaaPass.enabled = false;
    this.composer.addPass(this.fxaaPass);

    // 7. OutputPass — handles final tone mapping + sRGB encoding to screen
    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);
  }

  // ─── Global post-FX on/off ────────────────────────────────────
  setPostFXEnabled(enabled) {
    this.postFXEnabled = enabled;
    this._syncPasses();
  }

  // ─── Individual effect toggles ────────────────────────────────
  setBloom(enabled)       { this.bloomEnabled      = enabled; this._syncPasses(); }
  setVignette(enabled)    { this.vignetteEnabled   = enabled; this._syncPasses(); }
  setSSAO(enabled)        { this.ssaoEnabled       = enabled; this._syncPasses(); }
  setMotionBlur(enabled)  { this.motionBlurEnabled = enabled; this._syncPasses(); }

  setFXAA(enabled) {
    if (this.fxaaPass) this.fxaaPass.enabled = enabled;
  }

  // ─── Bloom params ─────────────────────────────────────────────
  setBloomStrength(v)  { if (this.bloomPass) this.bloomPass.strength  = v; }
  setBloomRadius(v)    { if (this.bloomPass) this.bloomPass.radius    = v; }
  setBloomThreshold(v) { if (this.bloomPass) this.bloomPass.threshold = v; }

  // ─── Vignette params ──────────────────────────────────────────
  setVignetteIntensity(v) {
    // darkness: 1.0 = none, 2.5 = strong
    if (this.vignettePass) this.vignettePass.uniforms['darkness'].value = 1.0 + v * 2.0;
  }

  setVignetteSoftness(v) {
    // offset: 1.0 = soft edge, 0.2 = sharp vignette ring
    if (this.vignettePass) this.vignettePass.uniforms['offset'].value = 1.0 - v * 0.8;
  }

  // ─── SSAO params ─────────────────────────────────────────────
  setSSAOIntensity(v) {
    if (this.ssaoPass) this.ssaoPass.kernelRadius = Math.max(1, v * 24);
  }

  setSSAORadius(v) {
    if (this.ssaoPass) this.ssaoPass.maxDistance = Math.max(0.005, v * 0.03);
  }

  // ─── Motion blur param ────────────────────────────────────────
  setMotionBlurStrength(v) {
    // afterimage damp: 0 = no trail, 1 = permanent ghost
    if (this.afterimagePass) this.afterimagePass.uniforms['damp'].value = 0.5 + v * 0.45;
  }

  // ─── Preset loader ───────────────────────────────────────────
  applyPreset(name) {
    switch (name) {
      case 'off':
        this.postFXEnabled = false;
        this.bloomEnabled = this.vignetteEnabled = this.ssaoEnabled = this.motionBlurEnabled = false;
        break;

      case 'basic':
        this.postFXEnabled = true;
        this.bloomEnabled = true; this.vignetteEnabled = false;
        this.ssaoEnabled = false; this.motionBlurEnabled = false;
        if (this.bloomPass) { this.bloomPass.strength = 0.20; this.bloomPass.radius = 0.10; this.bloomPass.threshold = 0.90; }
        break;

      case 'pretty':
        this.postFXEnabled = true;
        this.bloomEnabled = true; this.ssaoEnabled = true;
        this.vignetteEnabled = false; this.motionBlurEnabled = false;
        if (this.bloomPass) { this.bloomPass.strength = 0.35; this.bloomPass.radius = 0.20; this.bloomPass.threshold = 0.85; }
        break;

      case 'cinema':
        this.postFXEnabled = true;
        this.bloomEnabled = true; this.vignetteEnabled = true;
        this.ssaoEnabled = false; this.motionBlurEnabled = false;
        if (this.bloomPass) { this.bloomPass.strength = 0.50; this.bloomPass.radius = 0.30; this.bloomPass.threshold = 0.80; }
        if (this.vignettePass) { this.vignettePass.uniforms['darkness'].value = 1.5; this.vignettePass.uniforms['offset'].value = 0.65; }
        break;
    }

    this._syncPasses();
    this._syncCheckboxes();
  }

  // Internal: sync every pass's .enabled to current state flags
  _syncPasses() {
    const on = this.postFXEnabled;
    if (this.bloomPass)       this.bloomPass.enabled       = on && this.bloomEnabled;
    if (this.ssaoPass)        this.ssaoPass.enabled        = on && this.ssaoEnabled;
    if (this.afterimagePass)  this.afterimagePass.enabled  = on && this.motionBlurEnabled;
    if (this.vignettePass)    this.vignettePass.enabled    = on && this.vignetteEnabled;
  }

  // Internal: push state back into the Setting 6 checkboxes
  _syncCheckboxes() {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.checked = val; };
    set('post-toggle-bloom',      this.bloomEnabled);
    set('post-toggle-vignette',   this.vignetteEnabled);
    set('post-toggle-ao',         this.ssaoEnabled);
    set('post-toggle-motionblur', this.motionBlurEnabled);
  }

  // ─── Render (called every frame from animate loop) ────────────
  render(scene, camera) {
    if (!this.composer) this.buildComposer(scene, camera);

    if (this.postFXEnabled) {
      this.composer.render();
    } else {
      this.renderer.render(scene, camera);
    }
  }

  // ─── Accessors ────────────────────────────────────────────────
  getRenderer()   { return this.renderer; }
  getDomElement() { return this.renderer.domElement; }

  setClearColor(color, alpha = 1) { this.renderer.setClearColor(color, alpha); }

  getScreenshot() { return this.renderer.domElement.toDataURL('image/png'); }

  downloadScreenshot(filename = 'renderdeck-screenshot.png') {
    const a = document.createElement('a');
    a.download = filename;
    a.href = this.getScreenshot();
    a.click();
  }

  dispose() {
    if (this.composer) this.composer.dispose();
    this.renderer.dispose();
    const el = this.renderer.domElement;
    if (el.parentNode) el.parentNode.removeChild(el);
  }
}