export function createDesignLayers({
  IDBStorage,
  designMetaKey,
  designBlobKey,
  designBlobPartPrefix,
  designThumbKey,
  getActiveProjectIdSync,
  getCurrentModelName,
  getActiveMesh,
  getMeshMap,
  getUVEditor,
  getControls,
  scheduleWrite,
  log,
}) {
  function setObjectSelectThumb(modelName, dataUrl) {
    const controls = getControls();
    const opt = controls?._objSelect?._dropdown?.querySelector(`[data-value="${CSS.escape(modelName)}"]`);
    if (!opt) return;
    const labelRow = opt.querySelector('.custom-select__option-label-row');
    if (!labelRow) return;
    let img = opt.querySelector('.custom-select__option-design-thumb');
    if (!img) {
      img = document.createElement('img');
      img.className = 'custom-select__option-design-thumb';
      img.alt = '';
      labelRow.appendChild(img);
    }
    img.src = dataUrl;
  }

  function scheduleDesignLayerSave(layers, partName = getActiveMesh()?.name) {
    const pid = getActiveProjectIdSync();
    const modelName = getCurrentModelName();
    if (!pid || !modelName || !partName) return;
    const partNames = Object.keys(getMeshMap());
    scheduleWrite(`design:${pid}:${modelName}:${partName}`,
      () => writeDesignLayers(pid, modelName, partName, layers, partNames),
      { label: `design layers (${partName})` });
  }

  async function writeDesignLayers(pid, modelName, partName, layers, partNames) {
    const meta = layers.map(l => ({
      id:          l.id,
      name:        l.name,
      type:        l.type,
      textData:    l.textData,
      position:    l.position,
      size:        l.size,
      rotation:    l.rotation,
      aspectRatio: l.aspectRatio,
      flipH:       l.flipH,
      flipV:       l.flipV,
    }));

    const dataURLs = layers.map(l => getUVEditor().encodeLayerImage(l));
    const blobs = dataURLs.map(d => (d ? IDBStorage.dataURLToBlobSync(d) : null));

    const firstIdx = blobs.findIndex(Boolean);
    let thumbBlob = firstIdx >= 0 ? blobs[firstIdx] : null;
    if (!thumbBlob) {
      for (const p of partNames) {
        if (p === partName) continue;
        const otherMeta = await IDBStorage.get('metadata', designMetaKey(pid, modelName, p)).catch(() => null);
        const first = Array.isArray(otherMeta) ? otherMeta.find(e => e.id != null) : null;
        if (!first) continue;
        thumbBlob = await IDBStorage.get('blobs', designBlobKey(pid, modelName, p, first.id)).catch(() => null);
        if (thumbBlob) break;
      }
    }

    const ops = [{ type: 'delPrefix', store: 'blobs', prefix: designBlobPartPrefix(pid, modelName, partName) }];
    layers.forEach((l, i) => {
      if (blobs[i]) ops.push({ type: 'put', store: 'blobs', key: designBlobKey(pid, modelName, partName, l.id), value: blobs[i] });
    });
    ops.push(meta.length
      ? { type: 'put', store: 'metadata', key: designMetaKey(pid, modelName, partName), value: meta }
      : { type: 'del', store: 'metadata', key: designMetaKey(pid, modelName, partName) });
    ops.push(thumbBlob
      ? { type: 'put', store: 'blobs', key: designThumbKey(pid, modelName), value: thumbBlob }
      : { type: 'del', store: 'blobs', key: designThumbKey(pid, modelName) });
    await IDBStorage.batch(ops);

    if (thumbBlob) {
      setObjectSelectThumb(modelName, firstIdx >= 0 ? dataURLs[firstIdx] : await IDBStorage.blobToDataURL(thumbBlob));
    } else {
      const controls = getControls();
      const opt = controls?._objSelect?._dropdown?.querySelector(`[data-value="${CSS.escape(modelName)}"]`);
      opt?.querySelector('.custom-select__option-design-thumb')?.remove();
    }
  }

  async function loadDesignLayersFromCache(pid, modelName, partName) {
    try {
      const meta = await IDBStorage.get('metadata', designMetaKey(pid, modelName, partName));
      if (!Array.isArray(meta) || meta.length === 0) return null;

      const results = await Promise.all(meta.map(async (entry) => {
        try {
          const blob = await IDBStorage.get('blobs', designBlobKey(pid, modelName, partName, entry.id));
          if (!blob) return null;
          const dataURL = await IDBStorage.blobToDataURL(blob);
          return { ...entry, imageData: dataURL };
        } catch (_) {
          return null;
        }
      }));

      const valid = results.filter(Boolean);
      return valid.length > 0 ? valid : null;
    } catch (err) {
      log(`Could not load design layers for ${partName}: ${err.message}`, true);
      return null;
    }
  }

  return { scheduleDesignLayerSave, loadDesignLayersFromCache, writeDesignLayers };
}
