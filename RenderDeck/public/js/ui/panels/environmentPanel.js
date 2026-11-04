import { STANDARD_ENVIRONMENTS } from '../../config.js';
import { generateEnvPreview } from '../../domain/scenes/EnvironmentLoader.js';

function syncBackgroundCards(value) {
  document.querySelectorAll('#bg-preset-grid .bg-preset-card').forEach(card => {
    card.classList.toggle('selected', card.dataset.value === value);
  });
}

function syncEnvironmentCards(value) {
  document.querySelectorAll('#env-preset-grid .bg-preset-card').forEach(card => {
    card.classList.toggle('selected', card.dataset.value === value);
  });
}

export function setupEnvironmentPanel({
  environmentNames,
  currentEnvironment,
  setBackgroundState,
  applyBackground,
  pushSceneHistory,
  onEnvironmentChange,
}) {
  const sel = document.getElementById('environment-select');
  if (sel) {
    // Keep placeholder options in sync
    const placeholder = Array.from(sel.options).find(o => o.disabled);
    sel.innerHTML = '';
    if (placeholder) sel.appendChild(placeholder);
    environmentNames.forEach(name => {
      const o = document.createElement('option');
      o.value = name; o.textContent = name;
      sel.appendChild(o);
    });

    sel.addEventListener('change', e => onEnvironmentChange(e.target.value));
  }

  // Build the environment card grid
  const grid = document.getElementById('env-preset-grid');
  if (sel && grid) {
    grid.innerHTML = '';

    const previewMap = Object.fromEntries(
      STANDARD_ENVIRONMENTS.map(e => [e.label, e.preview])
    );

    environmentNames.forEach(name => {
      const card = document.createElement('div');
      card.className = 'bg-preset-card';
      card.dataset.value = name;

      const circle = document.createElement('div');
      circle.className = 'bg-preset-circle';
      circle.style.background = previewMap[name] ?? '#2a2a2a';

      const label = document.createElement('span');
      label.className = 'bg-preset-label';
      label.textContent = name;

      card.append(circle, label);
      card.addEventListener('click', () => {
        sel.value = name;
        sel.dispatchEvent(new Event('change'));
        syncEnvironmentCards(name);
      });
      grid.appendChild(card);

      // Asynchronously render the HDR onto a sphere and swap in the result
      const envDef = STANDARD_ENVIRONMENTS.find(e => e.label === name);
      if (envDef) {
        generateEnvPreview(envDef.path).then(dataUrl => {
          if (dataUrl) {
            circle.style.background = `url(${dataUrl}) center/cover`;
          }
        });
      }
    });
  }
  if (sel && environmentNames.includes(currentEnvironment)) sel.value = currentEnvironment;
  syncEnvironmentCards(currentEnvironment);

  // "Show environment background" — if OFF, HDR is still used for lighting but not as bg
  const envBgToggle = document.getElementById('env-bg-toggle');
  if (envBgToggle) {
    setBackgroundState({ showEnvBackground: envBgToggle.checked });
    envBgToggle.addEventListener('change', e => {
      setBackgroundState({ showEnvBackground: e.target.checked });
      applyBackground();
      pushSceneHistory(e.target.checked ? 'Background: show env' : 'Background: hide env');
    });
  }

  // "Enable gradient background"
  const gradBgToggle = document.getElementById('gradient-bg-toggle');
  if (gradBgToggle) {
    setBackgroundState({ gradientBgEnabled: gradBgToggle.checked });
    gradBgToggle.addEventListener('change', e => {
      setBackgroundState({ gradientBgEnabled: e.target.checked });
      applyBackground();
      pushSceneHistory(e.target.checked ? 'Background: gradient on' : 'Background: gradient off');
    });
  }

  // Gradient preset cards
  const bgSelect = document.getElementById('background-select');
  if (bgSelect) {
    bgSelect.addEventListener('change', e => {
      setBackgroundState({ currentGradientBg: e.target.value });
      applyBackground();
      pushSceneHistory(`Background: ${e.target.value || 'none'}`);
    });
  }

  document.querySelectorAll('.bg-preset-card').forEach(card => {
    card.addEventListener('click', () => {
      const bgSelect = document.getElementById('background-select');
      if (!bgSelect) return;
      bgSelect.value = card.dataset.value;
      bgSelect.dispatchEvent(new Event('change'));
      syncBackgroundCards(card.dataset.value);
    });
  });

  return { syncEnvironmentCards, syncBackgroundCards };
}
