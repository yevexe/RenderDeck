// IMAGEEXPORT.JS - Renders one frame outside the live loop for the Export tab

import * as THREE from 'three';
import { EXRExporter } from 'three/addons/exporters/EXRExporter.js';

const CANVAS_FORMATS = {
  jpg:  { mime: 'image/jpeg', quality: 0.92 },
  png:  { mime: 'image/png' },
  webp: { mime: 'image/webp', quality: 0.95 },
};

// Change the scene for one frame only; everything is put back even if draw() throws.
function withExportState({ rendererManager, scene, camera, overlays = [], width, height, transparent }, draw) {
  const renderer = rendererManager.getRenderer();
  const savedBackground = scene.background;
  const savedClearColor = renderer.getClearColor(new THREE.Color());
  const savedClearAlpha = renderer.getClearAlpha();
  const savedAspect = camera.aspect;
  const savedVisible = overlays.map(o => o.visible);
  try {
    overlays.forEach(o => { o.visible = false; });
    if (transparent) {
      scene.background = null;
      renderer.setClearColor(0x000000, 0);
    }
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    return draw();
  } finally {
    overlays.forEach((o, i) => { o.visible = savedVisible[i]; });
    scene.background = savedBackground;
    renderer.setClearColor(savedClearColor, savedClearAlpha);
    camera.aspect = savedAspect;
    camera.updateProjectionMatrix();
  }
}

// The viewport's CSS background (solid or linear-gradient preset) on a 2D canvas
function paintCssBackground(ctx, css, width, height) {
  const gradient = css.match(/^linear-gradient\((\d+)deg,\s*(.+)\)$/);
  if (!gradient) {
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, width, height);
    return;
  }
  // Same gradient line as CSS: through the centre, reaching the far corners
  const angle = Number(gradient[1]) * Math.PI / 180;
  const half = (Math.abs(width * Math.sin(angle)) + Math.abs(height * Math.cos(angle))) / 2;
  const dx = Math.sin(angle) * half;
  const dy = -Math.cos(angle) * half;
  const fill = ctx.createLinearGradient(width / 2 - dx, height / 2 - dy, width / 2 + dx, height / 2 + dy);
  gradient[2].split(/,\s*/).forEach(stop => {
    const [color, position] = stop.trim().split(/\s+/);
    fill.addColorStop(parseFloat(position) / 100, color);
  });
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, width, height);
}

function canvasToBlob(canvas, { mime, quality }) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      // Browsers silently fall back to PNG for a type they can't encode
      if (blob?.type === mime) resolve(blob);
      else reject(new Error(`This browser can't create ${mime} files`));
    }, mime, quality);
  });
}

/**
 * Render one frame to a .jpg, .png or .webp Blob.
 * The pixels are copied before the viewport is restored, so nothing shows on screen.
 */
export async function renderImage(options) {
  const { format, rendererManager, scene, camera, width, height, transparent, usePostFX, backgroundCss } = options;
  const renderer = rendererManager.getRenderer();

  const output = document.createElement('canvas');
  output.width = width;
  output.height = height;
  const ctx = output.getContext('2d');
  if (backgroundCss && !transparent) paintCssBackground(ctx, backgroundCss, width, height);

  try {
    withExportState(options, () => rendererManager.withRenderSize(width, height, () => {
      const gl = renderer.getContext();
      if (gl.drawingBufferWidth !== width || gl.drawingBufferHeight !== height) {
        throw new Error(`This GPU can't render ${width} × ${height}`);
      }
      if (usePostFX && !transparent) rendererManager.render(scene, camera);
      else renderer.render(scene, camera);
      ctx.drawImage(renderer.domElement, 0, 0);
    }));
  } finally {
    // Resizing cleared the canvas: redraw before the browser can paint it empty
    rendererManager.render(scene, camera);
  }

  return canvasToBlob(output, CANVAS_FORMATS[format]);
}

/**
 * Render one frame to an .exr Blob: linear HDR values, without tone mapping or post-processing.
 * A render target never touches the canvas, so the viewport isn't resized.
 */
export async function renderExr(options) {
  const { rendererManager, scene, camera, width, height } = options;
  const renderer = rendererManager.getRenderer();
  if (Math.max(width, height) > renderer.capabilities.maxTextureSize) {
    throw new Error(`This GPU can't render ${width} × ${height}`);
  }

  const target = new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    samples: 4,
  });
  try {
    withExportState(options, () => {
      const previousTarget = renderer.getRenderTarget();
      try {
        renderer.setRenderTarget(target);
        renderer.render(scene, camera);
      } finally {
        renderer.setRenderTarget(previousTarget);
      }
    });
    const data = await new EXRExporter().parse(renderer, target, { type: THREE.HalfFloatType });
    return new Blob([data], { type: 'image/x-exr' });
  } finally {
    target.dispose();
  }
}
