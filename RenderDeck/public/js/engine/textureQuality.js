import * as THREE from 'three';

let currentAnisotropy = 16;
let rendererManager = null;

export function setTextureQualityRenderer(manager) {
  rendererManager = manager;
}

export function setTextureAnisotropy(value) {
  currentAnisotropy = value;
}

export function applyTexQuality(tex) {
  if (!tex || !tex.isTexture) return;
  const renderer = rendererManager?.getRenderer?.();
  const maxAniso = renderer ? renderer.capabilities.getMaxAnisotropy() : 16;
  tex.anisotropy = Math.min(currentAnisotropy, maxAniso);
  if (tex.generateMipmaps !== false) {
    tex.minFilter = THREE.LinearMipmapLinearFilter;
  }
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
}
