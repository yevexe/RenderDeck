// MaterialState.js — undo/redo for material property changes

import { HistoryManager } from '../ui/HistoryManager.js';
import { renderHistoryList } from './historyUtils.js';

export class MaterialStateManager {
  /**
   * @param {object}   deps
   * @param {object}   deps.materialManager
   * @param {function} deps.getControls      - () => controls (lazy getter — controls may init after this)
   * @param {function} deps.getActiveMesh    - () => activeMesh
   * @param {function} deps.markNeedsRender  - markNeedsRender(frames)
   */
  constructor({ materialManager, getControls, getActiveMesh, markNeedsRender }) {
    this.materialManager  = materialManager;
    this.getControls      = getControls;
    this.getActiveMesh    = getActiveMesh;
    this.markNeedsRender  = markNeedsRender;

    this.history = new HistoryManager(50);
    this.history.onChange(() => this.updateUI());
  }

  // ── Snapshot ────────────────────────────────────────────────────
  snapshot() {
    const mesh = this.getActiveMesh();
    return {
      materialProperties: mesh?.material
        ? this.materialManager.extractProperties(mesh.material)
        : null,
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
  restore(state) {
    if (!state) return;
    const mesh = this.getActiveMesh();
    if (state.materialProperties && mesh?.material) {
      this.materialManager.applySavedProperties(mesh.material, state.materialProperties);
      mesh.material.needsUpdate = true;
      this.getControls()?.syncMaterialUI(mesh.material);
      this.markNeedsRender(4);
    }
  }

  // ── UI ──────────────────────────────────────────────────────────
  setupUI() {
    document.getElementById('mat-undo-btn')?.addEventListener('click', () => {
      const state = this.history.undo();
      if (state) this.restore(state);
      this.updateUI();
    });
    document.getElementById('mat-redo-btn')?.addEventListener('click', () => {
      const state = this.history.redo();
      if (state) this.restore(state);
      this.updateUI();
    });
  }

  updateUI() {
    const undoBtn = document.getElementById('mat-undo-btn');
    const redoBtn = document.getElementById('mat-redo-btn');
    if (undoBtn) undoBtn.disabled = !this.history.canUndo();
    if (redoBtn) redoBtn.disabled = !this.history.canRedo();
    renderHistoryList('mat-history-list', this.history, (idx) => {
      const state = this.history.jumpTo(idx);
      if (state) this.restore(state);
      this.updateUI();
    });
  }
}
