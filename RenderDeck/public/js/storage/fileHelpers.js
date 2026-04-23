/**
 * Small utilities for converting between the file representations the app
 * juggles: data URLs (guest path persistence), Blobs (IDB), and Files
 * (multipart uploads to the backend).
 */

/**
 * Convert a `data:` URL into a real `File` ready for FormData/multipart upload.
 * Filename and mime type are inferred when possible, with overrides accepted.
 *
 * @param {string} dataURL  e.g. "data:image/png;base64,iVBOR..."
 * @param {string} [filename]  Defaults to "upload.<ext>" derived from mime
 * @param {string} [mimeOverride]  Force a specific Content-Type
 * @returns {Promise<File>}
 */
export async function dataURLToFile(dataURL, filename, mimeOverride) {
    const res = await fetch(dataURL);
    const blob = await res.blob();
    const type = mimeOverride || blob.type || 'application/octet-stream';
    const name = filename || `upload.${mimeToExt(type)}`;
    return new File([blob], name, { type });
}

/**
 * Best-effort mime → extension mapping for the asset types the backend accepts.
 * Falls back to "bin" so the resulting filename is always at least valid.
 */
function mimeToExt(mime) {
    switch (mime) {
        case 'image/jpeg':         return 'jpg';
        case 'image/png':          return 'png';
        case 'image/svg+xml':      return 'svg';
        case 'model/gltf-binary':  return 'glb';
        case 'application/octet-stream': return 'bin';
        default: {
            const parts = mime.split('/');
            return parts[1] ? parts[1].split('+')[0] : 'bin';
        }
    }
}
