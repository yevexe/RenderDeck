// MaterialState.js — undo/redo for material property changes

import { HistoryManager } from './HistoryManager.js';
import { renderHistoryList } from './historyUtils.js';

export class MaterialStateManager {
  /**
   * @param {object}   deps
   * @param {function} deps.captureState  - () => state of the active part's material
   * @param {function} deps.applyState    - (state) => Promise, applies a state across the library
   */
  constructor({ captureState, applyState }) {
    this.captureState = captureState;
    this.applyState   = applyState;

    this.history = new HistoryManager(50);
    this.history.onChange(() => this.updateUI());

    this.onChanged = null;  // optional callback — fired after every push or restore
    this.onRestored = null; // optional callback — fired after undo/redo/jump restores a state
  }

  // ── Snapshot ────────────────────────────────────────────────────
  // { partName, materialId, materialProperties, channelMaps, clearedChannels }
  snapshot() {
    return this.captureState() || { materialProperties: null };
  }

  // ── History operations ──────────────────────────────────────────
  init(label = 'Initial state') {
    this.history.init(this.snapshot(), label);
  }

  push(label) {
    this.history.push(this.snapshot(), label);
    this.onChanged?.();
  }

  // ── Restore ─────────────────────────────────────────────────────
  async restore(state) {
    if (!state?.materialProperties) return;
    await this.applyState(state);
    this.onChanged?.();
    this.onRestored?.();
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
