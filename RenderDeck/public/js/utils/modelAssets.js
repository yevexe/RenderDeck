// Single-file imports must contain their buffers and images so they work offline.
export async function assertSelfContainedGLTF(file) {
  let manifest;
  if (/\.glb$/i.test(file.name)) {
    const buffer = await file.arrayBuffer();
    const view = new DataView(buffer);
    if (buffer.byteLength < 20 || view.getUint32(12, true) > buffer.byteLength - 20 || view.getUint32(16, true) !== 0x4e4f534a) {
      throw new Error('GLB has no valid JSON manifest.');
    }
    manifest = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, view.getUint32(12, true))).trim());
  } else {
    manifest = JSON.parse(await file.text());
  }
  const external = [...(manifest.buffers || []), ...(manifest.images || [])]
    .filter(item => item.uri && !/^data:/i.test(item.uri))
    .map(item => item.uri);
  if (external.length) {
    throw new Error(`"${file.name}" refers to separate files (${external.join(', ')}). Export it as .glb, or as .gltf with embedded data, and import that.`);
  }
}
