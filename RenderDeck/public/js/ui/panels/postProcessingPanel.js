export function setupPostProcessingPanel({ rendererManager, markNeedsRender, scheduleProjectSettingsSave, log }) {
  const rm = rendererManager; // shorthand

  // Helper: link slider <-> number input
  const link = (sliderId, inputId, callback) => {
    const s = document.getElementById(sliderId);
    const i = document.getElementById(inputId);
    if (!s || !i) return;
    s.addEventListener('input', () => { i.value = s.value; callback(parseFloat(s.value)); scheduleProjectSettingsSave(); });
    i.addEventListener('input', () => {
      const v = parseFloat(i.value);
      if (!isNaN(v)) { s.value = v; callback(v); scheduleProjectSettingsSave(); }
    });
  };

  // ── Global post-FX toggle (Setting 5 "Enable Post Effects") ──
  const globalToggle = document.getElementById('preview-toggle-postfx');
  if (globalToggle) {
    globalToggle.addEventListener('change', (e) => {
      rm.setPostFXEnabled(e.target.checked);
      scheduleProjectSettingsSave();
    });
    // Sync to the checkbox's actual DOM state on init
    rm.setPostFXEnabled(globalToggle.checked);
  }

  // ── Individual effect toggles ─────────────────────────────────
  const bloomToggle = document.getElementById('post-toggle-bloom');
  if (bloomToggle) {
    bloomToggle.addEventListener('change', (e) => { rm.setBloom(e.target.checked); scheduleProjectSettingsSave(); });
  }

  const vignetteToggle = document.getElementById('post-toggle-vignette');
  if (vignetteToggle) {
    vignetteToggle.addEventListener('change', (e) => { rm.setVignette(e.target.checked); scheduleProjectSettingsSave(); });
  }

  const aoToggle = document.getElementById('post-toggle-ao');
  if (aoToggle) {
    aoToggle.addEventListener('change', (e) => { rm.setSSAO(e.target.checked); scheduleProjectSettingsSave(); });
  }

  const motionBlurToggle = document.getElementById('post-toggle-motionblur');
  if (motionBlurToggle) {
    motionBlurToggle.addEventListener('change', (e) => { rm.setMotionBlur(e.target.checked); scheduleProjectSettingsSave(); });
  }

  // ── Bloom controls ────────────────────────────────────────────
  link('bloom-strength-slider', 'bloom-strength-input', v => rm.setBloomStrength(v));
  link('bloom-radius-slider',   'bloom-radius-input',   v => rm.setBloomRadius(v));
  link('bloom-threshold-slider','bloom-threshold-input',v => rm.setBloomThreshold(v));

  // ── Vignette controls ─────────────────────────────────────────
  link('vignette-intensity-slider', 'vignette-intensity-input', v => rm.setVignetteIntensity(v));
  link('vignette-softness-slider',  'vignette-softness-input',  v => rm.setVignetteSoftness(v));

  // Color picker + hex sync
  const vColorPicker = document.getElementById('vignette-color-picker');
  const vColorHex    = document.getElementById('vignette-color-hex');
  const vColorSwatch = document.getElementById('vignette-color-swatch');
  const syncVignetteColor = (hex) => {
    rm.setVignetteColor(hex);
    if (vColorPicker) vColorPicker.value = hex;
    if (vColorHex)    vColorHex.value    = hex;
    if (vColorSwatch) vColorSwatch.style.backgroundColor = hex;
    markNeedsRender(4);
    scheduleProjectSettingsSave();
  };
  vColorPicker?.addEventListener('input',  e => syncVignetteColor(e.target.value));
  vColorHex?.addEventListener('change', e => {
    const v = e.target.value.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(v)) syncVignetteColor(v);
  });
  syncVignetteColor('#000000'); // initialize swatch

  // Blend mode
  document.getElementById('vignette-blend-mode')?.addEventListener('change', e => {
    rm.setVignetteBlendMode(parseInt(e.target.value, 10));
    markNeedsRender(4);
    scheduleProjectSettingsSave();
  });

  // ── AO controls ───────────────────────────────────────────────
  link('ao-intensity-slider', 'ao-intensity-input', v => rm.setSSAOIntensity(v));
  link('ao-radius-slider',    'ao-radius-input',    v => rm.setSSAORadius(v));

  // ── Motion blur controls ──────────────────────────────────────
  link('motionblur-strength-slider', 'motionblur-strength-input', v => rm.setMotionBlurStrength(v));

  log('Post-processing UI ready.');
}
