export function initObjectPropsTabs() {
  const bar = document.getElementById('obj-props-tabs-bar');
  if (!bar) return;

  const tabs   = bar.querySelectorAll('.folder-tab');
  const panels = document.querySelectorAll('.folder-panel');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const targetId = tab.dataset.target;
      panels.forEach(panel => {
        panel.style.display = panel.id === targetId ? '' : 'none';
      });
    });
  });
}

export function initDebugPanelWidth() {
  const panel = document.querySelector('.scene-settings');
  if (!panel) return;

  document.querySelectorAll('.tablinks').forEach(btn => {
    btn.addEventListener('click', () => {
      const isDebug = btn.getAttribute('onclick')?.includes('Setting9');
      panel.classList.toggle('scene-settings--wide', !!isDebug);
    });
  });
}
