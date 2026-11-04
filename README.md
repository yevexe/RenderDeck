# RenderDeck

RenderDeck is a 3D product mockup tool that runs entirely in the browser. You pick or upload a 3D model, such as a mug or a shirt, place designs on it, adjust its materials, light and frame the scene, and preview the result in real time.

There is no build step and no backend yet. Everything a user uploads, creates or changes is saved in the browser's IndexedDB, grouped into projects, and is restored the next time the app opens. Syncing that data to a server is planned but not built.

## Pages

| Page | Purpose |
|---|---|
| `landing.html` | Marketing page. Its sign-up and log-in links open the app; there are no accounts yet. |
| `projects.html` | Create, rename, open and delete projects. |
| `index.html` | The main editor: a 3D viewport with a settings sidebar of 10 tabs. |

## Editor Tabs

| Tab | What it does |
|---|---|
| 1. Scene Set-Up | Choose or upload models, set HDR lighting and backgrounds, add props, save and load scenes, import props from Sketchfab, undo and redo scene changes |
| 2. Design Editor | Place images and text on a model's UV map, then move, scale, rotate, flip, wrap or delete them, per model part |
| 3. Materials | Edit the project's material library (standard, custom and each object's native materials), assign materials to parts, edit `MeshPhysicalMaterial` values and texture maps, and use the color picker and node editor |
| 4. Camera | Perspective or orthographic view, lens and sensor, clipping, tone mapping, exposure, depth of field |
| 5. Preview Quality | Render scale, device pixel ratio, anti-aliasing, shadows, texture filtering, wireframe and other view options |
| 6. Post-Processing | Bloom, vignette, ambient occlusion and motion blur, plus presets |
| 7. Rendering | Output resolution |
| 8. Export & Project | Layout and option checkboxes for image, model and project export. **The export, save, load and thumbnail buttons on this tab are not connected to any code yet.** Scene and custom model export live in other tabs. |
| 9. Debug | Shows stored data, logs and app state |
| 10. Setting 10 | Empty placeholder |

## Supported Files

| Type | Formats |
|---|---|
| Models | `.obj`, `.obj` + `.mtl` + textures, `.glb` |
| Props | `.glb`, `.gltf`, `.obj`. A standalone `.glb` or `.gltf` must have its data embedded. |
| Designs | `.png`, `.jpg`, `.jpeg`, `.svg` |
| Textures uploaded with a model | `.png`, `.jpg`, `.jpeg`, `.svg`, `.webp`, `.bmp`, `.gif` |

Files can be chosen with the upload buttons or dragged onto the browser window. When an `.obj` and its `.mtl` are dropped together, in either order, they are paired and their colors and textures are connected to the right parts.

## Standard Content

- **Models:** Plain Mug, T-Shirt and Long-Sleeve Shirt
- **Props:** Glass Waiting Room Table and Laptop
- **HDR environments:** Studio Kominka and Lebombo
- **Standard materials:** listed in `STANDARD_MATERIALS` in `js/config.js`; each project keeps its own edits, renames and deletions

## How Data Is Stored

All data is in one IndexedDB database, `renderdeck_db` (version 9):

