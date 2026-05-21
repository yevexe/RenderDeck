const CACHE = 'renderdeck-shell-v2';

const SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/js/config.js',
  '/js/main.js',
  '/js/core/Camera.js',
  '/js/core/Renderer.js',
  '/js/core/Scene.js',
  '/js/core/SceneLoader.js',
  '/js/materials/generators.js',
  '/js/materials/MaterialManager.js',
  '/js/models/ModelManager.js',
  '/js/models/ModelVerifier.js',
  '/js/projects.js',
  '/js/props/PropManager.js',
  '/js/scenes/CustomSceneStorage.js',
  '/js/shaders/CustomVignetteShader.js',
  '/js/shaders/DepthOfFieldShader.js',
  '/js/sketchfab/SketchfabAPI.js',
  '/js/sketchfab/SketchfabLoader.js',
  '/js/sketchfab/SketchfabModal.js',
  '/js/stateEditor/DesignState.js',
  '/js/stateEditor/historyUtils.js',
  '/js/stateEditor/MaterialState.js',
  '/js/stateEditor/SceneState.js',
  '/js/storage/CustomModelStorage.js',
  '/js/storage/indexedDBStorage.js',
  '/js/storage/ProjectStorage.js',
  '/js/ui/Controls.js',
  '/js/ui/HistoryManager.js',
  '/js/ui/NodeEditorManager.js',
  '/js/ui/UVEditor.js',
  '/js/utils/helpers.js',
  '/js/utils/logger.js',
  '/js/utils/TextureCompositor.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  // Only handle same-origin GET requests
  if (request.method !== 'GET' || !request.url.startsWith(self.location.origin)) return;

  const url = new URL(request.url);

  // Skip large binary assets — let them go to network directly
  if (/\.(hdr|exr|glb|gltf|obj|mtl|mp4|webm)$/i.test(url.pathname)) return;

  // Shell assets: cache-first
  if (SHELL.some(p => url.pathname === p || url.pathname === p + '/')) {
    e.respondWith(
      caches.open(CACHE).then(c =>
        c.match(request).then(cached => cached || fetch(request).then(r => {
          if (r.ok) c.put(request, r.clone());
          return r;
        }))
      )
    );
    return;
  }

  // Other same-origin requests (JSON manifests, small textures, fonts):
  // network-first, fall back to cache
  e.respondWith(
    fetch(request)
      .then(r => {
        if (r.ok) caches.open(CACHE).then(c => c.put(request, r.clone()));
        return r;
      })
      .catch(() => caches.match(request))
  );
});
