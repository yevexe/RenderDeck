
// TEXTURECOMPOSITOR.JS - Composite Texture Creation

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { log } from './logger.js';

export class TextureCompositor {
  /**
   * Create composite texture from base texture and overlay images
   * @param {THREE.Texture} baseTexture - Base texture (Wood/Metal/Glass/Plastic)
   * @param {Array} overlayImages - Array of {imageData, position, size, rotation}
   * @returns {Promise<THREE.CanvasTexture>}
   */
  static async createCompositeTexture(baseTexture, overlayImages) {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas');
      canvas.width = CONFIG.TEXTURE.COMPOSITE_SIZE;
      canvas.height = CONFIG.TEXTURE.COMPOSITE_SIZE;
      const ctx = canvas.getContext('2d');

      const drawComposite = () => {
        log(`Drawing composite with ${overlayImages ? overlayImages.length : 0} overlays`);
        
        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Draw base texture
        if (baseTexture && baseTexture.image) {
          try {
            ctx.drawImage(baseTexture.image, 0, 0, canvas.width, canvas.height);
          } catch (e) {
            console.warn('Failed to draw base texture:', e);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
          }
        } else {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        
        // If no overlays, return immediately
        if (!overlayImages || overlayImages.length === 0) {
          const texture = new THREE.CanvasTexture(canvas);
          texture.encoding = THREE[CONFIG.TEXTURE.ENCODING];
          texture.needsUpdate = true;
          resolve(texture);
          return;
        }
        
        // Load all overlay images
        const imageLoadPromises = overlayImages.map(overlay => {
          return new Promise((resolveImg) => {
            const img = new Image();
            img.onload = () => resolveImg({ img, overlay });
            img.onerror = () => {
              console.warn(`Failed to load overlay: ${overlay.name}`);
              resolveImg(null);
            };
            img.src = overlay.imageData;
          });
        });
        
        // Draw overlays once loaded
        Promise.all(imageLoadPromises)
          .then(loadedImages => {
            const successCount = loadedImages.filter(i => i !== null).length;
            log(`Loaded ${successCount} overlay images successfully`);
            
            loadedImages.forEach((item, index) => {
              if (!item) {
                log(`Overlay ${index + 1} failed to load`, true);
                return;
              }
              
              const { img, overlay } = item;
              const x = (overlay.position.x / 100) * canvas.width;
              const y = (overlay.position.y / 100) * canvas.height;
              const w = (overlay.size.w / 100) * canvas.width;
              const h = (overlay.size.h / 100) * canvas.height;
              
              log(`Drawing overlay ${index + 1} at x:${Math.round(x)}, y:${Math.round(y)}, w:${Math.round(w)}, h:${Math.round(h)}`);
              
              ctx.save();
              ctx.translate(x, y);
              ctx.rotate((overlay.rotation * Math.PI) / 180);
              ctx.drawImage(img, -w/2, -h/2, w, h);
              ctx.restore();
            });
            
            // Create texture
            const texture = new THREE.CanvasTexture(canvas);
            texture.encoding = THREE[CONFIG.TEXTURE.ENCODING];
            texture.needsUpdate = true;
            
            resolve(texture);
          })
          .catch(err => {
            console.error('Composite texture error:', err);
            reject(err);
          });
      };

      // Wait for base texture if needed
      if (baseTexture && baseTexture.image) {
        const isCanvas = baseTexture.image instanceof HTMLCanvasElement;
        const isImage = baseTexture.image instanceof HTMLImageElement;
        const isComplete = isImage ? baseTexture.image.complete : true;
        
        log(`Base texture type: ${isCanvas ? 'Canvas' : isImage ? 'Image' : 'Unknown'}, ready: ${isComplete}`);
        
        if (isCanvas || isComplete) {
          log(`Drawing composite immediately (base texture ready)`);
          drawComposite();
        } else {
          log(`Waiting for base texture to load...`);
          baseTexture.image.onload = () => {
            log(`Base texture loaded, drawing composite`);
            drawComposite();
          };
          baseTexture.image.onerror = () => {
            log(`Base texture failed to load, using white`, true);
            drawComposite();
          };
        }
      } else {
        log(`No base texture, drawing with white background`);
        drawComposite();
      }
    });
  }
}