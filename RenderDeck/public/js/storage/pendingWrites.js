
// PENDINGWRITES.JS — Debounced IndexedDB writes
// Continuous edits (sliders, drags, camera orbit) are written a short time after
// they settle. Every pending write is registered here so flushWrites() can run
// them all immediately when the page is hidden or closed.
//
// Writes are serialized per id: a run never starts while the previous run with
// the same id is still in progress. Anything scheduled meanwhile is collapsed to
// the latest request, which runs once the current run has finished — so an
// older write can never finish last and overwrite a newer one.

import { log } from '../utils/logger.js';

const DEFAULT_DELAY = 300;
const _pending = new Map(); // id → { timer, run, label }  (scheduled, not started)
const _running = new Map(); // id → Promise of the run in progress

// ─────────────────────────────────────────────
// Schedule a write. A newer call with the same id replaces the older one.
// run: () => Promise — performs the IndexedDB write. Callers that need to merge
// requests keep the request data themselves and read it inside run.
// ─────────────────────────────────────────────
export function scheduleWrite(id, run, { delay = DEFAULT_DELAY, label = id } = {}) {
  const existing = _pending.get(id);
  if (existing?.timer) clearTimeout(existing.timer);
  const entry = { timer: null, run, label };
  entry.timer = setTimeout(() => { entry.timer = null; _start(id); }, delay);
  _pending.set(id, entry);
}

// ─────────────────────────────────────────────
// Drop a pending write without running it (e.g. the record was deleted).
// A run already in progress still finishes.
// ─────────────────────────────────────────────
export function cancelWrite(id) {
  const existing = _pending.get(id);
  if (!existing) return;
  if (existing.timer) clearTimeout(existing.timer);
  _pending.delete(id);
}

// Cancel every pending write (e.g. before the database is deleted)
export function cancelAllWrites() {
  for (const id of [..._pending.keys()]) cancelWrite(id);
}

// Cancel every pending write whose id starts with prefix
export function cancelWritesWithPrefix(prefix) {
  for (const id of [..._pending.keys()]) {
    if (id.startsWith(prefix)) cancelWrite(id);
  }
}

// ─────────────────────────────────────────────
// Run every pending write now and wait for runs already in progress.
// Resolves once nothing is pending or running for any id seen at call time.
// ─────────────────────────────────────────────
export function flushWrites() {
  const ids = new Set([..._pending.keys(), ..._running.keys()]);
  return Promise.all([...ids].map(id => _settle(id)));
}

export function hasPendingWrites() {
  return _pending.size > 0 || _running.size > 0;
}

// Start the pending write for id now. If a run is in progress, mark the pending
// request as due instead; it starts as soon as the current run ends.
function _start(id) {
  const entry = _pending.get(id);
  if (!entry) return;
  if (entry.timer) { clearTimeout(entry.timer); entry.timer = null; }
  if (_running.has(id)) return;
  _pending.delete(id);

  const run = (async () => {
    try {
      await entry.run();
    } catch (err) {
      console.error(`[pendingWrites] ${entry.label} failed:`, err);
      log(`Save failed (${entry.label}): ${err.message}`, true);
    }
  })().finally(() => {
    _running.delete(id);
    // A request that became due (timer fired or flush) while we ran goes next
    if (_pending.get(id)?.timer === null) _start(id);
  });
  _running.set(id, run);
}

// Run everything pending for id and wait until nothing is pending or running
async function _settle(id) {
  while (_pending.has(id) || _running.has(id)) {
    _start(id);
    await _running.get(id);
  }
}
