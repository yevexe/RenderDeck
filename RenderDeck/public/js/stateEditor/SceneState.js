// SceneState.js — undo/redo for scene: environment, background, props, main model transform

import { HistoryManager } from '../ui/HistoryManager.js';
import { renderHistoryList } from './historyUtils.js';

export class SceneStateManager {
  /**
   * @param {object} deps
   * @param {object}   deps.propManager
   * @param {object}   deps.sceneManager
   * @param {function} deps.loadScene        - loadScene(name, callback)
   * @param {function} deps.applyBackground  - applyBackground()
   * @param {function} deps.markNeedsRender  - markNeedsRender(frames)
   * @param {function} deps.getEnv           - () => { currentEnvironment, currentEnvTexture, showEnvBackground, gradientBgEnabled, currentGradientBg }
   * @param {function} deps.setEnv           - (updates) => void  — writes back into main.js scope
   */
  constructor({ propManager, sceneManager, loadScene, applyBackground, markNeedsRender, getEnv, setEnv }) {
    this.propManager     = propManager;
    this.sceneManager    = sceneManager;
    this.loadScene       = loadScene;
    this.applyBackground = applyBackground;
    this.markNeedsRender = markNeedsRender;
    this.getEnv          = getEnv;
    this.setEnv          = setEnv;

    this.history = new HistoryManager(50);
    this.history.onChange(() => this.updateUI());
  }

  // ── Snapshot ────────────────────────────────────────────────────
  snapshot() {
    const env = this.getEnv();
    return {
      sceneName:          env.currentEnvironment,
      showEnvBackground:  env.showEnvBackground,
      gradientBgEnabled:  env.gradientBgEnabled,
      currentGradientBg:  env.currentGradientBg,
      props:              this.propManager.getSceneData(),
      mainModelTransform: this.propManager.getMainModelTransform(),
    };
  }

  // ── History operations ──────────────────────────────────────────
  init(label = 'Initial state') {
    this.history.init(this.snapshot(), label);
  }

  push(label) {
    this.history.push(this.snapshot(), label);
  }

  // ── Restore ─────────────────────────────────────────────────────
  async restore(state) {
    if (!state) return;

    const env = this.getEnv();
    const envChanged = state.sceneName && state.sceneName !== env.currentEnvironment;

    if (envChanged) {
      const envSel = document.getElementById('environment-select');
      if (envSel) envSel.value = state.sceneName;
      this.loadScene(state.sceneName, (name, texture) => {
        this.sceneManager.setEnvironment(texture);
        this.setEnv({
          currentEnvironment: name,
          currentEnvTexture:  texture,
          showEnvBackground:  state.showEnvBackground,
          gradientBgEnabled:  state.gradientBgEnabled,
          currentGradientBg:  state.currentGradientBg,
        });
        this._syncBgUI(state);
        this.applyBackground();
      });
    } else {
      this.setEnv({
        showEnvBackground: state.showEnvBackground,
        gradientBgEnabled: state.gradientBgEnabled,
        currentGradientBg: state.currentGradientBg,
      });
      this._syncBgUI(state);
      this.applyBackground();
    }

    if (state.props !== undefined) {
      this.propManager.clearAllProps();
      this.markNeedsRender(4);
      if (state.props?.length) await this.propManager.loadSceneData(state.props);
    }

    if (state.mainModelTransform !== undefined) {
      this.propManager.applyMainModelTransform(state.mainModelTransform);
    }

    this.markNeedsRender(60);
  }

  // ── UI ──────────────────────────────────────────────────────────
  setupUI() {
    document.getElementById('scene-undo-btn')?.addEventListener('click', () => {
      const state = this.history.undo();
      if (state) this.restore(state);
      this.updateUI();
    });
    document.getElementById('scene-redo-btn')?.addEventListener('click', () => {
      const state = this.history.redo();
      if (state) this.restore(state);
      this.updateUI();
    });
  }

  updateUI() {
    const undoBtn = document.getElementById('scene-undo-btn');
    const redoBtn = document.getElementById('scene-redo-btn');
    if (undoBtn) undoBtn.disabled = !this.history.canUndo();
    if (redoBtn) redoBtn.disabled = !this.history.canRedo();
    renderHistoryList('scene-history-list', this.history, (idx) => {
      const state = this.history.jumpTo(idx);
      if (state) this.restore(state);
      this.updateUI();
    });
  }

  // ── Internal ────────────────────────────────────────────────────
  _syncBgUI(state) {
    const envBgToggle  = document.getElementById('env-bg-toggle');
    const gradBgToggle = document.getElementById('gradient-bg-toggle');
    const bgSelect     = document.getElementById('background-select');
    if (envBgToggle)  envBgToggle.checked  = state.showEnvBackground;
    if (gradBgToggle) gradBgToggle.checked = state.gradientBgEnabled;
    if (bgSelect)     bgSelect.value       = state.currentGradientBg || '';
  }
}
