# RenderDeck

A browser-based 3D rendering application built with Three.js for creating, customizing, and previewing 3D models with PBR (Physically Based Rendering) materials.

## Tabs

### Tab 1 - Scene Set-Up
- Built-in model library with standard objects
- Drag and drop OBJ/GLB/GLTF file import
- Custom model export and import (.renderdeck.json)
- HDR environment lighting with presets
- Props system: add, remove, translate, rotate, and scale prop objects using transform gizmos
- Background options: HDR environment, solid color, or gradient presets
- Custom scene saving and loading (named scene files stored in IndexedDB)
- Scene history panel: undo/redo for environment, background, prop, and model transform changes

### Tab 2 - Design Editor
- Upload PNG, JPG, or SVG images as overlays onto 3D model UV maps
- Position, scale, rotate, flip, and delete overlay images on a UV preview canvas
- Live preview updates while dragging (after applying texture to model)
- Apply composite texture to model with a single click
- Design history panel: undo/redo for overlay changes with Ctrl+Z / Ctrl+Shift+Z

### Tab 3 - Materials
- Full MeshPhysicalMaterial support:
  - Base color, metalness, roughness
  - Specular color and intensity
  - Clearcoat and clearcoat roughness
  - Transparency and opacity
  - Transmission (glass), IOR, thickness
  - Volume absorption (attenuation)
  - Sheen and sheen roughness
  - Emissive color and intensity
  - Environment map intensity
- Material presets with save/load support
- Per-channel texture upload (albedo, normal, roughness, etc.)
- Material history panel: undo/redo for material property changes

### Tab 4 - Camera
- Perspective and orthographic camera modes
- Lens presets (18mm to 85mm)
- Film/sensor gauge selection (Full Frame, APS-C, Micro Four Thirds)
- Near/far clipping planes
- Tone mapping (ACES Filmic, Reinhard, Cineon)
- Exposure control
- Depth of field settings

### Tab 5 - Preview Quality
- Resolution presets (720p to 4K)
- Render scale and DPR settings
- Anti-aliasing modes (MSAA, FXAA)
- Shadow quality control
- Wireframe mode
- Grid and axes helpers

### Tab 6 - Post-Processing
- Bloom (strength, radius, threshold)
- Vignette (intensity, softness)
- Ambient occlusion (intensity, radius)
- Motion blur
- Presets: Basic, Pretty, Cinema

## Project Structure

```
public/
├── index.html
├── styles.css
└── js/
    ├── main.js                         # Application orchestrator
    ├── config.js                       # Centralized configuration
    ├── core/
    │   ├── Scene.js                    # Three.js scene manager
    │   ├── Renderer.js                 # WebGL renderer and post-processing
    │   ├── Camera.js                   # Camera and orbit controls
    │   └── SceneLoader.js             # HDR environment loader
    ├── materials/
    │   ├── MaterialManager.js          # PBR material presets and properties
    │   └── generators.js              # Procedural texture generation
    ├── models/
    │   ├── ModelManager.js            # Model loading and management
    │   └── ModelVerifier.js           # File validation
    ├── props/
    │   └── PropManager.js             # Prop loading, selection, and transform gizmos
    ├── scenes/
    │   └── CustomSceneStorage.js      # Named scene save/load via IndexedDB
    ├── stateEditor/
    │   ├── historyUtils.js            # Shared history UI utilities
    │   ├── SceneState.js              # Undo/redo for scene changes
    │   ├── DesignState.js             # Undo/redo for UV overlay changes
    │   └── MaterialState.js          # Undo/redo for material property changes
    ├── storage/
    │   ├── CustomModelStorage.js      # Custom model IndexedDB storage
    │   └── indexedDBStorage.js        # IndexedDB wrapper
    ├── ui/
    │   ├── Controls.js                # UI control bindings
    │   ├── HistoryManager.js          # Generic undo/redo stack
    │   └── UVEditor.js               # Design editor canvas implementation
    └── utils/
        ├── TextureCompositor.js       # Offscreen texture compositing
        ├── helpers.js                 # Utility functions
        └── logger.js                  # Logging utilities
```

## Keyboard Shortcuts

- **Ctrl+Z** - Undo design change
- **Ctrl+Shift+Z** - Redo design change
- **Ctrl+Y** - Redo design change

## Dependencies

- Three.js v0.175.0 - 3D rendering (loaded via import map, no build step required)

## Browser Support

Requires WebGL 2.0. Tested on:
- Chrome 90+
- Firefox 85+
- Edge 90+
- Safari 15+

## Usage

1. Serve the project with any static file server
2. Open in a modern browser
3. Select or import a model in Tab 1
4. Add props and set up the scene in Tab 1
5. Apply logos or images in Tab 2
6. Adjust materials in Tab 3
7. Configure camera and effects in Tabs 4-6
8. Save custom models or scenes for later use

## License

Proprietary
