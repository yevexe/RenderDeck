export function setupModelLibraryPanel({
  modelManager,
  getActiveModel,
  log,
  logSuccess,
  logWarn,
  logError,
  updateModelList,
  loadModel,
  getCurrentModelName,
  exportSingleModel,
  exportModelData,
  importCustomModels,
  uvEditor,
  collectModelParts,
  flushWrites,
  updateMaterialPresetList,
  scheduleAllMissingThumbnails,
  selectModelInDropdown,
  deleteModelsFromLibrary,
  registerBuiltInModels,
  materialLibrary,
  clearMaterialThumbnail,
}) {
  async function onUploadModel(files) {
    if (!files?.length) return;
    const result = await modelManager.addModelFromFiles(files);
    if (result.success) {
      logSuccess(`Model added: ${result.name}`);
      result.warnings.forEach(w => logWarn(w));
      await updateModelList();
      loadModel(result.name);
    } else {
      result.errors.forEach(e => logError(e));
    }
  }

  async function onExport() {
    const name = getCurrentModelName();
    if (!name) { logError('No model selected'); return; }
    const data = await modelManager.getModel(name);
    if (data?.type === 'custom') {
      if (await exportSingleModel(modelManager.storage, name)) logSuccess(`Exported: ${name}`);
    } else if (getActiveModel()) {
      const exportName = `${name} (Custom)`;
      const exported = await exportModelData(modelManager.storage, exportName, {
        basedOn: name,
        customName: exportName,
        sourceType: 'standard',
        sceneState: uvEditor.sceneState || null,
        parts: await collectModelParts(),
      });
      if (exported) logSuccess(`Exported: ${exportName}`);
    }
  }

  async function onImport(files) {
    if (!files?.length) return;
    const file = files[0];
    if (!file.name.endsWith('.json') && !file.name.endsWith('.renderdeck.json')) {
      logError('Please select a .json or .renderdeck.json file');
      return;
    }
    await flushWrites();
    const result = await importCustomModels(modelManager.storage, file, { hasModel: name => modelManager.models.has(name) });
    if (result.success) {
      await modelManager.restoreImportedBaseModels(result.newBaseModels);
      result.imported.forEach(({ name, originalName }) => logSuccess(name === originalName
        ? `Imported: ${name}`
        : `Imported "${originalName}" as "${name}": a standard or uploaded model already has that name`));
      for (const baseName of result.newBaseModels) {
        const catalog = await modelManager.readUploadedCatalog(baseName).catch(() => null);
        if (catalog) await materialLibrary.addCatalog(catalog);
      }
      updateMaterialPresetList();
      scheduleAllMissingThumbnails();
      await updateModelList();
      let loadable = null;
      for (const { name, basedOn } of result.imported) {
        if (await modelManager.getLoadingPaths(basedOn)) loadable ??= name;
        else logWarn(`Imported "${name}", but its base model "${basedOn}" isn't in this project. Upload ${basedOn} to use it.`);
      }
      if (loadable) {
        loadModel(loadable);
        selectModelInDropdown(loadable);
      }
    } else {
      logError(`Import failed: ${result.error}`);
    }
  }

  async function onClearCustom() {
    const names = await modelManager.storage.getAllCustomModelNames();
    if (names.length === 0) { log('No custom models to clear'); return; }
    if (!confirm(`Delete all ${names.length} custom model(s) and their saved designs and materials? This cannot be undone!`)) return;
    if (await deleteModelsFromLibrary(names)) logSuccess(`Cleared ${names.length} custom model(s)`);
  }

  async function onDeleteModel(name) {
    const dependents = await modelManager.getCustomModelsBasedOn(name);
    const extra = dependents.length
      ? `\n\nThese custom models are based on it and will also be deleted:\n${dependents.map(n => `• ${n}`).join('\n')}`
      : '';
    if (!confirm(`Delete "${name}" and its saved designs and materials?${extra}\n\nThis cannot be undone.`)) return;
    if (await deleteModelsFromLibrary([name, ...dependents])) logSuccess(`Deleted: ${[name, ...dependents].join(', ')}`);
  }

  async function onRestoreStandard() {
    registerBuiltInModels();
    await flushWrites();
    let restored = [];
    try {
      restored = await materialLibrary.restoreDeletedNatives();
    } catch (err) {
      logError(`Could not restore object materials: ${err.message}`);
    }
    restored.forEach(clearMaterialThumbnail);
    updateMaterialPresetList();
    scheduleAllMissingThumbnails();
    await updateModelList();
    logSuccess('Standard objects restored');
  }

  return { onUploadModel, onExport, onImport, onClearCustom, onDeleteModel, onRestoreStandard };
}
