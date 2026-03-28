import { unzip } from 'fflate';

function uint8ToBase64(arr) {
  let str = '';
  const CHUNK = 32768;
  for (let i = 0; i < arr.length; i += CHUNK) {
    str += String.fromCharCode(...arr.subarray(i, i + CHUNK));
  }
  return btoa(str);
}

function mimeForExt(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  return { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
           webp: 'image/webp', bin: 'application/octet-stream' }[ext]
    ?? 'application/octet-stream';
}

export function extractModelFromZip(zipData) {
  return new Promise((resolve, reject) => {
    // Check magic bytes before attempting extraction
    if (zipData.length < 4) {
      reject(new Error('Downloaded data is too small to be a valid model file.'));
      return;
    }

    // GLB magic: "glTF" = 0x67 0x6C 0x54 0x46
    if (zipData[0] === 0x67 && zipData[1] === 0x6C && zipData[2] === 0x54 && zipData[3] === 0x46) {
      const url = URL.createObjectURL(new Blob([zipData], { type: 'model/gltf-binary' }));
      resolve(url);
      return;
    }

    // ZIP magic: "PK\x03\x04" = 0x50 0x4B 0x03 0x04
    if (!(zipData[0] === 0x50 && zipData[1] === 0x4B)) {
      const preview = Array.from(zipData.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' ');
      reject(new Error(`Download returned unexpected data (not a ZIP or GLB). First bytes: ${preview}`));
      return;
    }

    unzip(zipData, (err, files) => {
      if (err) { reject(new Error('ZIP extraction failed: ' + err.message)); return; }

      // Flatten nested paths → basename map (skip empty directory entries)
      const flat = {};
      for (const [path, data] of Object.entries(files)) {
        if (data.length === 0) continue;
        flat[path.split('/').pop()] = data;
      }

      // Prefer GLB — single self-contained file
      const glbName = Object.keys(flat).find(n => n.toLowerCase().endsWith('.glb'));
      if (glbName) {
        const url = URL.createObjectURL(new Blob([flat[glbName]], { type: 'model/gltf-binary' }));
        resolve(url);
        return;
      }

      // Fall back to GLTF — inline all external buffers and images as data URIs
      const gltfName = Object.keys(flat).find(n => n.toLowerCase().endsWith('.gltf'));
      if (!gltfName) { reject(new Error('No GLB or GLTF file found in the downloaded ZIP.')); return; }

      let json;
      try { json = JSON.parse(new TextDecoder().decode(flat[gltfName])); }
      catch { reject(new Error('Could not parse GLTF JSON.')); return; }

      for (const buf of (json.buffers ?? [])) {
        if (buf.uri && !buf.uri.startsWith('data:')) {
          const name = buf.uri.split('/').pop().split('?')[0];
          if (flat[name]) buf.uri = `data:application/octet-stream;base64,${uint8ToBase64(flat[name])}`;
        }
      }
      for (const img of (json.images ?? [])) {
        if (img.uri && !img.uri.startsWith('data:')) {
          const name = img.uri.split('/').pop().split('?')[0];
          if (flat[name]) img.uri = `data:${mimeForExt(name)};base64,${uint8ToBase64(flat[name])}`;
        }
      }

      const url = URL.createObjectURL(new Blob([JSON.stringify(json)], { type: 'model/gltf+json' }));
      resolve(url);
    });
  });
}
