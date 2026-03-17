// RENDERER.JS - Renderer Management with EffectComposer post-processing

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { AfterimagePass } from 'three/addons/postprocessing/AfterimagePass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { TAARenderPass } from 'three/addons/postprocessing/TAARenderPass.js';
import { SSAARenderPass } from 'three/addons/postprocessing/SSAARenderPass.js';
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

    this._customResolution = null;

    // Post-processing passes
    this.composer       = null;
    this.renderPass     = null;
    this.taaPass        = null;
    this.ssaaPass       = null;
    this.bloomPass      = null;
    this.ssaoPass       = null;
    this.afterimagePass = null;
    this.vignettePass   = null;
    this.fxaaPass       = null;
    this.smaaPass       = null;
    this.outputPass     = null;

    // Effect state
    this.postFXEnabled      = false;
    this.bloomEnabled       = false;
    this.vignetteEnabled    = false;
    this.ssaoEnabled        = false;
    this.motionBlurEnabled  = false;
    this.aaMode             = 'smaa'; // default AA when post-FX is on

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  // ─── Resize renderer + composer ──────────────────────────────
  resize() {
    // If a custom resolution is set, keep the drawing buffer at that size
    // but fit the canvas CSS to the container.
    if (this._customResolution) {
      const { w, h } = this._customResolution;
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(w, h, false);
      this.resizeComposer(w, h);
    } else {
      const w = this.container.clientWidth  || 1;
      const h = this.container.clientHeight || 1;
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.renderer.setSize(w, h, false); // false = don't overwrite CSS (handled by stylesheet)
      this.resizeComposer(w, h);
    }
  }

  // ─── Resize composer + post-processing passes ────────────────
  resizeComposer(w, h) {
    if (this.composer) this.composer.setSize(w, h);
    const pr = this.renderer.getPixelRatio();
    if (this.fxaaPass)  this.fxaaPass.material.uniforms['resolution'].value.set(1 / (w * pr), 1 / (h * pr));
    if (this.smaaPass)  this.smaaPass.setSize(w * pr, h * pr);
    if (this.taaPass)   this.taaPass.setSize(w, h);
    if (this.ssaaPass)  this.ssaaPass.setSize(w, h);
    if (this.ssaoPass)  this.ssaoPass.setSize(w, h);
  }

  // ─── Set a custom render resolution ──────────────────────────
  setCustomResolution(w, h) {
    this._customResolution = { w, h };
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    this.resizeComposer(w, h);
  }

  // ─── Clear custom resolution (revert to container-fit) ───────
  clearCustomResolution() {
    this._customResolution = null;
    this.resize();
  }

  // ─── Build EffectComposer (called once on first render) ──────
  buildComposer(scene, camera) {
    const w  = this.container.clientWidth  || 1;
    const h  = this.container.clientHeight || 1;
    const pr = this.renderer.getPixelRatio();

    this.composer = new EffectComposer(this.renderer);

    // 1. TAA — replaces RenderPass when aaMode === 'taa'
    this.taaPass = new TAARenderPass(scene, camera);
    this.taaPass.sampleLevel = 2;    // 4 jittered samples
    this.taaPass.accumulate  = true;
    this.taaPass.enabled     = false;
    this.composer.addPass(this.taaPass);

    // 2. SSAA — replaces RenderPass when aaMode === 'ssaa'
    this.ssaaPass = new SSAARenderPass(scene, camera);
    this.ssaaPass.sampleLevel = 2; // 4 supersamples per frame
    this.ssaaPass.enabled     = false;
    this.composer.addPass(this.ssaaPass);

    // 3. Standard scene render (used for off / fxaa / smaa)
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    // 4. SSAO
    this.ssaoPass = new SSAOPass(scene, camera, w, h);
    this.ssaoPass.kernelRadius = 16;
    this.ssaoPass.minDistance  = 0.005;
    this.ssaoPass.maxDistance  = 0.1;
    this.ssaoPass.enabled = false;
    this.composer.addPass(this.ssaoPass);

    // 5. Bloom
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.35, 0.20, 0.85);
    this.bloomPass.enabled = false;
    this.composer.addPass(this.bloomPass);

    // 6. Motion blur (afterimage)
    this.afterimagePass = new AfterimagePass(0.88);
    this.afterimagePass.enabled = false;
    this.composer.addPass(this.afterimagePass);

    // 7. Vignette
    this.vignettePass = new ShaderPass(VignetteShader);
    this.vignettePass.uniforms['offset'].value   = 0.75;
    this.vignettePass.uniforms['darkness'].value = 1.25;
    this.vignettePass.enabled = false;
    this.composer.addPass(this.vignettePass);

    // 8. FXAA
    this.fxaaPass = new ShaderPass(FXAAShader);
    this.fxaaPass.material.uniforms['resolution'].value.set(1 / (w * pr), 1 / (h * pr));
    this.fxaaPass.enabled = false;
    this.composer.addPass(this.fxaaPass);

    // 9. SMAA (better than FXAA — default post-AA choice)
    this.smaaPass = new SMAAPass(w * pr, h * pr);
    this.smaaPass.enabled = false;
    this.composer.addPass(this.smaaPass);

    // 10. OutputPass — final tone mapping + sRGB encoding
    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);

    // Apply initial AA state
    this._syncPasses();
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

  setAA(mode) {
    this.aaMode = mode;
    this._syncPasses();
  }

  /** @deprecated use setAA('fxaa') */
  setFXAA(enabled) { this.setAA(enabled ? 'fxaa' : 'off'); }

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
    const on    = this.postFXEnabled;
    const aa    = this.aaMode;

    // Exactly one scene-render pass active: TAA/SSAA replace RenderPass
    const useTAA  = on && aa === 'taa';
    const useSSAA = on && aa === 'ssaa';
    if (this.taaPass)        this.taaPass.enabled        = useTAA;
    if (this.ssaaPass)       this.ssaaPass.enabled       = useSSAA;
    if (this.renderPass)     this.renderPass.enabled     = !(useTAA || useSSAA);

    // Effect passes — only when post-FX is on
    if (this.bloomPass)       this.bloomPass.enabled       = on && this.bloomEnabled;
    if (this.ssaoPass)        this.ssaoPass.enabled        = on && this.ssaoEnabled;
    if (this.afterimagePass)  this.afterimagePass.enabled  = on && this.motionBlurEnabled;
    if (this.vignettePass)    this.vignettePass.enabled    = on && this.vignetteEnabled;

    // Post-AA passes — only when post-FX is on
    if (this.fxaaPass)  this.fxaaPass.enabled  = on && aa === 'fxaa';
    if (this.smaaPass)  this.smaaPass.enabled  = on && aa === 'smaa';
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