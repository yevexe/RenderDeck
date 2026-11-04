import { SketchfabModal } from './SketchfabModal.js';
import { extractModelFromZip } from '../../io/sketchfab/SketchfabLoader.js';
import { appState } from '../../app/appState.js';

export function setupPropsPanel({
  propManager,
  cameraManager,
  sketchfabAPI,
  pushSceneHistory,
  logError,
  scheduleProjectSettingsSave,
  previewQualityPanel,
}) {
  const previewQualityState = appState.previewQuality;
  const propsSelect = document.getElementById('props-select');
  const addPropBtn = document.getElementById('add-prop-btn');
  const importPropBtn = document.getElementById('import-prop-btn');
  const propFileInput = document.getElementById('prop-file-input');
  const deletePropBtn = document.getElementById('delete-prop-btn');
  const clearPropsBtn = document.getElementById('clear-props-btn');
  let refreshPropsSelect = null;

  if (propsSelect) {
    refreshPropsSelect = () => {
      propsSelect.innerHTML = '<option value="" disabled selected>--- Select a Prop ---</option>';
      const categories = {};
      propManager.getAvailableProps().forEach(prop => {
        if (!categories[prop.category]) categories[prop.category] = [];
        categories[prop.category].push(prop);
      });
      Object.entries(categories).forEach(([cat, items]) => {
        const grp = document.createElement('optgroup');
        grp.label = cat;
        items.forEach(p => {
          const opt = document.createElement('option');
          opt.value = p.id;
          opt.textContent = p.name;
          grp.appendChild(opt);
        });
        propsSelect.appendChild(grp);
      });
    };
    refreshPropsSelect();

    addPropBtn?.addEventListener('click', async () => {
      const propId = propsSelect.value;
      if (!propId) return;
      const target = cameraManager.getControls().target;
      await propManager.addProp(propId, { x: target.x, y: target.y, z: target.z });
      propsSelect.value = '';
      pushSceneHistory(`Added prop: ${propId}`);
    });

    importPropBtn?.addEventListener('click', () => propFileInput?.click());

    propFileInput?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const customId = await propManager.uploadCustomProp(file);
        if (!customId) return;

        const name = customId.replace('custom_', '');
        let customGroup = propsSelect.querySelector('optgroup[label="Custom"]');
        if (!customGroup) {
          customGroup = document.createElement('optgroup');
          customGroup.label = 'Custom';
          propsSelect.appendChild(customGroup);
        }
        if (![...customGroup.children].some(option => option.value === customId)) {
          const opt = document.createElement('option');
          opt.value = customId;
          opt.textContent = name;
          customGroup.appendChild(opt);
        }

        propsSelect.value = customId;
        const target = cameraManager.getControls().target;
        await propManager.addProp(customId, { x: target.x, y: target.y, z: target.z });
        pushSceneHistory(`Imported prop: ${name}`);
      } catch (err) {
        logError(`Could not import "${file.name}": ${err.message}`);
      } finally {
        propFileInput.value = '';
      }
    });

    deletePropBtn?.addEventListener('click', () => {
      if (propManager.selectedProp) {
        const id = propManager.selectedProp.id;
        propManager.removeProp(id);
        pushSceneHistory(`Removed prop: ${id}`);
      }
    });

    clearPropsBtn?.addEventListener('click', () => {
      if (confirm('Clear all props?')) {
        propManager.clearAllProps();
        pushSceneHistory('Cleared all props');
      }
    });

    const sketchfabModal = new SketchfabModal(sketchfabAPI, {
      onImportProp: async (uid, name) => {
        const downloads = await sketchfabAPI.getDownloadUrls(uid);
        const info = downloads.glb ?? downloads.gltf ?? downloads.source;
        if (!info?.url) throw new Error('No downloadable format available for this model.');
        const zipData = await sketchfabAPI.fetchZip(info.url);
        const blobUrl = await extractModelFromZip(zipData);
        const propId = await propManager.saveBlobProp(`sketchfab_${uid}`, blobUrl, uid, name);
        URL.revokeObjectURL(blobUrl);
        if (!propId) throw new Error('Could not store Sketchfab prop.');
        const target = cameraManager.getControls().target;
        await propManager.addProp(propId, { x: target.x, y: target.y, z: target.z });

        let sfGroup = propsSelect.querySelector('optgroup[label="Sketchfab"]');
        if (!sfGroup) {
          sfGroup = document.createElement('optgroup');
          sfGroup.label = 'Sketchfab';
          propsSelect.appendChild(sfGroup);
        }
        const opt = document.createElement('option');
        opt.value = propId;
        opt.textContent = name;
        sfGroup.appendChild(opt);
        pushSceneHistory(`Imported Sketchfab prop: ${name}`);
      },
    });
    document.getElementById('sketchfab-prop-btn')?.addEventListener('click', () => sketchfabModal.open());
  }

  const btnTranslate = document.getElementById('tf-translate');
  const btnRotate = document.getElementById('tf-rotate');
  const btnScale = document.getElementById('tf-scale');
  const btnSnap = document.getElementById('tf-snap');
  const modeBtns = [btnTranslate, btnRotate, btnScale];
  const tsPanel = document.getElementById('transform-sensitivity-panel');
  const tsModes = ['translate', 'rotate', 'scale'];
  tsModes.forEach(m => {
    const slider = document.getElementById(`ts-${m}-slider`);
    const label = document.getElementById(`ts-${m}-value`);
    slider?.addEventListener('input', () => {
      if (label) label.value = parseFloat(slider.value).toFixed(2);
    });
  });

  function closeToolbarPopups() {
    document.querySelectorAll('.toolbar-popup').forEach(p => { p.style.display = 'none'; });
    document.getElementById('tf-grid-settings')?.classList.remove('tf-btn--active');
    document.getElementById('tf-dim-settings')?.classList.remove('tf-btn--active');
    document.getElementById('tf-snap-settings')?.classList.remove('tf-btn--active');
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest('.popup-close-btn')) closeToolbarPopups();
  });

  function activateMode(mode, btn) {
    modeBtns.forEach(b => b?.classList.remove('tf-btn--active'));
    btn?.classList.add('tf-btn--active');
    propManager.setTransformMode(mode);
    scheduleProjectSettingsSave();
    closeToolbarPopups();
    if (tsPanel) {
      tsPanel.style.display = '';
      tsModes.forEach(m => {
        const el = document.getElementById(`ts-${m}`);
        if (el) el.style.display = m === mode ? '' : 'none';
      });
    }
  }

  btnTranslate?.addEventListener('click', () => activateMode('translate', btnTranslate));
  btnRotate?.addEventListener('click', () => activateMode('rotate', btnRotate));
  btnScale?.addEventListener('click', () => activateMode('scale', btnScale));

  const btnSnapSettings = document.getElementById('tf-snap-settings');
  const snapPopup = document.getElementById('snap-settings-popup');
  const snapGridBtn = document.getElementById('snap-grid-btn');
  const snapVertexBtn = document.getElementById('snap-vertex-btn');
  btnSnap?.addEventListener('click', () => {
    previewQualityState.tfSnapOn = !previewQualityState.tfSnapOn;
    btnSnap.classList.toggle('tf-btn--active', previewQualityState.tfSnapOn);
    previewQualityPanel.applySnapState();
    scheduleProjectSettingsSave();
  });
  btnSnapSettings?.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = snapPopup?.style.display !== 'none';
    closeToolbarPopups();
    if (!open) {
      if (snapPopup) snapPopup.style.display = 'block';
      btnSnapSettings.classList.add('tf-btn--active');
    }
  });
  snapGridBtn?.addEventListener('click', () => {
    previewQualityState.tfSnapGrid = !previewQualityState.tfSnapGrid;
    snapGridBtn.classList.toggle('unit-btn--active', previewQualityState.tfSnapGrid);
    previewQualityPanel.applySnapState();
    scheduleProjectSettingsSave();
  });
  snapVertexBtn?.addEventListener('click', () => {
    previewQualityState.tfSnapVertex = !previewQualityState.tfSnapVertex;
    snapVertexBtn.classList.toggle('unit-btn--active', previewQualityState.tfSnapVertex);
    previewQualityPanel.applySnapState();
    scheduleProjectSettingsSave();
  });

  const btnEditMode = document.getElementById('tf-editmode');
  const toolbar = document.getElementById('transform-toolbar');
  function applyEditMode(on) {
    previewQualityState.tfEditModeOn = on;
    propManager.setEditMode(on);
    btnEditMode?.classList.toggle('tf-btn--active', on);
    toolbar?.classList.toggle('tf-locked', !on);
    scheduleProjectSettingsSave();
  }
  btnEditMode?.addEventListener('click', () => applyEditMode(!previewQualityState.tfEditModeOn));
  applyEditMode(false);

  function applyMeasureUnit(unit) {
    previewQualityState.measureUnit = unit;
    propManager.setMeasureUnit(unit);
    const gridSizeInput = document.getElementById('grid-size-input');
    const gridSizeLabel = document.getElementById('grid-size-unit-label');
    const displayVal = parseFloat(gridSizeInput?.value) || 10;
    previewQualityState.tfGridCfg.size = unit === 'in' ? displayVal * 2.54 : displayVal;
    if (gridSizeLabel) gridSizeLabel.textContent = unit === 'in' ? 'in' : 'cm';
    document.getElementById('unit-cm')?.classList.toggle('unit-btn--active', unit === 'cm');
    document.getElementById('unit-in')?.classList.toggle('unit-btn--active', unit === 'in');
    previewQualityPanel.rebuildGrid();
    if (previewQualityState.tfSnapOn) propManager.setSnapEnabled(true, previewQualityPanel.gridSnapStep());
    scheduleProjectSettingsSave();
  }
  document.getElementById('unit-cm')?.addEventListener('click', () => applyMeasureUnit('cm'));
  document.getElementById('unit-in')?.addEventListener('click', () => applyMeasureUnit('in'));

  const btnDimensions = document.getElementById('tf-dimensions');
  const btnDimSettings = document.getElementById('tf-dim-settings');
  const dimPopup = document.getElementById('dim-settings-popup');
  propManager.setShowLabels(false);
  btnDimensions?.addEventListener('click', () => {
    previewQualityState.tfDimLabelsOn = !previewQualityState.tfDimLabelsOn;
    propManager.setShowLabels(previewQualityState.tfDimLabelsOn);
    btnDimensions.classList.toggle('tf-btn--active', previewQualityState.tfDimLabelsOn);
    scheduleProjectSettingsSave();
  });
  btnDimSettings?.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = dimPopup?.style.display !== 'none';
    closeToolbarPopups();
    if (!open) {
      if (dimPopup) dimPopup.style.display = 'block';
      btnDimSettings.classList.add('tf-btn--active');
    }
  });
  document.addEventListener('click', (e) => {
    if (dimPopup && dimPopup.style.display !== 'none' && !dimPopup.contains(e.target) && e.target !== btnDimSettings) {
      dimPopup.style.display = 'none';
      btnDimSettings?.classList.remove('tf-btn--active');
    }
  });

  const btnStyleDefault = document.getElementById('dim-style-default');
  const btnStyleParallel = document.getElementById('dim-style-parallel');
  function applyLabelStyle(parallel) {
    previewQualityState.tfLabelsParallel = parallel;
    propManager.setLabelsParallel(parallel);
    btnStyleDefault?.classList.toggle('unit-btn--active', !parallel);
    btnStyleParallel?.classList.toggle('unit-btn--active', parallel);
    scheduleProjectSettingsSave();
  }
  btnStyleDefault?.addEventListener('click', () => applyLabelStyle(false));
  btnStyleParallel?.addEventListener('click', () => applyLabelStyle(true));

  const btnGrid = document.getElementById('tf-grid');
  btnGrid?.addEventListener('click', () => {
    previewQualityState.tfGridOn = !previewQualityState.tfGridOn;
    previewQualityPanel.rebuildGrid();
    btnGrid.classList.toggle('tf-btn--active', previewQualityState.tfGridOn);
    scheduleProjectSettingsSave();
  });

  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    switch (e.key.toLowerCase()) {
      case 'g': modeBtns.forEach(b => b?.classList.remove('tf-btn--active')); btnTranslate?.classList.add('tf-btn--active'); break;
      case 'r': modeBtns.forEach(b => b?.classList.remove('tf-btn--active')); btnRotate?.classList.add('tf-btn--active'); break;
      case 's':
        if (!e.ctrlKey && !e.metaKey) { modeBtns.forEach(b => b?.classList.remove('tf-btn--active')); btnScale?.classList.add('tf-btn--active'); }
        break;
    }
  });

  return refreshPropsSelect;
}
