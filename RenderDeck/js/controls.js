// js/controls.js
// ============================================================================
// RenderDeck Controls - Tab Logic + Input/Slider + Color Binding + Setting3 Toggles
// + Button-row "dropdown replacement" bindings (button-selected class)
// + Lens preset buttons <-> lens slider <-> lens numeric input sync
// ============================================================================

// ---------------- TAB CONTROLS LOGIC -----------------------
function openSetting(evt, settingName) {
  const tabcontent = document.getElementsByClassName("tabcontent");
  for (let i = 0; i < tabcontent.length; i++) tabcontent[i].style.display = "none";

  const tablinks = document.getElementsByClassName("tablinks");
  for (let i = 0; i < tablinks.length; i++)
    tablinks[i].className = tablinks[i].className.replace(" active", "");

  const target = document.getElementById(settingName);
  if (target) target.style.display = "block";
  if (evt && evt.currentTarget) evt.currentTarget.className += " active";
}

// ---------------- UTIL: decimals -----------------------
function countDecimals(value) {
  if (Math.floor(value) === value) return 0;
  const str = value.toString();
  if (str.indexOf(".") !== -1) return str.split(".")[1].length || 0;
  return 0;
}

// ---------------- INPUT/SLIDER BINDING SYSTEM -----------------------
function bindInputSlider(inputId, sliderId) {
  const input = document.getElementById(inputId);
  const slider = document.getElementById(sliderId);

  if (!input || !slider) {
    console.warn(`bindInputSlider: missing ${inputId} or ${sliderId}`);
    return;
  }

  const min = parseFloat(slider.min);
  const max = parseFloat(slider.max);
  const step = parseFloat(slider.step);
  const decimals = countDecimals(step);

  function clampValue(v) {
    return Math.max(min, Math.min(max, v));
  }

  function roundToStep(v) {
    if (!step || !isFinite(step)) return v;
    return Math.round(v / step) * step;
  }

  // Slider -> Input
  slider.addEventListener("input", function () {
    const value = parseFloat(this.value);
    if (isNaN(value)) return;
    input.value = value.toFixed(decimals);
  });

  // Input -> Slider (live)
  input.addEventListener("input", function () {
    let value = parseFloat(this.value);
    if (isNaN(value)) return;
    slider.value = clampValue(value);
  });

  // Commit formatting / bounds on blur
  input.addEventListener("blur", function () {
    let value = parseFloat(this.value);

    if (isNaN(value)) {
      value = parseFloat(slider.value);
    } else {
      value = clampValue(value);
      value = roundToStep(value);
    }

    input.value = value.toFixed(decimals);
    slider.value = value;
  });

  // Enter commits
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      input.blur();
    }
  });
}

// ---------------- COLOR PICKER <-> HEX FIELD BINDING -----------------------
function normalizeHex(hex) {
  if (typeof hex !== "string") return null;
  let h = hex.trim();
  if (!h.startsWith("#")) h = "#" + h;
  if (h.length !== 7) return null;
  if (!/^#[0-9a-fA-F]{6}$/.test(h)) return null;
  return h.toLowerCase();
}

function bindColorPickerHex(pickerId, hexId, swatchId = null) {
  const picker = document.getElementById(pickerId);
  const hex = document.getElementById(hexId);
  const swatch = swatchId ? document.getElementById(swatchId) : null;

  if (!picker || !hex) {
    console.warn(`bindColorPickerHex: missing ${pickerId} or ${hexId}`);
    return;
  }

  function applyColor(color) {
    picker.value = color;
    hex.value = color;
    if (swatch) swatch.style.backgroundColor = color;
  }

  const initial = normalizeHex(hex.value) || normalizeHex(picker.value) || "#000000";
  applyColor(initial);

  picker.addEventListener("input", () => {
    const color = normalizeHex(picker.value);
    if (!color) return;
    hex.value = color;
    if (swatch) swatch.style.backgroundColor = color;
  });

  hex.addEventListener("input", () => {
    const color = normalizeHex(hex.value);
    if (!color) return;
    picker.value = color;
    if (swatch) swatch.style.backgroundColor = color;
  });

  function commitHex() {
    const color = normalizeHex(hex.value) || normalizeHex(picker.value) || "#000000";
    applyColor(color);
  }

  hex.addEventListener("blur", commitHex);
  hex.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      hex.blur();
    }
  });
}

