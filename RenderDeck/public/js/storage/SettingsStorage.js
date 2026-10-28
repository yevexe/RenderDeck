
// SETTINGSSTORAGE.JS — App and project settings (IndexedDB 'settings' store)
//
// settings/app          → { swatchCollections, hiddenPresets, sketchfabToken }
//                         Shared by every project.
// settings/${projectId} → { camera, view, renderer, preview, background, environment, ui }
//                         Written a short time after each change (see pendingWrites.js).

import * as IDBStorage from './indexedDBStorage.js';
import { APP_SETTINGS_KEY, projectSettingsKey } from './storageKeys.js';
import { scheduleWrite } from './pendingWrites.js';

let _app = null;          // cached settings/app record
let _appLoading = null;
let _appWrites = Promise.resolve(); // settings/app writes run one at a time, in order

// Queue a write of settings/app. task runs after every earlier write has
// finished, so it always builds the record from the latest state.
function _enqueueAppWrite(task) {
  const run = _appWrites.catch(() => {}).then(task);
  _appWrites = run;
  return run;
}

// ─────────────────────────────────────────────
// App settings
// ─────────────────────────────────────────────

export function loadAppSettings() {
  if (_app) return Promise.resolve(_app);
  if (!_appLoading) {
    _appLoading = IDBStorage.get('settings', APP_SETTINGS_KEY)
      .then(rec => { _app = rec || {}; return _app; })
      .finally(() => { _appLoading = null; });
  }
  return _appLoading;
}

export function getAppSetting(name) {
  return _app ? _app[name] : undefined;
}

// Write to IndexedDB first; the in-memory copy only changes once the write succeeds.
// The record is built from the latest state when the queued write runs.
// Throws on failure so the caller can keep the UI unchanged and report the error.
export async function setAppSetting(name, value) {
  await loadAppSettings();
  return _enqueueAppWrite(async () => {
    const next = { ..._app };
    if (value === undefined || value === null) delete next[name];
    else next[name] = value;
    await IDBStorage.put('settings', APP_SETTINGS_KEY, next);
    _app = next;
  });
}

// For values that change continuously (swatch edits): memory updates now,
// the write follows after the edits settle.
export function scheduleAppSetting(name, value) {
  if (!_app) return; // not loaded yet — never overwrite stored data with defaults
  _app = { ..._app, [name]: value };
  scheduleWrite('settings:app',
    () => _enqueueAppWrite(() => IDBStorage.put('settings', APP_SETTINGS_KEY, _app)),
    { label: 'app settings' });
}

// ─────────────────────────────────────────────
// Project settings
// ─────────────────────────────────────────────

export async function loadProjectSettings(projectId) {
  if (!projectId) return {};
  return (await IDBStorage.get('settings', projectSettingsKey(projectId))) || {};
}

// collect: () => settings object — called when the write runs, so it always
// captures the latest state.
export function scheduleProjectSettings(projectId, collect) {
  if (!projectId) return;
  scheduleWrite(`settings:${projectId}`,
    () => IDBStorage.put('settings', projectSettingsKey(projectId), collect()),
    { label: 'project settings' });
}
