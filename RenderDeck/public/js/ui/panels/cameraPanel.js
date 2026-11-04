import * as THREE from 'three';
import { appState } from '../../app/appState.js';

export function setupCameraPanel({ cameraManager, rendererManager, cameraState, setupButtonRow, markNeedsRender, scheduleProjectSettingsSave, log }) {
  const camState = cameraState;

  function applyCameraSettings() {
    const renderer = rendererManager.getRenderer();

    if (camState.type === 'perspective') {
      cameraManager.setPerspectiveLens(camState.focalLength, camState.sensorKey, camState.near, camState.far);
    }

    // Tone mapping
    const TM = {
      none: THREE.NoToneMapping,
      aces: THREE.ACESFilmicToneMapping,
      reinhard: THREE.ReinhardToneMapping,
      cineon: THREE.CineonToneMapping,
    };
    renderer.toneMapping = TM[camState.toneMapping] ?? THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = camState.exposure;
    markNeedsRender(4);
  }

  function setupCameraUI() {
    // Helpers: link slider ↔ input (each change is saved to settings/${pid})
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

    // Camera type
    const typeSelect = document.getElementById('camera-type-select');
    if (typeSelect) {
      typeSelect.addEventListener('change', (e) => {
        camState.type = e.target.value;
        applyCameraType();
        scheduleProjectSettingsSave();
      });
    }

    // Lens / focal length — button row preset + slider/input for custom value
    setupButtonRow('lens-mm-buttons', (v) => {
      camState.focalLength = parseFloat(v);
      const s = document.getElementById('lens-mm-slider');
      const i = document.getElementById('lens-mm-input');
      if (s) s.value = v;
      if (i) i.value = v;
      applyCameraSettings();
      log(`Lens: ${camState.focalLength}mm`);
    });

    link('lens-mm-slider', 'lens-mm-input', (v) => {
      camState.focalLength = v;
      // Highlight preset button if slider lands on a preset value
      const group = document.getElementById('lens-mm-buttons');
      if (group) {
        group.querySelectorAll('button').forEach(b => {
          if (parseFloat(b.dataset.value) === v) {
            b.classList.add('button-selected');
          } else {
            b.classList.remove('button-selected');
          }
        });
      }
      applyCameraSettings();
      log(`Lens: ${v}mm`);
    });

    // Film / sensor gauge
    setupButtonRow('film-gauge-buttons', (v) => {
      camState.sensorKey = v;
      applyCameraSettings();
      log(`Sensor: ${v}`);
    });

    // Near clip
    link('near-slider', 'near-input', (v) => {
      camState.near = v;
      cameraManager.getCamera().near = v;
      cameraManager.getCamera().updateProjectionMatrix();
    });

    // Far clip
    link('far-slider', 'far-input', (v) => {
      camState.far = v;
      cameraManager.getCamera().far = v;
      cameraManager.getCamera().updateProjectionMatrix();
    });

    // Tone mapping
    setupButtonRow('tone-mapping-buttons', (v) => {
      camState.toneMapping = v;
      applyCameraSettings();
    });

    // Exposure
    link('exposure-slider', 'exposure-input', (v) => {
      camState.exposure = v;
      rendererManager.getRenderer().toneMappingExposure = v;
    });

    const applyDOF = () => {
      applyCameraDOF();
      scheduleProjectSettingsSave();
    };

    // DOF toggle
    const dofToggle = document.getElementById('cam-toggle-dof');
    if (dofToggle) {
      dofToggle.addEventListener('change', (e) => {
        camState.dofEnabled = e.target.checked;
        applyDOF();
      });
    }

    // DOF focus distance
    link('cam-dof-focus-slider', 'cam-dof-focus-input', (v) => {
      camState.dofFocus = v;
      applyDOF();
    });

    // DOF aperture/strength
    link('cam-dof-strength-slider', 'cam-dof-strength-input', (v) => {
      camState.dofAperture = v;
      applyDOF();
    });

    // DOF max blur
    link('cam-dof-maxblur-slider', 'cam-dof-maxblur-input', (v) => {
      camState.dofMaxBlur = v;
      applyDOF();
    });

    // DOF rings (sample quality)
    link('cam-dof-rings-slider', 'cam-dof-rings-input', (v) => {
      camState.dofRings = Math.round(v);
      applyDOF();
    });

    // DOF focus buttons
    const dofFocusObjBtn = document.getElementById('cam-dof-focus-object');
    if (dofFocusObjBtn) {
      dofFocusObjBtn.addEventListener('click', () => {
        if (!appState.activeMesh) return;
        const target = new THREE.Vector3();
        appState.activeMesh.getWorldPosition(target);
        const dist = cameraManager.getCamera().position.distanceTo(target);
        const clamped = Math.min(Math.max(dist, 0.1), 50);
        camState.dofFocus = clamped;
        const focusSlider = document.getElementById('cam-dof-focus-slider');
        const focusInput  = document.getElementById('cam-dof-focus-input');
        if (focusSlider) focusSlider.value = clamped;
        if (focusInput)  focusInput.value  = clamped.toFixed(1);
        applyDOF();
      });
    }

    const dofResetBtn = document.getElementById('cam-dof-reset-focus');
    if (dofResetBtn) {
      dofResetBtn.addEventListener('click', () => {
        camState.dofFocus = 5.0;
        const focusSlider = document.getElementById('cam-dof-focus-slider');
        const focusInput  = document.getElementById('cam-dof-focus-input');
        if (focusSlider) focusSlider.value = 5.0;
        if (focusInput)  focusInput.value  = '5.0';
        applyDOF();
      });
    }

    const dofResetAllBtn = document.getElementById('cam-dof-reset-all');
    if (dofResetAllBtn) {
      dofResetAllBtn.addEventListener('click', () => {
        camState.dofFocus    = 5.0;
        camState.dofAperture = 0.25;
        camState.dofMaxBlur  = 0.01;
        camState.dofRings    = 6;
        const set = (id, v) => {
          const el = document.getElementById(id);
          if (el) el.value = v;
        };
        set('cam-dof-focus-slider',    5.0);
        set('cam-dof-focus-input',     '5.0');
        set('cam-dof-strength-slider', 0.25);
        set('cam-dof-strength-input',  '0.25');
        set('cam-dof-maxblur-slider',  0.01);
        set('cam-dof-maxblur-input',   '0.010');
        set('cam-dof-rings-slider',    6);
        set('cam-dof-rings-input',     '6');
        applyDOF();
      });
    }

    // Apply initial camera settings from UI defaults
    applyCameraSettings();
  }

  function applyCameraType() {
    cameraManager.setCameraType(camState.type, camState.focalLength, camState.sensorKey);
  }

  function applyCameraDOF() {
    rendererManager.setDOF(camState.dofEnabled, camState.dofFocus, camState.dofAperture, camState.dofMaxBlur, camState.dofRings);
    markNeedsRender(4);
  }

  // Apply a saved camState (settings/${pid}.camera) and bring every camera control in line
  function restoreCameraSettings(saved) {
    if (!saved || typeof saved !== 'object') return;
    Object.assign(camState, saved);
    const setVal = (id, v) => { const el = document.getElementById(id); if (el && v !== undefined) el.value = v; };
    const selectButton = (groupId, value) => {
      document.getElementById(groupId)?.querySelectorAll('button').forEach(b => {
        b.classList.toggle('button-selected', parseFloat(b.dataset.value) === parseFloat(value) || b.dataset.value === String(value));
      });
    };
    setVal('camera-type-select', camState.type);
    setVal('lens-mm-slider', camState.focalLength);           setVal('lens-mm-input', camState.focalLength);
    selectButton('lens-mm-buttons', camState.focalLength);
    selectButton('film-gauge-buttons', camState.sensorKey);
    setVal('near-slider', camState.near);                     setVal('near-input', camState.near);
    setVal('far-slider', camState.far);                       setVal('far-input', camState.far);
    selectButton('tone-mapping-buttons', camState.toneMapping);
    setVal('exposure-slider', camState.exposure);             setVal('exposure-input', camState.exposure);
    const dofToggle = document.getElementById('cam-toggle-dof');
    if (dofToggle) dofToggle.checked = !!camState.dofEnabled;
    setVal('cam-dof-focus-slider', camState.dofFocus);        setVal('cam-dof-focus-input', camState.dofFocus);
    setVal('cam-dof-strength-slider', camState.dofAperture);  setVal('cam-dof-strength-input', camState.dofAperture);
    setVal('cam-dof-maxblur-slider', camState.dofMaxBlur);    setVal('cam-dof-maxblur-input', camState.dofMaxBlur);
    setVal('cam-dof-rings-slider', camState.dofRings);        setVal('cam-dof-rings-input', camState.dofRings);
    applyCameraSettings();
    applyCameraType();
    applyCameraDOF();
  }

  setupCameraUI();
  return restoreCameraSettings;
}