// ---------------- DOM helpers -----------------------
function byId(id) {
  return document.getElementById(id);
}

/**
 * Enable/disable a set of controls WITHOUT changing their values.
 */
function setEnabled(ids, enabled) {
  ids.forEach((id) => {
    const el = byId(id);
    if (!el) return;
    el.disabled = !enabled;
  });
}

// ---------------- BUTTON-ROW SELECT SYSTEM -----------------------
/**
 * Makes a .button-row behave like a single-choice select.
 * Uses "button-selected" CSS class (consistent with styles.css).
 *
 * HTML expected:
 * <div class="button-row" data-target-input="some-hidden-id">
 *   <button class="button" data-value="...">...</button>
 * </div>
 * <input id="some-hidden-id" type="hidden" value="...">
 */
function initButtonRows() {
  const rows = document.querySelectorAll(".button-row[data-target-input]");

  rows.forEach((row) => {
    const targetId = row.getAttribute("data-target-input");
    const hidden = byId(targetId);

    if (!hidden) {
      console.warn("initButtonRows: missing hidden input:", targetId);
      return;
    }

    // Skip rows already managed by bindButtonRowToNumberAndSlider
    // (identified by also having a matching -input and -slider pair)
    // They handle their own setup.

    function setSelectedByValue(value) {
      const v = String(value);
      const buttons = row.querySelectorAll("button.button");
      let found = false;

      buttons.forEach((b) => {
        const isMatch = (b.getAttribute("data-value") ?? "") === v;
        b.classList.toggle("button-selected", isMatch);
        if (isMatch) found = true;
      });

      if (!found) buttons.forEach((b) => b.classList.remove("button-selected"));
    }

    function setValue(value, fireChange = true) {
      hidden.value = String(value);
      setSelectedByValue(hidden.value);
      if (fireChange) hidden.dispatchEvent(new Event("change", { bubbles: true }));
    }

    // Click -> set value
    row.addEventListener("click", (e) => {
      const btn = e.target.closest("button.button");
      if (!btn) return;
      const value = btn.getAttribute("data-value");
      if (value == null) return;
      setValue(value, true);
    });

    // Initial highlight from hidden value
    if (hidden.value) {
      setSelectedByValue(hidden.value);
    } else {
      // Fall back to first button-selected already in HTML
      const preSelected = row.querySelector("button.button.button-selected");
      if (preSelected) {
        hidden.value = preSelected.getAttribute("data-value") || "";
        setSelectedByValue(hidden.value);
      }
    }
  });
}

/**
 * Keeps a button-row preset, hidden input, number input, and slider all synced.
 * Call this INSTEAD of a separate bindInputSlider for that pair — it calls it internally.
 */
