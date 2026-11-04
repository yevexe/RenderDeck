export function renderPBRMap({
  ctx,
  width,
  height,
  bgValue,
  fgValue,
  bgImage = null,
  bgScale = 1,
  wrapImages,
  overlayImages,
  maskCanvas,
  maskContext,
  drawTextureImage,
}) {
  ctx.clearRect(0, 0, width, height);

  const wrapOffsets = wrapImages
    ? [[-width,-height],[-width,0],[-width,height],[0,-height],[0,0],[0,height],[width,-height],[width,0],[width,height]]
    : [[0, 0]];

  if (bgImage?.image) {
    drawTextureImage(ctx, bgImage, width, height);
    if (bgScale !== 1) {
      const value = Math.round(Math.max(0, Math.min(1, bgScale)) * 255);
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = `rgb(${value},${value},${value})`;
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'source-over';
    }
  } else {
    const background = Math.round(bgValue);
    ctx.fillStyle = `rgb(${background},${background},${background})`;
    ctx.fillRect(0, 0, width, height);
  }

  if (overlayImages.length > 0) {
    if (maskCanvas.width !== width || maskCanvas.height !== height) {
      maskCanvas.width = width;
      maskCanvas.height = height;
    } else {
      maskContext.clearRect(0, 0, width, height);
    }

    [...overlayImages].reverse().forEach(img => {
      const x = (img.position.x / 100) * width;
      const y = (img.position.y / 100) * height;
      const imageWidth = (img.size.w / 100) * width;
      const imageHeight = (img.size.h / 100) * height;
      wrapOffsets.forEach(([dx, dy]) => {
        maskContext.save();
        maskContext.translate(x + dx, y + dy);
        maskContext.rotate((img.rotation * Math.PI) / 180);
        if (img.flipH) maskContext.scale(-1, 1);
        if (img.flipV) maskContext.scale(1, -1);
        maskContext.drawImage(img.image, -imageWidth / 2, -imageHeight / 2, imageWidth, imageHeight);
        maskContext.restore();
      });
    });

    const foreground = Math.round(fgValue);
    maskContext.globalCompositeOperation = 'source-in';
    maskContext.fillStyle = `rgb(${foreground},${foreground},${foreground})`;
    maskContext.fillRect(0, 0, width, height);
    maskContext.globalCompositeOperation = 'source-over';
    ctx.drawImage(maskCanvas, 0, 0);
  }
}
