const SYNC_STORES = new Set(['sync-outbox', 'sync-state']);
const DEVICE_ONLY_METADATA_KEYS = new Set([
  'activeProjectId',
  'migrated:v8:keys',
  'migrated:v8:orphan-presets',
  'standard-models-prefetched',
  'scenes_migrated_from_legacy',
]);
const DEVICE_ONLY_METADATA_PREFIXES = [
  'migrated:material-library:',
  'standard-model-info:',
];
const DEVICE_ONLY_BLOB_PREFIXES = [
  'design-thumb:',
  'env-preview:',
  'mat-thumb:',
  'preset-thumb:',
  'standard-model:',
  'thumb:',
];

export function isSyncInfrastructureStore(store) {
  return SYNC_STORES.has(store);
}

export function isSyncable(store, key) {
  if (isSyncInfrastructureStore(store)) return false;
  if (store === 'metadata') {
    return !DEVICE_ONLY_METADATA_KEYS.has(key)
      && !DEVICE_ONLY_METADATA_PREFIXES.some(prefix => String(key).startsWith(prefix));
  }
  if (store === 'blobs') {
    return !DEVICE_ONLY_BLOB_PREFIXES.some(prefix => String(key).startsWith(prefix));
  }
  return true;
}

export function prepareValueForSync(store, key, value) {
  if (store !== 'settings' || key !== 'app' || !value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }
  const { sketchfabToken, ...syncValue } = value;
  return syncValue;
}

export function preserveLocalValueOnSync(store, key, incomingValue, localValue) {
  if (store !== 'settings' || key !== 'app'
      || !incomingValue || typeof incomingValue !== 'object' || Array.isArray(incomingValue)) {
    return incomingValue;
  }
  const merged = { ...incomingValue };
  if (localValue && Object.hasOwn(localValue, 'sketchfabToken')) {
    merged.sketchfabToken = localValue.sketchfabToken;
  } else {
    delete merged.sketchfabToken;
  }
  return merged;
}