function bindButtonRowToNumberAndSlider(rowId, hiddenId, numberId, sliderId) {
  const row = byId(rowId);
  const hidden = byId(hiddenId);
  const num = byId(numberId);
  const slider = byId(sliderId);

  if (!row || !hidden || !num || !slider) {
    console.warn("bindButtonRowToNumberAndSlider: missing element(s)", {
      rowId, hiddenId, numberId, sliderId,
    });
    return;
  }

  // Bind num <-> slider
  bindInputSlider(numberId, sliderId);

  function highlightPresets(value) {
    const v = String(value);
    const buttons = row.querySelectorAll("button.button");
    let matched = false;

    buttons.forEach((b) => {
      const isMatch = (b.getAttribute("data-value") ?? "") === v;
      b.classList.toggle("button-selected", isMatch);
      if (isMatch) matched = true;
    });

    if (!matched) buttons.forEach((b) => b.classList.remove("button-selected"));
  }

  function setAll(v, doHighlight = true) {
    const value = String(v);
    num.value = value;
    slider.value = value;
    hidden.value = value;
    if (doHighlight) highlightPresets(value);
    hidden.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // Preset click -> update all
  row.addEventListener("click", (e) => {
    const btn = e.target.closest("button.button");
    if (!btn) return;
    const value = btn.getAttribute("data-value");
    if (value == null) return;
    setAll(value, true);
  });

  // Number/slider changes -> update hidden + preset highlight
  // Use "change" only to avoid fighting bindInputSlider's "input" handler
  num.addEventListener("change", () => {
    hidden.value = num.value;
    highlightPresets(num.value);
    hidden.dispatchEvent(new Event("change", { bubbles: true }));
  });
  slider.addEventListener("change", () => {
    hidden.value = slider.value;
    highlightPresets(slider.value);
    hidden.dispatchEvent(new Event("change", { bubbles: true }));
  });

  // Initial sync
  const initial =
    hidden.value ||
    num.value ||
    slider.value ||
    (row.querySelector("button.button")?.getAttribute("data-value") ?? "");

  setAll(initial, true);
}

// ---------------- Setting3: toggle logic (preserve values) -----------------------
function initSetting3() {
  // ---- Bind sliders/inputs (Setting3 only) ----
  bindInputSlider("metalness-input",    "metalness-slider");
  bindInputSlider("roughness-input",    "roughness-slider");
  bindInputSlider("specint-input",      "specint-slider");
  bindInputSlider("clearcoat-input",    "clearcoat-slider");
  bindInputSlider("clearcoatrough-input","clearcoatrough-slider");
  bindInputSlider("opacity-input",      "opacity-slider");
  bindInputSlider("transmission-input", "transmission-slider");
  bindInputSlider("ior-input",          "ior-slider");
  bindInputSlider("thickness-input",    "thickness-slider");
  bindInputSlider("attdist-input",      "attdist-slider");
  bindInputSlider("sheenrough-input",   "sheenrough-slider");
  bindInputSlider("emissiveint-input",  "emissiveint-slider");
  bindInputSlider("envint-input",       "envint-slider");

  // ---- Bind colors (Setting3 only) ----
  bindColorPickerHex("basecolor-picker",    "basecolor-hex",    "basecolor-swatch");
  bindColorPickerHex("speccolor-picker",    "speccolor-hex",    "speccolor-swatch");
  bindColorPickerHex("attcolor-picker",     "attcolor-hex",     "attcolor-swatch");
  bindColorPickerHex("sheencolor-picker",   "sheencolor-hex",   "sheencolor-swatch");
  // NOTE: emissive picker is "emissivecolor-picker", hex field is "emissive-hex", swatch is "emissive-swatch"
  bindColorPickerHex("emissivecolor-picker","emissive-hex",     "emissive-swatch");

  // ---- Toggles ----
  const tSpec     = byId("specular-enable");
  const tClear    = byId("clearcoat-enable");
  const tOpacity  = byId("opacity-enable");
  const tTrans    = byId("trans-enable");
  const tAtten    = byId("atten-enable");
  const tSheen    = byId("sheen-enable");
  const tEmissive = byId("emissive-enable");

  function applySpecularState() {
    const on = !!(tSpec && tSpec.checked);
    setEnabled(["speccolor-picker","speccolor-hex","specint-input","specint-slider"], on);
  }

  function applyClearcoatState() {
    const on = !!(tClear && tClear.checked);
    setEnabled(["clearcoat-input","clearcoat-slider","clearcoatrough-input","clearcoatrough-slider"], on);
  }

  function applyOpacityState() {
    const on = !!(tOpacity && tOpacity.checked);
    setEnabled(["opacity-input","opacity-slider"], on);
  }

  function applyTransmissionState() {
    const on = !!(tTrans && tTrans.checked);
    setEnabled([
      "transmission-input","transmission-slider",
      "ior-input","ior-slider",
      "thickness-input","thickness-slider",
      "atten-enable",
    ], on);
    applyAttenuationState();
  }

  function applyAttenuationState() {
    const transOn = !!(tTrans && tTrans.checked);
    const attenOn = transOn && !!(tAtten && tAtten.checked);
    setEnabled(["attdist-input","attdist-slider","attcolor-picker","attcolor-hex"], attenOn);
  }

  function applySheenState() {
    const on = !!(tSheen && tSheen.checked);
    setEnabled(["sheencolor-picker","sheencolor-hex","sheenrough-input","sheenrough-slider"], on);
  }

  function applyEmissiveState() {
    const on = !!(tEmissive && tEmissive.checked);
    setEnabled(["emissivecolor-picker","emissive-hex","emissiveint-input","emissiveint-slider"], on);
  }

  // Wire events
  if (tSpec)     tSpec.addEventListener("change",    applySpecularState);
  if (tClear)    tClear.addEventListener("change",   applyClearcoatState);
  if (tOpacity)  tOpacity.addEventListener("change", applyOpacityState);
  if (tTrans)    tTrans.addEventListener("change",   applyTransmissionState);
  if (tAtten)    tAtten.addEventListener("change",   applyAttenuationState);
  if (tSheen)    tSheen.addEventListener("change",   applySheenState);
  if (tEmissive) tEmissive.addEventListener("change",applyEmissiveState);

  // Initial states
  applySpecularState();
  applyClearcoatState();
  applyOpacityState();
  applyTransmissionState();
  applySheenState();
  applyEmissiveState();
}

// ---------------- Setting2 design sliders ----------------------
function initSetting2() {
  bindInputSlider("design-posx-input",     "design-posx-slider");
  bindInputSlider("design-posy-input",     "design-posy-slider");
  bindInputSlider("design-width-input",    "design-width-slider");
  bindInputSlider("design-height-input",   "design-height-slider");
  bindInputSlider("design-rotation-input", "design-rotation-slider");
}

// ---------------- Setting4 camera sliders ----------------------
function initSetting4() {
  bindInputSlider("near-input",             "near-slider");
  bindInputSlider("far-input",              "far-slider");
  bindInputSlider("exposure-input",         "exposure-slider");
  bindInputSlider("cam-dof-focus-input",    "cam-dof-focus-slider");
  bindInputSlider("cam-dof-strength-input", "cam-dof-strength-slider");
}

// ---------------- Setting6 postfx sliders ----------------------
function initSetting6() {
  bindInputSlider("bloom-strength-input",     "bloom-strength-slider");
  bindInputSlider("bloom-radius-input",       "bloom-radius-slider");
  bindInputSlider("bloom-threshold-input",    "bloom-threshold-slider");
  bindInputSlider("vignette-intensity-input", "vignette-intensity-slider");
  bindInputSlider("vignette-softness-input",  "vignette-softness-slider");
  bindInputSlider("ao-intensity-input",       "ao-intensity-slider");
  bindInputSlider("ao-radius-input",          "ao-radius-slider");
  bindInputSlider("motionblur-strength-input","motionblur-strength-slider");
}

// ---------------- INIT -----------------------
document.addEventListener("DOMContentLoaded", function () {
  initSetting2();
  initSetting3();
  initSetting4();
  initSetting6();

  // Button-row single-choice behavior for all rows that do NOT also sync
  // to a number+slider pair (those are handled by bindButtonRowToNumberAndSlider).
  initButtonRows();

  // Lens preset buttons <-> lens slider <-> lens numeric field
  bindButtonRowToNumberAndSlider(
    "lens-mm-buttons",
    "lens-mm-value",
    "lens-mm-input",
    "lens-mm-slider"
  );

  console.log("RenderDeck controls initialized.");
});