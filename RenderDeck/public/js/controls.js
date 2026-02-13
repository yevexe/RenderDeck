// ============================================================================
// RenderDeck Controls - Input/Slider Binding System
// ============================================================================

// -------------- TAB CONTROLS LOGIC -----------------------
function openSetting(evt, settingName) {
  // Get all elements with class="tabcontent" and hide them
  const tabcontent = document.getElementsByClassName("tabcontent");
  for (let i = 0; i < tabcontent.length; i++) {
    tabcontent[i].style.display = "none";
  }
  
  // Get all elements with class="tablinks" and remove the class "active"
  const tablinks = document.getElementsByClassName("tablinks");
  for (let i = 0; i < tablinks.length; i++) {
    tablinks[i].className = tablinks[i].className.replace(" active", "");
  }
  
  // Show the current tab, and add an "active" class to the button that opened the tab
  document.getElementById(settingName).style.display = "block";
  evt.currentTarget.className += " active";
}

// -------------- INPUT/SLIDER BINDING SYSTEM -----------------------

/**
 * Binds an input field with its corresponding slider
 * @param {string} inputId - ID of the input field
 * @param {string} sliderId - ID of the slider
 */
function bindInputSlider(inputId, sliderId) {
  const input = document.getElementById(inputId);
  const slider = document.getElementById(sliderId);
  
  if (!input || !slider) {
    console.warn(`Could not find elements: ${inputId} or ${sliderId}`);
    return;
  }
  
  const min = parseFloat(slider.min);
  const max = parseFloat(slider.max);
  const step = parseFloat(slider.step);
  
  // Clamp value within min/max range
  function clampValue(value) {
    return Math.max(min, Math.min(max, value));
  }
  
  // Round to nearest step
  function roundToStep(value) {
    return Math.round(value / step) * step;
  }
  
  // Update input from slider
  slider.addEventListener('input', function() {
    const value = parseFloat(this.value);
    input.value = value.toFixed(countDecimals(step));
  });
  
  // Update slider from input (only update slider, don't modify input value while typing)
  input.addEventListener('input', function() {
    let value = parseFloat(this.value);
    
    // Handle invalid input - just skip updating the slider
    if (isNaN(value)) {
      return;
    }
    
    // Update slider with clamped value, but don't modify the input field
    // This allows the user to type freely (e.g., "0." or "0.0")
    const clampedValue = clampValue(value);
    slider.value = clampedValue;
  });
  
  // Handle blur event to enforce bounds
  input.addEventListener('blur', function() {
    let value = parseFloat(this.value);
    
    if (isNaN(value)) {
      value = parseFloat(slider.value);
    } else {
      value = clampValue(value);
      value = roundToStep(value);
    }
    
    this.value = value.toFixed(countDecimals(step));
    slider.value = value;
  });
  
  // Handle Enter key to commit value
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      this.blur(); // Trigger blur event which will format and commit the value
    }
  });
}

/**
 * Count decimal places in a number
 */
function countDecimals(value) {
  if (Math.floor(value) === value) return 0;
  const str = value.toString();
  if (str.indexOf('.') !== -1) {
    return str.split('.')[1].length || 0;
  }
  return 0;
}

// -------------- INITIALIZE ALL BINDINGS -----------------------

document.addEventListener('DOMContentLoaded', function() {
  
  // Setting 2: Design Editor
  bindInputSlider('design-posx-input', 'design-posx-slider');
  bindInputSlider('design-posy-input', 'design-posy-slider');
  bindInputSlider('design-width-input', 'design-width-slider');
  bindInputSlider('design-height-input', 'design-height-slider');
  bindInputSlider('design-rotation-input', 'design-rotation-slider');
  
  // Setting 3: Material
  bindInputSlider('metalness-input', 'metalness-slider');
  bindInputSlider('roughness-input', 'roughness-slider');
  bindInputSlider('specint-input', 'specint-slider');
  bindInputSlider('clearcoat-input', 'clearcoat-slider');
  bindInputSlider('clearcoatrough-input', 'clearcoatrough-slider');
  bindInputSlider('transmission-input', 'transmission-slider');
  bindInputSlider('ior-input', 'ior-slider');
  bindInputSlider('thickness-input', 'thickness-slider');
  bindInputSlider('attdist-input', 'attdist-slider');
  bindInputSlider('sheenrough-input', 'sheenrough-slider');
  bindInputSlider('emissiveint-input', 'emissiveint-slider');
  bindInputSlider('envint-input', 'envint-slider');
  
  // Setting 4: Camera
  bindInputSlider('near-input', 'near-slider');
  bindInputSlider('far-input', 'far-slider');
  bindInputSlider('exposure-input', 'exposure-slider');
  bindInputSlider('cam-dof-focus-input', 'cam-dof-focus-slider');
  bindInputSlider('cam-dof-strength-input', 'cam-dof-strength-slider');
  
  // Setting 6: Post-Processing
  bindInputSlider('bloom-strength-input', 'bloom-strength-slider');
  bindInputSlider('bloom-radius-input', 'bloom-radius-slider');
  bindInputSlider('bloom-threshold-input', 'bloom-threshold-slider');
  bindInputSlider('vignette-intensity-input', 'vignette-intensity-slider');
  bindInputSlider('vignette-softness-input', 'vignette-softness-slider');
  bindInputSlider('ao-intensity-input', 'ao-intensity-slider');
  bindInputSlider('ao-radius-input', 'ao-radius-slider');
  bindInputSlider('motionblur-strength-input', 'motionblur-strength-slider');
  
  console.log('RenderDeck controls initialized successfully');
});