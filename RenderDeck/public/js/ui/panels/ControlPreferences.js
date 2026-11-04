// These controls describe project UI/export preferences, not per-part materials.
const CONTROL_IDS = [
  'ts-translate-slider', 'ts-rotate-slider', 'ts-scale-slider', 'resolution-select',
  'export-transparent-bg', 'export-include-postfx', 'export-use-preview-res',
  'export-full-quality', 'export-embed-textures', 'export-include-env',
  'export-include-material-json', 'export-include-decals', 'project-include-images',
  'sf-face-select',
];

export function collectControlPreferences() {
  const controls = {};
  for (const id of CONTROL_IDS) {
    const element = document.getElementById(id);
    if (element) controls[id] = element.type === 'checkbox' ? element.checked : element.value;
  }
  const buttons = {};
  document.querySelectorAll('[id$="-buttons"]').forEach(group => {
    const selected = group.querySelector('button.button-selected');
    if (selected) buttons[group.id] = [...group.querySelectorAll('button')].indexOf(selected);
  });
  const activeTab = [...document.querySelectorAll('.tablinks')].findIndex(button => button.classList.contains('active'));
  return {
    controls, buttons, activeTab,
    folderTabs: [...new Set([...document.querySelectorAll('.folder-tab.active')].map(button => button.dataset.target).filter(Boolean))],
  };
}

export function restoreControlPreferences(preferences) {
  if (!preferences) return;
  for (const [id, value] of Object.entries(preferences.controls || {})) {
    const element = document.getElementById(id);
    if (!element) continue;
    if (element.type === 'checkbox') element.checked = !!value;
    else element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }
  for (const [id, index] of Object.entries(preferences.buttons || {})) {
    const group = document.getElementById(id);
    const button = group?.querySelectorAll('button')[index];
    if (button && !button.classList.contains('button-selected')) button.click();
  }
  for (const target of preferences.folderTabs || []) {
    document.querySelector(`.folder-tab[data-target="${CSS.escape(target)}"]`)?.click();
  }
  if (preferences.activeTab >= 0) document.querySelectorAll('.tablinks')[preferences.activeTab]?.click();
}

export function bindControlPreferences(onChanged) {
  for (const event of ['input', 'change']) document.addEventListener(event, e => {
    if (CONTROL_IDS.includes(e.target.id)) onChanged();
  });
  document.addEventListener('click', e => {
    if (e.target.closest('.tablinks, .folder-tab, [id$="-buttons"]')) queueMicrotask(onChanged);
  });
}
