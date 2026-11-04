// GLTFLOADER.JS — The GLTF loader every part of the app should use
//
// three.js dropped KHR_materials_pbrSpecularGlossiness, which older files (many
// Sketchfab models among them) use in place of base color textures. Their materials
// would load plain white, so this converts them to physical materials on load.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const SPECULAR_GLOSSINESS = 'KHR_materials_pbrSpecularGlossiness';

// Makes F0 practically equal to specularColor, which is what the old format stores.
const SPECULAR_GLOSSINESS_IOR = 1000;

// The old format keeps glossiness in the alpha channel; three.js reads roughness from green.
function bakeRoughnessMap(source, glossinessFactor) {
  const { image } = source;
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = pixels;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 0;
    data[i + 1] = 255 - data[i + 3] * glossinessFactor;
    data[i + 2] = 0;
    data[i + 3] = 255;
  }
  ctx.putImageData(pixels, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  for (const key of ['flipY', 'wrapS', 'wrapT', 'magFilter', 'minFilter', 'channel']) texture[key] = source[key];
  texture.offset.copy(source.offset);
  texture.repeat.copy(source.repeat);
  texture.center.copy(source.center);
  texture.rotation = source.rotation;
  return texture;
}

class SpecularGlossinessPlugin {
  constructor(parser) {
    this.parser = parser;
    this.name = SPECULAR_GLOSSINESS;
  }

  _extensionOf(materialIndex) {
    return this.parser.json.materials[materialIndex].extensions?.[this.name] ?? null;
  }

  getMaterialType(materialIndex) {
    return this._extensionOf(materialIndex) ? THREE.MeshPhysicalMaterial : null;
  }

  async extendMaterialParams(materialIndex, params) {
    const extension = this._extensionOf(materialIndex);
    if (!extension) return;

    const [r, g, b, a] = extension.diffuseFactor ?? [1, 1, 1, 1];
    params.color = new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace);
    params.opacity = a;
    const glossiness = extension.glossinessFactor ?? 1;
    params.metalness = 0;
    params.roughness = 1 - glossiness;
    params.ior = SPECULAR_GLOSSINESS_IOR;
    params.specularIntensity = 1;
    const [sr, sg, sb] = extension.specularFactor ?? [1, 1, 1];
    params.specularColor = new THREE.Color().setRGB(sr, sg, sb, THREE.LinearSRGBColorSpace);

    if (extension.diffuseTexture) {
      await this.parser.assignTexture(params, 'map', extension.diffuseTexture, THREE.SRGBColorSpace);
    }
    if (extension.specularGlossinessTexture) {
      await this.parser.assignTexture(params, 'specularColorMap', extension.specularGlossinessTexture, THREE.SRGBColorSpace);
      if (params.specularColorMap?.image) {
        params.roughnessMap = bakeRoughnessMap(params.specularColorMap, glossiness);
        params.roughness = 1; // the map already holds the factor
      }
    }
  }
}

export function createGLTFLoader() {
  return new GLTFLoader().register(parser => new SpecularGlossinessPlugin(parser));
}
