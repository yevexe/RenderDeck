// js/app.js — RenderDeck Main Application (three.js r182)
// Sections:
//   1) Imports       — ES module imports replacing all CDN <script> tags
//   2) SettingsPersistence
//   3) AssetRegistry
//   4) MaterialSettings
//   5) SceneManager  — updated for r182 API
//   6) Boot
//
// r134 → r182 migration summary applied here:
//   • All Three.js addons imported from 'three/addons/' (no more THREE.X globals)
//   • renderer.outputEncoding = THREE.sRGBEncoding
//         → renderer.outputColorSpace = THREE.SRGBColorSpace
//   • RGBELoader → HDRLoader (renamed in r180)
//   • PCFSoftShadowMap deprecated in r182 → use PCFShadowMap
//   • MeshPhysicalMaterial.sheen (single float) → sheenColor + sheenRoughness
//   • MeshPhysicalMaterial.reflectivity → specularIntensity + specularColor
//   • MeshPhysicalMaterial.thickness + attenuationColor/Distance now fully supported
//   • PMREMGenerator required for HDR env maps (was semi-implicit before)
//   • typeof THREE.X guards removed — imports guarantee availability
//   • IIFE wrapper removed — ES module scope is already isolated
//   • window.X assignments kept so controls.js (plain script) can access managers

// ============================================================================
// 1) Imports
// ============================================================================

import {
    WebGLRenderer,
    PCFShadowMap,
    ACESFilmicToneMapping,
    ReinhardToneMapping,
    CineonToneMapping,
    NoToneMapping,
    SRGBColorSpace,
    Scene,
    Color,
    PerspectiveCamera,
    OrthographicCamera,
    AmbientLight,
    DirectionalLight,
    MeshPhysicalMaterial,
    SphereGeometry,
    BoxGeometry,
    CylinderGeometry,
    TorusGeometry,
    ConeGeometry,
    Mesh,
    GridHelper,
    AxesHelper,
    Box3,
    Vector2,
    Vector3,
    FrontSide,
    DoubleSide,
    PMREMGenerator,
    EquirectangularReflectionMapping
} from 'three';

import { OrbitControls }    from 'three/addons/controls/OrbitControls.js';
import { OBJLoader }        from 'three/addons/loaders/OBJLoader.js';
import { HDRLoader }        from 'three/addons/loaders/HDRLoader.js';        // was RGBELoader before r180

import { EffectComposer }   from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }       from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass }       from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass }  from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass }       from 'three/addons/postprocessing/OutputPass.js'; // replaces manual CopyShader+sRGB step

import { FXAAShader }       from 'three/addons/shaders/FXAAShader.js';
import { VignetteShader }   from 'three/addons/shaders/VignetteShader.js';

// ============================================================================
// 2) SettingsPersistence
// ============================================================================

const SettingsPersistence = (() => {
    const STORAGE_KEY = "renderdeck_ui_v1";

    const PERSIST_IDS = [
        // Tab 1
        "object-select", "background-select", "environment-select",
        // Tab 2
        "design-posx-input", "design-posy-input", "design-width-input",
        "design-height-input", "design-rotation-input",
        // Tab 3 — material
        "object-select-materialtab", "material-select",
        "basecolor-picker", "basecolor-hex",
        "metalness-input", "roughness-input",
        "specular-enable", "speccolor-picker", "speccolor-hex", "specint-input",
        "clearcoat-enable", "clearcoat-input", "clearcoatrough-input",
        "opacity-enable", "opacity-input",
        "trans-enable", "transmission-input", "ior-input", "thickness-input",
        "atten-enable", "attdist-input", "attcolor-picker", "attcolor-hex",
        "sheen-enable", "sheencolor-picker", "sheencolor-hex", "sheenrough-input",
        "emissive-enable", "emissivecolor-picker", "emissive-hex", "emissiveint-input",
        "envint-input",
        // Tab 4 — camera
        "camera-type-select",
        "lens-mm-value", "lens-mm-input",
        "film-gauge-value",
        "near-input", "far-input",
        "tone-mapping-value",
        "exposure-input",
        "cam-toggle-dof", "cam-dof-focus-input", "cam-dof-strength-input",
        // Tab 5 — quality
        "resolution-select",
        "render-scale-value",
        "max-dpr-value",
        "aa-mode-value",
        "shadow-quality-value",
        "texture-filtering-value",
        "preview-toggle-shadows", "preview-toggle-postfx", "preview-toggle-wireframe",
        "preview-toggle-helpers", "preview-toggle-vertexcolors",
        // Tab 6 — postfx
        "post-toggle-bloom", "post-toggle-vignette", "post-toggle-ao", "post-toggle-motionblur",
        "bloom-strength-input", "bloom-radius-input", "bloom-threshold-input",
        "vignette-intensity-input", "vignette-softness-input",
        "ao-intensity-input", "ao-radius-input",
        "motionblur-strength-input"
    ];

    function save() {
        const data = {};
        PERSIST_IDS.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            data[id] = (el.type === "checkbox") ? el.checked : el.value;
        });
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch(e) {}
    }

    function restore() {
        let data;
        try { data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch(e) {}
        if (!data) return false;

        PERSIST_IDS.forEach(id => {
            if (!(id in data)) return;
            const el = document.getElementById(id);
            if (!el) return;

            if (el.type === "checkbox") {
                el.checked = !!data[id];
            } else {
                el.value = data[id];
            }

            // Sync paired slider
            const sliderId = id.replace(/-input$/, "-slider");
            if (sliderId !== id) {
                const sld = document.getElementById(sliderId);
                if (sld) sld.value = data[id];
            }

            // Sync color pickers → swatches + hex
            if (el.type === "color") {
                let swatchId = id.replace("-picker", "-swatch");
                if (swatchId === "emissivecolor-swatch") swatchId = "emissive-swatch";
                const sw = document.getElementById(swatchId);
                if (sw) sw.style.backgroundColor = el.value;

                let hexId = id.replace("-picker", "-hex");
                if (hexId === "emissivecolor-hex") hexId = "emissive-hex";
                if (hexId !== id && !(hexId in data)) {
                    const hexEl = document.getElementById(hexId);
                    if (hexEl) hexEl.value = el.value;
                }
            }

            // Re-highlight button-row for hidden inputs
            if (el.type === "hidden" && el.value) {
                const row = document.querySelector(`.button-row[data-target-input="${id}"]`);
                if (row) {
                    row.querySelectorAll("button.button").forEach(b => {
                        b.classList.toggle("button-selected",
                            (b.getAttribute("data-value") ?? "") === el.value);
                    });
                }
            }
        });
        return true;
    }

    function init() {
        const saveHandler = () => save();
        PERSIST_IDS.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener("change", saveHandler);
            el.addEventListener("input",  saveHandler);
        });
    }

    return { save, restore, init };
})();

