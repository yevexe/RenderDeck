import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { createGLTFLoader } from '../../engine/gltfLoader.js';
import { catalogFromGltf, catalogFromMtl, readGlbJsonFromUrl, tagFileMaterials } from '../materials/nativeCatalog.js';
import { loadDesignImage } from '../../utils/imageAssets.js';
import { STANDARD_OBJECTS } from '../../config.js';
import { prepareModelParts } from './ModelParts.js';
import { migrateLegacyPart } from '../../storage/migrations.js';
import * as IDBStorage from '../../storage/indexedDBStorage.js';
import { modelTransformKey, partMaterialKey } from '../../storage/storageKeys.js';

export function countModelFaces(model) {
  let faces = 0;
  model.traverse(child => {
    if (!child.isMesh) return;
    const geo = child.geometry;
    if (geo.index) faces += geo.index.count / 3;
    else if (geo.attributes.position) faces += geo.attributes.position.count / 3;
  });
  return Math.round(faces);
}

export function createModelLoading({
  modelManager,
  materialManager,
  materialLibrary,
  materialLibraryReady,
  materialPresetsReady,
  materialState,
  designState,
  sceneManager,
  cameraManager,
  rendererManager,
  propManager,
  uvEditor,
  getActiveProjectIdSync,
  getMeshMap,
  setMeshMap,
  getActiveMesh,
  setActiveMesh,
  getActiveModel,
  setActiveModel,
  getPartCache,
  setPartCache,
  getOriginalCustomDefinitions,
  getPersistenceReady,
  scheduleWrite,
  commitActiveDefinition,
  getBootCamera,
  setBootCamera,
  loadDesignLayersFromCache,
  restoreSceneState,
  convertObjectToPhysical,
  convertToPhysical,
  applyTexQualityToObject,
  clearHighlight,
  cleanupActiveModel,
  updatePartSelection,
  clearPartSelection,
  setActivePartName,
  setSelectedModel,
  syncActiveMaterialView,
  syncChannelView,
  clearChannelMapData,
  updateMaterialPresetList,
  scheduleThumbnailUpdate,
  scheduleAllMissingThumbnails,
  scheduleMatThumbUpdate,
  checkAndApplyPolyPerf,
  onModelReady,
  onModelLoadMessage,
  onModelLoadWarning,
  onModelLoadError,
  getCurrentModelName,
  snapshotCurrentPart,
  serializeDecal,
  markNeedsRender,
  log,
  logError,
  logWarn,
}) {
  const mtlLoader = new MTLLoader();
  const gltfLoader = createGLTFLoader();
  let modelRequest = null;
  const pendingModelLoads = new Map();
  let modelCommit = Promise.resolve();

  function getModelRequest() {
    return modelRequest;
  }

  function getPendingModelLoad(name) {
    return pendingModelLoads.get(name) ?? null;
  }

  function schedulePartMaterialSave() {
    if (!getPersistenceReady()) return;
    const pid = getActiveProjectIdSync();
    const modelName = getCurrentModelName();
    const mesh = getActiveMesh();
    const materialId = libIdOf(mesh);
    if (!pid || !modelName || !materialId) return;
    const record = { version: 2, materialId, fromFile: materialId === mesh.userData.fileMaterialId };
    scheduleWrite(`part-material:${pid}:${modelName}:${mesh.name}`,
      () => IDBStorage.put('metadata', partMaterialKey(pid, modelName, mesh.name), record),
      { label: `material (${mesh.name})` });
    commitActiveDefinition();
  }

  function checkModelRequest(request) {
    if (request !== modelRequest) throw new Error('Superseded model load');
  }

  async function readMissingStandardCatalogs() {
    let added = false;
    for (const object of STANDARD_OBJECTS) {
      if (materialLibrary.hasCatalog(object.label)) continue;
      try {
        if (object.objPath.endsWith('.glb')) {
          await materialLibrary.addCatalog(catalogFromGltf(object.label, await readGlbJsonFromUrl(object.objPath)));
        } else if (object.mtlPath) {
          const response = await fetch(object.mtlPath);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          await materialLibrary.addCatalog(catalogFromMtl(object.label, await response.text()));
        } else {
          continue;
        }
        added = true;
      } catch (err) {
        logError(`Could not list materials of ${object.label}: ${err.message}`);
      }
    }
    if (added) {
      updateMaterialPresetList();
      scheduleAllMissingThumbnails();
    }
  }

  async function backfillUploadedCatalogs() {
    const categories = await modelManager.getModelNamesByCategory();
    for (const name of categories.uploaded || []) {
      if (materialLibrary.hasCatalog(name)) continue;
      try {
        const catalog = await modelManager.readUploadedCatalog(name);
        if (catalog) await materialLibrary.addCatalog(catalog);
      } catch (err) {
        logError(`Could not list materials of ${name}: ${err.message}`);
      }
    }
  }

  async function loadNativeSourcesFromFile(objectName) {
    const paths = await modelManager.getLoadingPaths(objectName);
    const catalog = materialLibrary.getCatalog(objectName);
    if (!paths || !catalog) throw new Error(`${objectName} is not available`);
    const sources = new Map();
    if (paths.type === 'glb-path' || paths.type === 'glb-blob') {
      const gltf = await gltfLoader.loadAsync(paths.obj);
      tagFileMaterials(gltf.scene, catalog, gltf.parser.associations);
      convertObjectToPhysical(gltf.scene);
      gltf.scene.traverse(child => {
        if (!child.isMesh) return;
        child.geometry?.dispose();
        const material = child.material;
        if (material?.userData.libId && !sources.has(material.userData.libId)) sources.set(material.userData.libId, material);
      });
      return sources;
    }
    if (!paths.mtl) throw new Error(`${objectName} has no material file`);
    const response = await fetch(paths.mtl);
    if (!response.ok) throw new Error(`Material download failed: ${response.status}`);
    const materials = mtlLoader.parse(await response.text(), paths.type === 'path' ? paths.mtl.slice(0, paths.mtl.lastIndexOf('/') + 1) : '');
    materials.preload();
    for (const item of catalog.materials) {
      const material = convertToPhysical(materials.create(item.name));
      material.userData.libId = item.id;
      sources.set(item.id, material);
    }
    return sources;
  }

  async function tagLoadedFile(object, objectName, parser, mtlText) {
    await materialLibraryReady;
    if (!materialLibrary.hasCatalog(objectName)) {
      const catalog = parser ? catalogFromGltf(objectName, parser.json) : (mtlText ? catalogFromMtl(objectName, mtlText) : null);
      if (catalog) {
        await materialLibrary.addCatalog(catalog);
        updateMaterialPresetList();
      }
    }
    const catalog = materialLibrary.getCatalog(objectName);
    if (catalog) tagFileMaterials(object, catalog, parser?.associations);
  }

  async function prefetchStandardModels() {
    try {
      await IDBStorage.del('metadata', 'standard-models-prefetched');
      void IDBStorage.requestPersistentStorage();
      await modelManager.storeStandardModels();
    } catch (err) {
      if (IDBStorage.isQuotaError(err)) logWarn('Storage is full, so standard models will keep downloading when opened.');
      else console.warn('Standard model prefetch failed:', err);
    }
  }

  function disposeLoadedModel(object) {
    const resources = new Set();
    object?.traverse(child => {
      if (child.geometry) resources.add(child.geometry);
      for (const material of [child.material].flat().filter(Boolean)) {
        resources.add(material);
        Object.values(material).forEach(value => { if (value?.isTexture) resources.add(value); });
      }
    });
    resources.forEach(resource => resource.dispose());
  }

  function loadModel(name, onLoaded = null) {
    if (pendingModelLoads.has(name)) {
      modelRequest = pendingModelLoads.get(name);
      const request = modelRequest;
      return onLoaded ? request.promise.then(ready => {
        if (ready && request === modelRequest) onLoaded(getActiveModel());
        return ready;
      }) : request.promise;
    }
    const request = { name };
    pendingModelLoads.set(name, request);
    modelRequest = request;
    console.log(`Loading ${name}`);
    request.promise = (async () => {
      let object;
      try {
        request.data = await modelManager.getModel(name);
        if (!request.data) throw new Error(`Model not found: ${name}`);
        const paths = await modelManager.getLoadingPaths(name);
        checkModelRequest(request);
        const glb = paths.type === 'glb-path' || paths.type === 'glb-blob';
        const requestOBJLoader = new OBJLoader().setMaterials(null);
        let mtlText = null;
        let parser = null;
        if (!glb) {
          if (paths.mtl) {
            try {
              const text = await fetch(paths.mtl).then(response => {
                if (!response.ok) throw new Error(`Material download failed: ${response.status}`);
                return response.text();
              });
              mtlText = text;
              const materials = mtlLoader.parse(text, paths.type === 'path' ? paths.mtl.slice(0, paths.mtl.lastIndexOf('/') + 1) : '');
              materials.preload();
              requestOBJLoader.setMaterials(materials);
            } catch (err) {
              onModelLoadWarning(`MTL could not be loaded: ${err.message}; using the default material.`);
              paths.mtl = null;
            }
          }
        }
        if (glb) {
          const gltf = await gltfLoader.loadAsync(paths.obj);
          object = gltf.scene;
          parser = gltf.parser;
        } else {
          object = await requestOBJLoader.loadAsync(paths.obj);
        }
        request.object = object;
        request.paths = paths;
        const previousCommit = modelCommit;
        let release;
        modelCommit = new Promise(resolve => { release = resolve; });
        await previousCommit;
        try {
          checkModelRequest(request);
          await tagLoadedFile(object, request.data.type === 'custom' ? request.data.basedOn : name, parser, mtlText);
          checkModelRequest(request);
          prepareModelParts(object);
          setMeshMap({});
          clearHighlight();
          clearPartSelection();
          materialState.history.clear();
          materialState.updateUI();
          designState.history.clear();
          designState.updateUI();

          const modelData = request.data;
          if (!modelData) { onModelLoadError(`Model not found: ${name}`); return; }
          setSelectedModel(name);
          cleanupActiveModel();
          if (modelData.type === 'custom') {
            await loadCustomModel(name, modelData, onLoaded, request);
          } else {
            await loadRegularModel(name, modelData, onLoaded, request);
          }
          checkModelRequest(request);
          materialState.init('Initial state');
          designState.init('Initial state');
          return true;
        } finally { release(); }
      } catch (err) {
        if (request !== modelRequest) {
          if (object && object === getActiveModel()) cleanupActiveModel();
          else disposeLoadedModel(object);
          return false;
        }
        console.warn(`Model load failed: ${name}`, err);
        console.log(`Could not load ${name}: ${err.message}`);
        modelRequest = null;
        return false;
      }
    })();
    request.promise.finally(() => pendingModelLoads.delete(name));
    return request.promise;
  }

  async function decodeDecals(decals) {
    return (await Promise.all((decals || []).map(async (saved, index) => {
      try {
        const image = await loadDesignImage(saved.imageData);
        return { ...saved, id: saved.id ?? index + 1, image, _originalDataURL: saved.imageData };
      } catch (err) {
        logError(`Could not restore design "${saved.name}": ${err.message}`);
        return null;
      }
    }))).filter(Boolean);
  }

  async function loadCustomModel(name, modelData, onLoaded = null, request) {
    onModelLoadMessage(`Loading custom model: ${name}…`);
    const loadingPaths = await modelManager.getLoadingPaths(modelData.basedOn);
    checkModelRequest(request);
    if (!loadingPaths) { onModelLoadError(`Base model not found: ${modelData.basedOn}`); return; }

    await materialPresetsReady;
    checkModelRequest(request);

    const isV3 = !!(modelData.parts && modelData.version >= 3);
    const v2OverlayPreload = (!isV3 && modelData.overlayImages?.length > 0)
      ? decodeDecals(modelData.overlayImages) : Promise.resolve([]);

    const pid = getActiveProjectIdSync();
    const v3DecalPreload = isV3
      ? Object.fromEntries(await Promise.all(
          Object.entries(modelData.parts).map(async ([pName, pData]) => {
            const working = pid ? await loadDesignLayersFromCache(pid, name, pName) : null;
            checkModelRequest(request);
            const decals = await decodeDecals(working || pData.decals);
            checkModelRequest(request);
            return [pName, decals];
          })
        ))
      : {};

    const normalizePartNames = STANDARD_OBJECTS.some(model => model.objPath.endsWith('.glb') && model.objPath === loadingPaths.sourcePath);
    const object = request.object;
    checkModelRequest(request);
    convertObjectToPhysical(object);

    const meshList = [];
    setPartCache({});
    object.traverse(child => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
      child.userData.isCustomModel = true;

      let baseName = (normalizePartNames ? child.name.replace(/_1$/, '') : child.name) || 'Part';
      let uniqueName = baseName;
      let idx = 1;
      const meshMap = getMeshMap();
      while (meshMap[uniqueName]) uniqueName = `${baseName}_${idx++}`;
      child.name = uniqueName;
      meshList.push(child);
      meshMap[child.name] = child;
      if (!getActiveMesh()) setActiveMesh(child);
    });

    const legacyPart = isV3 ? modelData.parts.__default__ : null;
    if (legacyPart) {
      const { decals: _unused, ...material } = legacyPart;
      const parts = {};
      for (const [index, mesh] of meshList.entries()) {
        parts[mesh.name] = index === 0 ? legacyPart : { ...material, decals: [] };
        const working = pid ? await loadDesignLayersFromCache(pid, name, mesh.name) : null;
        checkModelRequest(request);
        v3DecalPreload[mesh.name] = working ? await decodeDecals(working) : (index === 0 ? v3DecalPreload.__default__ : []);
        checkModelRequest(request);
      }
      modelData = { ...modelData, parts };
    }

    sceneManager.add(object);
    setActiveModel(object);
    propManager.setMainModel(getActiveModel());
    setActiveMesh(meshList.find(mesh => v3DecalPreload[mesh.name]?.length) || meshList[0] || null);

    const names = meshList.map(mesh => mesh.name);
    updatePartSelection(names);
    if (getActiveMesh()) setActivePartName(getActiveMesh().name);

    clearChannelMapData();
    if (isV3) {
      const cache = getPartCache();
      for (const partName of Object.keys(modelData.parts)) {
        cache[partName] = { overlayImages: v3DecalPreload[partName] || [] };
      }
    }
    const savedParts = isV3 ? modelData.parts : null;
    const legacyWhole = { materialId: modelData.materialId, materialPreset: modelData.materialPreset, materialData: modelData.materialProperties };
    await bindLoadedParts(name, request, partName => (isV3 ? savedParts[partName] : legacyWhole));
    checkModelRequest(request);

    if (getActiveMesh()) {
      const activeMesh = getActiveMesh();
      const overlays = isV3 ? (getPartCache()[activeMesh.name]?.overlayImages || []) : await v2OverlayPreload;
      checkModelRequest(request);
      updateMaterialPresetList();
      syncActiveMaterialView();
      uvEditor.activeModelName = modelData.basedOn;
      uvEditor.customModelName = name;
      uvEditor.openWithPreloadedData(activeMesh, name, { basedOn: modelData.basedOn }, overlays, libIdOf(activeMesh));
      syncActiveMaterialView();
    }
    await restoreInactivePartDesigns(name, request);

    if (modelData.sceneState) restoreSceneState(modelData.sceneState);
    const bootCamera = getBootCamera();
    const customBootLoad = !!bootCamera;
    if (bootCamera) {
      cameraManager.setPosition(bootCamera.position.x, bootCamera.position.y, bootCamera.position.z);
      if (bootCamera.target) cameraManager.setTarget(bootCamera.target.x, bootCamera.target.y, bootCamera.target.z);
      setBootCamera(null);
    }
    if (!customBootLoad) cameraManager.reframeObject(object);
    checkAndApplyPolyPerf(object);
    markNeedsRender(60);

    const loadedModelName = name;
    Object.keys(getMeshMap()).forEach(partName => scheduleMatThumbUpdate(loadedModelName, partName));
    await restoreModelTransform(name, object, request);
    onModelReady(object, name, getActiveMesh());
    if (onLoaded) onLoaded(object);
  }

  function libIdOf(mesh) {
    return mesh?.material?.userData?.libId ?? null;
  }

  async function loadPartMaterial(pid, modelName, partName) {
    try {
      return await IDBStorage.get('metadata', partMaterialKey(pid, modelName, partName));
    } catch (err) {
      log(`Could not load material for ${partName}: ${err.message}`, true);
      return null;
    }
  }

  async function bindPart(mesh, id, fileId) {
    const entry = materialLibrary.get(id);
    if (id === fileId) {
      materialManager.applySavedProperties(mesh.material, entry.params);
      mesh.material.name = entry.name;
      for (const channel of new Set([...Object.keys(entry.channelMaps), ...entry.clearedChannels])) {
        mesh.material[channel] = await materialLibrary.channelTexture(id, channel);
      }
      mesh.material.needsUpdate = true;
      return;
    }
    let instance;
    try {
      instance = await materialLibrary.createInstance(id);
    } catch (err) {
      logError(`Could not load textures of "${entry.name}": ${err.message}`);
      instance = await materialLibrary.createPreview(id);
    }
    materialManager.applyEnvironment(instance, sceneManager.getScene().environment);
    materialManager.dispose(mesh.material);
    mesh.material = instance;
  }

  async function bindLoadedParts(modelName, request, savedPart = () => null) {
    const pid = getActiveProjectIdSync();
    const originalCustomDefinitions = getOriginalCustomDefinitions();
    originalCustomDefinitions.clear();
    const meshMap = getMeshMap();
    const meshes = Object.entries(meshMap);

    for (const [, mesh] of meshes) {
      const fileId = libIdOf(mesh);
      mesh.userData.fileMaterialId = fileId;
      if (fileId && !materialLibrary.hasSource(fileId)) {
        materialLibrary.registerSource(fileId, mesh.material.clone());
        scheduleThumbnailUpdate(fileId);
      }
    }

    const ops = [];
    const migratedModelParts = {};
    const links = [];
    for (const [partName, mesh] of meshes) {
      const fileId = mesh.userData.fileMaterialId;
      const record = pid ? await loadPartMaterial(pid, modelName, partName) : null;
      checkModelRequest(request);
      const saved = savedPart(partName);
      const defaultId = saved?.materialId ?? fileId ?? materialLibrary.fallbackId();
      let desired;
      if (record?.materialId !== undefined && record?.materialId !== null) {
        desired = record.fromFile ? (fileId ?? record.materialId) : record.materialId;
      } else if (record) {
        desired = migrateLegacyPart(materialLibrary, defaultId, record, partName, ops);
      } else if (saved && saved.materialId === undefined && saved.materialData) {
        const { channelMaps, ...props } = saved.materialData;
        desired = migrateLegacyPart(materialLibrary, fileId ?? materialLibrary.fallbackId(), { props, channelMaps }, partName, ops);
        migratedModelParts[partName] = desired;
      } else {
        desired = defaultId;
      }
      const id = materialLibrary.resolveId(desired);
      links.push({ partName, mesh, fileId, id, record });
      mesh.userData.originalMaterialId = migratedModelParts[partName] ?? saved?.materialId ?? fileId ?? materialLibrary.fallbackId();
    }
    if (ops.length) await IDBStorage.batch(ops);

    const linkOps = [];
    for (const { partName, mesh, fileId, id, record } of links) {
      await bindPart(mesh, id, fileId);
      checkModelRequest(request);
      const fromFile = id === fileId;
      if (pid && (record?.materialId !== id || record?.fromFile !== fromFile)) {
        linkOps.push({ type: 'put', store: 'metadata', key: partMaterialKey(pid, modelName, partName), value: { version: 2, materialId: id, fromFile } });
      }
      const entry = materialLibrary.get(mesh.userData.originalMaterialId);
      if (entry?.origin === 'custom' && !originalCustomDefinitions.has(entry.id)) {
        originalCustomDefinitions.set(entry.id, structuredClone(entry));
      }
      scheduleThumbnailUpdate(id);
    }
    if (linkOps.length) await IDBStorage.batch(linkOps);
    if (Object.keys(migratedModelParts).length) await modelManager.storage.setPartMaterialIds(modelName, migratedModelParts);
    updateMaterialPresetList();
    syncChannelView();
  }

  async function restoreModelTransform(name, object, request) {
    const pid = getActiveProjectIdSync();
    const transform = pid ? await IDBStorage.get('metadata', modelTransformKey(pid, name)) : null;
    checkModelRequest(request);
    if (transform && object === getActiveModel()) propManager.applyMainModelTransform(transform);
  }

  // The editor only opens the active part, so every other part's design is restored here.
  async function restoreInactivePartDesigns(modelName, request) {
    const pid = getActiveProjectIdSync();
    for (const [partName, mesh] of Object.entries(getMeshMap())) {
      if (mesh === getActiveMesh()) continue;
      let layers = getPartCache()[partName]?.overlayImages;
      if (!layers) {
        const saved = pid ? await loadDesignLayersFromCache(pid, modelName, partName) : null;
        checkModelRequest(request);
        if (!saved) continue;
        layers = await decodeDecals(saved);
        checkModelRequest(request);
      }
      if (uvEditor.restorePartDesign(mesh, layers.map(img => ({ ...img })))) {
        getPartCache()[partName] = { overlayImages: layers };
      }
    }
  }

  async function restoreDesignLayersForPart(partName) {
    const pid = getActiveProjectIdSync();
    const modelName = getCurrentModelName();
    if (!pid || !modelName || !partName) return;
    const layers = await loadDesignLayersFromCache(pid, modelName, partName);
    if (!layers || getActiveMesh()?.name !== partName) return;
    await uvEditor.restoreSessionState({
      overlayImages: layers,
      selectedImageId: null,
      nextImageId: layers.reduce((max, layer) => Math.max(max, layer.id + 1), 0),
    });
  }

  async function loadRegularModel(name, _modelData, onLoaded = null, request) {
    onModelLoadMessage(`Loading ${name}…`);
    const loadingPaths = await modelManager.getLoadingPaths(name);
    checkModelRequest(request);
    if (!loadingPaths) { onModelLoadError(`No paths for ${name}`); return; }

    const normalizePartNames = STANDARD_OBJECTS.some(model => model.objPath.endsWith('.glb') && model.objPath === loadingPaths.sourcePath);
    if (loadingPaths.type === 'glb-path' || loadingPaths.type === 'glb-blob') {
      {
        const object = request.object;
        checkModelRequest(request);
        const meshList = [];
        object.traverse(child => {
          if (!child.isMesh) return;
          child.castShadow = true;
          child.receiveShadow = true;
          if (child.material) {
            child.material = child.material.clone();
            child.material.needsUpdate = true;
          }
          let baseName = (normalizePartNames ? child.name.replace(/_1$/, '') : child.name) || 'Part';
          let uniqueName = baseName;
          let idx = 1;
          const meshMap = getMeshMap();
          while (meshMap[uniqueName]) uniqueName = `${baseName}_${idx++}`;
          child.name = uniqueName;
          meshList.push(child);
          meshMap[child.name] = child;
        });
        setActiveMesh(meshList[0] || null);
        updatePartSelection(meshList.map(mesh => mesh.name));
        sceneManager.add(object);
        setActiveModel(object);
        propManager.setMainModel(getActiveModel());
        convertObjectToPhysical(object);
        applyTexQualityToObject(object);
        await bindLoadedParts(name, request);
        checkModelRequest(request);
        syncActiveMaterialView();
        const bootCamera = getBootCamera();
        const glbBootLoad = !!bootCamera;
        if (bootCamera) {
          cameraManager.setPosition(bootCamera.position.x, bootCamera.position.y, bootCamera.position.z);
          if (bootCamera.target) cameraManager.setTarget(bootCamera.target.x, bootCamera.target.y, bootCamera.target.z);
          setBootCamera(null);
        }
        if (!glbBootLoad) cameraManager.reframeObject(object);
        rendererManager.getRenderer()?.compile(sceneManager.getScene(), cameraManager.getCamera());
        log(`${name} loaded.`);
        checkAndApplyPolyPerf(object);
        if (getActiveMesh()) {
          const activeMesh = getActiveMesh();
          await uvEditor.open(activeMesh, name, libIdOf(activeMesh));
          checkModelRequest(request);
          await restoreDesignLayersForPart(activeMesh.name);
          checkModelRequest(request);
        }
        await restoreInactivePartDesigns(name, request);
        markNeedsRender(60);
        await restoreModelTransform(name, object, request);
        onModelReady(object, name, getActiveMesh());
        if (onLoaded) onLoaded(object);
      }
      return;
    }

    async function loadOBJ(materials = null) {
      const hasMtl = !!materials;
      {
        const object = request.object;
        checkModelRequest(request);
        const meshList = [];
        object.traverse(child => {
          if (!child.isMesh) return;
          child.castShadow = true;
          child.receiveShadow = true;
          let baseName = child.name || 'Part';
          let uniqueName = baseName;
          let idx = 1;
          const meshMap = getMeshMap();
          while (meshMap[uniqueName]) uniqueName = `${baseName}_${idx++}`;
          child.name = uniqueName;
          meshList.push(child);
          meshMap[child.name] = child;
        });
        setActiveMesh(meshList[0] || null);
        updatePartSelection(meshList.map(mesh => mesh.name));
        sceneManager.add(object);
        setActiveModel(object);
        propManager.setMainModel(getActiveModel());
        convertObjectToPhysical(object);
        if (hasMtl) convertObjectToPhysical(object);
        applyTexQualityToObject(object);
        await bindLoadedParts(name, request);
        checkModelRequest(request);
        syncActiveMaterialView();

        const bootCamera = getBootCamera();
        const objBootLoad = !!bootCamera;
        if (bootCamera) {
          cameraManager.setPosition(bootCamera.position.x, bootCamera.position.y, bootCamera.position.z);
          if (bootCamera.target) cameraManager.setTarget(bootCamera.target.x, bootCamera.target.y, bootCamera.target.z);
          setBootCamera(null);
        }
        if (!objBootLoad) cameraManager.reframeObject(object);
        rendererManager.getRenderer()?.compile(sceneManager.getScene(), cameraManager.getCamera());
        log(`${name} loaded.`);
        checkAndApplyPolyPerf(object);
        if (getActiveMesh()) {
          const activeMesh = getActiveMesh();
          await uvEditor.open(activeMesh, name, libIdOf(activeMesh));
          checkModelRequest(request);
          await restoreDesignLayersForPart(activeMesh.name);
          checkModelRequest(request);
        }
        await restoreInactivePartDesigns(name, request);
        markNeedsRender(60);
        await restoreModelTransform(name, object, request);
        onModelReady(object, name, getActiveMesh());
        if (onLoaded) onLoaded(object);
      }
    }
    await loadOBJ(loadingPaths.mtl ? true : null);
    checkModelRequest(request);
  }

  async function collectModelParts() {
    snapshotCurrentPart();
    const parts = {};
    for (const [partName, mesh] of Object.entries(getMeshMap())) {
      const cached = getPartCache()[partName];
      const decals = await Promise.all((cached?.overlayImages || []).map(async img => ({
        name: img.name,
        type: img.type || 'image',
        textData: img.textData ? { ...img.textData } : null,
        position: { ...img.position },
        size: { ...img.size },
        rotation: img.rotation,
        aspectRatio: img.aspectRatio,
        flipH: img.flipH ?? false,
        flipV: img.flipV ?? false,
        imageData: await serializeDecal(img),
      })));
      parts[partName] = {
        materialId: libIdOf(mesh),
        decals,
      };
    }
    return parts;
  }

  return {
    readMissingStandardCatalogs,
    backfillUploadedCatalogs,
    loadNativeSourcesFromFile,
    schedulePartMaterialSave,
    prefetchStandardModels,
    loadModel,
    loadCustomModel,
    loadRegularModel,
    bindLoadedParts,
    restoreModelTransform,
    restoreDesignLayersForPart,
    collectModelParts,
    getModelRequest,
    getPendingModelLoad,
    checkModelRequest,
  };
}
