// Render SVGs with explicit dimensions while retaining the exact uploaded bytes.
export function fileDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read image'));
    const extension = file.name?.split('.').pop().toLowerCase();
    const type = file.type || ({ svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' }[extension]) || 'application/octet-stream';
    reader.readAsDataURL(file.slice(0, file.size, type));
  });
}

export async function loadDesignImage(dataURL) {
  let source = dataURL;
  if (/^data:image\/svg\+xml/i.test(dataURL)) {
    const blob = await fetch(dataURL).then(response => response.blob());
    const doc = new DOMParser().parseFromString(await blob.text(), 'image/svg+xml');
    const svg = doc.documentElement;
    if (svg.localName !== 'svg' || doc.querySelector('parsererror')) throw new Error('Invalid SVG image');
    const box = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    let width = parseFloat(svg.getAttribute('width'));
    let height = parseFloat(svg.getAttribute('height'));
    if (!(width > 0 && height > 0) && box.length === 4 && box[2] > 0 && box[3] > 0) [width, height] = box.slice(2);
    if (!(width > 0 && height > 0)) throw new Error('SVG needs drawable dimensions or a viewBox');
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    source = await fileDataURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
  }
  const image = new Image();
  image.src = source;
  await image.decode();
  if (!(image.naturalWidth > 0 && image.naturalHeight > 0)) throw new Error('Image has no drawable dimensions');
  const probe = document.createElement('canvas');
  probe.width = probe.height = 1;
  const context = probe.getContext('2d');
  context.drawImage(image, 0, 0, 1, 1);
  context.getImageData(0, 0, 1, 1);
  image._originalDataURL = dataURL;
  return image;
}