window.SettingsPersistence = SettingsPersistence;

// ============================================================================
// 3) AssetRegistry
// ============================================================================

const AssetRegistry = (() => {
    const state = {
        manifestUrl: "assets/manifest.json",
        manifest: null,
        objectsById: new Map(),
        materialsById: new Map(),
        envsById: new Map(),
        materialDataCache: new Map(),
        standardObjects: [], userObjects: [],
        standardMaterials: [], userMaterials: [],
        standardEnvironments: [], userEnvironments: []
    };

    function findSep(sel, text) {
        const t = (text || "").trim();
        return Array.from(sel.options).findIndex(o => o.disabled && (o.textContent || "").trim() === t);
    }
    function clearNonDisabled(sel) {
        const keep = Array.from(sel.options).filter(o => o.disabled);
        sel.innerHTML = "";
        keep.forEach(o => sel.add(o));
    }
    function insertAfter(sel, after, items, { valueKey = "id", labelKey = "label" } = {}) {
        let at = after + 1;
        for (const item of items) {
            const opt = document.createElement("option");
            opt.value = item?.[valueKey] ?? "";
            opt.textContent = item?.[labelKey] ?? item?.[valueKey] ?? "Unnamed";
            if (at >= sel.options.length) sel.add(opt); else sel.add(opt, sel.options[at]);
            at++;
        }
    }

    async function loadManifest(url = state.manifestUrl) {
        state.manifestUrl = url;
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(`Failed: ${url} (${res.status})`);
        const manifest = await res.json();
        state.manifest = manifest;
        state.standardObjects      = (manifest?.standard?.objects      ?? []).slice();
        state.userObjects          = (manifest?.user?.objects           ?? []).slice();
        state.standardMaterials    = (manifest?.standard?.materials     ?? []).slice();
        state.userMaterials        = (manifest?.user?.materials         ?? []).slice();
        state.standardEnvironments = (manifest?.standard?.environments  ?? []).slice();
        state.userEnvironments     = (manifest?.user?.environments      ?? []).slice();

        state.objectsById.clear();
        state.materialsById.clear();
        state.envsById.clear();
        for (const o of [...state.standardObjects,    ...state.userObjects])        if (o?.id) state.objectsById.set(o.id, o);
        for (const m of [...state.standardMaterials,  ...state.userMaterials])      if (m?.id) state.materialsById.set(m.id, m);
        for (const e of [...state.standardEnvironments,...state.userEnvironments])  if (e?.id) state.envsById.set(e.id, e);
        return state;
    }

    function populateMenus({ objectSelectId = "object-select", objectSelectIds = null, materialSelectId = "material-select", environmentSelectId = "environment-select" } = {}) {
        for (const id of objectSelectIds ?? [objectSelectId]) {
            const sel = document.getElementById(id);
            if (!sel) continue;
            clearNonDisabled(sel);
            const std = findSep(sel, "--- Standard Objects ---");
            const usr = findSep(sel, "--- User Objects ---");
            if (std !== -1) insertAfter(sel, std, state.standardObjects);
            if (usr !== -1) insertAfter(sel, usr, state.userObjects);
        }
        const mSel = document.getElementById(materialSelectId);
        if (mSel) {
            clearNonDisabled(mSel);
            const std = findSep(mSel, "--- Standard Materials ---");
            const usr = findSep(mSel, "--- User Materials ---");
            if (std !== -1) insertAfter(mSel, std, state.standardMaterials);
            if (usr !== -1) insertAfter(mSel, usr, state.userMaterials);
        }
        const eSel = document.getElementById(environmentSelectId);
        if (eSel) {
            clearNonDisabled(eSel);
            const std = findSep(eSel, "--- Standard Lighting ---");
            const usr = findSep(eSel, "--- User Lighting ---");
            if (std !== -1) insertAfter(eSel, std, state.standardEnvironments);
            if (usr !== -1) insertAfter(eSel, usr, state.userEnvironments);
        }
    }

    function getObjectById(id)      { return state.objectsById.get(id)   ?? null; }
    function getMaterialById(id)    { return state.materialsById.get(id)  ?? null; }
    function getEnvironmentById(id) { return state.envsById.get(id)       ?? null; }

    async function fetchMaterialData(id) {
        if (state.materialDataCache.has(id)) return state.materialDataCache.get(id);
        const entry = getMaterialById(id);
        if (!entry) return null;
        const path = entry.path ?? "";
        if ((entry.typeHint ?? "").toLowerCase() === "mtl" || path.endsWith(".mtl")) {
            console.log("Skipping MTL:", id);
            return null;
        }
        try {
            const res = await fetch(path, { cache: "no-store" });
            if (!res.ok) throw new Error(res.status);
            const data = await res.json();
            state.materialDataCache.set(id, data);
            return data;
        } catch(e) {
            console.warn(`Material fetch failed for "${id}":`, e);
            return null;
        }
    }

    return { state, loadManifest, populateMenus, getObjectById, getMaterialById, getEnvironmentById, fetchMaterialData };
})();

