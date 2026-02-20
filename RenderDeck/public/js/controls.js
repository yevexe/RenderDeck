// js/controls.js
// ============================================================================
// RenderDeck Controls - Tab Logic + Input/Slider + Color Binding + Setting3 Toggles
// Version: "preserve values while disabled" (no wiping on toggle-off)
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
 * Also visually greys out via disabled attribute (you can style :disabled).
 */
function setEnabled(ids, enabled) {
  ids.forEach((id) => {
    const el = byId(id);
    if (!el) return;
    el.disabled = !enabled;
    // optional: add a class for styling parents if you want
  });
}

// ---------------- Setting3: toggle logic (preserve values) -----------------------
function initSetting3() {
  // ---- Bind sliders/inputs (Setting3 only) ----
  bindInputSlider("metalness-input", "metalness-slider");
  bindInputSlider("roughness-input", "roughness-slider");

  bindInputSlider("specint-input", "specint-slider");

  bindInputSlider("clearcoat-input", "clearcoat-slider");
  bindInputSlider("clearcoatrough-input", "clearcoatrough-slider");

  bindInputSlider("opacity-input", "opacity-slider");

  bindInputSlider("transmission-input", "transmission-slider");
  bindInputSlider("ior-input", "ior-slider");
  bindInputSlider("thickness-input", "thickness-slider");

  bindInputSlider("attdist-input", "attdist-slider");

  bindInputSlider("sheenrough-input", "sheenrough-slider");

  bindInputSlider("emissiveint-input", "emissiveint-slider");

  bindInputSlider("envint-input", "envint-slider");

  // ---- Bind colors (Setting3 only) ----
  bindColorPickerHex("basecolor-picker", "basecolor-hex", "basecolor-swatch");
  bindColorPickerHex("speccolor-picker", "speccolor-hex", "speccolor-swatch");
  bindColorPickerHex("attcolor-picker", "attcolor-hex", "attcolor-swatch");
  bindColorPickerHex("sheencolor-picker", "sheencolor-hex", "sheencolor-swatch");
  bindColorPickerHex("emissivecolor-picker", "emissive-hex", "emissive-swatch");

  // ---- Toggles ----
  const tSpec = byId("specular-enable");
  const tClear = byId("clearcoat-enable");
  const tOpacity = byId("opacity-enable");
  const tTrans = byId("trans-enable");
  const tAtten = byId("atten-enable");
  const tSheen = byId("sheen-enable");
  const tEmissive = byId("emissive-enable");

  function applySpecularState() {
    const on = !!(tSpec && tSpec.checked);
    setEnabled(
      ["speccolor-picker", "speccolor-hex", "specint-input", "specint-slider"],
      on
    );
  }

  function applyClearcoatState() {
    const on = !!(tClear && tClear.checked);
    setEnabled(
      ["clearcoat-input", "clearcoat-slider", "clearcoatrough-input", "clearcoatrough-slider"],
      on
    );
  }

  function applyOpacityState() {
    const on = !!(tOpacity && tOpacity.checked);
    setEnabled(["opacity-input", "opacity-slider"], on);
  }

  /**
   * Transmission gates the whole glass block (but DOES NOT wipe values).
   * If transmission is off, absorption is forcibly disabled in UI (values kept).
   */
  function applyTransmissionState() {
    const on = !!(tTrans && tTrans.checked);

    setEnabled(
      [
        "transmission-input",
        "transmission-slider",
        "ior-input",
        "ior-slider",
        "thickness-input",
        "thickness-slider",
        "atten-enable", // allow toggling absorption only if transmission is on
      ],
      on
    );

    // Attenuation sub-block depends on BOTH transmission + attenuation toggle
    applyAttenuationState();
  }

  function applyAttenuationState() {
    const transOn = !!(tTrans && tTrans.checked);
    const attenOn = transOn && !!(tAtten && tAtten.checked);

    // If transmission is off, user cannot interact with atten toggle itself
    if (!transOn && tAtten) {
      // Don't change checked state; just lock it out with the parent gate above.
      // (So when transmission returns, their previous atten choice is preserved.)
    }

    setEnabled(["attdist-input", "attdist-slider", "attcolor-picker", "attcolor-hex"], attenOn);
  }

  function applySheenState() {
    const on = !!(tSheen && tSheen.checked);
    setEnabled(["sheencolor-picker", "sheencolor-hex", "sheenrough-input", "sheenrough-slider"], on);
  }

  function applyEmissiveState() {
    const on = !!(tEmissive && tEmissive.checked);
    setEnabled(["emissivecolor-picker", "emissive-hex", "emissiveint-input", "emissiveint-slider"], on);
  }

  // Wire events
  if (tSpec) tSpec.addEventListener("change", applySpecularState);
  if (tClear) tClear.addEventListener("change", applyClearcoatState);
  if (tOpacity) tOpacity.addEventListener("change", applyOpacityState);

  if (tTrans) tTrans.addEventListener("change", applyTransmissionState);
  if (tAtten) tAtten.addEventListener("change", applyAttenuationState);

  if (tSheen) tSheen.addEventListener("change", applySheenState);
  if (tEmissive) tEmissive.addEventListener("change", applyEmissiveState);

  // Initial states
  applySpecularState();
  applyClearcoatState();
  applyOpacityState();
  applyTransmissionState();
  applySheenState();
  applyEmissiveState();
}

// ---------------- INIT -----------------------
document.addEventListener("DOMContentLoaded", function () {
  initSetting3();
  console.log("RenderDeck controls initialized (Setting3 preserve-values toggles)");
});