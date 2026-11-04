// NATIVECATALOG.JS — Materials listed inside object files
//
// Lists an object's materials without loading the object: a GLB's JSON chunk sits
// at the start of the file, so only that much is downloaded before aborting.
// A catalog record is { objectName, materials: [{ id, name, occurrence, index, params }] }.
// params are simple values for a thumbnail; the real ones are read when the file loads.

import * as THREE from 'three';
import { nativeMaterialId } from '../../storage/storageKeys.js';
import { SPECULAR_GLOSSINESS } from '../../engine/gltfLoader.js';

const GLB_MAGIC = 0x46546C67; // 'glTF'
const GLB_JSON_CHUNK = 0x4E4F534A; // 'JSON'
const GLB_HEADER_BYTES = 20;

function linearColorHex([r, g, b]) {
  return `#${new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace).getHexString()}`;
}

function simpleGltfParams(material) {
  const specularGlossiness = material.extensions?.[SPECULAR_GLOSSINESS];
  const pbr = specularGlossiness
    ? { baseColorFactor: specularGlossiness.diffuseFactor, metallicFactor: 0, roughnessFactor: 1 - (specularGlossiness.glossinessFactor ?? 1) }
    : material.pbrMetallicRoughness || {};
  const factor = pbr.baseColorFactor || [1, 1, 1, 1];
  // A texture multiplies its factor. Without the texture the factor alone would be
  // wrong (the shirts have a white emissive factor), so leave emission out.
  const emissive = material.emissiveTexture ? [0, 0, 0] : (material.emissiveFactor || [0, 0, 0]);
  return {
    color: linearColorHex(factor),
    opacity: factor[3] ?? 1,
    transparent: material.alphaMode === 'BLEND',
    metalness: pbr.metallicFactor ?? 1,
    roughness: pbr.roughnessFactor ?? 1,
    emissive: linearColorHex(emissive),
    emissiveIntensity: 1,
  };
}

export function catalogFromGltf(objectName, json) {
  const seen = new Map();
  const materials = (json.materials || []).map((material, index) => {
    const name = material.name || `Material ${index + 1}`;
    const occurrence = seen.get(name) || 0;
    seen.set(name, occurrence + 1);
    return { id: nativeMaterialId(objectName, name, occurrence), name, occurrence, index, params: simpleGltfParams(material) };
  });
  return { objectName, materials };
}

// MTLLoader keeps one material per name, so occurrence is always 0 here.
export function catalogFromMtl(objectName, text) {
  const materials = [];
  let current = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (/^newmtl\s/i.test(line)) {
      const name = line.slice(6).trim();
      if (materials.some(material => material.name === name)) { current = null; continue; }
      current = { id: nativeMaterialId(objectName, name, 0), name, occurrence: 0, index: materials.length, params: {} };
      materials.push(current);
    } else if (current && /^kd\s/i.test(line)) {
      const [r, g, b] = line.split(/\s+/).slice(1).map(Number);
      if ([r, g, b].every(Number.isFinite)) current.params.color = `#${new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace).getHexString()}`;
    }
  }
  return { objectName, materials };
}

// Read the JSON chunk from a stream and stop the download as soon as it is complete.
export async function readGlbJsonFromUrl(url) {
  const controller = new AbortController();
  const response = await fetch(url, { signal: controller.signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const reader = response.body.getReader();
  let buffer = new Uint8Array(0);
  let needed = GLB_HEADER_BYTES;
  let headerRead = false;
  try {
    for (;;) {
      if (buffer.length >= needed) {
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        if (!headerRead) {
          if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error('not a GLB file');
          if (view.getUint32(16, true) !== GLB_JSON_CHUNK) throw new Error('GLB has no JSON chunk first');
          needed = GLB_HEADER_BYTES + view.getUint32(12, true);
          headerRead = true;
          continue;
        }
        return JSON.parse(new TextDecoder().decode(buffer.subarray(GLB_HEADER_BYTES, needed)));
      }
      const { done, value } = await reader.read();
      if (done) throw new Error('file ended before its JSON chunk');
      const next = new Uint8Array(buffer.length + value.length);
      next.set(buffer);
      next.set(value, buffer.length);
      buffer = next;
    }
  } finally {
    controller.abort();
    reader.cancel().catch(() => {});
  }
}

// An uploaded .glb, or a self-contained .gltf stored in the same slot.
export async function readGltfJsonFromBlob(blob) {
  const head = new DataView(await blob.slice(0, GLB_HEADER_BYTES).arrayBuffer());
  if (head.byteLength >= 4 && head.getUint32(0, true) === GLB_MAGIC) {
    const end = GLB_HEADER_BYTES + head.getUint32(12, true);
    return JSON.parse(await blob.slice(GLB_HEADER_BYTES, end).text());
  }
  return JSON.parse(await blob.text());
}

// Mark each file material with its library id. The id lives in userData, so it
// survives Material.clone() and convertToPhysical copies it across.
export function tagFileMaterials(object, catalog, associations = null) {
  const byIndex = new Map(catalog.materials.map(entry => [entry.index, entry]));
  const byName = new Map();
  for (const entry of catalog.materials) if (!byName.has(entry.name)) byName.set(entry.name, entry);
  object.traverse(child => {
    if (!child.isMesh) return;
    for (const material of [child.material].flat().filter(Boolean)) {
      const index = associations?.get(material)?.materials;
      const entry = byIndex.get(index) ?? byName.get(material.name);
      if (entry) material.userData.libId = entry.id;
    }
  });
}