window.AssetRegistry = AssetRegistry;

// ============================================================================
// 4) MaterialSettings — JSON preset → UI fields
// ============================================================================

const MaterialSettings = (() => {
    function $(id) { return document.getElementById(id); }
    function normHex(s, fb = "#ffffff") {
        if (!s) return fb;
        const t = String(s).trim();
        if (/^#[0-9a-fA-F]{6}$/.test(t)) return t.toUpperCase();
        if (/^[0-9a-fA-F]{6}$/.test(t)) return ("#" + t).toUpperCase();
        return fb;
    }
    function setInput(id, v) {
        const el = $(id);
        if (!el) return;
        el.value = v;
        el.dispatchEvent(new Event("input",  { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        const sld = $(id.replace(/-input$/, "-slider"));
        if (sld) { sld.value = v; sld.dispatchEvent(new Event("input", { bubbles: true })); }
    }
    function setChk(id, v) {
        const el = $(id);
        if (!el) return;
        el.checked = !!v;
        el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    function setColor(ids, hex) {
        const c = normHex(hex);
        if (ids.pickerId) { const p = $(ids.pickerId); if (p) { p.value = c; p.dispatchEvent(new Event("input", { bubbles: true })); } }
        if (ids.hexId)    { const h = $(ids.hexId);    if (h) { h.value = c; h.dispatchEvent(new Event("input", { bubbles: true })); } }
        if (ids.swatchId) { const sw = $(ids.swatchId); if (sw) sw.style.backgroundColor = c; }
    }
    const UI = {
        baseColor:          { pickerId: "basecolor-picker",     hexId: "basecolor-hex",   swatchId: "basecolor-swatch"  },
        metalness:          "metalness-input",
        roughness:          "roughness-input",
        specularColor:      { pickerId: "speccolor-picker",     hexId: "speccolor-hex",   swatchId: "speccolor-swatch"  },
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
        attenuationColor:   { pickerId: "attcolor-picker",      hexId: "attcolor-hex",    swatchId: "attcolor-swatch"   },
        sheenEnabled:       "sheen-enable",
        sheenRoughness:     "sheenrough-input",
        sheenColor:         { pickerId: "sheencolor-picker",    hexId: "sheencolor-hex",  swatchId: "sheencolor-swatch" },
        emissiveEnabled:    "emissive-enable",
        emissiveColor:      { pickerId: "emissivecolor-picker", hexId: "emissive-hex",    swatchId: "emissive-swatch"   },
        emissiveIntensity:  "emissiveint-input",
        envMapIntensity:    "envint-input"
    };

    function applyMaterialToUI(data) {
        const s = (data?.params || data?.settings || data?.ui || data);
        if (!s || typeof s !== "object") { console.warn("applyMaterialToUI: bad data", data); return; }
        const bHex = s.baseColor || s.color || s.basecolor || s.albedo;
        if (bHex)                         setColor(UI.baseColor,         bHex);
        if (s.metalness          != null) setInput(UI.metalness,          String(s.metalness));
        if (s.roughness          != null) setInput(UI.roughness,          String(s.roughness));
        if (s.specularIntensity  != null) setInput(UI.specularIntensity,  String(s.specularIntensity));
        if (s.clearcoat          != null) setInput(UI.clearcoat,          String(s.clearcoat));
        if (s.clearcoatRoughness != null) setInput(UI.clearcoatRoughness, String(s.clearcoatRoughness));
        if (s.opacity            != null) setInput(UI.opacity,            String(s.opacity));
        if (s.transmission       != null) setInput(UI.transmission,       String(s.transmission));
        if (s.ior                != null) setInput(UI.ior,                String(s.ior));
        if (s.thickness          != null) setInput(UI.thickness,          String(s.thickness));
        if (s.attenuationDistance!= null) setInput(UI.attenuationDistance,String(s.attenuationDistance));
        if (s.sheenRoughness     != null) setInput(UI.sheenRoughness,     String(s.sheenRoughness));
        if (s.emissiveIntensity  != null) setInput(UI.emissiveIntensity,  String(s.emissiveIntensity));
        if (s.envMapIntensity    != null) setInput(UI.envMapIntensity,    String(s.envMapIntensity));
        if (s.clearcoatEnabled   != null) setChk(UI.clearcoatEnabled,    s.clearcoatEnabled);
        if (s.opacityEnabled     != null) setChk(UI.opacityEnabled,      s.opacityEnabled);
        if (s.transmissionEnabled!= null) setChk(UI.transmissionEnabled, s.transmissionEnabled);
        if (s.attenuationEnabled != null) setChk(UI.attenuationEnabled,  s.attenuationEnabled);
        if (s.sheenEnabled       != null) setChk(UI.sheenEnabled,        s.sheenEnabled);
        if (s.emissiveEnabled    != null) setChk(UI.emissiveEnabled,     s.emissiveEnabled);
        if (s.specularColor      != null) setColor(UI.specularColor,     s.specularColor);
        if (s.attenuationColor   != null) setColor(UI.attenuationColor,  s.attenuationColor);
        if (s.sheenColor         != null) setColor(UI.sheenColor,        s.sheenColor);
        if (s.emissiveColor      != null) setColor(UI.emissiveColor,     s.emissiveColor);
        if (window.SceneManager?.applyUIStateToMaterial) window.SceneManager.applyUIStateToMaterial();
    }

    function onMatChange() {
        const sel = document.getElementById("material-select");
        if (!sel?.value) return;
        window.AssetRegistry?.fetchMaterialData(sel.value).then(d => { if (d) applyMaterialToUI(d); });
    }
    function init() {
        const sel = document.getElementById("material-select");
        if (!sel) return;
        sel.addEventListener("change", onMatChange);
        if (sel.value) onMatChange();
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
    return { applyMaterialToUI, refreshFromSelection: onMatChange };
})();

window.MaterialSettings = MaterialSettings;

// ============================================================================
// 5) SceneManager — three.js r182
// ============================================================================

const SceneManager = (() => {
    let renderer, scene, camera, orthoCamera, activeCamera, orbitControls;
    let currentMesh = null, currentMaterial = null, container = null;
    let keys = {}, gridHelper = null, axesHelper = null, keyLight = null;
    let pmremGenerator = null;

    // PostFX
    let composer = null, renderPass = null;
    let bloomPass = null, vignettePass = null, fxaaPass = null, outputPass = null;

    function $(id) { return document.getElementById(id); }
    function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
    function parseRes(s) { const m = String(s || "").match(/^(\d+)x(\d+)$/i); return m ? { w: +m[1], h: +m[2] } : null; }
    function containerSize() { return { w: container?.clientWidth || 960, h: container?.clientHeight || 540 }; }
    function safeFloat(id, fb) { const el = $(id); if (!el) return fb; const v = parseFloat(el.value); return Number.isFinite(v) ? v : fb; }
    function readColor(hexId, pickId) {
        const h = $(hexId);
        if (h && /^#[0-9a-fA-F]{6}$/.test(h.value)) return h.value;
        const p = $(pickId);
        return p ? p.value : "#ffffff";
    }

    // Mark all scene materials needsUpdate — required after renderer.toneMapping changes
    function invalidateAllMaterials() {
        scene.traverse(obj => {
            if (obj.isMesh && obj.material) {
                const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
                mats.forEach(m => { m.needsUpdate = true; });
            }
        });
    }

    // -- Ground / focus --
    function groundOnGrid(obj) {
        obj.updateMatrixWorld(true);
        let minY = Infinity;
        const v = new Vector3();
        obj.traverse(c => {
            if (!c.isMesh || !c.geometry) return;
            const p = c.geometry.attributes.position;
            if (!p) return;
            for (let i = 0; i < p.count; i++) {
                v.fromBufferAttribute(p, i).applyMatrix4(c.matrixWorld);
                if (v.y < minY) minY = v.y;
            }
        });
        if (Number.isFinite(minY)) obj.position.y -= minY;
    }

    function focusCamera(obj) {
        if (!obj) return;
        obj.updateMatrixWorld(true);
        const box = new Box3().setFromObject(obj);
        const center = new Vector3(), size = new Vector3();
        box.getCenter(center);
        box.getSize(size);
        if (orbitControls) { orbitControls.target.copy(center); orbitControls.update(); }
        const maxD = Math.max(size.x, size.y, size.z);
        const fovR = camera ? camera.fov * (Math.PI / 180) : 50 * Math.PI / 180;
        const dist = (maxD / 2) / Math.tan(fovR / 2) * 2.2;
        activeCamera.position.copy(center).add(new Vector3(dist * 0.6, dist * 0.5, dist));
        activeCamera.lookAt(center);
        if (orbitControls) orbitControls.update();
    }

    // -- Init --
    function init(containerId = "scene-view-placeholder") {
        container = document.getElementById(containerId);
        if (!container) { console.error("Container not found:", containerId); return; }
        container.style.overflow = "hidden";
        container.style.position = container.style.position || "relative";
        container.innerHTML = "";

        renderer = new WebGLRenderer({ antialias: true });
        renderer.shadowMap.enabled   = true;
        // r182: PCFSoftShadowMap deprecated → PCFShadowMap (now soft by default)
        renderer.shadowMap.type      = PCFShadowMap;
        renderer.toneMapping         = ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.0;
        // r152+: outputEncoding = THREE.sRGBEncoding → outputColorSpace = SRGBColorSpace
        renderer.outputColorSpace    = SRGBColorSpace;
        renderer.setPixelRatio(1);

        const canvas = renderer.domElement;
        canvas.style.cssText = "display:block;width:100%;height:100%;object-fit:contain;";
        container.appendChild(canvas);

        // PMREMGenerator is now required for HDR env maps to integrate with PBR materials
        pmremGenerator = new PMREMGenerator(renderer);
        pmremGenerator.compileEquirectangularShader();

        scene = new Scene();
        scene.background = new Color(0x1a1a1a);

        const { w, h } = containerSize();
        const aspect = w / h;

        camera = new PerspectiveCamera(50, aspect, 0.1, 2000);
        camera.position.set(0, 1.2, 3.5);
        camera.lookAt(0, 0.5, 0);

        orthoCamera = new OrthographicCamera(-2 * aspect, 2 * aspect, 2, -2, 0.1, 2000);
        orthoCamera.position.set(0, 1.2, 3.5);
        orthoCamera.lookAt(0, 0.5, 0);

        activeCamera = camera;

        orbitControls = new OrbitControls(activeCamera, canvas);
        orbitControls.enableDamping = true;
        orbitControls.dampingFactor = 0.07;
        orbitControls.target.set(0, 0.5, 0);

        addLights();
        addHelpers();

        // r182 MeshPhysicalMaterial API:
        //   • specularIntensity / specularColor  (was reflectivity)
        //   • sheenColor / sheenRoughness        (was single sheen float)
        //   • thickness / attenuationColor / attenuationDistance  (fully supported now)
        currentMaterial = new MeshPhysicalMaterial({
            color:              0xff6600,
            roughness:          0.5,
            metalness:          0.0,
            clearcoat:          0.0,
            clearcoatRoughness: 0.0,
            transmission:       0.0,
            ior:                1.5,
            thickness:          0.0,
            sheenColor:         new Color(0xffffff),
            sheenRoughness:     1.0,
            specularIntensity:  1.0,
            specularColor:      new Color(0xffffff),
            emissive:           new Color(0x000000),
            emissiveIntensity:  0.0,
            envMapIntensity:    1.0,
            side:               FrontSide
        });

        const savedObj = $("object-select")?.value || "sphere";
        loadGeometry(savedObj);

        window.addEventListener("resize", resize);
        window.addEventListener("keydown", e => {
            if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA") return;
            keys[e.key] = true;
        });
        window.addEventListener("keyup", e => { keys[e.key] = false; });

        ["object-select", "object-select-materialtab"].forEach(id => {
            const el = $(id);
            if (el) el.addEventListener("change", e => loadGeometry(e.target.value));
        });
        const envSel = $("environment-select");
        if (envSel) envSel.addEventListener("change", e => loadEnvironment(e.target.value));

        wireMaterialControls();
        wireCameraControls();
        wireQualityControls();
        wirePostFXControls();

        applyUIStateToMaterial();
        applyCameraFromUI();
        applyQualityFromUI();
        applyPostFXFromUI();

        window.SettingsPersistence?.init();

        resize();
        animate();

        const savedEnv = $("environment-select")?.value;
        if (savedEnv) loadEnvironment(savedEnv);
    }

    // -- Resize --
    function resize() {
        if (!container || !renderer) return;

        const resSel = $("resolution-select");
        const chosen = resSel ? parseRes(resSel.value) : null;
        const cs = containerSize();

        const renderW = chosen?.w || cs.w;
        const renderH = chosen?.h || cs.h;

        const rsHidden = $("render-scale-value");
        let renderScale = parseFloat(rsHidden?.value || "1");
        if (!Number.isFinite(renderScale) || renderScale <= 0) renderScale = 1;

        const W = Math.max(1, Math.floor(renderW * renderScale));
        const H = Math.max(1, Math.floor(renderH * renderScale));

        renderer.setSize(W, H, false);

        const aspect = W / H;
        if (camera)      { camera.aspect = aspect; camera.updateProjectionMatrix(); }
        if (orthoCamera) { orthoCamera.left = -2 * aspect; orthoCamera.right = 2 * aspect; orthoCamera.top = 2; orthoCamera.bottom = -2; orthoCamera.updateProjectionMatrix(); }

        if (composer) composer.setSize(W, H);
        if (fxaaPass) fxaaPass.material.uniforms["resolution"].value.set(1 / W, 1 / H);
    }

    // -- Lighting --
    function addLights() {
        scene.add(new AmbientLight(0xffffff, 0.4));
        keyLight = new DirectionalLight(0xffffff, 1.2);
        keyLight.position.set(3, 5, 3);
        keyLight.castShadow = true;
        keyLight.shadow.mapSize.width = keyLight.shadow.mapSize.height = 2048;
        keyLight.shadow.camera.near = 0.1; keyLight.shadow.camera.far = 30;
        keyLight.shadow.camera.left = -5; keyLight.shadow.camera.right = 5;
        keyLight.shadow.camera.top = 5;   keyLight.shadow.camera.bottom = -5;
        scene.add(keyLight);
        const rim = new DirectionalLight(0x8888ff, 0.4);
        rim.position.set(-3, 2, -3);
        scene.add(rim);
    }

    function addHelpers() {
        gridHelper = new GridHelper(10, 10, 0x444444, 0x333333);
        gridHelper.visible = false;
        scene.add(gridHelper);
        axesHelper = new AxesHelper(1.5);
        axesHelper.visible = false;
        scene.add(axesHelper);
    }

    // -- Geometry --
    const PRIMITIVES = {
        sphere:   () => new SphereGeometry(0.8, 64, 64),
        cube:     () => new BoxGeometry(1.2, 1.2, 1.2),
        cylinder: () => new CylinderGeometry(0.6, 0.6, 1.4, 64),
        torus:    () => new TorusGeometry(0.7, 0.28, 32, 128),
        cone:     () => new ConeGeometry(0.7, 1.4, 64)
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
        if (!currentMaterial) currentMaterial = new MeshPhysicalMaterial({ color: 0xe9e9e9, roughness: 0.5 });

        if (PRIMITIVES[id]) {
            currentMesh = new Mesh(PRIMITIVES[id](), currentMaterial);
            currentMesh.castShadow = currentMesh.receiveShadow = true;
            scene.add(currentMesh);
            groundOnGrid(currentMesh);
            focusCamera(currentMesh);
            return;
        }

        const entry = window.AssetRegistry?.getObjectById(id);
        if (!entry?.path) { console.warn("No path for:", id); return; }

        new OBJLoader().load(entry.path, obj => {
            obj.traverse(c => { if (c.isMesh) { c.material = currentMaterial; c.castShadow = c.receiveShadow = true; } });
            const box = new Box3().setFromObject(obj), sz = new Vector3();
            box.getSize(sz);
            const maxD = Math.max(sz.x, sz.y, sz.z);
            if (maxD > 0) obj.scale.setScalar(1.5 / maxD);
            box.setFromObject(obj);
            const ctr = new Vector3();
            box.getCenter(ctr);
            obj.position.x -= ctr.x; obj.position.z -= ctr.z;
            scene.add(obj);
            currentMesh = obj;
            groundOnGrid(currentMesh);
            focusCamera(currentMesh);
            if (entry.defaultMaterialId) {
                window.AssetRegistry.fetchMaterialData(entry.defaultMaterialId)
                    .then(d => { if (d && window.MaterialSettings) window.MaterialSettings.applyMaterialToUI(d); });
            }
        }, undefined, err => console.error("OBJ error:", err));
    }

    // -- Environment --
    // r180+: RGBELoader renamed to HDRLoader.
    // r182: PMREMGenerator must be used explicitly to convert equirect HDR
    //       into a PMREM cube map that PBR materials can use for env reflections.
    function loadEnvironment(id) {
        if (!id) return;
        const entry = window.AssetRegistry?.getEnvironmentById(id);
        if (!entry?.path) return;

        new HDRLoader().load(entry.path, tex => {
            const envMap = pmremGenerator.fromEquirectangular(tex).texture;
            tex.dispose();
            scene.environment = envMap;
            if (currentMaterial) currentMaterial.envMapIntensity = safeFloat("envint-input", 1);
        }, undefined, err => console.error("HDR error:", err));
    }

    // -- Material UI → Three.js r182 --
    function applyUIStateToMaterial() {
        if (!currentMaterial) return;

        currentMaterial.color.set(readColor("basecolor-hex", "basecolor-picker"));
        currentMaterial.metalness = safeFloat("metalness-input", 0);
        currentMaterial.roughness = safeFloat("roughness-input", 0.5);

        // r182: specularIntensity + specularColor  (replaces old reflectivity single-float)
        if ($("specular-enable")?.checked) {
            currentMaterial.specularIntensity = clamp(safeFloat("specint-input", 1), 0, 1);
            currentMaterial.specularColor.set(readColor("speccolor-hex", "speccolor-picker"));
        } else {
            currentMaterial.specularIntensity = 1.0;   // PBR default
            currentMaterial.specularColor.set(0xffffff);
        }

        // Clearcoat
        if ($("clearcoat-enable")?.checked) {
            currentMaterial.clearcoat          = safeFloat("clearcoat-input",      0);
            currentMaterial.clearcoatRoughness = safeFloat("clearcoatrough-input", 0.1);
        } else {
            currentMaterial.clearcoat = currentMaterial.clearcoatRoughness = 0;
        }

        // Opacity
        if ($("opacity-enable")?.checked) {
            currentMaterial.transparent = true;
            currentMaterial.opacity = safeFloat("opacity-input", 1);
        } else {
            currentMaterial.transparent = false;
            currentMaterial.opacity = 1;
        }

        // Transmission / glass — thickness + attenuation now fully supported in r182
        if ($("trans-enable")?.checked) {
            currentMaterial.transmission = safeFloat("transmission-input", 0);
            currentMaterial.ior          = safeFloat("ior-input",          1.5);
            currentMaterial.thickness    = safeFloat("thickness-input",    0);
            currentMaterial.side         = DoubleSide;
        } else {
            currentMaterial.transmission = 0;
            currentMaterial.thickness    = 0;
            currentMaterial.side         = FrontSide;
        }

        // Volume absorption (attenuation)
        if ($("atten-enable")?.checked) {
            currentMaterial.attenuationDistance = safeFloat("attdist-input", 0) || Infinity;
            currentMaterial.attenuationColor.set(readColor("attcolor-hex", "attcolor-picker"));
        } else {
            currentMaterial.attenuationDistance = Infinity;
            currentMaterial.attenuationColor.set(0xffffff);
        }

        // r182: sheenColor (Color) + sheenRoughness (float)  — replaces old single sheen float
        if ($("sheen-enable")?.checked) {
            currentMaterial.sheenColor.set(readColor("sheencolor-hex", "sheencolor-picker"));
            currentMaterial.sheenRoughness = clamp(safeFloat("sheenrough-input", 1), 0, 1);
        } else {
            currentMaterial.sheenColor.set(0x000000);
            currentMaterial.sheenRoughness = 1.0;
        }

        // Emission
        if ($("emissive-enable")?.checked) {
            currentMaterial.emissive.set(readColor("emissive-hex", "emissivecolor-picker"));
            currentMaterial.emissiveIntensity = safeFloat("emissiveint-input", 1);
        } else {
            currentMaterial.emissive.set(0x000000);
            currentMaterial.emissiveIntensity = 0;
        }

        currentMaterial.envMapIntensity = safeFloat("envint-input", 1);
        currentMaterial.needsUpdate = true;
    }

    function wireMaterialControls() {
        [
            "basecolor-picker", "basecolor-hex", "metalness-input", "metalness-slider",
            "roughness-input", "roughness-slider",
            "specular-enable", "speccolor-picker", "speccolor-hex", "specint-input", "specint-slider",
            "clearcoat-enable", "clearcoat-input", "clearcoat-slider", "clearcoatrough-input", "clearcoatrough-slider",
            "opacity-enable", "opacity-input", "opacity-slider",
            "trans-enable", "transmission-input", "transmission-slider", "ior-input", "ior-slider",
            "thickness-input", "thickness-slider",
            "atten-enable", "attdist-input", "attdist-slider", "attcolor-picker", "attcolor-hex",
            "sheen-enable", "sheencolor-picker", "sheencolor-hex", "sheenrough-input", "sheenrough-slider",
            "emissive-enable", "emissivecolor-picker", "emissive-hex", "emissiveint-input", "emissiveint-slider",
            "envint-input", "envint-slider"
        ].forEach(id => {
            const el = $(id);
            if (!el) return;
            el.addEventListener("input",  applyUIStateToMaterial);
            el.addEventListener("change", applyUIStateToMaterial);
        });
    }

    // -- Tab 4: Camera --
    function applyCameraFromUI() {
        const camType = $("camera-type-select")?.value;
        setActiveCam(camType === "orthographic" ? orthoCamera : camera);

        const near = parseFloat($("near-input")?.value || "0.1");
        const far  = parseFloat($("far-input")?.value  || "2000");
        if (Number.isFinite(near) && activeCamera) activeCamera.near = clamp(near, 0.01, 1000);
        if (Number.isFinite(far)  && activeCamera) activeCamera.far  = clamp(far,  10, 100000);
        if (activeCamera) activeCamera.updateProjectionMatrix();

        const tmap = {
            none:     NoToneMapping,
            aces:     ACESFilmicToneMapping,
            reinhard: ReinhardToneMapping,
            cineon:   CineonToneMapping
        };
        const toneVal = $("tone-mapping-value")?.value || "aces";
        if (renderer) {
            const newTone = tmap[toneVal] ?? ACESFilmicToneMapping;
            if (renderer.toneMapping !== newTone) {
                renderer.toneMapping = newTone;
                invalidateAllMaterials();
            }
        }

        const exp = parseFloat($("exposure-input")?.value || "1");
        if (renderer && Number.isFinite(exp)) renderer.toneMappingExposure = clamp(exp, 0.01, 10);

        const mm = parseFloat($("lens-mm-value")?.value || "50");
        if (Number.isFinite(mm) && mm > 0 && camera) {
            camera.fov = (2 * Math.atan(36 / (2 * mm))) * (180 / Math.PI);
            camera.updateProjectionMatrix();
        }
    }

    function setActiveCam(cam) {
        if (!cam) return;
        if (cam !== activeCamera) {
            const pos = activeCamera.position.clone();
            const tgt = orbitControls ? orbitControls.target.clone() : new Vector3(0, 0.5, 0);
            activeCamera = cam;
            activeCamera.position.copy(pos);
            activeCamera.lookAt(tgt);
        }
        if (orbitControls && orbitControls.object !== activeCamera) {
            orbitControls.object = activeCamera;
            orbitControls.update();
        }
        if (renderPass && renderPass.camera !== activeCamera) {
            renderPass.camera = activeCamera;
        }
    }

    function wireCameraControls() {
        const camSel = $("camera-type-select");
        if (camSel) camSel.addEventListener("change", applyCameraFromUI);

        const toneHidden = $("tone-mapping-value");
        if (toneHidden) toneHidden.addEventListener("change", applyCameraFromUI);

        const lensHidden = $("lens-mm-value");
        if (lensHidden) lensHidden.addEventListener("change", applyCameraFromUI);

        const expInp = $("exposure-input"), expSld = $("exposure-slider");
        if (expInp) { expInp.addEventListener("input", applyCameraFromUI); expInp.addEventListener("change", applyCameraFromUI); }
        if (expSld) { expSld.addEventListener("input", applyCameraFromUI); expSld.addEventListener("change", applyCameraFromUI); }

        const nearInp = $("near-input"), nearSld = $("near-slider");
        if (nearInp) { nearInp.addEventListener("input", applyCameraFromUI); nearInp.addEventListener("change", applyCameraFromUI); }
        if (nearSld) { nearSld.addEventListener("input", applyCameraFromUI); nearSld.addEventListener("change", applyCameraFromUI); }

        const farInp = $("far-input"), farSld = $("far-slider");
        if (farInp) { farInp.addEventListener("input", applyCameraFromUI); farInp.addEventListener("change", applyCameraFromUI); }
        if (farSld) { farSld.addEventListener("input", applyCameraFromUI); farSld.addEventListener("change", applyCameraFromUI); }
    }

    // -- Tab 5: Quality --
    function applyQualityFromUI() {
        if (!renderer) return;

        // DPR
        const dprVal = $("max-dpr-value")?.value || "1";
        const dpr = dprVal === "auto" ? window.devicePixelRatio : parseFloat(dprVal);
        if (Number.isFinite(dpr) && dpr > 0) renderer.setPixelRatio(dpr);

        // Shadows
        const shadowsOn = !!$("preview-toggle-shadows")?.checked;
        renderer.shadowMap.enabled = shadowsOn;

        // Shadow map size
        if (keyLight) {
            const sqMap = { off: 0, low: 512, medium: 1024, high: 2048, ultra: 4096 };
            const sqVal = $("shadow-quality-value")?.value || "high";
            const sz = sqMap[sqVal] ?? 2048;
            keyLight.shadow.mapSize.width = keyLight.shadow.mapSize.height = sz;
        }

        // Wireframe
        if (currentMaterial) currentMaterial.wireframe = !!$("preview-toggle-wireframe")?.checked;

        // Helpers
        const vis = !!$("preview-toggle-helpers")?.checked;
        if (gridHelper) gridHelper.visible = vis;
        if (axesHelper)  axesHelper.visible = vis;

        resize();
    }

    function wireQualityControls() {
        ["resolution-select"].forEach(id => {
            const el = $(id);
            if (el) el.addEventListener("change", applyQualityFromUI);
        });
        ["render-scale-value", "max-dpr-value", "aa-mode-value", "shadow-quality-value", "texture-filtering-value"].forEach(id => {
            const el = $(id);
            if (el) el.addEventListener("change", applyQualityFromUI);
        });
        ["preview-toggle-shadows", "preview-toggle-wireframe", "preview-toggle-helpers", "preview-toggle-postfx"].forEach(id => {
            const el = $(id);
            if (el) el.addEventListener("change", applyQualityFromUI);
        });
    }

    // -- Tab 6: PostFX --
    // r182 postprocessing note: OutputPass (from three/addons/postprocessing/OutputPass.js)
    // replaces the old CopyShader + manual sRGB gamma step. It handles color-space
    // conversion from linear to the renderer's outputColorSpace automatically.
    function buildComposer() {
        if (composer) { composer.passes = []; bloomPass = vignettePass = fxaaPass = outputPass = null; }

        composer = new EffectComposer(renderer);

        // 1. Scene render
        renderPass = new RenderPass(scene, activeCamera);
        composer.addPass(renderPass);

        // 2. Bloom
        const { w, h } = containerSize();
        bloomPass = new UnrealBloomPass(
            new Vector2(w, h),
            safeFloat("bloom-strength-input",  0.35),
            safeFloat("bloom-radius-input",    0.20),
            safeFloat("bloom-threshold-input", 0.85)
        );
        bloomPass.enabled = false;
        composer.addPass(bloomPass);

        // 3. Vignette
        vignettePass = new ShaderPass(VignetteShader);
        vignettePass.uniforms.offset.value   = 1.0;
        vignettePass.uniforms.darkness.value = 1.1;
        vignettePass.enabled = false;
        composer.addPass(vignettePass);

        // 4. FXAA
        fxaaPass = new ShaderPass(FXAAShader);
        fxaaPass.enabled = false;
        composer.addPass(fxaaPass);

        // 5. OutputPass — handles sRGB conversion + tone mapping output (replaces CopyShader)
        outputPass = new OutputPass();
        composer.addPass(outputPass);
    }

    function applyBloomFromUI() {
        if (!bloomPass) return;
        bloomPass.strength  = safeFloat("bloom-strength-input",  0.35);
        bloomPass.radius    = safeFloat("bloom-radius-input",    0.20);
        bloomPass.threshold = safeFloat("bloom-threshold-input", 0.85);
    }

    function applyVignetteFromUI() {
        if (!vignettePass) return;
        vignettePass.uniforms.darkness.value = 0.5 + clamp(safeFloat("vignette-intensity-input", 0.25), 0, 1) * 1.5;
        vignettePass.uniforms.offset.value   = 0.7 + clamp(safeFloat("vignette-softness-input",  0.60), 0, 1) * 0.8;
    }

    function applyPostFXFromUI() {
        if (!composer) buildComposer();

        const bloomOn = !!$("post-toggle-bloom")?.checked;
        const vigOn   = !!$("post-toggle-vignette")?.checked;
        const aaMode  = $("aa-mode-value")?.value || "msaa";

        if (bloomPass)    { bloomPass.enabled    = bloomOn; applyBloomFromUI(); }
        if (vignettePass) { vignettePass.enabled = vigOn;   applyVignetteFromUI(); }
        if (fxaaPass)     { fxaaPass.enabled     = (aaMode === "fxaa"); }
        if (renderPass)   renderPass.camera = activeCamera;

        SceneManager._postfxMasterOn = $("preview-toggle-postfx")?.checked ?? true;
        resize();
    }

    function wirePostFXControls() {
        ["preview-toggle-postfx", "post-toggle-bloom", "post-toggle-vignette", "post-toggle-ao", "post-toggle-motionblur"]
            .forEach(id => { const el = $(id); if (el) el.addEventListener("change", applyPostFXFromUI); });

        const aaModeHidden = $("aa-mode-value");
        if (aaModeHidden) aaModeHidden.addEventListener("change", applyPostFXFromUI);

        ["bloom-strength-input", "bloom-strength-slider",
         "bloom-radius-input",   "bloom-radius-slider",
         "bloom-threshold-input","bloom-threshold-slider"].forEach(id => {
            const el = $(id);
            if (el) { el.addEventListener("input", applyBloomFromUI); el.addEventListener("change", applyBloomFromUI); }
        });

        ["vignette-intensity-input", "vignette-intensity-slider",
         "vignette-softness-input",  "vignette-softness-slider"].forEach(id => {
            const el = $(id);
            if (el) { el.addEventListener("input", applyVignetteFromUI); el.addEventListener("change", applyVignetteFromUI); }
        });
    }

    // -- Keyboard --
    function handleKeys() {
        if (!activeCamera) return;
        const s = 0.04;
        if (keys["ArrowLeft"])  activeCamera.position.x -= s;
        if (keys["ArrowRight"]) activeCamera.position.x += s;
        if (keys["ArrowUp"])    activeCamera.position.y += s;
        if (keys["ArrowDown"])  activeCamera.position.y -= s;
        if (keys["q"] || keys["Q"]) activeCamera.position.z += s;
        if (keys["e"] || keys["E"]) activeCamera.position.z -= s;
        if (keys["r"] || keys["R"]) {
            if (currentMesh) focusCamera(currentMesh);
            else {
                activeCamera.position.set(0, 1.2, 3.5);
                activeCamera.lookAt(0, 0.5, 0);
                if (orbitControls) orbitControls.target.set(0, 0.5, 0);
            }
            keys["r"] = keys["R"] = false;
        }
    }

    // -- Render loop --
    function animate() {
        requestAnimationFrame(animate);
        handleKeys();
        if (orbitControls) orbitControls.update();
        if (SceneManager._postfxMasterOn !== false && composer) {
            if (renderPass) renderPass.camera = activeCamera;
            composer.render();
        } else {
            renderer.render(scene, activeCamera);
        }
    }

    return { _postfxMasterOn: true, init, loadGeometry, loadEnvironment, applyUIStateToMaterial, wireMaterialControls };
})();

window.SceneManager = SceneManager;

// ============================================================================
// 6) Boot
// ============================================================================

// type="module" scripts are deferred by default — DOM is already ready here.
// We still handle the manifest-missing case gracefully.
(function boot() {
    window.SettingsPersistence.restore();

    window.AssetRegistry.loadManifest("assets/manifest.json")
        .then(() => {
            window.AssetRegistry.populateMenus({
                objectSelectIds:     ["object-select", "object-select-materialtab"],
                materialSelectId:    "material-select",
                environmentSelectId: "environment-select"
            });
            window.SettingsPersistence.restore();
            window.SceneManager.init("scene-view-placeholder");
            window.MaterialSettings?.refreshFromSelection?.();
        })
        .catch(err => {
            console.warn("Boot: manifest failed (running without assets):", err);
            window.SettingsPersistence.restore();
            window.SceneManager.init("scene-view-placeholder");
        });
})();