| Store | Contents |
|---|---|
| `projects` | Project records |
| `models` | Saved custom models |
| `uploaded-models`, `uploaded-props`, `uploaded-hdrs` | Records for uploaded files |
| `blobs` | File contents and images, such as uploads, standard object files (one copy shared by all projects), design layers and thumbnails |
| `materials` | Each project's custom materials |
| `scenes` | Named scenes |
| `node-graphs` | Node editor graphs |
| `settings` | App-wide settings (`app`) and per-project settings (the project's id) |
| `metadata` | Sessions, part-to-material links, each project's changes to standard and native materials, lists of object files' materials, design layer data and migration flags |

- **Saving:** continuous edits are written about 300 ms after they settle, and any waiting writes are flushed when the page is hidden or closed.
- **Deleting:** related records are removed together in one transaction, so a failed delete leaves everything in place.
- **Browser protection:** the app calls `navigator.storage.persist()` to ask the browser not to clear its data. The browser may refuse, and the request does not protect against a user clearing site data or against Chrome deleting a corrupted database.
- **Standard models:** the three standard model files are currently fetched from `assets/` and kept in the browser's HTTP cache, not in IndexedDB.
- **Sensitive data:** the Sketchfab token is stored in `settings/app`, so a future sync must not upload it blindly.

## Keyboard Shortcuts

| Key | Action |
|---|---|
| Ctrl+Z | Undo |
| Ctrl+Shift+Z or Ctrl+Y | Redo |
| G / R / S | Move, rotate or scale the selected prop |
| Delete or Backspace | Remove the selected prop |
| Ctrl+D | Duplicate the selected prop |
| Escape | Deselect the prop |
| Arrow keys (design mode) | Nudge the selected design |
| Q / E (design mode) | Rotate the selected design |
| R (design mode) | Reset the selected design's transform |

## Running It

Serve the `RenderDeck/public` folder with any static file server, then open `index.html`:

```bash
cd RenderDeck/public
python3 -m http.server 8000
```

WebGL 2 is required, and an internet connection is needed to load the libraries below.

## Dependencies

- [Three.js](https://threejs.org/) 0.183.2: 3D rendering, loaded from unpkg through an import map
- [fflate](https://github.com/101arrowz/fflate) 0.8.2: ZIP extraction for Sketchfab downloads, loaded from jsDelivr

## Planned Features

- User accounts and authentication (Supabase)
- Cloud sync of projects, models, scenes, materials and files (PostgreSQL and Supabase Storage)
- Spring Boot REST API for cloud save, file upload and sharing
- A cross-project material library
- Share codes for models, scenes and materials
- `.renderdeck` ZIP export and import

---

# Code Reference

All paths are under `RenderDeck/public/js/`. Names starting with `_` are internal helpers. A name followed by `()` is a function or method, and related ones are grouped under one description.

## Entry Points

### `main.js`: application orchestrator

Creates every manager, connects them to the UI, and owns the running state: active model, part, materials, saving and the render loop.

**Startup and render loop**
- `initializeApp()`: starts the app in order, from opening the database and running migrations to restoring the last session, then turns saving on.
- `animate()`, `markNeedsRender()`: the render loop, which draws only when something has changed.
- `registerBuiltInModels()`, `initMaterialPresets()`, `loadInitialEnvironment()`: load the standard content.
- `prefetchStandardModels()`: after the first model has loaded, stores the standard models in IndexedDB in the background.

**Model loading**
- `loadModel()`: the main entry point; it handles repeated and replaced requests and picks the right loader.
- `loadRegularModel()`, `loadOBJ()`, `loadCustomModel()`: load standard or uploaded models and saved custom models.
- `_decodeDecals()`: turns saved decal data back into images.
- `_onModelReady()`: finishes setup after a model is in the scene.
- `checkModelRequest()`: stops a load that a newer request has replaced.
- `disposeLoadedModel()`, `cleanupActiveModel()`: free a model's memory.
- `waitForModelReady()`: waits until the current model has loaded.
- `_modelExists()`: checks whether a model is in the library.
- `deleteModelsFromLibrary()`: deletes models and all their stored data.
- `updateModelList()`, `updateSceneList()`: refresh the dropdowns.
- `countModelFaces()`, `updatePerfModeUI()`, `updatePolyWarning()`, `checkAndApplyPolyPerf()`: detect heavy models, warn the user, and switch on performance mode.

**Materials**
- `convertToPhysical()`, `convertObjectToPhysical()`: upgrade imported materials to `MeshPhysicalMaterial`.
- `applyTexQuality()`, `applyTexQualityToObject()`: apply the current texture quality settings.
- `applyMaterialPreset()`, `updateMaterialProperty()`, `extractPropertiesForPreset()`: assign a library material to a part, edit the active part's material live, and read its real values.
- `partsUsing()`, `setPartChannel()`, `applyDefinitionToLiveParts()`, `setDefinitionChannel()`, `applyPropertyToOtherParts()`, `flushOtherPartEdits()`, `commitActiveDefinition()`, `scheduleLibraryWrite()`: apply a definition across every loaded part using it, and save it.
- `captureMaterialState()`, `applyMaterialHistoryState()`: material undo and redo.
- `restoreOriginalMaterial()`: returns a part to the material it loaded with, and that material to its original values.
- `getChannelThumbnailOverrides()`, `syncChannelView()`: show the active material's texture channels.
- `applyNodeEditorTexture()`: applies a texture coming from the node editor.
- `libIdOf()`, `schedulePartMaterialSave()`, `_loadPartMaterial()`, `bindLoadedParts()`, `_bindPart()`: read, save and restore which library material each part uses.
- `readMissingStandardCatalogs()`, `backfillUploadedCatalogs()`, `loadNativeSourcesFromFile()`, `tagLoadedFile()`: list objects' native materials and load their textures.
- `updateMaterialPresetList()`, `syncMaterialDropdown()`, `syncActiveMaterialView()`: refresh the material list and everything showing the active part's material.

**Thumbnails**
- `_setObjectSelectThumb()`, `_setObjectSelectMatThumb()`, `scheduleMatThumbUpdate()`: update thumbnails in the object dropdown.
- `loadCachedThumbnails()`, `_storeMaterialThumb()`, `getMaterialThumbnail()`, `scheduleThumbnailUpdate()`, `scheduleAllMissingThumbnails()`: load, render and cache each project's material thumbnails.
- `_ensureWarmupScene()`, `_ensureThumbRenderer()`, `warmupAndGenerateThumbnails()`: prepare shaders and generate thumbnails without freezing the page.
- `_saveThumbnailToProject()`: saves a viewport image as the project's thumbnail.

**Design layers and part selection**
- `scheduleDesignLayerSave()`, `_writeDesignLayers()`, `loadDesignLayersFromCache()`, `_restoreDesignLayersForPart()`: save and restore design layers.
- `setHighlight()`, `clearHighlight()`, `onPointerMove()`, `onCanvasClick()`, `selectPart()`: hover over and select model parts.
- `_snapshotCurrentPart()`: keeps a part's state in memory before switching away from it.
- `_applyFrontBackShader()`, `_clearFrontBackShader()`: add or remove the shader change used for designs on front and back faces.
- `setupDesignShortcuts()`: keyboard shortcuts and buttons for moving designs.

**Saving and restoring**
- `collectSession()`, `scheduleSessionSave()`, `restoreSessionState()`: the open model, part, scene and props.
- `collectProjectSettings()`, `scheduleProjectSettingsSave()`, `restoreProjectSettings()`, `restorePreviewSettings()`, `restoreUiPreferences()`, `_selectedButtonValue()`: per-project settings and UI choices.
- `scheduleModelTransformSave()`, `restoreModelTransform()`: each model's position, rotation and scale.
- `flushAllWrites()`: saves everything immediately when the page is hidden or closed.
- `getCurrentModelName()`: reads the selected model.

**Scene, background and history**
- `applyBackground()`, `syncBgCards()`, `syncEnvCards()`, `setupBackgroundUI()`: backgrounds and environment cards.
- `syncSceneState()`, `restoreSceneState()`, `loadSceneSetup()`, `restoreCameraFromScene()`, `ensureSketchfabPropsRegistered()`, `resetScene()`: apply saved scenes and reset the scene.
- `setupSceneSetupUI()`, `populateScenesDropdown()`: the Scene Set-Up tab.
- `pushSceneHistory()`, `setupHistoryUI()`: undo and redo.

**Camera and other tab setup**
- `computeFOV()`, `applyCameraSettings()`, `setupCameraUI()`, `_applyCameraType()`, `_applyCameraDOF()`, `restoreCameraSettings()`: camera controls.
- `setupPostFXUI()`: the Post-Processing tab.
- `setupPreviewQualityUI()`, `updateResolutionDisplay()`: the Preview Quality tab.
- `setupPropsUI()`: the props panel.
- `setupTransformToolbar()`, `closeToolbarPopups()`, `activateMode()`, `applyEditMode()`, `applyMeasureUnit()`, `applyLabelStyle()`: the viewport's transform toolbar.
- `gridSnapStep()`, `applySnapState()`, `rebuildGrid()`: the grid and snapping.
- `setupButtonRow()`, `setupValueInputSpinners()`: shared control helpers.

**Debug panel**
- `setupDebugPanel()`, `refreshDebugPanel()`, `_dbgBytes()`, `_dbgFmtVal()`, `_dbgKVRows()`, `escapeDebugText()`: build and fill the Debug tab.

### `projects.js`: projects page

- `render()`, `escapeHtml()`: draw the project cards safely.
- `openProject()`: makes a project active and opens the editor.
- `startRename()`, `closeRenameModal()`, `confirmRename()`: rename a project.
- `startDelete()`, `closeDeleteModal()`, `confirmDelete()`: delete a project.

### `config.js`: shared settings

Has no functions. It exports `CONFIG`, `FEATURES`, `STANDARD_OBJECTS`, `STANDARD_ENVIRONMENTS`, `PROP_PATHS` and `STANDARD_MATERIALS`.

## `core/`: Three.js foundation

### `core/Camera.js`: `CameraManager`

- `constructor()`, `setupControls()`, `setupResizeListener()`: create the camera, orbit controls and resize handling.
- `update()`, `getCamera()`, `getControls()`: per-frame update and access.
- `frameObject()`, `reframeObject()`: fit an object in view.
- `setPosition()`, `setTarget()`, `reset()`, `setControlsEnabled()`: direct camera control.

### `core/Renderer.js`: `RendererManager`

- `constructor()`, `resize()`, `resizeComposer()`, `setCustomResolution()`, `clearCustomResolution()`: create the renderer and manage its size.
- `enterOrbitPerfMode()`, `exitOrbitPerfMode()`: lower the resolution while orbiting.
- `buildComposer()`, `initComposer()`, `_ensureOptionalPasses()`, `_syncPasses()`: build the post-processing pipeline.
- `getState()`, `restoreState()`, `applyState()`, `syncUI()`, `_syncCheckboxes()`: save, restore and display settings.
- `setPostFXEnabled()`, `setAA()`, `setVignetteIntensity()`, `setVignetteSoftness()`, `setVignetteColor()`, `setVignetteBlendMode()`, `setSSAOIntensity()`, `setSSAORadius()`, `setMotionBlurStrength()`, `setDOF()`, `setDOFFocus()`, `applyPreset()`: effect settings.
- `render()`, `downloadScreenshot()`, `dispose()`: draw a frame, save an image and clean up.

### `core/Scene.js`: `SceneManager`

- `constructor()`, `setupLighting()`, `updateLighting()`: create the scene and its lights.
- `setEnvironment()`, `setBackground()`: set the environment and background.
- `add()`, `remove()`, `getScene()`, `clear()`: manage scene contents.

### `core/SceneLoader.js`: HDR environments

- `initScenes()`, `loadScene()`, `getSceneNames()`, `_loadHDR()`: load environments.
- `envPreviewCacheId()`, `forgetEnvPreview()`, `generateEnvPreview()`: create and cache preview images.

## `materials/`

### `materials/MaterialLibrary.js`: `MaterialLibrary`

One library per project, and every material rule in one place. Each material is one entry with one definition, and parts refer to it by a stable id:

| Origin | Id | Stored |
| --- | --- | --- |
| Standard | `standard:${configId}` | Shipped JSON (never changed), plus this project's changes in `metadata` `material-override:${pid}:…` |
| Native | `native:${object}:${name}:${occurrence}` | The object's file, plus this project's changes in the same override records. File textures are not copied |
| Custom | a UUID | `materials/${pid}:${uuid}` |
| Fallback | `internal:white` | Plain white, never listed or deleted, used if `Default — White` has been deleted |

Each part keeps its own Three.js material instance, because the Design Editor changes it per part; `main.js` applies definition changes across the instances. Only shipped definitions and the lists read from standard object files are shared between projects.

- **Loading:** `constructor()`, `_reset()`, `loadProject()`, `_fullParams()`, `_makeEntry()`, `_customEntry()`, `_applyOverride()`, `_addCatalogEntries()`, `noteCatalog()`, `addCatalog()`, `hasCatalog()`, `getCatalog()`, `isStandardObject()`.
- **Reading:** `get()`, `isListed()`, `fallbackId()`, `resolveId()`, `listedIds()`, `getSections()`, `findByLegacyName()`.
- **Editing and saving:** `setParams()`, `setChannel()`, `setChannels()`, `persist()`, `rename()`, `createCustomFrom()`, `_enqueue()`, `_customRecord()`, `_customPutOp()`, `_overrideOp()`, `_overrideParams()`, `_newCustomEntry()`.
- **Deleting and resetting:** `deleteMaterial()`, `resetStandardMaterials()`, `restoreDeletedNatives()`, `restoreOriginal()`, `prepareObjectDeletion()`, `_resetOverrides()`, `_referenceOps()`, `_idsUsedOutside()`.
- **Files, textures and instances:** `hasSource()`, `registerSource()`, `releaseSources()`, `ensureSource()`, `_objectOfNative()`, `channelTexture()`, `_loadChannelTexture()`, `_dropTextures()`, `createInstance()`, `createPreview()`.
- **Older data, export and import:** `legacyToId()`, `legacyEmbeddedCustom()`, `exportDefinitions()`, `importDefinition()`, `importModelMaterials()`.
- **Module helpers:** `textureToDataURL()`, `sameValue()`, `sameMaps()`, `sameParams()`, `hashString()`.

### `materials/nativeCatalog.js`

Lists the materials inside object files without loading them. A GLB's JSON chunk is at the start of the file, so only that much is downloaded.

- `readGlbJsonFromUrl()`, `readGltfJsonFromBlob()`: read a file's JSON.
- `catalogFromGltf()`, `catalogFromMtl()`, `simpleGltfParams()`, `linearColorHex()`: build the list, with simple values for thumbnails.
- `tagFileMaterials()`: marks a loaded file's materials with their library ids.

### `materials/MaterialManager.js`: `MaterialManager`

Builds and reads Three.js materials. Holds the shipped definitions, but no project data.

- `constructor()`, `_initializeLegacyPresets()`, `isLegacyPreset()`, `createLegacyPreset()`, `loadPresetsFromManifest()`: shipped definitions and old procedural presets.
- `createMaterial()`: creates a material instance.
- `applyEnvironment()`, `applySavedProperties()`, `extractProperties()`, `dispose()`: read and apply material values and clean up.

### `materials/generators.js`: procedural textures

- `createTextureFromCanvas()`: shared canvas-to-texture helper.
- `createWoodTexture()`, `createMetalTexture()`, `createGlassTexture()`, `createPlasticTexture()`: draw simple material textures.

## `models/`

### `models/ModelManager.js`: `ModelManager`

- `constructor()`, `_init()`, `loadCustomModelsFromStorage()`, `_loadPersistedUploadedModels()`: load the model library.
- `registerModel()`, `addModelFromFiles()`: add standard and uploaded models.
- `_persistUploadedModel()`, `_persistError()`: save an upload in one transaction and report failures.
- `createMTLWithBlobURLs()`: connects an MTL file's textures to the uploaded files.
- `getModel()`, `getModelInfo()`, `getLoadingPaths()`, `getModelNamesByCategory()`, `getCustomModelsBasedOn()`: look up models.
- `saveCustomModel()`, `deleteModels()`, `_releaseModel()`: save, delete and free models.
- `storeStandardModels()`, `_standardModelURL()`: keep each standard object's file in IndexedDB and load it from there, falling back to the network if there's no stored copy.
- `readUploadedCatalog()`: lists the native materials of an upload stored before lists were kept.
- `generateModelName()`, `readFileAsText()`: helpers.
- `exportModelList()`, `importModelList()`, `exportCustomModel()`, `importCustomModel()`: export and import.

### `models/ModelVerifier.js`: `ModelVerifier`

- `constructor()`, `verifyModelFolder()`: check a set of uploaded files and pair them.
- `validateGLBFile()`, `validateOBJFile()`, `validateMTLFile()`, `validateTextureFile()`: check each file type.
- `generateReport()`, `getFileExtension()`, `readFileAsText()`, `loadImageFromFile()`, `formatBytes()`: reporting and helpers.

### `models/MTLUtils.js`: MTL handling

- `fileName()`: gets a file name from a path.
- `parseMap()`: reads a texture line from an MTL file.
- `rewriteMTL()`: points texture lines at the uploaded files and warns about missing ones.

### `models/ModelParts.js`

- `prepareModelParts()`: splits multi-material meshes into separate parts and gives each its own material. Clones keep the file material's library id.

## `props/`

### `props/PropManager.js`: `PropManager`

- **Setup and input:** `constructor()`, `_setupTransformControls()`, `_setupEventListeners()`, `_onCanvasClick()`, `_findPropByMesh()`, `_onKeyDown()`.
- **Managing props:** `getAvailableProps()`, `addProp()`, `removeProp()`, `duplicateProp()`, `clearAllProps()`, `_updatePropsList()`.
- **Selection:** `setMainModel()`, `_selectMainModel()`, `_deselectMainModel()`, `selectProp()`, `deselectProp()`.
- **Outlines and size labels:** `_getOBBCorners()`, `_boxPositionsFromCorners()`, `_boxPositions()`, `_outlineMetrics()`, `_createThickOutline()`, `_disposeThickOutline()`, `_createLabelCanvas()`, `_formatSize()`, `_updateSizeLabels()`, `_clearSizeLabels()`, `hasOutlines()`, `setShowLabels()`, `setLabelsParallel()`, `setMeasureUnit()`, `updateOutlines()`, `_addOutline()`, `_removeOutline()`.
- **Moving objects:** `_updatePropTransform()`, `setTransformMode()`, `setSnapEnabled()`, `setVertexSnapEnabled()`, `_buildVertexCache()`, `_snapToNearestVertex()`, `setEditMode()`, `setCollisionEnabled()`, `_checkCollisions()`.
- **Stored and uploaded props:** `registerBlobProp()`, `loadStoredProps()`, `saveBlobProp()`, `uploadCustomProp()`.
- **Saving scene data and cleanup:** `getSceneData()`, `loadSceneData()`, `getMainModelTransform()`, `applyMainModelTransform()`, `dispose()`.

## `scenes/`

### `scenes/CustomSceneStorage.js`: `CustomSceneStorage`

- `sceneKey()`, `isLegacyKey()`, `constructor()`: key helpers and setup.
- `saveScene()`, `getScene()`, `getAllSceneNames()`, `deleteScene()`, `clearAllScenes()`: named scenes for the active project.
- `exportScene()`, `importScene()`: JSON export and import.
- `_ensureMigrated()`, `_readLegacyDB()`: move scenes from the old database.

## `shaders/`

Neither file has functions.

- `shaders/CustomVignetteShader.js`: exports `CustomVignetteShader`, the vignette effect with color and blend modes.
- `shaders/DepthOfFieldShader.js`: exports `HQBokehFragmentShader`, the depth-of-field blur.

## `sketchfab/`

### `sketchfab/SketchfabAPI.js`: `SketchfabAPI`

- `constructor()`, `load()`, `setToken()`, `_headers()`: manage the API token.
- `searchModels()`, `getDownloadUrls()`, `fetchZip()`: search and download.

### `sketchfab/SketchfabLoader.js`

- `extractModelFromZip()`: gets the model from a downloaded ZIP.
- `uint8ToBase64()`, `mimeForExt()`: helpers.

### `sketchfab/SketchfabModal.js`: `SketchfabModal`

- `formatFaces()`, `faceColor()`, `bestThumb()`: display helpers.
- `constructor()`, `_build()`, `_wire()`, `open()`: create and open the window.
- `_showToken()`, `_showSearch()`, `_status()`: switch views and show status.
- `_search()`, `_loadMore()`, `_append()`, `_card()`: search and list results.
- `_import()`: downloads a model and adds it as a prop.

## `stateEditor/`: undo and redo

`DesignState.js` (`DesignStateManager`), `MaterialState.js` (`MaterialStateManager`) and `SceneState.js` (`SceneStateManager`) share the same methods:

- `constructor()`: receives what it needs from `main.js`.
- `snapshot()`: captures the current state.
- `init()`, `push()`: set the starting state and add a new one.
- `restore()`: applies a saved state.
- `setupUI()`, `updateUI()`: the history panel.

`MaterialState.js` gets its state from `main.js`, because a restore changes a library definition and every part linked to it.

`SceneState.js` also has `_syncBgUI()`, which updates the background controls after a restore.

`historyUtils.js` has the shared helpers `formatAge()` and `renderHistoryList()`.

## `storage/`: everything saved to IndexedDB

### `storage/indexedDBStorage.js`: database wrapper

- `openDB()`, `storeNames()`, `deleteDatabase()`, `isIndexedDBAvailable()`: manage the database.
- `get()`, `put()`, `del()`, `batch()`, `getAllKeys()`, `getAll()`, `clearStore()`: read and write records; `batch()` runs several operations in one transaction.
- `prefixRange()`, `encodeKeyPart()`: key helpers.
- `_wrapError()`, `_requireDB()`, `isQuotaError()`: error handling.
- `dataURLToBlob()`, `dataURLToBlobSync()`, `blobToDataURL()`: data conversion.
- `getPersistentStorageState()`, `requestPersistentStorage()`, `startPersistentStorageRequests()`: ask the browser not to clear the data.

### `storage/storageKeys.js`: key formats

One place for compound keys, so saves, loads and deletes agree.

- **Base and parsing:** `partSegment()`, `modelSegment()`, `parsePartKey()`.
- **Per-part material links:** `partMaterialKey()`, `partMaterialPrefix()`, `partMaterialProjectPrefix()`.
- **Material library:** `materialOverrideKey()`, `materialOverridePrefix()`, `objectOverridePrefix()`, `nativeMaterialId()`, `nativeIdPrefix()`, `standardCatalogKey()`, `uploadedCatalogKey()`, `uploadedCatalogPrefix()`.
- **Design layers:** `designMetaKey()`, `designMetaPrefix()`, `designBlobKey()`, `designBlobPartPrefix()`, `designBlobPrefix()`, `designThumbKey()`.
- **Thumbnails and previews:** `matThumbKey()`, `matThumbPrefix()`, `materialThumbKey()`, `materialThumbPrefix()`, `envPreviewKey()`.
- **Node graphs:** `nodeGraphKey()`, `nodeGraphPrefix()`, `nodeImageKey()`, `nodeImagePrefix()`.
- **Project records:** `sessionKey()`, `projectSettingsKey()`, `modelTransformKey()`.
- **Uploads:** `uploadedPropKey()`, `uploadedPropBlobKey()`, `uploadedModelMtlKey()`.

### `storage/pendingWrites.js`: delayed writes

- `scheduleWrite()`: queues a write; a newer one with the same id replaces it.
- `cancelWrite()`, `cancelAllWrites()`, `cancelWritesWithPrefix()`: cancel waiting writes.
- `flushWrites()`, `hasPendingWrites()`: run waiting writes now or check for them.
- `_start()`, `_settle()`: run writes in order, so an older one can't overwrite a newer one.

### `storage/cascade.js`: delete operations

- `uploadedModelBlobKeys()`, `customModelBlobKeys()`: find a model's stored files.
- `modelWorkingStateOps()`, `modelDeleteOps()`: delete a model's working state, or everything stored for it.
- `sessionWithoutModels()`: removes deleted models from the session.
- `projectDeleteOps()`: deletes everything in a project, including its whole material library.

### `storage/CustomModelStorage.js`: `CustomModelStorage`

- `modelKey()`, `partBlobKey()`, `legacyBlobKey()`, `isLegacyKey()`, `constructor()`: key helpers and setup.
- `saveCustomModel()`, `loadCustomModel()`, `_loadByKey()`, `loadAllCustomModels()`, `getAllCustomModelNames()`: save and load custom models.
- `exportCustomModels()`, `exportSingleModel()`, `importCustomModels()`, `_normaliseImport()`, `_withMaterials()`: JSON export and import. Exports carry the material definitions their parts use.
- `setPartMaterialIds()`: records part links migrated when a custom model first loads.
- `_migrateLegacyKey()`: moves old records into the active project.

### `storage/NodeGraphStorage.js`

- `saveNodeGraph()`, `loadNodeGraphs()`: save and load a project's graphs.
- `graphIdentity()`, `graphWriteOps()`: helpers for keys and write operations.

### `storage/ProjectStorage.js`

- `generateId()`, `createProject()`, `listProjects()`, `getProject()`, `updateProject()`, `deleteProject()`: manage projects.
- `getActiveProjectId()`, `setActiveProjectId()`, `getActiveProjectIdSync()`, `getActiveProject()`: track the active project.
- `ensureActiveProject()`, `_ensureActiveProject()`: make sure a project always exists.

### `storage/SettingsStorage.js`

- `loadAppSettings()`, `getAppSetting()`, `setAppSetting()`, `scheduleAppSetting()`, `setAppBlobSetting()`, `_enqueueAppWrite()`: app-wide settings.
- `loadProjectSettings()`, `scheduleProjectSettings()`: per-project settings.

### `storage/migrations.js`: one-time data moves

- `runMigrations()`: runs the moves at startup.
- `_migrateOldKeys()`, `_migrateLocalStorage()`, `migrateSessionGraphs()`: move old keys, `localStorage` data and session-embedded graphs.
- `migrateMaterialLibrary()`, `_migrateProjectLibrary()`, `migrateLegacyPart()`: move each project to the material library. Parts with edits keep their look through a new custom material, and shared hidden presets and thumbnails become per project. Parts using their file's material finish when the object first loads, because only then can they be compared with the file.
- `_lsGet()`, `_lsJSON()`, `_lsKeys()`, `_stripPrivate()`, `_splitPid()`, `_splitLast()`: helpers.

## `ui/`

### `ui/Controls.js`: sidebar controls and color picker

**Color helpers:** `clamp()`, `componentToHex()`, `rgbToHex()`, `hexToRgb()`, `rgbToHsv()`, `hsvToRgb()`, `rgbToCmyk()`, `cmykToRgb()`, `rgbToLab()`, `labToRgb()`, `pointerPosition()`, `lerp()`, `generateSwatchColors()`.

**`CompactColorPicker`: color picker, swatches and color extractor**
- **Setup and shared state:** `constructor()`, `setActiveFolderTab()`, `setExtractorPreferences()`, `restoreExtractorImage()`, `setSharedCollections()`.
- **Building and events:** `_build()`, `_configureCanvasResolution()`, `_makeModeButton()`, `_buildFieldGroup()`, `_bindLauncher()`, `_bindPanelEvents()`, `_bindKeyboardEvents()`, `_bindGroupInputs()`, `_applyFieldValues()`, `_bindCanvasDrag()`, `_handlePointer()`, `_normalizeHex()`, `_buildArrow()`, `_positionArrow()`.
- **Color state:** `open()`, `close()`, `setMode()`, `setColor()`, `_setStateFromRgb()`, `_setStateFromHsv()`, `_syncUI()`, `_positionPanel()`.
- **Drawing:** `render()`, `_drawSquare()`, `_drawWheel()`, `_drawHueSlider()`, `_drawValueSlider()`, `_drawSliderMarker()`, `_drawCrosshair()`, `_harmonyOffsets()`, `_harmonyHitTest()`, `_drawHarmonyHandle()`.
- **Swatch collections:** `_buildPresetSwatches()`, `_renderSwatchCollections()`, `_addSwatchCollection()`, `_loadStandardSwatchCollections()`, `_removeSelectedSwatchCollection()`, `_removeSelectedSwatchTarget()`, `_openSwatchRename()`, `_closeSwatchRename()`, `_commitSwatchRename()`, `_renameSelectedSwatchTarget()`, `_deleteSwatchByRef()`, `_clearMultiSelect()`, `_deleteSelected()`, `_handleMultiCollectionReorder()`, `_addHarmonyColorsToRecent()`, `_addRecentColor()`, `_refreshRecentGrid()`, `_saveCollections()`, `_clearCollectionDropIndicators()`, `_handleCollectionReorder()`, `_markDropTarget()`, `_clearDropIndicators()`, `_syncRenderedSwatchSelection()`, `_handleSwatchDrop()`.
- **Extracting colors from an image:** `_bindExtractorEvents()`, `_loadExtractorImage()`, `_runExtractor()`, `_showExtractorResults()`, `_sampleN()`, `_colorDistSq()`, `_deduplicateColors()`, `_boxRange()`, `_splitBox()`, `_extractMostCommon()`, `_extractLeastCommon()`, `_extractByLuminance()`, `_extractKMeans()`, `_extractMedianCut()`, `_extractMMCQ()`, `_extractHistogram()`, `_extractWeightedRegions()`, `_filterHSV()`, `_extractVibrant()`, `_extractMuted()`, `_extractLabKMeans()`.

**`CustomSelect`: styled dropdown with thumbnails**
- `constructor()`, `_build()`, `_openDropdown()`, `_close()`: build, open and close it.
- `populate()`, `_setTriggerThumb()`, `_scheduleRerender()`, `_rerenderItem()`: fill it and draw thumbnails.
- `_select()`, `_selectNoClose()`, `value()`, `_labelOf()`, `setLabel()`: read or change the selection. Items can be a value and a separate display label.
- `_startInlineRename()`, `onRenameRequest()`: rename an item in place.

**`ControlsManager`: connects sidebar controls to the app**
- **Setup:** `constructor()`, `initialize()`, `setupEventListeners()`, `initColorSwatches()`, `_ensureColorSwatch()`, `initMaterialSections()`, `_bindMaterialSection()`, `initGridSettings()`, `enhanceValueInputs()`, `wrapValueInput()`.
- **Linking inputs:** `linkSliderInput()`, `linkColorPicker()`.
- **Texture channels:** `_setupChannelPickers()`, `_drawChannelThumb()`, `_showChannelTexPreview()`.
- **Dropdowns:** `updateModelSelect()`, `updateSceneSelect()`, `updateMaterialPresetSelect()`, `updatePartSelect()`, `setMaterialPresetValue()`, `getMaterialPresetValue()`, `onMaterialRenameRequest()`.
- **Syncing and control state:** `syncMaterialUI()`, `syncOneMaterialProp()`, `setEnabled()`, `setVisible()`.

**Sidebar layout:** `initObjectPropsTabs()`, `initDebugPanelWidth()`.

### `ui/ControlPreferences.js`

- `collectControlPreferences()`, `restoreControlPreferences()`, `bindControlPreferences()`: read, restore and watch UI and export preferences.

### `ui/HistoryManager.js`: `HistoryManager`

A general undo and redo stack.

- `constructor()`, `init()`, `push()`, `clear()`: manage entries.
- `undo()`, `redo()`, `jumpTo()`: move through history.
- `peekUndoTimestamp()`, `peekRedoTimestamp()`, `getEntries()`: read history.

### `ui/NodeEditorManager.js`: `NodeEditorManager`

**Helpers:** `hexToRgb()`, `rgbToHex()`, `blendHex()`, `lightenHex()`, `darkenHex()`, `s()`, `bezier()`, `portSectionY()`, `portRelY()`, `outputPortY()`, `nodeHeight()`, `matPortSection()`, `matOutputPortY()`, `matOutputNodeHeight()`.

**Class methods**
- **Opening and connecting to the app:** `constructor()`, `open()`, `close()`, `setMaterialOutputHandler()`, `_changed()`, `setCollections()`, `setSelection()`.
- **Saving and loading graphs:** `getGraphData()`, `loadGraphData()`, `removeGraphsForObject()`, `_saveGraph()`, `_loadGraph()`.
- **Syncing with material controls:** `syncMaterialProp()`, `syncMaterialProps()`, `_syncOnePortControl()`. Graphs stay per part: a graph's output edits the part's material, so linked parts follow, and opening a graph doesn't send anything.
- **Building the editor:** `_build()`, `_buildLeftPanel()`, `_buildCanvas()`, `_renderCollections()`.
- **Nodes:** `_placeMaterialOutputNode()`, `_placeNode()`, `_renderNode()`, `_renderMaterialNode()`, `_deleteNode()`, `_evaluateNode()`, `_evaluateFrom()`.
- **Connections:** `_onConnectionRemoved()`, `_portTypeOf()`, `_addConnection()`, `_updateMatOutputConnStates()`, `_redrawConns()`, `_portAbsPos()`, `_bindOutputDrag()`, `_bindInputDisconnect()`.
- **Pan and zoom:** `_bindCanvasPan()`, `_startPan()`, `_bindWheelZoom()`, `_zoomBy()`, `_zoomTo()`, `_applyTransform()`, `_clientToGraph()`, `_centerView()`.
- **Menus and window:** `_bindMenu()`, `_addCollection()`, `_deleteSelected()`, `_openRenameForm()`, `_closeRenameForm()`, `_bindDrag()`, `_centre()`, `_bindResize()`.

### `ui/UVEditor.js`: `UVEditor`

The Design Editor tab.

- **Setup and opening:** `constructor()`, `_setupInlineUI()`, `_linkSlider()`, `open()`, `openWithPreloadedData()`, `show()`, `setPartNames()`.
- **Per-part design state:** `_freshPartFields()`, `_capturePartFields()`, `_cleanMapOf()`, `_nextLayerId()`, `_ensureCanvas()`, `_ensureDesignCanvases()`, `_freeDesignCanvases()`, `_stashActivePart()`, `_switchToPart()`, `_finishPartSwitch()`, `_withPartState()`, `_forEachStoredPart()`, `_syncDesignToLayers()`, `_clearActiveDesign()`, `clearAllPartDesigns()`, `hasPartDesign()`, `getPartBaseTexture()`, `withOriginalMaterialValues()`.
- **Layers:** `handleImageUpload()`, `selectImage()`, `deleteSelectedImage()`, `_updateLayersList()`, `_setSelected()`, `_syncSlidersFromImage()`.
- **Moving designs:** `nudgeSelected()`, `rotateSelected()`, `resetSelectedTransform()`, `_flipSelected()`, `_getLocalMouseCoords()`, `_wrapPercent()`, `_getWrapCenters()`, `_updateCursor()`, `_onMouseDown()`, `_onMouseMove()`.
- **Text layers:** `_openTextPanel()`, `_closeTextPanel()`, `_onTextCreate()`, `_buildTextImage()`, `_addTextLayer()`.
- **Preview and drawing:** `_buildCheckerCache()`, `_renderPreview()`, `_renderCompositeToCanvas()`, `_renderComposite()`, `_renderCompositeDrag()`, `_restoreFullResTexture()`, `_applyDesignTextureSettings()`, `_makeStickerTexture()`, `_refreshDragTexture()`, `_designFlipY()`, `_drawTextureImage()`, `_dragImageOf()`, `_clearDragImageCache()`, `_scheduleDragRestore()`.
- **Applying designs and sticker maps:** `applyTextureToModel()`, `resetTexture()`, `_renderStickerPBRMapsDrag()`, `_renderPBRMap()`, `_updateStickerPBRIfActive()`, `_renderStickerPBRMaps()`, `_applyStickerPBRMaps()`, `_removeStickerPBRMaps()`.
- **Syncing with materials:** `updatePartMaterial()` (changes a property on any part, including an inactive one with a design), `applyPartDefinition()`, `replacePartMaterial()`, `getPartCleanChannel()`, `_setMaterialValue()`, `_applyMaterialValue()`, `prepareMaterialSwap()`, `notifyBaseMapChanged()`, `notifyPBRMapChanged()`, `notifyPartChannelChanged()`, `updateMaterialColor()`, `updateMaterialPBR()`, `commitMaterialChange()`, `reapplyDecalState()`, `_reapplyPartDecalState()`, `onMaterialPresetApplied()`, `getCleanMaterialForThumbnail()`.
- **View toggles:** `_deactivateCheckUV()`, `_toggleCheckUV()`, `_toggleWrap()`, `_togglePreviewUV()`, `_drawUVWireframe()`.
- **History, saving and session:** `saveAsCustomModel()`, `restoreHistoryState()`, `_copyLayers()`, `_sameLayers()`, `snapshotOverlays()`, `_imageToDataURL()`, `getSessionState()`, `restoreSessionState()`, `onLayersSaved()`, `_notifyLayersSaved()`, `encodeLayerImage()`.

## `utils/`

### `utils/TextureCompositor.js`: `TextureCompositor`

- `createCompositeTexture()`: combines a base texture and overlay images into one texture.

### `utils/helpers.js`

- `centerAndFrameModel()`: frames a model in the camera.
- `cleanupObject()`, `disposeMaterial()`: free Three.js memory.
- `readFileAsText()`, `readFileAsDataURL()`, `downloadFile()`: file helpers.
- `generateId()`, `clamp()`, `lerp()`, `formatBytes()`, `debounce()`, `deepClone()`: general helpers.

### `utils/imageAssets.js`

- `fileDataURL()`: reads an image for display, giving SVGs explicit dimensions while the uploaded file stays unchanged.
- `loadDesignImage()`: loads a design image from a data URL.

### `utils/logger.js`

- **`Logger` class:** `constructor()`, `log()`, `error()`, `warn()`, `success()`, `clear()`, `getLogs()`, `export()`.
- **Module functions:** `log()`, `logError()`, `logWarn()`, `logSuccess()`.

### `utils/modelAssets.js`

- `assertSelfContainedGLTF()`: rejects a `.glb` or `.gltf` file that depends on external files.

## License

Proprietary
