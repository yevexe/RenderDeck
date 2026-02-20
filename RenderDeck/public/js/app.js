// js/app.js
// RenderDeck — Main Application
// Includes:
//   1) AssetRegistry    — manifest loading, menu population, material JSON fetching
//   2) MaterialSettings — applies fetched material JSON to UI fields + sliders
//   3) SceneManager     — Three.js scene: renderer, camera, lighting, object loading
//                       — Settings 4 (Camera), 5 (Preview Quality), 6 (PostFX) bound to preview
//   4) Boot             — load manifest -> populate menus -> init scene -> apply defaults
//
// NOTE: Color picker <-> hex sync and slider <-> input binding are handled entirely
// by controls.js (bindColorPickerHex / bindInputSlider). No duplication here.

(() => {
    // ============================================================================
    // 1) AssetRegistry
    // ============================================================================
    const AssetRegistry = (() => {
        const state = {
            manifestUrl: "assets/manifest.json",
            manifest: null,
            objectsById: new Map(),
            materialsById: new Map(),
            envsById: new Map(),
            materialDataCache: new Map(),
            standardObjects: [],
            userObjects: [],
            standardMaterials: [],
            userMaterials: [],
            standardEnvironments: [],
            userEnvironments: []
        };

        function findSeparatorIndex(selectEl, text) {
            const target = (text || "").trim();
            return Array.from(selectEl.options).findIndex(
                (o) => o.disabled && (o.textContent || "").trim() === target
            );
        }

        function removeNonDisabledOptions(selectEl) {
            const keep = Array.from(selectEl.options).filter((o) => o.disabled);
            selectEl.innerHTML = "";
            keep.forEach((o) => selectEl.add(o));
        }

        function insertOptionsAfter(selectEl, afterIndex, items, { valueKey = "id", labelKey = "label" } = {}) {
            let insertAt = afterIndex + 1;
            for (const item of items) {
                const opt = document.createElement("option");
                opt.value = item?.[valueKey] ?? "";
                opt.textContent = item?.[labelKey] ?? item?.[valueKey] ?? "Unnamed";
                if (insertAt >= selectEl.options.length) selectEl.add(opt);
                else selectEl.add(opt, selectEl.options[insertAt]);
                insertAt++;
            }
        }

        async function loadManifest(manifestUrl = state.manifestUrl) {
            state.manifestUrl = manifestUrl;
            const res = await fetch(manifestUrl, { cache: "no-store" });
            if (!res.ok) throw new Error(`Failed to fetch manifest: ${manifestUrl} (${res.status})`);
            const manifest = await res.json();
            state.manifest = manifest;
            buildRegistries(manifest);
            return state;
        }

        function buildRegistries(manifest) {
            state.objectsById.clear();
            state.materialsById.clear();
            state.envsById.clear();

            state.standardObjects = (manifest?.standard?.objects ?? []).slice();
            state.userObjects = (manifest?.user?.objects ?? []).slice();
            state.standardMaterials = (manifest?.standard?.materials ?? []).slice();
            state.userMaterials = (manifest?.user?.materials ?? []).slice();
            state.standardEnvironments = (manifest?.standard?.environments ?? []).slice();
            state.userEnvironments = (manifest?.user?.environments ?? []).slice();

            for (const o of [...state.standardObjects, ...state.userObjects])
                if (o?.id) state.objectsById.set(o.id, o);
            for (const m of [...state.standardMaterials, ...state.userMaterials])
                if (m?.id) state.materialsById.set(m.id, m);
            for (const e of [...state.standardEnvironments, ...state.userEnvironments])
                if (e?.id) state.envsById.set(e.id, e);
        }

        function populateMenus({
            objectSelectId = "object-select",
            objectSelectIds = null,
            materialSelectId = "material-select",
            environmentSelectId = "environment-select"
        } = {}) {
            for (const id of objectSelectIds ?? [objectSelectId]) {
                const sel = document.getElementById(id);
                if (!sel) continue;
                removeNonDisabledOptions(sel);

                const stdSep = findSeparatorIndex(sel, "--- Standard Objects ---");
                const usrSep = findSeparatorIndex(sel, "--- User Objects ---");

                if (stdSep !== -1) insertOptionsAfter(sel, stdSep, state.standardObjects);
                if (usrSep !== -1) insertOptionsAfter(sel, usrSep, state.userObjects);
                else insertOptionsAfter(sel, sel.options.length - 1, state.userObjects);
            }

            const materialSel = document.getElementById(materialSelectId);
            if (materialSel) {
                removeNonDisabledOptions(materialSel);

                const stdSep = findSeparatorIndex(materialSel, "--- Standard Materials ---");
                const usrSep = findSeparatorIndex(materialSel, "--- User Materials ---");

                if (stdSep !== -1) insertOptionsAfter(materialSel, stdSep, state.standardMaterials);
                if (usrSep !== -1) insertOptionsAfter(materialSel, usrSep, state.userMaterials);
                else insertOptionsAfter(materialSel, materialSel.options.length - 1, state.userMaterials);
            }

            const envSel = document.getElementById(environmentSelectId);
            if (envSel) {
                removeNonDisabledOptions(envSel);

                const stdSep = findSeparatorIndex(envSel, "--- Standard Lighting ---");
                const usrSep = findSeparatorIndex(envSel, "--- User Lighting ---");

                if (stdSep !== -1) insertOptionsAfter(envSel, stdSep, state.standardEnvironments);
                if (usrSep !== -1) insertOptionsAfter(envSel, usrSep, state.userEnvironments);
                else insertOptionsAfter(envSel, envSel.options.length - 1, state.userEnvironments);
            }
        }

        function getObjectById(id) { return state.objectsById.get(id) ?? null; }
        function getMaterialById(id) { return state.materialsById.get(id) ?? null; }
        function getEnvironmentById(id) { return state.envsById.get(id) ?? null; }

        async function fetchMaterialData(materialId) {
            if (state.materialDataCache.has(materialId)) return state.materialDataCache.get(materialId);

            const entry = getMaterialById(materialId);
            if (!entry) return null;

            const typeHint = (entry.typeHint ?? "").toLowerCase();
            const path = entry.path ?? "";
            if (typeHint === "mtl" || path.endsWith(".mtl")) {
                console.log("Skipping MTL material:", materialId);
                return null;
            }

            try {
                const res = await fetch(path, { cache: "no-store" });
                if (!res.ok) throw new Error("HTTP " + res.status);
                const data = await res.json();
                state.materialDataCache.set(materialId, data);
                return data;
            } catch (err) {
                console.warn(`Failed to fetch material JSON for "${materialId}" at "${path}":`, err);
                return null;
            }
        }

        return {
            state,
            loadManifest,
            populateMenus,
            getObjectById,
            getMaterialById,
            getEnvironmentById,
            fetchMaterialData
        };
    })();

    window.AssetRegistry = AssetRegistry;

    // ============================================================================
    // 2) MaterialSettings
    // ============================================================================
    const MaterialSettings = (() => {
        function $(id) { return document.getElementById(id); }

        function isHexColor(s) {
            return typeof s === "string" && /^#[0-9a-fA-F]{6}$/.test(s.trim());
        }

        function normalizeHex(s, fallback) {
            fallback = fallback || "#ffffff";
            if (!s) return fallback;
            const t = String(s).trim();
            if (isHexColor(t)) return t.toUpperCase();
            if (/^[0-9a-fA-F]{6}$/.test(t)) return ("#" + t).toUpperCase();
            return fallback;
        }

        // Set a numeric input + its paired slider, then fire events so SceneManager picks it up
        function setInputValue(id, value) {
            const el = $(id);
            if (!el) return;
            el.value = value;
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));

            // Sync paired slider if naming convention matches
            const sliderId = id.replace(/-input$/, "-slider");
            if (sliderId !== id) {
                const slider = $(sliderId);
                if (slider) {
                    slider.value = value;
                    slider.dispatchEvent(new Event("input", { bubbles: true }));
                }
            }
        }

        function setCheckbox(id, checked) {
            const el = $(id);
            if (!el) return;
            el.checked = !!checked;
            el.dispatchEvent(new Event("change", { bubbles: true }));
        }

        // Update color picker + hex field + swatch — controls.js handles the bidirectional
        // sync between them, but we need to set both to keep them consistent.
        function setColorUI(ids, hex) {
            const color = normalizeHex(hex);
            if (ids.pickerId) {
                const p = $(ids.pickerId);
                if (p) { p.value = color; p.dispatchEvent(new Event("input", { bubbles: true })); }
            }
            if (ids.hexId) {
                const h = $(ids.hexId);
                if (h) { h.value = color; h.dispatchEvent(new Event("input", { bubbles: true })); }
            }
            if (ids.swatchId) {
                const sw = $(ids.swatchId);
                if (sw) sw.style.backgroundColor = color;
            }
        }

        const UI = {
            baseColor:          { pickerId: "basecolor-picker",     hexId: "basecolor-hex",    swatchId: "basecolor-swatch"  },
            metalness:          "metalness-input",
            roughness:          "roughness-input",
            specularColor:      { pickerId: "speccolor-picker",     hexId: "speccolor-hex",    swatchId: "speccolor-swatch"  },
            specularIntensity:  "specint-input",
            clearcoatEnabled:   "clearcoat-enable",
            clearcoat:          "clearcoat-input",
            clearcoatRoughness: "clearcoatrough-input",
            opacityEnabled:     "opacity-enable",
            opacity:            "opacity-input",
            transmissionEnabled:"trans-enable",
            transmission:       "transmission-input",
            ior:                "ior-input",
            thickness:          "thickness-input",
            attenuationEnabled: "atten-enable",
            attenuationDistance:"attdist-input",
            attenuationColor:   { pickerId: "attcolor-picker",      hexId: "attcolor-hex",     swatchId: "attcolor-swatch"   },
            sheenEnabled:       "sheen-enable",
            sheenRoughness:     "sheenrough-input",
            sheenColor:         { pickerId: "sheencolor-picker",    hexId: "sheencolor-hex",   swatchId: "sheencolor-swatch" },
            emissiveEnabled:    "emissive-enable",
            emissiveColor:      { pickerId: "emissivecolor-picker", hexId: "emissive-hex",     swatchId: "emissive-swatch"   },
            emissiveIntensity:  "emissiveint-input",
            envMapIntensity:    "envint-input"
        };

        function extractSettings(data) {
            if (!data || typeof data !== "object") return {};
            return data.params || data.settings || data.ui || data;
        }

        function applyMaterialToUI(data) {
            const s = extractSettings(data);
            if (!s || typeof s !== "object") {
                console.warn("applyMaterialToUI: no settings found in", data);
                return;
            }

            const baseHex = s.baseColor || s.color || s.basecolor || s.albedo;
            if (baseHex != null) setColorUI(UI.baseColor, baseHex);

            if (s.metalness         != null) setInputValue(UI.metalness,          String(s.metalness));
            if (s.roughness         != null) setInputValue(UI.roughness,           String(s.roughness));
            if (s.specularIntensity != null) setInputValue(UI.specularIntensity,   String(s.specularIntensity));
            if (s.clearcoat         != null) setInputValue(UI.clearcoat,           String(s.clearcoat));
            if (s.clearcoatRoughness!= null) setInputValue(UI.clearcoatRoughness,  String(s.clearcoatRoughness));
            if (s.opacity           != null) setInputValue(UI.opacity,             String(s.opacity));
            if (s.transmission      != null) setInputValue(UI.transmission,        String(s.transmission));
            if (s.ior               != null) setInputValue(UI.ior,                 String(s.ior));
            if (s.thickness         != null) setInputValue(UI.thickness,           String(s.thickness));
            if (s.attenuationDistance!=null) setInputValue(UI.attenuationDistance, String(s.attenuationDistance));
            if (s.sheenRoughness    != null) setInputValue(UI.sheenRoughness,      String(s.sheenRoughness));
            if (s.emissiveIntensity != null) setInputValue(UI.emissiveIntensity,   String(s.emissiveIntensity));
            if (s.envMapIntensity   != null) setInputValue(UI.envMapIntensity,     String(s.envMapIntensity));

            if (s.clearcoatEnabled   != null) setCheckbox(UI.clearcoatEnabled,    s.clearcoatEnabled);
            if (s.opacityEnabled     != null) setCheckbox(UI.opacityEnabled,      s.opacityEnabled);
            if (s.transmissionEnabled!= null) setCheckbox(UI.transmissionEnabled, s.transmissionEnabled);
            if (s.attenuationEnabled != null) setCheckbox(UI.attenuationEnabled,  s.attenuationEnabled);
            if (s.sheenEnabled       != null) setCheckbox(UI.sheenEnabled,        s.sheenEnabled);
            if (s.emissiveEnabled    != null) setCheckbox(UI.emissiveEnabled,     s.emissiveEnabled);

            if (s.specularColor     != null) setColorUI(UI.specularColor,     s.specularColor);
            if (s.attenuationColor  != null) setColorUI(UI.attenuationColor,  s.attenuationColor);
            if (s.sheenColor        != null) setColorUI(UI.sheenColor,        s.sheenColor);
            if (s.emissiveColor     != null) setColorUI(UI.emissiveColor,     s.emissiveColor);

            if (window.SceneManager && window.SceneManager.applyUIStateToMaterial) {
                window.SceneManager.applyUIStateToMaterial();
            }
        }

        function onMaterialSelectionChanged() {
            const sel = document.getElementById("material-select");
            if (!sel) return;
            const id = sel.value;
            if (!id) return;

            const reg = window.AssetRegistry;
            if (!reg) { console.warn("AssetRegistry not available"); return; }

            reg.fetchMaterialData(id).then((data) => {
                if (!data) { console.warn("No material data for id:", id); return; }
                applyMaterialToUI(data);
            });
        }

        function init() {
            const sel = document.getElementById("material-select");
            if (!sel) return;
            sel.addEventListener("change", onMaterialSelectionChanged);
            if (sel.value) onMaterialSelectionChanged();
        }

        if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
        else init();

        return { applyMaterialToUI, refreshFromSelection: onMaterialSelectionChanged };
    })();

    window.MaterialSettings = MaterialSettings;

    // ============================================================================
    // 3) SceneManager — Three.js preview + Tabs 4/5/6 bindings
    // ============================================================================
    const SceneManager = (() => {
        let renderer, scene, camera, orthoCamera, activeCamera, controls;
        let currentMesh = null;
        let currentMaterial = null;
        let container = null;
        let keys = {};

        // helpers
        let gridHelper = null;
        let axesHelper = null;

        // lighting refs
        let keyLight = null;

        // resolution / scaling
        let renderScale = 1.0;

        // postfx
        let composer = null;
        let renderPass = null;
        let vignettePass = null;

        // ---- Utils ----
        function $(id) { return document.getElementById(id); }
        function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

        function parseResString(s) {
            const m = String(s || "").match(/^(\d+)\s*x\s*(\d+)$/i);
            if (!m) return null;
            return { w: parseInt(m[1], 10), h: parseInt(m[2], 10) };
        }

        function getContainerSize() {
            const w = container?.clientWidth || 960;
            const h = container?.clientHeight || 540;
            return { w, h };
        }

        // ---- Ground object on Y=0 (grid plane) ----
        // Finds the lowest world-space Y vertex and lifts the object so it rests on Y=0.
        function groundObjectOnGrid(obj) {
            obj.updateMatrixWorld(true);

            let minY = Infinity;

            obj.traverse((child) => {
                if (!child.isMesh || !child.geometry) return;
                const pos = child.geometry.attributes.position;
                if (!pos) return;
                const worldMatrix = child.matrixWorld;
                const vertex = new THREE.Vector3();
                for (let i = 0; i < pos.count; i++) {
                    vertex.fromBufferAttribute(pos, i).applyMatrix4(worldMatrix);
                    if (vertex.y < minY) minY = vertex.y;
                }
            });

            if (Number.isFinite(minY)) {
                obj.position.y -= minY;
            }
        }

        // ---- Focus camera & orbit target on the object's bounding box center ----
        function focusCameraOnObject(obj) {
            if (!obj) return;
            obj.updateMatrixWorld(true);

            const box = new THREE.Box3().setFromObject(obj);
            const center = new THREE.Vector3();
            const size   = new THREE.Vector3();
            box.getCenter(center);
            box.getSize(size);

            // Orbit target = geometric center of the grounded object
            if (controls) {
                controls.target.copy(center);
                controls.update();
            }

            // Position camera so the object fits nicely in view
            const maxDim = Math.max(size.x, size.y, size.z);
            const fov = camera ? camera.fov * (Math.PI / 180) : 50 * (Math.PI / 180);
            const camDist = (maxDim / 2) / Math.tan(fov / 2) * 2.2;

            // Place camera at a nice 3/4 angle above the center
            const offset = new THREE.Vector3(camDist * 0.6, camDist * 0.5, camDist);
            activeCamera.position.copy(center).add(offset);
            activeCamera.lookAt(center);

            if (controls) controls.update();
        }

        // ---- Init ----
        function init(containerId = "scene-view-placeholder") {
            container = document.getElementById(containerId);
            if (!container) { console.error("SceneManager: container not found:", containerId); return; }

            container.style.overflow = "hidden";
            container.style.position = container.style.position || "relative";
            container.innerHTML = "";

            renderer = new THREE.WebGLRenderer({ antialias: true });
            renderer.shadowMap.enabled = true;
            renderer.shadowMap.type = THREE.PCFSoftShadowMap;
            renderer.toneMapping = THREE.ACESFilmicToneMapping;
            renderer.toneMappingExposure = 1.0;
            renderer.outputEncoding = THREE.sRGBEncoding;
            renderer.setPixelRatio(1);

            container.appendChild(renderer.domElement);

            scene = new THREE.Scene();
            scene.background = new THREE.Color(0x1a1a1a);

            const { w, h } = getContainerSize();
            const aspect = w / h;

            camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 2000);
            camera.position.set(0, 1.2, 3.5);
            camera.lookAt(0, 0.5, 0);

            orthoCamera = new THREE.OrthographicCamera(-2 * aspect, 2 * aspect, 2, -2, 0.1, 2000);
            orthoCamera.position.set(0, 1.2, 3.5);
            orthoCamera.lookAt(0, 0.5, 0);

            activeCamera = camera;

            if (typeof THREE.OrbitControls !== "undefined") {
                controls = new THREE.OrbitControls(activeCamera, renderer.domElement);
                controls.enableDamping = true;
                controls.dampingFactor = 0.07;
                controls.target.set(0, 0.5, 0);
            } else {
                console.warn("SceneManager: OrbitControls not found.");
            }

            addDefaultLighting();
            addHelpers();

            // Create initial material — only r128-compatible MeshPhysicalMaterial properties.
            // Properties NOT in r128 (added in later versions):
            //   thickness, attenuationDistance, attenuationColor  (r129+)
            //   sheenRoughness, sheenColor                        (r130+)
            //   specularIntensity, specularColor                  (r129+)
            // r128 equivalents used instead:
            //   sheen (0–1 float controls sheen intensity, no separate color/roughness params)
            //   reflectivity (0–1, legacy specular stand-in)
            currentMaterial = new THREE.MeshPhysicalMaterial({
                color:              0xff6600,
                roughness:          0.5,
                metalness:          0.0,
                clearcoat:          0.0,
                clearcoatRoughness: 0.0,
                transmission:       0.0,
                ior:                1.5,
                sheen:              0.0,
                reflectivity:       0.5,
                emissive:           new THREE.Color(0x000000),
                emissiveIntensity:  0.0,
                envMapIntensity:    1.0,
                side:               THREE.FrontSide
            });
            loadGeometry("sphere");

            window.addEventListener("resize", resizeToContainer);

            // Keyboard: only fire when canvas or body is focused (not when typing in inputs)
            window.addEventListener("keydown", (e) => {
                if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA") return;
                keys[e.key] = true;
            });
            window.addEventListener("keyup", (e) => { keys[e.key] = false; });

            const objSel1 = $("object-select");
            if (objSel1) objSel1.addEventListener("change", (e) => loadGeometry(e.target.value));

            const objSel3 = $("object-select-materialtab");
            if (objSel3) objSel3.addEventListener("change", (e) => loadGeometry(e.target.value));

            const envSel = $("environment-select");
            if (envSel) envSel.addEventListener("change", (e) => loadEnvironment(e.target.value));

            // Wire material controls (listen-only — no color/slider sync, that's controls.js)
            wireMaterialControls();
            wireCameraControls();
            wireQualityControls();
            wirePostFXControls();

            applyCameraFromUI(true);
            applyQualityFromUI(true);
            applyPostFXFromUI(true);

            resizeToContainer();
            animate();
        }

        // ---- Resize ----
        function resizeToContainer() {
            if (!container || !renderer) return;

            const cs = getContainerSize();
            const resSel = $("resolution-select");
            const chosen = resSel ? parseResString(resSel.value) : null;

            const baseW = chosen?.w || cs.w;
            const baseH = chosen?.h || cs.h;

            const rsSel = $("render-scale-select");
            renderScale = rsSel ? parseFloat(rsSel.value || "1.0") : 1.0;
            if (!Number.isFinite(renderScale) || renderScale <= 0) renderScale = 1.0;

            const targetW = Math.max(1, Math.floor(baseW * renderScale));
            const targetH = Math.max(1, Math.floor(baseH * renderScale));

            renderer.setSize(targetW, targetH, false);
            renderer.domElement.style.width = "100%";
            renderer.domElement.style.height = "100%";
            renderer.domElement.style.display = "block";

            const aspect = cs.w / cs.h;

            if (camera) { camera.aspect = aspect; camera.updateProjectionMatrix(); }
            if (orthoCamera) {
                orthoCamera.left = -2 * aspect;
                orthoCamera.right = 2 * aspect;
                orthoCamera.top = 2;
                orthoCamera.bottom = -2;
                orthoCamera.updateProjectionMatrix();
            }

            if (composer) composer.setSize(targetW, targetH);
        }

        // ---- Lighting ----
        function addDefaultLighting() {
            scene.add(new THREE.AmbientLight(0xffffff, 0.4));

            keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
            keyLight.position.set(3, 5, 3);
            keyLight.castShadow = true;
            keyLight.shadow.mapSize.width = 2048;
            keyLight.shadow.mapSize.height = 2048;
            keyLight.shadow.camera.near = 0.1;
            keyLight.shadow.camera.far = 30;
            keyLight.shadow.camera.left = -5;
            keyLight.shadow.camera.right = 5;
            keyLight.shadow.camera.top = 5;
            keyLight.shadow.camera.bottom = -5;
            scene.add(keyLight);

            const rim = new THREE.DirectionalLight(0x8888ff, 0.4);
            rim.position.set(-3, 2, -3);
            scene.add(rim);
        }

        // ---- Helpers ----
        function addHelpers() {
            gridHelper = new THREE.GridHelper(10, 10, 0x444444, 0x333333);
            gridHelper.position.y = 0;
            scene.add(gridHelper);

            axesHelper = new THREE.AxesHelper(1.5);
            scene.add(axesHelper);

            // Helpers off by default — toggle in Tab 5
            gridHelper.visible = false;
            axesHelper.visible = false;
        }

        // ---- Geometry loading ----
        const PRIMITIVES = {
            sphere:   () => new THREE.SphereGeometry(0.8, 64, 64),
            cube:     () => new THREE.BoxGeometry(1.2, 1.2, 1.2),
            cylinder: () => new THREE.CylinderGeometry(0.6, 0.6, 1.4, 64),
            torus:    () => new THREE.TorusGeometry(0.7, 0.28, 32, 128),
            cone:     () => new THREE.ConeGeometry(0.7, 1.4, 64)
        };

        function removeMesh() {
            if (!currentMesh) return;
            scene.remove(currentMesh);
            if (currentMesh.isMesh && currentMesh.geometry) currentMesh.geometry.dispose();
            currentMesh = null;
        }

        function loadGeometry(id) {
            if (!id) return;
            removeMesh();

            if (!currentMaterial) {
                currentMaterial = new THREE.MeshPhysicalMaterial({ color: 0xe9e9e9, roughness: 0.5 });
            }

            if (PRIMITIVES[id]) {
                const geo = PRIMITIVES[id]();
                currentMesh = new THREE.Mesh(geo, currentMaterial);
                currentMesh.castShadow = true;
                currentMesh.receiveShadow = true;
                scene.add(currentMesh);
                groundObjectOnGrid(currentMesh);
                focusCameraOnObject(currentMesh);
                return;
            }

            // OBJ from registry
            const entry = window.AssetRegistry && window.AssetRegistry.getObjectById(id);
            if (!entry || !entry.path) { console.warn("SceneManager: no path for object id:", id); return; }

            if (typeof THREE.OBJLoader === "undefined") { console.warn("SceneManager: OBJLoader not available"); return; }

            const loader = new THREE.OBJLoader();
            loader.load(
                entry.path,
                (obj) => {
                    obj.traverse((child) => {
                        if (child.isMesh) {
                            child.material = currentMaterial;
                            child.castShadow = true;
                            child.receiveShadow = true;
                        }
                    });

                    // Normalize scale to ~1.5 units tall
                    const box = new THREE.Box3().setFromObject(obj);
                    const size = new THREE.Vector3();
                    box.getSize(size);
                    const maxDim = Math.max(size.x, size.y, size.z);
                    if (maxDim > 0) obj.scale.setScalar(1.5 / maxDim);

                    // Center horizontally (X/Z), zero out Y so grounding works from origin
                    box.setFromObject(obj); // recompute after scale
                    const center = new THREE.Vector3();
                    box.getCenter(center);
                    obj.position.x -= center.x;
                    obj.position.z -= center.z;
                    // Do NOT offset Y here — groundObjectOnGrid handles that

                    scene.add(obj);
                    currentMesh = obj;

                    // Ground after adding to scene so world matrices are correct
                    groundObjectOnGrid(currentMesh);
                    focusCameraOnObject(currentMesh);

                    if (entry.defaultMaterialId) {
                        window.AssetRegistry.fetchMaterialData(entry.defaultMaterialId).then((data) => {
                            if (data && window.MaterialSettings) window.MaterialSettings.applyMaterialToUI(data);
                        });
                    }
                },
                undefined,
                (err) => console.error("OBJ load error:", err)
            );
        }

        // ---- Environment loading ----
        function loadEnvironment(id) {
            if (!id) return;
            const entry = window.AssetRegistry && window.AssetRegistry.getEnvironmentById(id);
            if (!entry || !entry.path) { console.warn("SceneManager: no path for environment id:", id); return; }

            if (typeof THREE.RGBELoader === "undefined") { console.warn("SceneManager: RGBELoader not available"); return; }

            const loader = new THREE.RGBELoader();
            loader.load(
                entry.path,
                (texture) => {
                    texture.mapping = THREE.EquirectangularReflectionMapping;
                    scene.environment = texture;

                    const intensityEl = $("envint-input");
                    const intensity = intensityEl ? parseFloat(intensityEl.value) : 1;
                    if (currentMaterial) currentMaterial.envMapIntensity = Number.isFinite(intensity) ? intensity : 1;
                },
                undefined,
                (err) => console.error("HDRI load error:", err)
            );
        }

        // ---- Apply UI -> material (Tab 3) ----
        // NOTE: Color picker <-> hex sync is handled by controls.js.
        // Here we READ hex field values (and picker values as fallback) and push to Three.js material.
        //
        // IMPORTANT: never use `parseFloat(x) || fallback` for values that can legitimately be 0.
        // Use the safeFloat helper instead.
        function safeFloat(id, fallback) {
            const el = $(id);
            if (!el) return fallback;
            const v = parseFloat(el.value);
            return Number.isFinite(v) ? v : fallback;
        }

        // Read hex from either the hex text input or the color picker (picker is always valid)
        function readColor(hexId, pickerId) {
            const hexEl = $(hexId);
            if (hexEl && /^#[0-9a-fA-F]{6}$/.test(hexEl.value)) return hexEl.value;
            const picker = $(pickerId);
            if (picker) return picker.value;
            return "#ffffff";
        }

        function applyUIStateToMaterial() {
            if (!currentMaterial) return;

            // ---- Base ----
            currentMaterial.color.set(readColor("basecolor-hex", "basecolor-picker"));
            currentMaterial.metalness = safeFloat("metalness-input", 0);
            currentMaterial.roughness = safeFloat("roughness-input", 0.5);

            // ---- Specular (r128: use reflectivity 0–1, no specularColor/specularIntensity) ----
            // The "Specular Color" picker is not mappable to a color in r128 — reflectivity is scalar only.
            // We still read the UI toggle & intensity slider, map intensity → reflectivity.
            const specEnable = $("specular-enable");
            if (specEnable && specEnable.checked) {
                const specInt = safeFloat("specint-input", 1);
                currentMaterial.reflectivity = clamp(specInt, 0, 1);
            } else {
                currentMaterial.reflectivity = 0.5; // r128 physical default
            }

            // ---- Clearcoat ----
            const ccEnable = $("clearcoat-enable");
            if (ccEnable && ccEnable.checked) {
                currentMaterial.clearcoat          = safeFloat("clearcoat-input",      0);
                currentMaterial.clearcoatRoughness = safeFloat("clearcoatrough-input", 0.1);
            } else {
                currentMaterial.clearcoat          = 0;
                currentMaterial.clearcoatRoughness = 0;
            }

            // ---- Opacity ----
            const opEnable = $("opacity-enable");
            if (opEnable && opEnable.checked) {
                currentMaterial.transparent = true;
                currentMaterial.opacity     = safeFloat("opacity-input", 1);
            } else {
                currentMaterial.transparent = false;
                currentMaterial.opacity     = 1;
            }

            // ---- Transmission / Glass (r128: transmission + ior exist; thickness/attenuation do NOT) ----
            const transEnable = $("trans-enable");
            if (transEnable && transEnable.checked) {
                currentMaterial.transmission = safeFloat("transmission-input", 0);
                currentMaterial.ior          = safeFloat("ior-input", 1.5);
                // DoubleSide needed for transmission to render correctly
                currentMaterial.side         = THREE.DoubleSide;
            } else {
                currentMaterial.transmission = 0;
                currentMaterial.side         = THREE.FrontSide;
            }
            // thickness, attenuationDistance, attenuationColor — NOT in r128, silently ignored.

            // ---- Sheen (r128: sheen is a single 0–1 float; no sheenColor/sheenRoughness) ----
            // The UI has sheenColor + sheenRoughness sliders which have no r128 equivalent.
            // We map sheen toggle → sheen intensity only (sheenRoughness/Color are displayed but no-op).
            const sheenEnable = $("sheen-enable");
            if (sheenEnable && sheenEnable.checked) {
                // sheenRoughness slider repurposed as sheen intensity (0–1) since r128 has only one sheen param
                const sheenIntensity = safeFloat("sheenrough-input", 1);
                currentMaterial.sheen = clamp(sheenIntensity, 0, 1);
            } else {
                currentMaterial.sheen = 0;
            }

            // ---- Emission ----
            const emEnable = $("emissive-enable");
            if (emEnable && emEnable.checked) {
                currentMaterial.emissive.set(readColor("emissive-hex", "emissivecolor-picker"));
                currentMaterial.emissiveIntensity = safeFloat("emissiveint-input", 1);
            } else {
                currentMaterial.emissive.set(0x000000);
                currentMaterial.emissiveIntensity = 0;
            }

            // ---- Environment ----
            currentMaterial.envMapIntensity = safeFloat("envint-input", 1);

            currentMaterial.needsUpdate = true;
        }

        // Wire material controls — listen on all inputs INCLUDING color pickers.
        // controls.js handles picker <-> hex <-> swatch UI sync.
        // We listen on BOTH picker and hex so dragging the color wheel updates the material instantly.
        function wireMaterialControls() {
            const ids = [
                // Base
                "basecolor-picker",  "basecolor-hex",
                "metalness-input",   "metalness-slider",
                "roughness-input",   "roughness-slider",
                // Specular
                "specular-enable",
                "speccolor-picker",  "speccolor-hex",
                "specint-input",     "specint-slider",
                // Clearcoat
                "clearcoat-enable",
                "clearcoat-input",   "clearcoat-slider",
                "clearcoatrough-input", "clearcoatrough-slider",
                // Opacity
                "opacity-enable",
                "opacity-input",     "opacity-slider",
                // Transmission
                "trans-enable",
                "transmission-input","transmission-slider",
                "ior-input",         "ior-slider",
                "thickness-input",   "thickness-slider",
                // Attenuation
                "atten-enable",
                "attdist-input",     "attdist-slider",
                "attcolor-picker",   "attcolor-hex",
                // Sheen
                "sheen-enable",
                "sheencolor-picker", "sheencolor-hex",
                "sheenrough-input",  "sheenrough-slider",
                // Emission
                "emissive-enable",
                "emissivecolor-picker", "emissive-hex",
                "emissiveint-input", "emissiveint-slider",
                // Environment
                "envint-input",      "envint-slider"
            ];

            ids.forEach((id) => {
                const el = $(id);
                if (!el) return;
                el.addEventListener("input",  applyUIStateToMaterial);
                el.addEventListener("change", applyUIStateToMaterial);
            });
        }

        // ---- Tab 4 — Camera controls ----
        // syncPair is only used internally for camera/postfx sliders not covered by controls.js
        function syncPair(inputId, sliderId, applyFn) {
            const inp = $(inputId);
            const sld = $(sliderId);
            if (inp) {
                inp.addEventListener("input",  () => { if (sld) sld.value = inp.value; applyFn(parseFloat(inp.value)); });
                inp.addEventListener("change", () => { if (sld) sld.value = inp.value; applyFn(parseFloat(inp.value)); });
            }
            if (sld) {
                sld.addEventListener("input",  () => { if (inp) inp.value = sld.value; applyFn(parseFloat(sld.value)); });
                sld.addEventListener("change", () => { if (inp) inp.value = sld.value; applyFn(parseFloat(sld.value)); });
            }
        }

        function setActiveCamera(nextCam) {
            if (!nextCam || nextCam === activeCamera) return;

            const pos = activeCamera.position.clone();
            const tgt = controls ? controls.target.clone() : new THREE.Vector3(0, 0.5, 0);

            activeCamera = nextCam;
            activeCamera.position.copy(pos);
            activeCamera.lookAt(tgt);

            if (controls) {
                controls.object = activeCamera;
                controls.update();
            }

            // Keep composer renderPass in sync
            if (renderPass) renderPass.camera = activeCamera;
        }

        function applyCameraFromUI(applyAll = false) {
            const camType = $("camera-type-select")?.value || "perspective";
            setActiveCamera(camType === "orthographic" ? orthoCamera : camera);

            const nearVal = parseFloat($("near-input")?.value || "0.1");
            const farVal  = parseFloat($("far-input")?.value  || "2000");
            if (Number.isFinite(nearVal) && activeCamera) activeCamera.near = clamp(nearVal, 0.01, 1000);
            if (Number.isFinite(farVal)  && activeCamera) activeCamera.far  = clamp(farVal, 10, 100000);
            if (activeCamera) activeCamera.updateProjectionMatrix();

            const toneSel = $("tone-mapping-select");
            if (toneSel && renderer) {
                const map = {
                    none:     THREE.NoToneMapping,
                    aces:     THREE.ACESFilmicToneMapping,
                    reinhard: THREE.ReinhardToneMapping,
                    cineon:   THREE.CineonToneMapping
                };
                renderer.toneMapping = map[toneSel.value] ?? THREE.ACESFilmicToneMapping;
            }

            const exp = parseFloat($("exposure-input")?.value || "1.0");
            if (renderer && Number.isFinite(exp)) renderer.toneMappingExposure = clamp(exp, 0.01, 10);

            const lensSel = $("lens-mm-select");
            if (lensSel && camera) {
                const mm = parseFloat(lensSel.value);
                if (Number.isFinite(mm) && mm > 0) {
                    camera.fov = (2 * Math.atan(36 / (2 * mm))) * (180 / Math.PI);
                    camera.updateProjectionMatrix();
                }
            }
        }

        function wireCameraControls() {
            const camType = $("camera-type-select");
            if (camType) camType.addEventListener("change", () => applyCameraFromUI());

            const toneSel = $("tone-mapping-select");
            if (toneSel) toneSel.addEventListener("change", () => applyCameraFromUI());

            const lensSel = $("lens-mm-select");
            if (lensSel) lensSel.addEventListener("change", () => applyCameraFromUI());

            // Camera sliders are NOT bound by controls.js, so we use syncPair here
            syncPair("exposure-input", "exposure-slider", () => applyCameraFromUI());
            syncPair("near-input", "near-slider", () => applyCameraFromUI());
            syncPair("far-input", "far-slider", () => applyCameraFromUI());
            syncPair("cam-dof-focus-input", "cam-dof-focus-slider", () => {});
            syncPair("cam-dof-strength-input", "cam-dof-strength-slider", () => {});
        }

        // ---- Tab 5 — Preview Quality controls ----
        function applyQualityFromUI(applyAll = false) {
            const dprSel = $("max-dpr-select");
            let cap = dprSel ? dprSel.value : "auto";
            let dpr = window.devicePixelRatio || 1;
            if (cap !== "auto") { const v = parseFloat(cap); if (Number.isFinite(v) && v > 0) dpr = v; }
            renderer.setPixelRatio(dpr);

            const shadowsToggle = $("preview-toggle-shadows");
            const shadowsOn = shadowsToggle ? shadowsToggle.checked : true;
            renderer.shadowMap.enabled = !!shadowsOn;

            const shadowQual = $("shadow-quality-select")?.value || "high";
            const mapSizeByPreset = { off: 0, low: 512, medium: 1024, high: 2048, ultra: 4096 };
            const ms = mapSizeByPreset[shadowQual] ?? 2048;

            if (keyLight) {
                if (ms > 0 && shadowsOn) {
                    keyLight.castShadow = true;
                    keyLight.shadow.mapSize.width = ms;
                    keyLight.shadow.mapSize.height = ms;
                    if (keyLight.shadow.map) { keyLight.shadow.map.dispose(); keyLight.shadow.map = null; }
                } else {
                    keyLight.castShadow = false;
                }
            }

            const wireToggle = $("preview-toggle-wireframe");
            if (wireToggle && currentMaterial) currentMaterial.wireframe = !!wireToggle.checked;

            const helpersToggle = $("preview-toggle-helpers");
            if (helpersToggle) {
                const vis = !!helpersToggle.checked;
                if (gridHelper) gridHelper.visible = vis;
                if (axesHelper)  axesHelper.visible  = vis;
            }

            resizeToContainer();
        }

        function wireQualityControls() {
            ["resolution-select", "render-scale-select", "max-dpr-select"].forEach((id) => {
                const el = $(id); if (!el) return;
                el.addEventListener("change", () => applyQualityFromUI());
            });
            ["preview-toggle-shadows", "preview-toggle-wireframe", "preview-toggle-helpers"].forEach((id) => {
                const el = $(id); if (!el) return;
                el.addEventListener("change", () => applyQualityFromUI());
            });
            const sq = $("shadow-quality-select"); if (sq) sq.addEventListener("change", () => applyQualityFromUI());
            const aa = $("aa-mode-select"); if (aa) aa.addEventListener("change", () => applyQualityFromUI(true));
        }

        // ---- Tab 6 — PostFX ----
        function ensureComposer() {
            if (typeof THREE.EffectComposer === "undefined" || typeof THREE.RenderPass === "undefined") {
                composer = null; renderPass = null; return false;
            }
            if (composer) return true;

            composer = new THREE.EffectComposer(renderer);
            renderPass = new THREE.RenderPass(scene, activeCamera);
            composer.addPass(renderPass);
            return true;
        }

        function setVignetteEnabled(enabled) {
            enabled = !!enabled;

            if (!enabled) {
                if (composer && vignettePass) {
                    const idx = composer.passes.indexOf(vignettePass);
                    if (idx !== -1) composer.passes.splice(idx, 1);
                }
                vignettePass = null;
                return;
            }

            if (!ensureComposer()) return;

            if (typeof THREE.VignetteShader === "undefined" || typeof THREE.ShaderPass === "undefined") {
                console.warn("VignetteShader/ShaderPass not loaded.");
                return;
            }

            if (!vignettePass) {
                vignettePass = new THREE.ShaderPass(THREE.VignetteShader);
                vignettePass.uniforms.offset.value = 1.0;
                vignettePass.uniforms.darkness.value = 1.1;
                composer.addPass(vignettePass);
            }
        }

        function applyVignetteFromUI() {
            if (!vignettePass) return;
            const intensity = parseFloat($("vignette-intensity-input")?.value || "0.25");
            const softness  = parseFloat($("vignette-softness-input")?.value  || "0.60");
            vignettePass.uniforms.darkness.value = 0.5 + clamp(intensity, 0, 1) * 1.5;
            vignettePass.uniforms.offset.value   = 0.7 + clamp(softness,  0, 1) * 0.8;
        }

        function setBloomEnabled(enabled)      { if (enabled) console.log("Bloom (stub — not implemented)."); }
        function applyBloomFromUI()            {}
        function setAOEnabled(enabled)         { if (enabled) console.log("AO (stub — not implemented)."); }
        function setMotionBlurEnabled(enabled) { if (enabled) console.log("Motion blur (stub — not implemented)."); }

        function applyPostFXFromUI(applyAll = false) {
            const presetSel = $("postfx-preset-select");
            const preset = presetSel ? presetSel.value : "off";

            if (preset !== "off") {
                const bloom = $("post-toggle-bloom");
                const ao    = $("post-toggle-ao");
                const vig   = $("post-toggle-vignette");
                const mb    = $("post-toggle-motionblur");
                const setChk = (el, v) => { if (el) el.checked = !!v; };

                if      (preset === "basic")  { setChk(bloom,true);  setChk(ao,false); setChk(vig,false); setChk(mb,false); }
                else if (preset === "pretty") { setChk(bloom,true);  setChk(ao,true);  setChk(vig,false); setChk(mb,false); }
                else if (preset === "cinema") { setChk(bloom,true);  setChk(ao,false); setChk(vig,true);  setChk(mb,false); }
            }

            const postEnabled = $("preview-toggle-postfx") ? $("preview-toggle-postfx").checked : true;
            const vigOn = !!$("post-toggle-vignette")?.checked;
            const bloomOn = !!$("post-toggle-bloom")?.checked;
            const aoOn    = !!$("post-toggle-ao")?.checked;
            const mbOn    = !!$("post-toggle-motionblur")?.checked;

            if (vigOn) setVignetteEnabled(true);
            else       setVignetteEnabled(false);

            applyVignetteFromUI();
            setBloomEnabled(bloomOn);
            applyBloomFromUI();
            setAOEnabled(aoOn);
            setMotionBlurEnabled(mbOn);

            if (composer && renderPass) renderPass.camera = activeCamera;

            resizeToContainer();
            SceneManager._postfxMasterOn = !!postEnabled;
        }

        function wirePostFXControls() {
            const master = $("preview-toggle-postfx");
            if (master) master.addEventListener("change", () => applyPostFXFromUI());

            const preset = $("postfx-preset-select");
            if (preset) preset.addEventListener("change", () => applyPostFXFromUI(true));

            ["post-toggle-bloom","post-toggle-vignette","post-toggle-ao","post-toggle-motionblur"].forEach((id) => {
                const el = $(id); if (!el) return;
                el.addEventListener("change", () => applyPostFXFromUI());
            });

            // PostFX sliders — not bound by controls.js, so use syncPair
            syncPair("bloom-strength-input",     "bloom-strength-slider",     () => applyPostFXFromUI());
            syncPair("bloom-radius-input",        "bloom-radius-slider",        () => applyPostFXFromUI());
            syncPair("bloom-threshold-input",     "bloom-threshold-slider",     () => applyPostFXFromUI());
            syncPair("vignette-intensity-input",  "vignette-intensity-slider",  () => applyVignetteFromUI());
            syncPair("vignette-softness-input",   "vignette-softness-slider",   () => applyVignetteFromUI());
            syncPair("ao-intensity-input",        "ao-intensity-slider",        () => applyPostFXFromUI());
            syncPair("ao-radius-input",           "ao-radius-slider",           () => applyPostFXFromUI());
            syncPair("motionblur-strength-input", "motionblur-strength-slider", () => applyPostFXFromUI());
        }

        // ---- Keyboard ----
        function handleKeyboard() {
            const speed = 0.04;
            if (!activeCamera) return;
            if (keys["ArrowLeft"])  activeCamera.position.x -= speed;
            if (keys["ArrowRight"]) activeCamera.position.x += speed;
            if (keys["ArrowUp"])    activeCamera.position.y += speed;
            if (keys["ArrowDown"])  activeCamera.position.y -= speed;
            if (keys["q"] || keys["Q"]) activeCamera.position.z += speed;
            if (keys["e"] || keys["E"]) activeCamera.position.z -= speed;
            if (keys["r"] || keys["R"]) {
                // Reset: re-focus camera on current object (or default if none)
                if (currentMesh) {
                    focusCameraOnObject(currentMesh);
                } else {
                    activeCamera.position.set(0, 1.2, 3.5);
                    activeCamera.lookAt(0, 0.5, 0);
                    if (controls) controls.target.set(0, 0.5, 0);
                }
                keys["r"] = false;
                keys["R"] = false;
            }
        }

        // ---- Render loop ----
        function animate() {
            requestAnimationFrame(animate);
            handleKeyboard();
            if (controls) controls.update();

            const master = SceneManager._postfxMasterOn !== false;
            if (master && composer && renderPass) {
                renderPass.camera = activeCamera;
                composer.render();
            } else {
                renderer.render(scene, activeCamera);
            }
        }

        return {
            _postfxMasterOn: true,
            init,
            loadGeometry,
            loadEnvironment,
            applyUIStateToMaterial,
            wireMaterialControls
        };
    })();

    window.SceneManager = SceneManager;

    // ============================================================================
    // 4) Boot
    // ============================================================================
    function boot() {
        function run() {
            window.AssetRegistry.loadManifest("assets/manifest.json")
                .then(() => {
                    window.AssetRegistry.populateMenus({
                        objectSelectIds: ["object-select", "object-select-materialtab"],
                        materialSelectId: "material-select",
                        environmentSelectId: "environment-select"
                    });

                    if (typeof THREE !== "undefined") {
                        window.SceneManager.init("scene-view-placeholder");
                    } else {
                        console.warn("Boot: THREE not found. Add three.js CDN scripts to index.html before app.js.");
                    }

                    if (window.MaterialSettings && window.MaterialSettings.refreshFromSelection) {
                        window.MaterialSettings.refreshFromSelection();
                    }
                })
                .catch((err) => {
                    console.warn("Boot: manifest load failed (this is normal in local dev without a server):", err);
                    // Still init the scene even if manifest fails
                    if (typeof THREE !== "undefined") {
                        window.SceneManager.init("scene-view-placeholder");
                    }
                });
        }

        if (document.readyState === "complete") run();
        else window.addEventListener("load", run, { once: true });
    }

    boot();
})();