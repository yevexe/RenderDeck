import { appState } from '../../app/appState.js';

//═══════════════════════════════════════════════════════════════
// DEBUG INSPECTOR
//═══════════════════════════════════════════════════════════════

function _dbgBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(2) + ' MB';
}

function _dbgFmtVal(val) {
  if (val === null || val === undefined) return '<span class="dbg-val-null">null</span>';
  if (typeof val === 'boolean') return `<span class="dbg-val-bool">${val}</span>`;
  if (typeof val === 'number')  return `<span class="dbg-val-num">${Number.isInteger(val) ? val : val.toFixed(4)}</span>`;
  if (typeof val === 'object')  return `<span class="dbg-val-obj">{…}</span>`;
  const s = String(val);
  // hex color swatch
  if (/^#[0-9a-fA-F]{6}$/.test(s)) {
    return `<span class="dbg-color-swatch" style="background:${s}"></span><span class="dbg-val-str">${s}</span>`;
  }
  const display = s.length > 72 ? s.slice(0, 69) + '…' : s;
  return `<span class="dbg-val-str" title="${s.replace(/"/g,'&quot;')}">${display}</span>`;
}

function _dbgKVRows(obj) {
  if (!obj || typeof obj !== 'object') return '<div class="dbg-empty">—</div>';
  return '<div class="dbg-kv">' +
    Object.entries(obj).map(([k, v]) =>
      `<div class="dbg-row"><span class="dbg-key">${k}</span><span class="dbg-val">${_dbgFmtVal(v)}</span></div>`
    ).join('') +
  '</div>';
}

