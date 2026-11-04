export function setupValueInputSpinners() {
  const upSVG = '<svg viewBox="0 0 10 6"><path d="M1 5L5 1L9 5" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>';
  const downSVG = '<svg viewBox="0 0 10 6"><path d="M1 1L5 5L9 1" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>';

  document.querySelectorAll('input.value-input[type="number"]').forEach(input => {
    if (input.closest('.value-input-wrap')) return;

    const wrap = document.createElement('div');
    wrap.className = 'value-input-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    const arrows = document.createElement('div');
    arrows.className = 'value-input-arrows';

    const btnUp = document.createElement('button');
    btnUp.className = 'value-input-arrow';
    btnUp.innerHTML = upSVG;
    btnUp.tabIndex = -1;
    btnUp.type = 'button';

    const btnDown = document.createElement('button');
    btnDown.className = 'value-input-arrow';
    btnDown.innerHTML = downSVG;
    btnDown.tabIndex = -1;
    btnDown.type = 'button';

    arrows.appendChild(btnUp);
    arrows.appendChild(btnDown);
    wrap.appendChild(arrows);

    const inputStep = input.step && input.step !== 'any' ? parseFloat(input.step) : null;

    function getStep(val) {
      if (inputStep) return inputStep;
      const s = val.replace(/^-/, '');
      const dot = s.indexOf('.');
      if (dot === -1) return 1;
      const decimals = s.length - dot - 1;
      return Math.pow(10, -decimals);
    }

    function getDecimals(delta) {
      const s = String(delta);
      const dot = s.indexOf('.');
      return dot === -1 ? 0 : s.length - dot - 1;
    }

    function step(dir) {
      const raw = input.value || '0';
      const current = parseFloat(raw);
      if (isNaN(current)) return;
      const delta = getStep(raw);
      let next = current + delta * dir;
      const decimals = Math.max(getDecimals(delta), (raw.indexOf('.') !== -1) ? raw.replace(/^-/, '').split('.')[1].length : 0);
      next = parseFloat(next.toFixed(decimals));
      const min = input.min !== '' ? parseFloat(input.min) : -Infinity;
      const max = input.max !== '' ? parseFloat(input.max) : Infinity;
      next = Math.max(min, Math.min(max, next));
      input.value = decimals > 0 ? next.toFixed(decimals) : String(next);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    btnUp.addEventListener('mousedown', e => { e.preventDefault(); step(1); });
    btnDown.addEventListener('mousedown', e => { e.preventDefault(); step(-1); });
  });
}
