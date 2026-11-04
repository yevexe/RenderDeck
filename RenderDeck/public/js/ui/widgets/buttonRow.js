import { markNeedsRender } from '../../engine/renderRequest.js';

export function setupButtonRow(groupId, callback, scheduleProjectSettingsSave) {
  const group = document.getElementById(groupId);
  if (!group) return;
  group.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-value]');
    if (!btn) return;
    group.querySelectorAll('button').forEach(b => b.classList.remove('button-selected'));
    btn.classList.add('button-selected');
    const targetId = group.dataset.targetInput;
    if (targetId) {
      const input = document.getElementById(targetId);
      if (input) input.value = btn.dataset.value;
    }
    callback(btn.dataset.value);
    markNeedsRender(4);
    scheduleProjectSettingsSave();
  });
}
