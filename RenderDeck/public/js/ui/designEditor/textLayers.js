export async function buildTextImage(textData) {
  const { content, fontFamily, fontSize, color, bold, italic } = textData;
  const weight = bold ? 'bold' : 'normal';
  const style = italic ? 'italic' : 'normal';
  const scale = 3;
  const scaledSize = fontSize * scale;
  const fontStr = `${style} ${weight} ${scaledSize}px "${fontFamily}"`;

  try { await document.fonts.load(fontStr); } catch (_) { /* fallback to whatever is cached */ }

  const lines = content.split('\n');
  const lineHeight = scaledSize * 1.25;
  const padH = scaledSize * 0.4;
  const padV = scaledSize * 0.3;

  const measureCanvas = document.createElement('canvas');
  measureCanvas.width = 4;
  measureCanvas.height = 4;
  const measureContext = measureCanvas.getContext('2d');
  measureContext.font = fontStr;
  let maxWidth = 0;
  for (const line of lines) {
    const width = measureContext.measureText(line || ' ').width;
    if (width > maxWidth) maxWidth = width;
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(Math.ceil(maxWidth + padH * 2), 4);
  canvas.height = Math.max(Math.ceil(lineHeight * lines.length + padV * 2), 4);

  const context = canvas.getContext('2d');
  context.font = fontStr;
  context.fillStyle = color;
  context.textBaseline = 'top';
  for (let i = 0; i < lines.length; i++) {
    context.fillText(lines[i], padH, padV + i * lineHeight);
  }

  const dataUrl = canvas.toDataURL('image/png');
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve({ image: img, aspectRatio: canvas.width / canvas.height });
    img.src = dataUrl;
  });
}
