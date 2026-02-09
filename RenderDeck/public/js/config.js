
// CONFIG.JS - Centralized Configuration

export const CONFIG = {
  // Texture Settings
  TEXTURE: {
    DEFAULT_SIZE: 2048,
    COMPOSITE_SIZE: 2048,
    PREVIEW_SIZE: 512,
    MAX_SIZE: 4096,
    MIN_SIZE: 512,
    ENCODING: 'sRGBEncoding'
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
    MAX_MODEL_SIZE: 50 * 1024 * 1024, // 50MB
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

// Feature Flags (turn features on/off easily)
export const FEATURES = {
  ENABLE_DEBUG_LOGGING: true,
  ENABLE_CUSTOM_MODELS: true,
  ENABLE_MODEL_EXPORT: true,
  ENABLE_MODEL_IMPORT: true,
  ENABLE_UNDO_REDO: false,
  ENABLE_LAYER_ORDERING: false
};

// Model Registry Paths
export const MODEL_PATHS = {
  BASE_PATH: '../models/',
  PLAIN_MUG: {
    folder: 'plain_mug',
    obj: 'mug.obj',
    mtl: null  
  },
  SIMPLE_PEN: {
    folder: 'simple_pen',
    obj: 'pen.obj',
    mtl: 'pen.mtl'  
  }
};

// Scene Environment Paths
export const SCENE_PATHS = {
  BASE_PATH: '../scenes/',
  ENVIRONMENTS: {
    'Studio Kominka': 'studio_kominka_02_2k.hdr',
    'Lebombo': 'lebombo_2k.hdr'
  }
};