export function setupDragAndDrop({
  container,
  modelManager,
  updateModelList,
  loadModel,
  getActiveMesh,
  uvEditor,
  logError,
  logWarn,
}) {
  container.addEventListener('dragover', e => {
    e.preventDefault(); e.stopPropagation();
    container.classList.add('drag-over');
  });
  container.addEventListener('dragleave', e => {
    e.preventDefault(); e.stopPropagation();
    container.classList.remove('drag-over');
  });
  window.addEventListener('dragover', event => {
    if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
  }, true);
  window.addEventListener('drop', async event => {
    const files = Array.from(event.dataTransfer?.files || []);
    if (!files.length) return;
    event.preventDefault();
    document.querySelectorAll('.drag-over').forEach(element => element.classList.remove('drag-over'));
    const isModel = files.some(file => /\.(obj|mtl|glb)$/i.test(file.name));
    const imagesOnly = files.every(file => /\.(png|jpe?g|svg|webp|gif|bmp)$/i.test(file.name));
    if (isModel || !imagesOnly) {
      event.stopImmediatePropagation();
      if (!isModel) { logError(`Unsupported dropped files: ${files.map(file => file.name).join(', ')}`); return; }
      const isModelFile = file => /\.(obj|mtl|glb|png|jpe?g|svg|webp|gif|bmp)$/i.test(file.name);
      files.filter(file => !isModelFile(file)).forEach(file => logWarn(`Skipped ${file.name}: not a model or texture file`));
      const result = await modelManager.addModelFromFiles(files.filter(isModelFile));
      if (!result.success) { result.errors.forEach(logError); return; }
      result.warnings.forEach(logWarn);
      await updateModelList();
      await loadModel(result.name);
      return;
    }
    if (event.target.closest('#design-preview-canvas, .ne-image-drop, .compact-color-picker__extractor-preview')) return;
    if (container.contains(event.target)) {
      event.stopImmediatePropagation();
      if (!getActiveMesh()) { logError('Select a model part before uploading a design.'); return; }
      for (const file of files) await uvEditor.handleImageUpload(file);
    } else logError('Drop design images onto the viewport or an image upload zone.');
  }, true);
}
