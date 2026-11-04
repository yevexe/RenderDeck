import { CHANNELS } from './MaterialLibrary.js';

export function createMaterialActions({
  getMeshMap,
  libIdOf,
  materialLibrary,
  materialManager,
  uvEditor,
  markNeedsRender,
  logError,
}) {
  function partsUsing(id) {
    return Object.values(getMeshMap()).filter(mesh => libIdOf(mesh) === id);
  }

  function setPartChannel(mesh, channel, texture) {
    mesh.material[channel] = texture;
    mesh.material.needsUpdate = true;
    uvEditor.notifyPartChannelChanged(mesh, channel, texture);
  }

  async function applyDefinitionToLiveParts(id) {
    const entry = materialLibrary.get(id);
    if (!entry) return;
    const applySaved = (material, params) => materialManager.applySavedProperties(material, params);
    for (const mesh of partsUsing(id)) {
      uvEditor.applyPartDefinition(mesh, entry.params, applySaved);
      mesh.material.name = entry.name;
      for (const channel of CHANNELS) {
        let texture;
        try {
          texture = await materialLibrary.channelTexture(id, channel);
        } catch (err) {
          logError(`Could not load ${channel} of "${entry.name}": ${err.message}`);
          continue;
        }
        if (mesh.material && texture !== uvEditor.getPartCleanChannel(mesh, channel)) {
          setPartChannel(mesh, channel, texture ?? null);
        }
      }
    }
    markNeedsRender(8);
  }

  async function setDefinitionChannel(id, channel, value) {
    const entry = materialLibrary.get(id);
    if (!entry) return false;
    const previous = entry.channelMaps[channel] ?? (entry.clearedChannels.includes(channel) ? null : undefined);
    materialLibrary.setChannel(id, channel, value);
    try {
      const texture = await materialLibrary.channelTexture(id, channel);
      for (const mesh of partsUsing(id)) setPartChannel(mesh, channel, texture ?? null);
      return true;
    } catch (err) {
      materialLibrary.setChannel(id, channel, previous);
      logError(`Could not load texture for "${entry.name}": ${err.message}`);
      return false;
    }
  }

  const pendingOtherPartEdits = new Map();
  let otherPartEditTimer = null;

  function flushOtherPartEdits() {
    clearTimeout(otherPartEditTimer);
    otherPartEditTimer = null;
    for (const [mesh, edits] of pendingOtherPartEdits) {
      if (!mesh.material) continue;
      for (const [property, value] of Object.entries(edits)) {
        uvEditor.updatePartMaterial(mesh, property, value);
      }
    }
    pendingOtherPartEdits.clear();
  }

  function applyPropertyToOtherParts(id, property, value, activeMesh) {
    for (const mesh of partsUsing(id)) {
      if (mesh === activeMesh) continue;
      if (!uvEditor.hasPartDesign(mesh)) {
        uvEditor.updatePartMaterial(mesh, property, value);
        continue;
      }
      pendingOtherPartEdits.set(mesh, {
        ...(pendingOtherPartEdits.get(mesh) || {}),
        [property]: value,
      });
      if (!otherPartEditTimer) otherPartEditTimer = setTimeout(flushOtherPartEdits, 100);
    }
  }

  function clearPendingOtherPartEdits() {
    pendingOtherPartEdits.clear();
  }

  return {
    partsUsing,
    setPartChannel,
    applyDefinitionToLiveParts,
    setDefinitionChannel,
    flushOtherPartEdits,
    applyPropertyToOtherParts,
    clearPendingOtherPartEdits,
  };
}
