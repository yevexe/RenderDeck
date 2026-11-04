export function startRenderLoop({
  cameraManager,
  propManager,
  rendererManager,
  sceneManager,
  getPerformanceModeEnabled,
  markNeedsRender,
  getRenderBurst,
  ensureRenderBurst,
  consumeRenderBurst,
}) {
  document.addEventListener('input', () => markNeedsRender(4), { passive: true, capture: true });
  document.addEventListener('change', () => markNeedsRender(4), { passive: true, capture: true });

  function animate() {
    requestAnimationFrame(animate);
    const cameraMoved = cameraManager.update();
    if (cameraMoved && getRenderBurst() < 4) ensureRenderBurst(4);

    if (getRenderBurst() > 0) {
      if (propManager.hasOutlines()) propManager.updateOutlines(getPerformanceModeEnabled());
      rendererManager.render(sceneManager.getScene(), cameraManager.getCamera());
      consumeRenderBurst();
    }
  }

  animate();
}
