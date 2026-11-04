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
    .find(item => item.uri && !/^data:/i.test(item.uri));
  if (external) throw new Error(`Single-file import references an external file: ${external.uri}. Embed it before uploading.`);
}
