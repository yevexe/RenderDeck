// MODELEXPORT.JS - Builds the Export tab's model packages (.glb, .gltf, .obj + .mtl, .zip)

import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { zipSync, strToU8 } from 'fflate';
import { CHANNELS } from '../../domain/materials/MaterialLibrary.js';

const uniqueName = (name, used) => {
  const base = name.replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '') || 'part';
  let unique = base;
  for (let n = 2; used.has(unique); n++) unique = `${base}_${n}`;
  used.add(unique);
  return unique;
};

// A copy of the model that shares its geometry and textures but has its own materials,
// so exporting never changes what's on screen. Only the materials need disposing.
function buildExportCopy(model, getPartMaterial) {
  const copy = model.clone(true);
  const sources = [];
  const targets = [];
  model.traverse(child => sources.push(child));
  copy.traverse(child => targets.push(child));

  const parts = [];
  const used = new Set();
  targets.forEach((mesh, i) => {
    if (!mesh.isMesh) return;
    const { material, presetName } = getPartMaterial(sources[i]);
    material.wireframe = false;
    material.userData = {};
    mesh.material = material;
    parts.push({
      name: sources[i].name,
      fileName: uniqueName(sources[i].name, used),
      material,
      presetName,
    });
  });
  copy.updateMatrixWorld(true);
  return { copy, parts };
}

function canvasToBytes(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (blob) resolve(new Uint8Array(await blob.arrayBuffer()));
      else reject(new Error('Could not encode a texture'));
    }, 'image/png');
  });
}

// Writes each image once under textures/. PNGs are stored with V pointing up, the way
// OBJ expects them: a texture with flipY off (glTF) reads its image from the top.
class TextureFiles {
  constructor(files) {
    this.files = files;
    this.paths = new Map();
    this.used = new Set();
  }

  async add(texture, label) {
    const image = texture?.image;
    const width = image?.naturalWidth || image?.width;
    const height = image?.naturalHeight || image?.height;
    if (!width || !height || image.data) return null; // no drawable image, e.g. a DataTexture
    const key = texture.source.uuid;
    if (this.paths.has(key)) return this.paths.get(key);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!texture.flipY) {
      ctx.translate(0, height);
      ctx.scale(1, -1);
    }
    ctx.drawImage(image, 0, 0, width, height);

    const path = `textures/${uniqueName(label, this.used)}.png`;
    this.files[path] = await canvasToBytes(canvas);
    this.paths.set(key, path);
    return path;
  }
}

async function materialsJson(parts, textureFiles, extractProperties) {
  const output = {};
  for (const part of parts) {
    const textures = {};
    for (const channel of CHANNELS) {
      const texture = part.material[channel];
      if (!texture) continue;
      const path = await textureFiles.add(texture, `${part.fileName}_${channel}`);
      if (path) textures[channel] = path;
    }
    output[part.name] = {
      preset: part.presetName,
      properties: extractProperties(part.material),
      textures,
    };
  }
  return JSON.stringify({ parts: output }, null, 2);
}

function mtlFor(part, mapPath) {
  const { material } = part;
  const color = material.color.getRGB({ r: 1, g: 1, b: 1 }, THREE.SRGBColorSpace);
  // A common approximation of a Phong exponent from PBR roughness
  const shininess = Math.round(Math.pow(1 - material.roughness, 2) * 1000);
  const lines = [
    `newmtl ${part.fileName}`,
    `Kd ${color.r.toFixed(4)} ${color.g.toFixed(4)} ${color.b.toFixed(4)}`,
    `Ns ${shininess}`,
    `d ${material.opacity}`,
    'illum 2',
  ];
  if (mapPath) lines.push(`map_Kd ${mapPath}`);
  return lines.join('\n');
}

async function dataUriToBytes(uri) {
  return new Uint8Array(await (await fetch(uri)).arrayBuffer());
}

// glTF JSON with its images moved out into files. Geometry stays embedded in the .gltf.
async function moveGltfImagesToFiles(gltf, files) {
  for (const [index, image] of (gltf.images ?? []).entries()) {
    if (!image.uri?.startsWith('data:')) continue;
    const ext = image.mimeType === 'image/jpeg' || image.uri.startsWith('data:image/jpeg') ? 'jpg' : 'png';
    const path = `textures/image_${index}.${ext}`;
    files[path] = await dataUriToBytes(image.uri);
    image.uri = path;
  }
}

