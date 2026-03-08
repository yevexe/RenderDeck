// HistoryManager.js — generic undo/redo history stack
// Stores full snapshots at each committed change point.
// The initial state (index 0) is set via init(), subsequent changes via push().

export class HistoryManager {
  constructor(maxEntries = 50) {
    this._max = maxEntries;
    this._states = []; // [{ label, timestamp, state }]
    this._index = -1;  // current position; -1 = uninitialised
    this._onChange = null;
  }

  /** Set the baseline state (e.g. on model load or app start). */
  init(state, label = 'Initial state') {
    this._states = [{ label, timestamp: Date.now(), state }];
    this._index = 0;
    this._notify();
  }

  /** Record a new committed state. Clears any redo states above the current index. */
  push(state, label = 'Change') {
    this._states = this._states.slice(0, this._index + 1);
    this._states.push({ label, timestamp: Date.now(), state });
    if (this._states.length > this._max) {
      this._states.shift();
    } else {
      this._index++;
    }
    this._notify();
  }

  /** Undo: move back one step. Returns the state to restore, or null. */
  undo() {
    if (this._index <= 0) return null;
    this._index--;
    this._notify();
    return this._states[this._index].state;
  }

  /** Redo: move forward one step. Returns the state to restore, or null. */
  redo() {
    if (this._index >= this._states.length - 1) return null;
    this._index++;
    this._notify();
    return this._states[this._index].state;
  }

  canUndo() { return this._index > 0; }
  canRedo() { return this._index < this._states.length - 1; }

  /** Timestamp of the entry that would be undone next, or -Infinity if nothing to undo. */
  peekUndoTimestamp() {
    return this._index > 0 ? this._states[this._index].timestamp : -Infinity;
  }

  /** Timestamp of the entry that would be redone next, or -Infinity if nothing to redo. */
  peekRedoTimestamp() {
    const next = this._index + 1;
    return next < this._states.length ? this._states[next].timestamp : -Infinity;
  }

  /**
   * All history entries for display, most recent first.
   * Each entry: { label, timestamp, isCurrent, originalIndex }
   */
  getEntries() {
    return this._states
      .map((e, i) => ({ label: e.label, timestamp: e.timestamp, isCurrent: i === this._index, originalIndex: i }))
      .reverse();
  }

  /** Jump directly to a specific original (non-reversed) index. Returns state or null. */
  jumpTo(originalIndex) {
    if (originalIndex < 0 || originalIndex >= this._states.length) return null;
    this._index = originalIndex;
    this._notify();
    return this._states[this._index].state;
  }

  /** Clear all history. */
  clear() {
    this._states = [];
    this._index = -1;
    this._notify();
  }

  /** Register a callback to run whenever history changes (for UI refresh). */
  onChange(cb) { this._onChange = cb; }

  _notify() { this._onChange?.(); }
}
