let renderBurst = 4;

export function markNeedsRender(frames = 4) {
  if (frames > renderBurst) renderBurst = frames;
}

export function getRenderBurst() {
  return renderBurst;
}

export function ensureRenderBurst(frames) {
  if (renderBurst < frames) renderBurst = frames;
}

export function consumeRenderBurst() {
  renderBurst--;
}
