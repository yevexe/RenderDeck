// MaterialState.js — undo/redo for material property changes

import { HistoryManager } from '../ui/HistoryManager.js';
import { renderHistoryList } from './historyUtils.js';

export class MaterialStateManager {
  /**
   * @param {object}   deps
   * @param {object}   deps.materialManager
   * @param {function} deps.getControls      - () => controls (lazy getter — controls may init after this)
   * @param {function} deps.getActiveMesh    - () => activeMesh
   * @param {function} deps.markNeedsRender  - markNeedsRender(frames)
   */
  constructor({ materialManager, getControls, getActiveMesh, markNeedsRender, getUVEditor, getPresetName, getChannelMaps, applyChannelMaps }) {
    this.materialManager  = materialManager;
    this.getControls      = getControls;
    this.getActiveMesh    = getActiveMesh;
    this.markNeedsRender  = markNeedsRender;
    this.getUVEditor      = getUVEditor || (() => null);
    this.getPresetName    = getPresetName || (() => null);
    this.getChannelMaps   = getChannelMaps   || null;
    this.applyChannelMaps = applyChannelMaps || null;

    this.history = new HistoryManager(50);
    this.history.onChange(() => this.updateUI());

    this.onChanged = null; // optional callback — fired after every push or restore
  }

  // ── Snapshot ────────────────────────────────────────────────────
  snapshot() {
    const mesh = this.getActiveMesh();
    if (!mesh?.material) return { materialProperties: null };

    const mat = mesh.material;
    const uv = this.getUVEditor();
    const stickerActive = uv && uv._origMetalness !== null;

    // Temporarily restore real values before extracting
    if (stickerActive) {
      mat.metalness = uv._origMetalness;
      mat.roughness = uv._origRoughness;
      if (uv._origTransmission !== null) mat.transmission = uv._origTransmission;
      if (uv._origColor && mat.color) mat.color.set(uv._origColor);
    }

    const props = this.materialManager.extractProperties(mat);

    // Restore overridden values
    if (stickerActive) {
      mat.metalness = 1.0;
      mat.roughness = 1.0;
      // Use _liveTransmissionTexture (not _origTransmission > 0) — the user may have
      // slid transmission to 0 which sets _origTransmission = 0, but the sticker override
      // is still 1.0 as long as the live texture exists.
      if (uv._liveTransmissionTexture) mat.transmission = 1.0;
      if (mat.color) mat.color.set(0xffffff);
    }

    return {
      materialProperties: props,
      presetName:   this.getPresetName(),
      channelMaps:  this.getChannelMaps?.() ?? undefined,
    };
  }

  // ── History operations ──────────────────────────────────────────
  init(label = 'Initial state') {
    this.history.init(this.snapshot(), label);
  }

  push(label) {
    this.history.push(this.snapshot(), label);
    this.onChanged?.();
  }

  // ── Restore ─────────────────────────────────────────────────────
  restore(state) {
    if (!state) return;
    const mesh = this.getActiveMesh();
    if (state.materialProperties && mesh?.material) {
      const uv = this.getUVEditor();
      const stickerActive = uv && uv._origMetalness !== null;

      this.materialManager.applySavedProperties(mesh.material, state.materialProperties);

      // When sticker PBR maps are active, update the stored originals
      // and re-override the material so the maps keep working
      if (stickerActive) {
        const p = state.materialProperties;
        if (p.metalness !== undefined) uv._origMetalness = p.metalness;
        if (p.roughness !== undefined) uv._origRoughness = p.roughness;
        if (p.transmission !== undefined) uv._origTransmission = p.transmission;
        if (p.color !== undefined) {
          uv._origColor = p.color;
          uv._materialBaseColor = p.color;
        }

        // Re-override material for sticker PBR
        mesh.material.metalness = 1.0;
        mesh.material.roughness = 1.0;
        if (uv._liveTransmissionTexture) mesh.material.transmission = 1.0;
        if (mesh.material.color) mesh.material.color.set(0xffffff);

        // Re-render PBR maps and composite with new base values
        uv._renderStickerPBRMaps();
        uv._renderComposite();
        if (uv._liveMetalnessTexture) uv._liveMetalnessTexture.needsUpdate = true;
        if (uv._liveRoughnessTexture) uv._liveRoughnessTexture.needsUpdate = true;
        if (uv._liveTransmissionTexture) uv._liveTransmissionTexture.needsUpdate = true;
      }

      mesh.material.needsUpdate = true;

      // Sync UI with real values, not overridden sticker PBR values
      if (stickerActive) {
        mesh.material.metalness = uv._origMetalness;
        mesh.material.roughness = uv._origRoughness;
        if (uv._origTransmission !== null) mesh.material.transmission = uv._origTransmission;
        if (uv._origColor && mesh.material.color) mesh.material.color.set(uv._origColor);
      }
      this.getControls()?.syncMaterialUI(mesh.material);
      if (stickerActive) {
        mesh.material.metalness = 1.0;
        mesh.material.roughness = 1.0;
        if (uv._liveTransmissionTexture) mesh.material.transmission = 1.0;
        if (mesh.material.color) mesh.material.color.set(0xffffff);
      }

      if (state.presetName) {
        mesh.material.name = state.presetName;
        this.getControls()?.setMaterialPresetValue(state.presetName);
      }

      // Restore channel textures if captured in this snapshot (async — UI syncs in callback)
      if (state.channelMaps !== undefined) {
        this.applyChannelMaps?.(state.channelMaps);
      }

      this.markNeedsRender(4);
      this.onChanged?.();
    }
  }

  // ── UI ──────────────────────────────────────────────────────────
  setupUI() {
    document.getElementById('mat-undo-btn')?.addEventListener('click', () => {
      const state = this.history.undo();
      if (state) this.restore(state);
      this.updateUI();
    });
    document.getElementById('mat-redo-btn')?.addEventListener('click', () => {
      const state = this.history.redo();
      if (state) this.restore(state);
      this.updateUI();
    });
  }

  updateUI() {
    const undoBtn = document.getElementById('mat-undo-btn');
    const redoBtn = document.getElementById('mat-redo-btn');
    if (undoBtn) undoBtn.disabled = !this.history.canUndo();
    if (redoBtn) redoBtn.disabled = !this.history.canRedo();
    renderHistoryList('mat-history-list', this.history, (idx) => {
      const state = this.history.jumpTo(idx);
      if (state) this.restore(state);
      this.updateUI();
    });
  }
}
