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
import { CustomVignetteShader } from '../shaders/CustomVignetteShader.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { HQBokehFragmentShader } from '../shaders/DepthOfFieldShader.js';

export class RendererManager {
  constructor(container) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true, // required for toDataURL() thumbnail capture
    });

    container.appendChild(this.renderer.domElement);

    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this._customResolution = null;
    this._inOrbitPerf = false;

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
    this.bokehPass      = null;
    this.outputPass     = null;

    // Effect state flags
    this.postFXEnabled      = false;
    this.bloomEnabled       = false;
    this.vignetteEnabled    = false;
    this.ssaoEnabled        = false;
    this.motionBlurEnabled  = false;
    this.dofEnabled         = false;
    this.aaMode             = 'smaa';

    // Raw slider param values — used to initialise passes when they are first built
    // and persisted to session state so the user's settings survive a reload.
    this._params = {
      bloom:      { strength: 0.35, radius: 0.20, threshold: 0.85 },
      vignette:   { intensity: 0.125, softness: 0.3125, color: '#000000', blendMode: 0 },
      ssao:       { intensity: 0.667, radius: 1.0 },
      motionBlur: { strength: 0.844 },
    };

    // Stored scene/camera refs so we can rebuild the composer lazily
    // when the user enables a pass that hasn't been added yet.
    this._scene  = null;
    this._camera = null;

    // Which optional passes have been added to the composer
    this._builtPasses = new Set();

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  // ─── Resize renderer + composer ──────────────────────────────
  resize() {
    if (this._customResolution) {
      const { w, h } = this._customResolution;
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(w, h, false);
      this.resizeComposer(w, h);
    } else {
      const w = this.container.clientWidth  || 1;
      const h = this.container.clientHeight || 1;
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.renderer.setSize(w, h, false);
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

  // ─── Half-res mode during orbit drag ─────────────────────────
  enterOrbitPerfMode() {
    if (this._inOrbitPerf || this._customResolution) return;
    this._inOrbitPerf = true;
    const w = this.container.clientWidth  || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setPixelRatio(0.5);
    this.renderer.setSize(w, h, false);
    this.resizeComposer(w * 0.5, h * 0.5);
  }

  exitOrbitPerfMode() {
    if (!this._inOrbitPerf) return;
    this._inOrbitPerf = false;
    this.resize();
  }

  // ─── Build (or rebuild) the EffectComposer ───────────────────
  // Only adds the passes that are currently enabled, so shader
  // compilation is deferred until each effect is actually needed.
  buildComposer(scene, camera) {
    const w  = this.container.clientWidth  || 1;
    const h  = this.container.clientHeight || 1;
    const pr = this.renderer.getPixelRatio();

    this._scene  = scene;
    this._camera = camera;

    // Dispose existing composer when rebuilding
    if (this.composer) {
      this.composer.dispose();
      this.composer = null;
      this._builtPasses.clear();
      this.taaPass = this.ssaaPass = this.renderPass = null;
      this.ssaoPass = this.bloomPass = this.afterimagePass = null;
      this.vignettePass = this.bokehPass = this.fxaaPass = this.smaaPass = this.outputPass = null;
    }

    this.composer = new EffectComposer(this.renderer);
    const on = this.postFXEnabled;
    const aa = this.aaMode;

    // ── Scene render passes (always added, only one active at a time) ─
    this.taaPass = new TAARenderPass(scene, camera);
    this.taaPass.sampleLevel = 2;
    this.taaPass.accumulate  = true;
    this.taaPass.enabled     = on && aa === 'taa';
    this.composer.addPass(this.taaPass);
    this._builtPasses.add('taa');

    this.ssaaPass = new SSAARenderPass(scene, camera);
    this.ssaaPass.sampleLevel = 2;
    this.ssaaPass.enabled     = on && aa === 'ssaa';
    this.composer.addPass(this.ssaaPass);
    this._builtPasses.add('ssaa');

    this.renderPass = new RenderPass(scene, camera);
    this.renderPass.enabled = !(on && (aa === 'taa' || aa === 'ssaa'));
    this.composer.addPass(this.renderPass);

    // ── Optional passes — only added when currently enabled ──────────
    // This avoids compiling shaders for effects the user hasn't turned on.
    // If the user enables a new effect later, _ensureOptionalPasses rebuilds.

    if (on && this.ssaoEnabled) {
      this.ssaoPass = new SSAOPass(scene, camera, w, h);
      this.ssaoPass.kernelRadius = Math.max(1, this._params.ssao.intensity * 24);
      this.ssaoPass.minDistance  = 0.005;
      this.ssaoPass.maxDistance  = Math.max(0.005, this._params.ssao.radius * 0.03);
      this.ssaoPass.enabled = true;
      this.composer.addPass(this.ssaoPass);
      this._builtPasses.add('ssao');
    }

    if (on && this.bloomEnabled) {
      this.bloomPass = new UnrealBloomPass(
        new THREE.Vector2(w, h),
        this._params.bloom.strength,
        this._params.bloom.radius,
        this._params.bloom.threshold
      );
      this.bloomPass.enabled = true;
      this.composer.addPass(this.bloomPass);
      this._builtPasses.add('bloom');
    }

    if (on && this.motionBlurEnabled) {
      this.afterimagePass = new AfterimagePass(0.5 + this._params.motionBlur.strength * 0.45);
      this.afterimagePass.enabled = true;
      this.composer.addPass(this.afterimagePass);
      this._builtPasses.add('motionBlur');
    }

    if (on && this.vignetteEnabled) {
      this.vignettePass = new ShaderPass(CustomVignetteShader);
      this.vignettePass.uniforms['offset'].value        = 1.0 - this._params.vignette.softness * 0.8;
      this.vignettePass.uniforms['darkness'].value      = 1.0 + this._params.vignette.intensity * 2.0;
      this.vignettePass.uniforms['vignetteColor'].value = new THREE.Color(this._params.vignette.color);
      this.vignettePass.uniforms['blendMode'].value     = this._params.vignette.blendMode;
      this.vignettePass.enabled = true;
      this.composer.addPass(this.vignettePass);
      this._builtPasses.add('vignette');
    }

    if (on && this.dofEnabled) {
      this.bokehPass = new BokehPass(scene, camera, {
        focus:    5.0,
        aperture: 0.01,
        maxblur:  0.01,
      });
      this.bokehPass.materialBokeh.fragmentShader = HQBokehFragmentShader;
      this.bokehPass.materialBokeh.uniforms.uRings = { value: 6 };
      this.bokehPass.materialBokeh.needsUpdate = true;
      this.bokehPass.enabled = true;
      this.composer.addPass(this.bokehPass);
      this._builtPasses.add('dof');
    }

    if (on && aa === 'fxaa') {
      this.fxaaPass = new ShaderPass(FXAAShader);
      this.fxaaPass.material.uniforms['resolution'].value.set(1 / (w * pr), 1 / (h * pr));
      this.fxaaPass.enabled = true;
      this.composer.addPass(this.fxaaPass);
      this._builtPasses.add('fxaa');
    }

    if (on && aa === 'smaa') {
      this.smaaPass = new SMAAPass(w * pr, h * pr);
      this.smaaPass.enabled = true;
      this.composer.addPass(this.smaaPass);
      this._builtPasses.add('smaa');
    }

    // OutputPass — always last
    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);
  }

  // ─── Pre-build composer + pre-compile scene shaders ──────────
  // Call this after restoreState() so the right passes are built up-front.
  // Returns a Promise — uses KHR_parallel_shader_compile in r163+ (Chrome/Edge)
  // so compilation runs off the main thread and doesn't freeze the first frame.
  async initComposer(scene, camera) {
    if (!this.composer) this.buildComposer(scene, camera);
    await this.renderer.compileAsync(scene, camera);
  }

  // ─── Serialise / restore renderer state ──────────────────────

  getState() {
    return {
      postFXEnabled:     this.postFXEnabled,
      bloomEnabled:      this.bloomEnabled,
      vignetteEnabled:   this.vignetteEnabled,
      ssaoEnabled:       this.ssaoEnabled,
      motionBlurEnabled: this.motionBlurEnabled,
      aaMode:            this.aaMode,
      params: {
        bloom:      { ...this._params.bloom },
        vignette:   { ...this._params.vignette },
        ssao:       { ...this._params.ssao },
        motionBlur: { ...this._params.motionBlur },
      },
    };
  }

  // Applies saved state to internal flags + _params without touching the DOM
  // or building the composer. Call syncUI() afterwards to push values to DOM.
  restoreState(state) {
    if (!state) return;
    if (typeof state.postFXEnabled    === 'boolean') this.postFXEnabled    = state.postFXEnabled;
    if (typeof state.bloomEnabled     === 'boolean') this.bloomEnabled     = state.bloomEnabled;
    if (typeof state.vignetteEnabled  === 'boolean') this.vignetteEnabled  = state.vignetteEnabled;
    if (typeof state.ssaoEnabled      === 'boolean') this.ssaoEnabled      = state.ssaoEnabled;
    if (typeof state.motionBlurEnabled=== 'boolean') this.motionBlurEnabled= state.motionBlurEnabled;
    if (typeof state.aaMode           === 'string')  this.aaMode           = state.aaMode;
    if (state.params) {
      if (state.params.bloom)      Object.assign(this._params.bloom,      state.params.bloom);
      if (state.params.vignette)   Object.assign(this._params.vignette,   state.params.vignette);
      if (state.params.ssao)       Object.assign(this._params.ssao,       state.params.ssao);
      if (state.params.motionBlur) Object.assign(this._params.motionBlur, state.params.motionBlur);
    }
  }

  // Push all internal state to the DOM (checkboxes, sliders, inputs, color pickers).
  // Call this after restoreState() once the UI has been set up.
  syncUI() {
    const set    = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    const setCSS = (id, prop, val) => { const el = document.getElementById(id); if (el) el.style[prop] = val; };

    // Global post-FX toggle
    set('preview-toggle-postfx', this.postFXEnabled);

    // Individual effect checkboxes
    set('post-toggle-bloom',      this.bloomEnabled);
    set('post-toggle-vignette',   this.vignetteEnabled);
    set('post-toggle-ao',         this.ssaoEnabled);
    set('post-toggle-motionblur', this.motionBlurEnabled);

    // AA mode — activate the matching button in the row
    const aaGroup = document.getElementById('aa-mode-buttons');
    if (aaGroup) {
      aaGroup.querySelectorAll('button').forEach(b => b.classList.remove('button-selected'));
      const activeBtn = aaGroup.querySelector(`button[data-value="${this.aaMode}"]`);
      if (activeBtn) activeBtn.classList.add('button-selected');
    }

    // Bloom sliders
    setVal('bloom-strength-slider',  this._params.bloom.strength);
    setVal('bloom-strength-input',   this._params.bloom.strength);
    setVal('bloom-radius-slider',    this._params.bloom.radius);
    setVal('bloom-radius-input',     this._params.bloom.radius);
    setVal('bloom-threshold-slider', this._params.bloom.threshold);
    setVal('bloom-threshold-input',  this._params.bloom.threshold);

    // Vignette sliders + color
    setVal('vignette-intensity-slider', this._params.vignette.intensity);
    setVal('vignette-intensity-input',  this._params.vignette.intensity);
    setVal('vignette-softness-slider',  this._params.vignette.softness);
    setVal('vignette-softness-input',   this._params.vignette.softness);
    setVal('vignette-color-picker',     this._params.vignette.color);
    setVal('vignette-color-hex',        this._params.vignette.color);
    setCSS('vignette-color-swatch', 'backgroundColor', this._params.vignette.color);
    setVal('vignette-blend-mode',       this._params.vignette.blendMode);

    // AO sliders
    setVal('ao-intensity-slider', this._params.ssao.intensity);
    setVal('ao-intensity-input',  this._params.ssao.intensity);
    setVal('ao-radius-slider',    this._params.ssao.radius);
    setVal('ao-radius-input',     this._params.ssao.radius);

    // Motion blur slider
    setVal('motionblur-strength-slider', this._params.motionBlur.strength);
    setVal('motionblur-strength-input',  this._params.motionBlur.strength);
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
  setBloomStrength(v)  { this._params.bloom.strength  = v; if (this.bloomPass) this.bloomPass.strength  = v; }
  setBloomRadius(v)    { this._params.bloom.radius    = v; if (this.bloomPass) this.bloomPass.radius    = v; }
  setBloomThreshold(v) { this._params.bloom.threshold = v; if (this.bloomPass) this.bloomPass.threshold = v; }

  // ─── Vignette params ──────────────────────────────────────────
  setVignetteIntensity(v) {
    this._params.vignette.intensity = v;
    if (this.vignettePass) this.vignettePass.uniforms['darkness'].value = 1.0 + v * 2.0;
  }

  setVignetteSoftness(v) {
    this._params.vignette.softness = v;
    if (this.vignettePass) this.vignettePass.uniforms['offset'].value = 1.0 - v * 0.8;
  }

  setVignetteColor(hex) {
    this._params.vignette.color = hex;
    if (this.vignettePass) this.vignettePass.uniforms['vignetteColor'].value.set(hex);
  }

  setVignetteBlendMode(mode) {
    this._params.vignette.blendMode = mode | 0;
    if (this.vignettePass) this.vignettePass.uniforms['blendMode'].value = mode | 0;
  }

  // ─── SSAO params ─────────────────────────────────────────────
  setSSAOIntensity(v) {
    this._params.ssao.intensity = v;
    if (this.ssaoPass) this.ssaoPass.kernelRadius = Math.max(1, v * 24);
  }

  setSSAORadius(v) {
    this._params.ssao.radius = v;
    if (this.ssaoPass) this.ssaoPass.maxDistance = Math.max(0.005, v * 0.03);
  }

  // ─── Motion blur param ────────────────────────────────────────
  setMotionBlurStrength(v) {
    this._params.motionBlur.strength = v;
    if (this.afterimagePass) this.afterimagePass.uniforms['damp'].value = 0.5 + v * 0.45;
  }

  // ─── Depth of Field ──────────────────────────────────────────
  setDOF(enabled, focus, aperture, maxblur = 0.01, rings = 6) {
    this.dofEnabled = enabled;
    if (this.bokehPass) {
      this.bokehPass.uniforms['focus'].value    = focus;
      this.bokehPass.uniforms['aperture'].value = aperture * 0.003;
      this.bokehPass.uniforms['maxblur'].value  = maxblur;
      this.bokehPass.materialBokeh.uniforms.uRings.value = Math.round(rings);
    }
    this._syncPasses();
  }

  setDOFFocus(focus) {
    if (this.bokehPass) this.bokehPass.uniforms['focus'].value = focus;
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
        this.setBloomStrength(0.20); this.setBloomRadius(0.10); this.setBloomThreshold(0.90);
        break;

      case 'pretty':
        this.postFXEnabled = true;
        this.bloomEnabled = true; this.ssaoEnabled = true;
        this.vignetteEnabled = false; this.motionBlurEnabled = false;
        this.setBloomStrength(0.35); this.setBloomRadius(0.20); this.setBloomThreshold(0.85);
        break;

      case 'cinema':
        this.postFXEnabled = true;
        this.bloomEnabled = true; this.vignetteEnabled = true;
        this.ssaoEnabled = false; this.motionBlurEnabled = false;
        this.setBloomStrength(0.50); this.setBloomRadius(0.30); this.setBloomThreshold(0.80);
        this.setVignetteIntensity(0.25); this.setVignetteSoftness(0.4375);
        break;
    }

    this._syncPasses();
    this._syncCheckboxes();
  }

  // ─── Internal: rebuild if newly-enabled passes are missing ───
  _ensureOptionalPasses() {
    if (!this.composer || !this._scene) return;
    const on = this.postFXEnabled;
    const aa = this.aaMode;

    const needsRebuild =
      (on && this.ssaoEnabled       && !this._builtPasses.has('ssao'))       ||
      (on && this.bloomEnabled      && !this._builtPasses.has('bloom'))      ||
      (on && this.motionBlurEnabled && !this._builtPasses.has('motionBlur')) ||
      (on && this.vignetteEnabled   && !this._builtPasses.has('vignette'))   ||
      (on && this.dofEnabled        && !this._builtPasses.has('dof'))        ||
      (on && aa === 'fxaa'          && !this._builtPasses.has('fxaa'))       ||
      (on && aa === 'smaa'          && !this._builtPasses.has('smaa'));

    if (needsRebuild) {
      this.buildComposer(this._scene, this._camera);
      // Pre-compile the newly-added pass shaders so the first rendered frame doesn't stall.
      this.renderer.compile(this._scene, this._camera);
    }
  }

  // ─── Internal: sync every pass's .enabled to current state flags ─
  _syncPasses() {
    // If a newly-enabled pass isn't in the composer yet, rebuild first.
    this._ensureOptionalPasses();

    const on = this.postFXEnabled;
    const aa = this.aaMode;

    const useTAA  = on && aa === 'taa';
    const useSSAA = on && aa === 'ssaa';
    if (this.taaPass)        this.taaPass.enabled        = useTAA;
    if (this.ssaaPass)       this.ssaaPass.enabled       = useSSAA;
    if (this.renderPass)     this.renderPass.enabled     = !(useTAA || useSSAA);

    if (this.bloomPass)       this.bloomPass.enabled       = on && this.bloomEnabled;
    if (this.ssaoPass)        this.ssaoPass.enabled        = on && this.ssaoEnabled;
    if (this.afterimagePass)  this.afterimagePass.enabled  = on && this.motionBlurEnabled;
    if (this.vignettePass)    this.vignettePass.enabled    = on && this.vignetteEnabled;
    if (this.bokehPass)       this.bokehPass.enabled       = on && this.dofEnabled;
    if (this.fxaaPass)        this.fxaaPass.enabled        = on && aa === 'fxaa';
    if (this.smaaPass)        this.smaaPass.enabled        = on && aa === 'smaa';
  }

  // ─── Internal: push enabled flags back into Setting 6 checkboxes ─
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