async function refreshDebugPanel(dependencies) {
  const { activeModel, activeMesh, cameraState: camState, rendererManager, materialThumbCache: _matThumbCache, channelMapData: _channelMapData } = appState;
  const { IDBStorage, getActiveProjectIdSync, sessionKey, partMaterialKey, APP_SETTINGS_KEY, projectSettingsKey } = dependencies;

  // ── Active model ──────────────────────────────────────────────
  const modelEl    = document.getElementById('dbg-model-table');
  const modelBadge = document.getElementById('dbg-model-badge');
  if (modelEl) {
    let meshCount = 0, vertCount = 0, triCount = 0;
    if (activeModel) {
      activeModel.traverse(c => {
        if (!c.isMesh) return;
        meshCount++;
        const pos = c.geometry?.attributes?.position;
        if (pos) vertCount += pos.count;
        const idx = c.geometry?.index;
        triCount += idx ? idx.count / 3 : (pos ? pos.count / 3 : 0);
      });
    }
    if (modelBadge) modelBadge.textContent = activeModel ? activeModel.name || 'unnamed' : 'none';
    modelEl.innerHTML = _dbgKVRows({
      name:         activeModel?.name             ?? null,
      meshCount:    activeModel ? meshCount        : null,
      vertices:     activeModel ? vertCount        : null,
      triangles:    activeModel ? Math.round(triCount) : null,
      activeMesh:   activeMesh?.name              ?? null,
      material:     activeMesh?.material?.name    ?? null,
      transmission: activeMesh?.material?.transmission ?? null,
      metalness:    activeMesh?.material?.metalness    ?? null,
      roughness:    activeMesh?.material?.roughness    ?? null,
    });
  }

  // ── Session state (IDB) ───────────────────────────────────────
  const sessionEl = document.getElementById('dbg-session-table');
  if (sessionEl) {
    try {
      const pid = getActiveProjectIdSync();
      const s = pid ? await IDBStorage.get('metadata', sessionKey(pid)) : null;
      const pm = (pid && s?.modelName && s?.partName)
        ? await IDBStorage.get('metadata', partMaterialKey(pid, s.modelName, s.partName))
        : null;
      sessionEl.innerHTML = s ? _dbgKVRows({
        key:                sessionKey(pid),
        version:            s.version,
        modelName:          s.modelName,
        partName:           s.partName,
        activeCustomScene:  s.activeCustomScene,
        propCount:          s.props?.length ?? 0,
        hasMainTransform:   !!s.mainModelTransform,
        nodeGraphCount:     Object.keys(s.nodeGraph?.graphs ?? {}).length,
        'part.materialId':  pm?.materialId ?? null,
        'part.fromFile':    pm?.fromFile ?? null,
      }) : '<div class="dbg-empty">No session state in IDB</div>';
    } catch (e) {
      sessionEl.innerHTML = `<div class="dbg-error">${e.message}</div>`;
    }
  }

  // ── Camera state ──────────────────────────────────────────────
  const cameraEl = document.getElementById('dbg-camera-table');
  if (cameraEl) cameraEl.innerHTML = _dbgKVRows(camState);

  // ── Renderer / post-FX state ──────────────────────────────────
  const rendererEl = document.getElementById('dbg-renderer-table');
  if (rendererEl) {
    const rs = rendererManager.getState();
    rendererEl.innerHTML = _dbgKVRows({
      postFXEnabled:           rs.postFXEnabled,
      aaMode:                  rs.aaMode,
      bloomEnabled:            rs.bloomEnabled,
      vignetteEnabled:         rs.vignetteEnabled,
      ssaoEnabled:             rs.ssaoEnabled,
      motionBlurEnabled:       rs.motionBlurEnabled,
      'bloom.strength':        rs.params.bloom.strength,
      'bloom.radius':          rs.params.bloom.radius,
      'bloom.threshold':       rs.params.bloom.threshold,
      'vignette.intensity':    rs.params.vignette.intensity,
      'vignette.softness':     rs.params.vignette.softness,
      'vignette.color':        rs.params.vignette.color,
      'vignette.blendMode':    rs.params.vignette.blendMode,
      'ssao.intensity':        rs.params.ssao.intensity,
      'ssao.radius':           rs.params.ssao.radius,
      'motionBlur.strength':   rs.params.motionBlur.strength,
    });
  }

  // ── Thumbnail cache ───────────────────────────────────────────
  const thumbGrid  = document.getElementById('dbg-thumb-grid');
  const thumbBadge = document.getElementById('dbg-thumb-badge');
  if (thumbGrid) {
    if (thumbBadge) thumbBadge.textContent = `${_matThumbCache.size} cached`;
    thumbGrid.innerHTML = _matThumbCache.size === 0
      ? '<div class="dbg-empty">No thumbnails in memory</div>'
      : [..._matThumbCache.entries()].map(([name, url]) =>
          `<div class="dbg-thumb-item">
            <img src="${url}" class="dbg-thumb-img" title="${name}">
            <div class="dbg-thumb-label">${name}</div>
          </div>`
        ).join('');
  }

  // ── Active channel maps ───────────────────────────────────────
  const channelsEl    = document.getElementById('dbg-channels-table');
  const channelsBadge = document.getElementById('dbg-channels-badge');
  if (channelsEl) {
    if (channelsBadge) channelsBadge.textContent = `${_channelMapData.size} active`;
    if (_channelMapData.size === 0) {
      channelsEl.innerHTML = '<div class="dbg-empty">No channel maps loaded</div>';
    } else {
      channelsEl.innerHTML = '<div class="dbg-kv">' +
        [..._channelMapData.entries()].map(([key, dataUrl]) => {
          const bytes = _dbgBytes(Math.round(dataUrl.length * 0.75));
          const fmt   = dataUrl.slice(5, dataUrl.indexOf(';')) || 'unknown';
          return `<div class="dbg-row">
            <span class="dbg-key">${key}</span>
            <span class="dbg-val">
              <img src="${dataUrl}" class="dbg-channel-preview">
              <span class="dbg-val-num">${bytes}</span>
              <span class="dbg-val-null"> · ${fmt}</span>
            </span>
          </div>`;
        }).join('') +
      '</div>';
    }
  }

  // ── IndexedDB inspector ───────────────────────────────────────
  const idbEl = document.getElementById('dbg-idb-content');
  if (idbEl) {
    try {
      const STORES = [
        ['projects',        'project record'],
        ['models',          'custom model (v3 parts)'],
        ['uploaded-models', 'uploaded model record'],
        ['uploaded-props',  'uploaded prop record'],
        ['uploaded-hdrs',   'uploaded HDR record'],
        ['materials',       'user preset'],
        ['scenes',          'saved scene'],
        ['node-graphs',     'node graph'],
        ['settings',        'settings record'],
        ['metadata',        'JSON'],
        ['blobs',           'blob / data URL'],
      ];
      const allKeys = await Promise.all(STORES.map(([name]) => IDBStorage.getAllKeys(name)));

      const storeBlock = (name, badge, rows) =>
        `<div class="dbg-idb-store">
          <div class="dbg-store-header">
            <span class="dbg-store-name">${name}</span>
            <span class="dbg-badge dbg-badge-idb">${badge}</span>
          </div>
          ${rows}
        </div>`;

      const keyRows = (keys, valLabel) => keys.length
        ? '<div class="dbg-kv">' + keys.map(k =>
            `<div class="dbg-row">
              <span class="dbg-key">${escapeDebugText(k)}</span>
              <span class="dbg-val dbg-val-null">${valLabel}</span>
            </div>`).join('') + '</div>'
        : '<div class="dbg-empty">empty</div>';

      // Group blob keys by their prefix (text before the first ':')
      const blobRows = (keys) => {
        const groups = new Map();
        keys.forEach(k => {
          const g = k.slice(0, k.indexOf(':') + 1) || '(other)';
          if (!groups.has(g)) groups.set(g, []);
          groups.get(g).push(k);
        });
        return [...groups].map(([g, ks]) =>
          `<div class="dbg-store-subheader">${escapeDebugText(g)} (${ks.length})</div>` + keyRows(ks, 'blob')
        ).join('') || '<div class="dbg-empty">empty</div>';
      };

      idbEl.innerHTML = STORES.map(([name, label], i) =>
        storeBlock(name, `${allKeys[i].length} entries`,
          name === 'blobs' ? blobRows(allKeys[i]) : keyRows(allKeys[i], label))
      ).join('');
    } catch (e) {
      idbEl.innerHTML = `<div class="dbg-error">${e.message}</div>`;
    }
  }

  // ── Settings records (IDB settings store) ─────────────────────
  const settingsEl = document.getElementById('dbg-settings-table');
  if (settingsEl) {
    try {
      const pid = getActiveProjectIdSync();
      const [app, proj] = await Promise.all([
        IDBStorage.get('settings', APP_SETTINGS_KEY),
        pid ? IDBStorage.get('settings', projectSettingsKey(pid)) : null,
      ]);
      const token = app?.sketchfabToken;
      settingsEl.innerHTML =
        _dbgKVRows({ storagePersistence: IDBStorage.getPersistentStorageState().status }) +
        `<div class="dbg-store-subheader">settings/app</div>` +
        (app ? _dbgKVRows({
          swatchCollections: app.swatchCollections ? `${app.swatchCollections.length} collections` : null,
          sketchfabToken:    token ? `${token.slice(0, 8)}…` : null,
        }) : '<div class="dbg-empty">not set</div>') +
        `<div class="dbg-store-subheader">settings/${escapeDebugText(pid ?? '—')}</div>` +
        (proj ? _dbgKVRows({
          environment:         proj.environment,
          'camera.focalLength': proj.camera?.focalLength,
          'camera.toneMapping': proj.camera?.toneMapping,
          'camera.dofEnabled':  proj.camera?.dofEnabled,
          hasView:             !!proj.view,
          'renderer.postFX':   proj.renderer?.postFXEnabled,
          'renderer.aaMode':   proj.renderer?.aaMode,
          'background.env':    proj.background?.showEnvBackground,
          'background.preset': proj.background?.currentGradientBg,
          'preview.shadows':   proj.preview?.shadows,
          'preview.wireframe': proj.preview?.wireframe,
          'ui.grid':           proj.ui?.gridOn,
          'ui.snap':           proj.ui?.snapOn,
          'ui.unit':           proj.ui?.measureUnit,
        }) : '<div class="dbg-empty">not set</div>');
    } catch (e) {
      settingsEl.innerHTML = `<div class="dbg-error">${e.message}</div>`;
    }
  }
}

function escapeDebugText(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function setupDebugPanel(dependencies) {
  document.getElementById('dbg-refresh-btn')?.addEventListener('click', () => refreshDebugPanel(dependencies));
  // Auto-refresh when the debug tab is opened
  document.querySelector('button[title="Debug"]')
    ?.addEventListener('click', () => setTimeout(() => refreshDebugPanel(dependencies), 60));
}

