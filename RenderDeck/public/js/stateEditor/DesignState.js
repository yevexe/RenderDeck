// DesignState.js — undo/redo for UV editor overlay changes

import { HistoryManager } from '../ui/HistoryManager.js';
import { renderHistoryList } from './historyUtils.js';

export class DesignStateManager {
  /**
   * @param {object} deps
   * @param {object} deps.uvEditor
   */
  constructor({ uvEditor }) {
    this.uvEditor = uvEditor;
    this.history  = new HistoryManager(50);
    this.history.onChange(() => this.updateUI());
  }

  // ── Snapshot ────────────────────────────────────────────────────
  snapshot() {
    return { overlays: this.uvEditor.snapshotOverlays() };
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
    this.uvEditor.restoreHistoryState(state.overlays);
  }

  // ── UI ──────────────────────────────────────────────────────────
  setupUI() {
    document.getElementById('design-undo-btn')?.addEventListener('click', () => {
      const state = this.history.undo();
      if (state) this.restore(state);
      this.updateUI();
    });
    document.getElementById('design-redo-btn')?.addEventListener('click', () => {
      const state = this.history.redo();
      if (state) this.restore(state);
      this.updateUI();
    });

    // Hook UV editor commits → push design history entry
    this.uvEditor.onCommit = (label) => {
      this.push(label);
      this.updateUI();
    };
  }

  updateUI() {
    const undoBtn = document.getElementById('design-undo-btn');
    const redoBtn = document.getElementById('design-redo-btn');
    if (undoBtn) undoBtn.disabled = !this.history.canUndo();
    if (redoBtn) redoBtn.disabled = !this.history.canRedo();
    renderHistoryList('design-history-list', this.history, (idx) => {
      const state = this.history.jumpTo(idx);
      if (state) this.restore(state);
      this.updateUI();
    });
  }
}