function zipBlob(files) {
  const entries = {};
  for (const [path, data] of Object.entries(files)) {
    // Images and GLBs are compressed already: deflating them again only costs time
    entries[path] = [data, { level: /\.(png|jpe?g|glb|hdr)$/i.test(path) ? 0 : 6 }];
  }
  return new Blob([zipSync(entries)], { type: 'application/zip' });
}

function droppedFeatureWarning(parts, format) {
  if (format === 'obj') return 'The .obj package keeps color, opacity, roughness and the base color texture. Use .glb for full materials.';
  const dropped = [];
  if (parts.some(part => part.material.displacementMap)) dropped.push('displacement maps');
  if (parts.some(part => part.material.alphaMap)) dropped.push('alpha maps');
  return dropped.length ? `glTF can't store ${dropped.join(' or ')}, so they were left out.` : null;
}

/**
 * Build one model package.
 * @param {object} options
 * @param {'glb'|'gltf'|'obj'|'zip'} options.format
 * @param {THREE.Object3D} options.model
 * @param {string} options.baseName - file name inside packages (no spaces)
 * @param {Function} options.getPartMaterial - mesh → { material, presetName }; the material is a copy this function disposes
 * @param {Function} options.extractProperties - material → saved property values
 * @param {boolean} options.embedTextures
 * @param {boolean} options.includeMaterialJson
 * @param {?{ fileName: string, path: string }} options.environment - HDR to include in a zip
 * @returns {Promise<{ blob: Blob, ext: string, warnings: string[] }>}
 */
export async function buildModelPackage(options) {
  const { format, model, baseName, getPartMaterial, extractProperties, embedTextures, includeMaterialJson, environment } = options;
  const { copy, parts } = buildExportCopy(model, getPartMaterial);
  const warnings = [];
  const addWarning = warning => { if (warning) warnings.push(warning); };

  try {
    addWarning(droppedFeatureWarning(parts, format));

    if (format === 'glb') {
      const data = await new GLTFExporter().parseAsync(copy, { binary: true });
      return { blob: new Blob([data], { type: 'model/gltf-binary' }), ext: 'glb', warnings };
    }
    if (format === 'gltf' && embedTextures) {
      const data = await new GLTFExporter().parseAsync(copy, { binary: false });
      return { blob: new Blob([JSON.stringify(data)], { type: 'model/gltf+json' }), ext: 'gltf', warnings };
    }

    // Everything else is delivered as a zip
    const files = {};
    const textureFiles = new TextureFiles(files);

    if (format === 'gltf') {
      const gltf = await new GLTFExporter().parseAsync(copy, { binary: false });
      await moveGltfImagesToFiles(gltf, files);
      files[`${baseName}.gltf`] = strToU8(JSON.stringify(gltf));
    } else if (format === 'obj') {
      const mtl = [];
      for (const part of parts) {
        const mapPath = await textureFiles.add(part.material.map, `${part.fileName}_map`);
        mtl.push(mtlFor(part, mapPath));
        part.material.name = part.fileName; // OBJExporter writes usemtl from this
      }
      files[`${baseName}.obj`] = strToU8(`mtllib ${baseName}.mtl\n${new OBJExporter().parse(copy)}`);
      files[`${baseName}.mtl`] = strToU8(`${mtl.join('\n\n')}\n`);
    } else {
      const data = await new GLTFExporter().parseAsync(copy, { binary: true });
      files[`${baseName}.glb`] = new Uint8Array(data);
    }

    if (includeMaterialJson) {
      files['materials.json'] = strToU8(await materialsJson(parts, textureFiles, extractProperties));
    }
    if (environment) {
      try {
        const response = await fetch(environment.path);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        files[`environment/${environment.fileName}`] = new Uint8Array(await response.arrayBuffer());
      } catch (err) {
        addWarning(`The environment HDR was left out: ${err.message}`);
      }
    }
    return { blob: zipBlob(files), ext: 'zip', warnings };
  } finally {
    parts.forEach(part => part.material.dispose());
  }
}
