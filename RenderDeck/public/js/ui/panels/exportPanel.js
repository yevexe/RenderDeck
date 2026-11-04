import * as THREE from 'three';
import { renderImage, renderExr } from '../../io/files/imageExport.js';
import { buildModelPackage } from '../../io/files/modelExport.js';
import { buildProjectFile, importProjectFile } from '../../io/files/projectFile.js';
import { downloadBlob, safeFileName } from '../../utils/helpers.js';

export function setupExportPanel({
  rendererManager,
  sceneManager,
  cameraManager,
  getGradientBackground,
  getExportOverlays,
  markNeedsRender,
  log,
  logError,
  logSuccess,
  logWarn,
  getActiveProject,
  getActiveProjectIdSync,
  saveThumbnailToProject,
  getActiveModel,
  clearHighlight,
  getCurrentModelName,
  standardEnvironments,
  getCurrentEnvironment,
  uvEditor,
  materialLibrary,
  libIdOf,
  materialManager,
  scheduleSessionSave,
  scheduleProjectSettingsSave,
  flushWrites,
  getFailedWrites,
  retryFailedWrites,
  onWriteStateChange,
  getWriteState,
}) {
  // The output size in pixels. "Use Selected Resolution" gives exact pixels; otherwise the
  // viewport's size, at full device pixel ratio with "Force Full Quality" and at the
  // current render scale without it.
  function _exportImageSize() {
    const renderer = rendererManager.getRenderer();
    if (document.getElementById('export-use-preview-res')?.checked) {
      const selected = document.getElementById('resolution-select')?.value.match(/^(\d+)x(\d+)$/);
      if (selected) return { width: Number(selected[1]), height: Number(selected[2]) };
    }
    const fullQuality = document.getElementById('export-full-quality')?.checked;
    const pixelRatio = fullQuality ? (window.devicePixelRatio || 1) : renderer.getPixelRatio();
    const size = renderer.getSize(new THREE.Vector2());
    return { width: Math.round(size.x * pixelRatio), height: Math.round(size.y * pixelRatio) };
  }

  async function _exportFileName(suffix, ext) {
    const project = await getActiveProject();
    return `renderdeck-${safeFileName(project?.name || 'project')}-${suffix}.${ext}`;
  }

  async function exportImage(format) {
    const scene = sceneManager.getScene();
    const transparentChecked = !!document.getElementById('export-transparent-bg')?.checked;
    const transparent = transparentChecked && format !== 'jpg';
    // Without an HDR background the viewport shows a CSS background behind the canvas
    const backgroundCss = getGradientBackground(scene);
    const options = {
      format,
      rendererManager,
      scene,
      camera: cameraManager.getCamera(),
      overlays: getExportOverlays(),
      ..._exportImageSize(),
      transparent,
      usePostFX: !!document.getElementById('export-include-postfx')?.checked && rendererManager.postFXEnabled,
      backgroundCss,
    };

    if (format === 'exr' && backgroundCss && !transparent) {
      logWarn('EXR files can\'t include the gradient background: it is left transparent');
    }
    const blob = await (format === 'exr' ? renderExr(options) : renderImage(options));
    markNeedsRender(4);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = await _exportFileName(timestamp, format);
    downloadBlob(filename, blob);
    logSuccess(`Exported: ${filename} (${options.width} × ${options.height})`);
  }

  async function downloadProjectThumbnail() {
    const pid = getActiveProjectIdSync();
    let dataUrl = (await getActiveProject())?.thumbnail;
    if (!dataUrl) {
      logWarn('This project has no thumbnail yet: press Capture Thumbnail first');
      return;
    }
    let blob = await (await fetch(dataUrl)).blob();
    // Thumbnails saved by older versions are stretched to 16:9: replace them with a square one
    const image = await createImageBitmap(blob);
    const isSquare = image.width === image.height;
    image.close();
    if (!isSquare) {
      if (!await saveThumbnailToProject(pid)) {
        logError('Could not replace the old thumbnail');
        return;
      }
      dataUrl = (await getActiveProject())?.thumbnail;
      blob = await (await fetch(dataUrl)).blob();
    }
    const filename = await _exportFileName('thumbnail', 'jpg');
    downloadBlob(filename, blob);
    logSuccess(`Exported: ${filename}`);
  }

  async function exportModelPackage(format) {
    const activeModel = getActiveModel();
    if (!activeModel) {
      logWarn('Load a model before exporting it');
      return;
    }
    clearHighlight();
    const modelName = getCurrentModelName() || 'model';
    const checked = id => !!document.getElementById(id)?.checked;
    const includeDesigns = checked('export-include-decals');
    const environment = checked('export-include-env')
      ? standardEnvironments.find(env => env.label === getCurrentEnvironment())
      : null;

    const { blob, ext, warnings } = await buildModelPackage({
      format,
      model: activeModel,
      baseName: safeFileName(modelName).replace(/\s+/g, '_'),
      getPartMaterial: mesh => ({
        material: uvEditor.getExportMaterial(mesh, includeDesigns),
        presetName: materialLibrary.get(libIdOf(mesh))?.name ?? null,
      }),
      extractProperties: material => materialManager.extractProperties(material),
      embedTextures: checked('export-embed-textures'),
      includeMaterialJson: checked('export-include-material-json'),
      environment: environment
        ? { path: environment.path, fileName: environment.path.split('/').pop() }
        : null,
    });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `renderdeck-${safeFileName(modelName)}-${timestamp}.${ext}`;
    downloadBlob(filename, blob);
    warnings.forEach(warning => logWarn(warning));
    logSuccess(`Exported: ${filename}`);
  }

  // Which package options affect a format. Pointing at a format button greys out the rest.
  function _modelOptionsFor(format) {
    const isZip = format === 'obj' || format === 'zip'
      || (format === 'gltf' && !document.getElementById('export-embed-textures')?.checked);
    return {
      'export-embed-textures': format === 'gltf',
      'export-include-env': isZip,
      'export-include-material-json': isZip,
      'export-include-decals': true,
    };
  }

  function _setupModelExportButtons() {
    const formats = ['glb', 'gltf', 'obj', 'zip'];
    const buttons = formats.map(format => document.getElementById(`export-${format}-btn`));
    const showOptions = (format) => {
      const applies = format ? _modelOptionsFor(format) : null;
      ['export-embed-textures', 'export-include-env', 'export-include-material-json', 'export-include-decals'].forEach(id => {
        const option = document.getElementById(id);
        if (option) option.disabled = !!applies && !applies[id];
      });
    };
    formats.forEach((format, i) => {
      const button = buttons[i];
      if (!button) return;
      button.addEventListener('pointerenter', () => showOptions(format));
      button.addEventListener('pointerleave', () => showOptions(null));
      button.addEventListener('focus', () => showOptions(format));
      button.addEventListener('blur', () => showOptions(null));
      button.addEventListener('click', async () => {
        showOptions(null);
        buttons.forEach(b => { if (b) b.disabled = true; });
        try {
          await exportModelPackage(format);
        } catch (err) {
          logError(`Export failed: ${err.message}`);
        } finally {
          buttons.forEach(b => { if (b) b.disabled = false; });
        }
      });
    });
  }

  // Write everything still pending. Returns the labels of anything that couldn't be saved.
  async function _flushProjectWrites() {
    scheduleSessionSave();
    scheduleProjectSettingsSave();
    await flushWrites();
    return getFailedWrites();
  }

  async function saveProject() {
    retryFailedWrites();
    const failed = await _flushProjectWrites();
    if (failed.length) logError(`Could not save: ${failed.join(', ')}`);
    else logSuccess('Project saved');
  }

  async function downloadProject() {
    const failed = await _flushProjectWrites();
    if (failed.length) logWarn(`The file won't include unsaved changes to: ${failed.join(', ')}`);
    const project = await getActiveProject();
    const blob = await buildProjectFile(project.id, {
      includeImages: !!document.getElementById('project-include-images')?.checked,
    });
    const filename = `${safeFileName(project.name) || 'project'}.rdo`;
    downloadBlob(filename, blob);
    logSuccess(`Exported: ${filename}`);
  }

  async function loadProject(file) {
    await _flushProjectWrites();
    const project = await importProjectFile(file);
    logSuccess(`Loaded project: ${project.name}`);
    window.location.href = 'index.html';
  }

  function _setupProjectButtons() {
    const saveBtn = document.getElementById('save-project-btn');
    const downloadBtn = document.getElementById('download-project-btn');
    const loadBtn = document.getElementById('load-project-btn');
    const fileInput = document.getElementById('project-file-input');
    const buttons = [saveBtn, downloadBtn, loadBtn];
    const run = async (task, failureText) => {
      buttons.forEach(b => { if (b) b.disabled = true; });
      try {
        await task();
      } catch (err) {
        logError(`${failureText}: ${err.message}`);
      } finally {
        buttons.forEach(b => { if (b) b.disabled = false; });
      }
    };
    const SAVE_LABELS = { saved: 'All changes saved', saving: 'Saving…', failed: 'Save failed — Retry' };
    const showWriteState = (state) => {
      if (!saveBtn) return;
      saveBtn.textContent = SAVE_LABELS[state];
      saveBtn.classList.toggle('save-failed', state === 'failed');
    };
    onWriteStateChange(showWriteState);
    showWriteState(getWriteState());

    saveBtn?.addEventListener('click', () => run(saveProject, 'Could not save the project'));
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        run(saveProject, 'Could not save the project');
      }
    });
    downloadBtn?.addEventListener('click', () => run(downloadProject, 'Could not download the project'));
    loadBtn?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', () => {
      const file = fileInput.files[0];
      fileInput.value = '';
      if (file) run(() => loadProject(file), 'Could not load the project');
    });
  }

  function setupExportUI() {
    _setupModelExportButtons();
    _setupProjectButtons();

    const formats = ['jpg', 'png', 'webp', 'exr'];
    const buttons = formats.map(format => document.getElementById(`export-${format}-btn`));
    formats.forEach((format, i) => {
      buttons[i]?.addEventListener('click', async () => {
        buttons.forEach(b => { if (b) b.disabled = true; });
        try {
          await exportImage(format);
        } catch (err) {
          logError(`Export failed: ${err.message}`);
        } finally {
          buttons.forEach(b => { if (b) b.disabled = false; });
        }
      });
    });

    document.getElementById('capture-thumbnail-btn')?.addEventListener('click', async () => {
      if (await saveThumbnailToProject(getActiveProjectIdSync())) logSuccess('Thumbnail saved');
      else logError('Could not save the thumbnail');
    });
    document.getElementById('download-thumbnail-btn')?.addEventListener('click', async () => {
      try {
        await downloadProjectThumbnail();
      } catch (err) {
        logError(`Could not download the thumbnail: ${err.message}`);
      }
    });
  }

  setupExportUI();
}
