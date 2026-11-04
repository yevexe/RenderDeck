import * as IDBStorage from '../../storage/indexedDBStorage.js';
import { EXTRACTOR_IMAGE_KEY } from '../../storage/storageKeys.js';
import { getAppSetting, scheduleAppSetting, setAppBlobSetting } from '../../storage/SettingsStorage.js';

export async function loadColorExtractorImage() {
  const blob = await IDBStorage.get('blobs', EXTRACTOR_IMAGE_KEY);
  if (!blob) return null;
  return {
    blob,
    fileName: getAppSetting('colorExtractorFileName') || blob.name || 'Image',
  };
}

export function saveColorExtractorImage(file) {
  return setAppBlobSetting('colorExtractorFileName', file.name || 'Image', EXTRACTOR_IMAGE_KEY, file);
}

export function scheduleSwatchCollectionsSave(collections) {
  return scheduleAppSetting('swatchCollections', collections);
}
