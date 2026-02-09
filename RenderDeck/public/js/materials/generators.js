
// GENERATORS.JS - Procedural Texture Generators

import * as THREE from 'three';
import { CONFIG } from '../config.js';

/**
 * Helper to create texture from canvas drawing function
 * @param {Function} drawFn - Function that draws on canvas: (ctx, size) => void
 * @param {number} size - Canvas size (default 256)
 * @returns {THREE.CanvasTexture}
 */
function createTextureFromCanvas(drawFn, size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  drawFn(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.encoding = THREE[CONFIG.TEXTURE.ENCODING];
  tex.needsUpdate = true;
  return tex;
}

/**
 * Create procedural wood texture
 * Features: brown base, grain lines, wood knot
 */
export function createWoodTexture() {
  return createTextureFromCanvas((ctx, s) => {
    // Base color (brown)
    ctx.fillStyle = '#6b3a2a';
    ctx.fillRect(0, 0, s, s);
    
    // Wood grain lines
    for (let y = 0; y < s; y += 6 + Math.random() * 8) {
      const shade = Math.random();
      ctx.strokeStyle = shade > 0.5
        ? `rgba(90, 55, 30, ${0.3 + Math.random() * 0.4})`
        : `rgba(120, 75, 45, ${0.2 + Math.random() * 0.3})`;
      ctx.lineWidth = 1 + Math.random() * 3;
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x < s; x += 20) {
        ctx.lineTo(x, y + Math.sin(x * 0.05) * 3 + (Math.random() - 0.5) * 2);
      }
      ctx.stroke();
    }
    
    // Wood knot
    const kx = s * 0.3;
    const ky = s * 0.6;
    ctx.fillStyle = 'rgba(50, 28, 15, 0.7)';
    ctx.beginPath();
    ctx.ellipse(kx, ky, 12, 8, 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(75, 40, 20, 0.6)';
    ctx.beginPath();
    ctx.ellipse(kx, ky, 6, 4, 0.2, 0, Math.PI * 2);
    ctx.fill();
  });
}

/**
 * Create procedural metal texture
 * Features: brushed metal gradient, horizontal brush strokes, specular highlight
 */
export function createMetalTexture() {
  return createTextureFromCanvas((ctx, s) => {
    // Brushed metal gradient
    const grad = ctx.createLinearGradient(0, 0, s, 0);
    grad.addColorStop(0, '#5a5a5a');
    grad.addColorStop(0.3, '#a8a8a8');
    grad.addColorStop(0.5, '#c0c0c0');
    grad.addColorStop(0.7, '#909090');
    grad.addColorStop(1, '#6a6a6a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, s, s);
    
    // Brush strokes
    for (let y = 0; y < s; y += 2) {
      const r = 180 + Math.random() * 40;
      const g = 180 + Math.random() * 40;
      const b = 180 + Math.random() * 40;
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.15)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(s, y);
      ctx.stroke();
    }
    
    // Specular highlight
    const specGrad = ctx.createLinearGradient(s * 0.4, 0, s * 0.6, 0);
    specGrad.addColorStop(0, 'rgba(255,255,255,0)');
    specGrad.addColorStop(0.5, 'rgba(255,255,255,0.3)');
    specGrad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = specGrad;
    ctx.fillRect(0, 0, s, s);
  });
}

/**
 * Create procedural glass texture
 * Features: radial gradient with light blue tint
 */
export function createGlassTexture() {
  return createTextureFromCanvas((ctx, s) => {
    const grad = ctx.createRadialGradient(s/2, s/2, 0, s/2, s/2, s/2);
    grad.addColorStop(0, 'rgba(220, 240, 255, 0.9)');
    grad.addColorStop(1, 'rgba(180, 210, 235, 0.7)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, s, s);
  });
}

/**
 * Create procedural plastic texture
 * Features: smooth light gray base with subtle noise
 */
export function createPlasticTexture() {
  return createTextureFromCanvas((ctx, s) => {
    // Smooth base
    ctx.fillStyle = '#e8e8e8';
    ctx.fillRect(0, 0, s, s);
    
    // Subtle texture (noise)
    for (let i = 0; i < 100; i++) {
      ctx.fillStyle = `rgba(200, 200, 200, ${Math.random() * 0.1})`;
      ctx.fillRect(Math.random() * s, Math.random() * s, 2, 2);
    }
  });
}