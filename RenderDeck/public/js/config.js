
// CONFIG.JS - Centralized Configuration

export const CONFIG = {
  // Texture Settings
  TEXTURE: {
    DEFAULT_SIZE: 2048,
    COMPOSITE_SIZE: 2048,
    PREVIEW_SIZE: 512,
    MAX_SIZE: 4096,
    MIN_SIZE: 512,
    COLOR_SPACE: 'SRGBColorSpace'
  },

  // Material Defaults
  MATERIALS: {
    WOOD: {
      roughness: 0.85,
      metalness: 0.0
    },
    METAL: {
      roughness: 0.2,
      metalness: 0.9
    },
    GLASS: {
      roughness: 0.05,
      metalness: 0.1,
      opacity: 0.45,
      transparent: true
    },
    PLASTIC: {
      roughness: 0.3,
      metalness: 0.05
    }
  },

  // File Upload Limits
  UPLOAD: {
    MAX_IMAGE_SIZE: 20 * 1024 * 1024, // 20MB
    MAX_MODEL_SIZE: 200 * 1024 * 1024, // 200MB
    MAX_IMAGE_DIMENSION: 8192,
    ALLOWED_IMAGE_FORMATS: ['.png', '.jpg', '.jpeg', '.webp', '.gif'],
    ALLOWED_MODEL_FORMATS: ['.obj', '.mtl']
  },

  // UV Editor
  UV_EDITOR: {
    DEFAULT_WIDTH: 1200,
    DEFAULT_HEIGHT: 700,
    MIN_WIDTH: 800,
    MIN_HEIGHT: 500,
    CANVAS_SIZE: 512,
    HANDLE_SIZE: 6,
    SELECTION_COLOR: '#4CAF50'
  },

  // Storage
  STORAGE: {
    DB_NAME: 'renderDeck_customModels',
    VERSION: 2,
    MODELS_STORE: 'models',
    BLOBS_STORE: 'blobs'
  },

  // Scene
  SCENE: {
    CAMERA_FOV: 50,
    CAMERA_NEAR: 0.1,
    CAMERA_FAR: 2000,
    CAMERA_POSITION: { x: 0, y: 1, z: 5 },
    DEFAULT_ENV: 'Studio Kominka',
    BACKGROUND_COLOR: 0x1a1a1a
  },

  // Lighting
  LIGHTING: {
    AMBIENT_INTENSITY: 0.6,
    DIRECTIONAL_INTENSITY: 0.8,
    DIRECTIONAL_POSITION: { x: 5, y: 10, z: 7.5 },
    SHADOW_MAP_SIZE: 2048,
    SHADOW_CAMERA_SIZE: 10
  },

  // Controls
  CONTROLS: {
    DAMPING_ENABLED: true,
    DAMPING_FACTOR: 0.05
  }
};

// Feature Flags
export const FEATURES = {
  ENABLE_DEBUG_LOGGING: true,
  ENABLE_CUSTOM_MODELS: true,
  ENABLE_MODEL_EXPORT: true,
  ENABLE_MODEL_IMPORT: true,
  ENABLE_UNDO_REDO: false,
  ENABLE_LAYER_ORDERING: false
};

// Standard 3D Objects
// label must stay stable — IndexedDB custom models store basedOn: label
export const STANDARD_OBJECTS = [
  {
    id: 'plain_mug',
    label: 'Plain Mug',
    objPath: './assets/standard/objects/RDO_Standard_Mug.obj',
    mtlPath: null
  },
  {
    id: 'simple_pen',
    label: 'Simple Pen',
    objPath: './assets/standard/objects/RDO_Standard_Pen.obj',
    mtlPath: './assets/standard/materials/RDM_Standard_Pen.mtl'
  },
];

// Standard HDR Environments
export const STANDARD_ENVIRONMENTS = [
  {
    id: 'studio_kominka',
    label: 'Studio Kominka',
    path: './assets/standard/environments/RDE_StudioKominka_2k.hdr'
  },
  {
    id: 'lebombo',
    label: 'Lebombo',
    path: './assets/standard/environments/RDE_Lebombo_2K.hdr'
  },
];

// Prop Assets
export const PROP_PATHS = {
  BASE_PATH: 'props/',
  GLASS_WAITING_ROOM_TABLE: {
    file: 'glass_waiting_room_table.glb',
    category: 'Furniture',
    displayName: 'Glass Waiting Room Table'
  },
  LAPTOP: {
    file: 'laptop.glb',
    category: 'Electronics',
    displayName: 'Laptop'
  }
};

// Standard Material Presets (JSON files)
export const STANDARD_MATERIALS = [
  {
    id: 'RDM_Ceramic_Porcelain_GlossyWhite',
    label: 'Ceramic — Porcelain Glossy White',
    path: './assets/standard/materials/RDM_Ceramic_Porcelain_GlossyWhite.json'
  },
  {
    id: 'RDM_Glass_Clear_IOR150',
    label: 'Glass — Clear (IOR 1.50)',
    path: './assets/standard/materials/RDM_Glass_Clear_IOR150.json'
  },
  {
    id: 'RDM_Metal_Aluminum_Anodized_Satin',
    label: 'Metal — Aluminum Anodized Satin',
    path: './assets/standard/materials/RDM_Metal_Aluminum_Anodized_Satin.json'
  },
  {
    id: 'RDM_Metal_Chrome_Mirror',
    label: 'Metal — Chrome Mirror',
    path: './assets/standard/materials/RDM_Metal_Chrome_Mirror.json'
  },
  {
    id: 'RDM_Metal_Gold_Polished',
    label: 'Metal — Gold Polished',
    path: './assets/standard/materials/RDM_Metal_Gold_Polished.json'
  },
  {
    id: 'RDM_Paint_Acrylic_SatinBlue',
    label: 'Paint — Acrylic Satin Blue',
    path: './assets/standard/materials/RDM_Paint_Acrylic_SatinBlue.json'
  },
  {
    id: 'RDM_Rubber_Silicone_MatteBlack',
    label: 'Rubber — Silicone Matte Black',
    path: './assets/standard/materials/RDM_Rubber_Silicone_MatteBlack.json'
  },
];
