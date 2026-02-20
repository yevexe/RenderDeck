# RenderDeck

A browser-based 3D rendering application built with Three.js for creating, customizing, and previewing 3D models with PBR (Physically Based Rendering) materials.

## Features

### Material Editor (Tab 3)
Full MeshPhysicalMaterial support with controls for:
- Base color, metalness, roughness
- Specular color and intensity
- Clearcoat and clearcoat roughness
- Transparency and opacity
- Transmission (glass), IOR, thickness
- Volume absorption (attenuation)
- Sheen and sheen roughness
- Emissive color and intensity
- Environment map intensity

### Design Editor (Tab 2)
Apply custom images/logos to 3D models:
- Upload PNG, JPG, or SVG images
- Position, scale, and rotate overlays on a UV preview canvas
- Live preview with drag-and-drop repositioning
- Save as custom models with all overlays preserved

### Camera Controls (Tab 4)
- Perspective and orthographic camera modes
- Lens presets (18mm to 85mm)
- Film/sensor gauge selection (Full Frame, APS-C, Micro Four Thirds)
- Near/far clipping planes
- Tone mapping (ACES, Reinhard, Cineon)
- Exposure control
- Depth of Field settings

### Post-Processing (Tab 6)
- Bloom (strength, radius, threshold)
- Vignette (intensity, softness)
- Ambient Occlusion (intensity, radius)
- Motion blur
- Presets: Basic, Pretty, Cinema

### Preview Quality (Tab 5)
- Resolution presets (720p to 4K)
- Render scale and DPR settings
- Anti-aliasing modes (MSAA, FXAA)
- Shadow quality control
- Wireframe mode
- Grid and axes helpers

### Model Management (Tab 1)
- Built-in model library
- Drag & drop OBJ file import
- Custom model export/import (.renderdeck.json)
- HDR environment lighting

## Project Structure

```
renderdeck/
├── index.html              # Main HTML with tab UI
├── styles.css              # Styling
├── js/
│   ├── main.js             # Application orchestrator
│   ├── config.js           # Centralized configuration
│   ├── scenes.js           # HDR environment loader
│   ├── core/
│   │   ├── Scene.js        # Three.js scene manager
│   │   ├── Renderer.js     # WebGL renderer + post-processing
│   │   └── Camera.js       # Camera and orbit controls
│   ├── materials/
│   │   └── MaterialManager.js  # PBR material presets
│   ├── models/
│   │   ├── ModelManager.js     # Model loading and storage
│   │   ├── ModelVerifier.js    # File validation
│   │   └── CustomModelStorage.js  # IndexedDB storage
│   ├── ui/
│   │   ├── Controls.js     # UI control bindings
│   │   └── UVEditor.js     # Design editor implementation
│   └── utils/
│       ├── TextureCompositor.js  # Texture compositing
│       ├── indexedDBStorage.js   # IndexedDB wrapper
│       ├── helpers.js      # Utility functions
│       ├── logger.js       # Logging utilities
│       └── generators.js   # Procedural texture generation
└── assets/
    ├── models/             # OBJ/MTL files
    └── hdri/               # HDR environment maps
```

## Dependencies

- [Three.js](https://threejs.org/) v0.175.0 - 3D rendering
- Uses ES modules via import maps (no build step required)

## Usage

1. Serve the project with any static file server
2. Open in a modern browser (Chrome, Firefox, Edge recommended)
3. Select a model from Tab 1 or drag & drop an OBJ file
4. Customize materials in Tab 3
5. Add designs/logos in Tab 2
6. Adjust camera and effects in Tabs 4-6
7. Save custom models for later use

## Keyboard Shortcuts

- **Arrow Keys** - Rotate camera
- **E / Q** - Move camera up/down
- **R** - Reset camera

## Browser Support

Requires WebGL 2.0 support. Tested on:
- Chrome 90+
- Firefox 85+
- Edge 90+
- Safari 15+

## License

Proprietary
