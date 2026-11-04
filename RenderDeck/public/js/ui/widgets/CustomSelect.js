export class CustomSelect {
  constructor(container) {
    this._container      = container;
    this._value          = '';
    this._handlers       = [];
    this._open           = false;
    this._thumbMap       = new Map(); // value → dataUrl
    this._getThumbnailFn = null;      // (name) => dataUrl | null
    this._getEnvKeyFn    = null;      // () => string  — identifies current environment
    this._lastEnvKey     = undefined; // env key at last render
    this._rerenderSeq    = 0;         // incremented to cancel stale batches
    this._items          = [];
    this._labels         = new Map(); // value → display label, when the two differ
    this._build();
  }

  _build() {
    this._container.classList.add('custom-select');

    this._trigger = document.createElement('div');
    this._trigger.className = 'custom-select__trigger';

    // Thumbnail shown in the trigger for the currently selected item
    this._triggerThumb = document.createElement('img');
    this._triggerThumb.className = 'custom-select__thumb custom-select__trigger-thumb';
    this._triggerThumb.alt = '';
    this._triggerThumb.style.display = 'none';

    this._label = document.createElement('span');
    this._label.className = 'custom-select__value';
    this._label.textContent = '— Select preset —';

    const arrow = document.createElement('span');
    arrow.className = 'custom-select__arrow';

    this._trigger.append(this._triggerThumb, this._label, arrow);

    this._dropdown = document.createElement('div');
    this._dropdown.className = 'custom-select__dropdown';

    this._container.append(this._trigger, this._dropdown);

    this._trigger.addEventListener('click', e => { e.stopPropagation(); this._toggle(); });

    // On hover: if environment has changed since last render, kick off a lazy re-render
    this._trigger.addEventListener('mouseenter', () => {
      if (!this._getThumbnailFn) return;
      const envKey = this._getEnvKeyFn?.();
      if (envKey !== this._lastEnvKey) this._scheduleRerender();
    });

    document.addEventListener('click', e => {
      if (!this._container.contains(e.target)) this._close();
    });

    this._container.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this._toggle(); }
      if (e.key === 'Escape') this._close();
    });
  }

  _toggle() { this._open ? this._close() : this._openDropdown(); }

  _openDropdown() {
    this._open = true;
    this._container.classList.add('is-open');
  }

  _close() {
    this._open = false;
    this._container.classList.remove('is-open');
  }

  _setTriggerThumb(value) {
    const url = this._thumbMap.get(value);
    if (url) {
      this._triggerThumb.src = url;
      this._triggerThumb.style.display = '';
    } else {
      this._triggerThumb.style.display = 'none';
    }
  }

  /**
   * Re-render thumbnails for the currently-visible portion first, then
   * lazily render the rest in small batches without blocking the main thread.
   */
  _scheduleRerender() {
    const token    = ++this._rerenderSeq;
    const itemEls  = [...this._dropdown.querySelectorAll('.custom-select__option')];
    if (!itemEls.length || !this._getThumbnailFn) return;

    // Approximate items visible in the 220px max-height dropdown (~32px per row)
    const VISIBLE = Math.ceil(220 / 32) + 1;

    // Render the visible portion synchronously (fast — user is about to open)
    for (let i = 0; i < Math.min(VISIBLE, itemEls.length); i++) {
      this._rerenderItem(itemEls[i]);
    }

    // Lazily render the rest in batches of 3, ~20 ms apart
    let idx = VISIBLE;
    const renderBatch = () => {
      if (token !== this._rerenderSeq) return; // superseded by a newer call
      const end = Math.min(idx + 3, itemEls.length);
      for (; idx < end; idx++) this._rerenderItem(itemEls[idx]);
      if (idx < itemEls.length) setTimeout(renderBatch, 20);
    };
    if (idx < itemEls.length) setTimeout(renderBatch, 20);

    this._lastEnvKey = this._getEnvKeyFn?.();
  }

  _rerenderItem(optEl) {
    const name    = optEl.dataset.value;
    const dataUrl = this._getThumbnailFn(name, 64); // HQ upgrade on hover
    if (!dataUrl) return;
    this._thumbMap.set(name, dataUrl);
    const img = optEl.querySelector('.custom-select__thumb');
    if (img) img.src = dataUrl;
    if (name === this._value) this._setTriggerThumb(name);
  }

  _labelOf(value) {
    return this._labels.get(value) ?? value;
  }

  /** Display text for a value that isn't in the list (or differs from its value). */
  setLabel(value, label) {
    this._labels.set(value, label);
    if (value === this._value) this._label.textContent = label;
  }

  /**
   * @param {Array<string|{value: string, label: string}>} items
   * @param {(name: string) => string|null} [getThumbnail]
   * @param {() => string} [getEnvKey] — returns a key identifying current environment
   */
  populate(items, getThumbnail, getEnvKey) {
    this._items          = Array.isArray(items) ? items
                           : (items.groups || []).flatMap(g => g.items);
    this._getThumbnailFn = getThumbnail ?? null;
    this._getEnvKeyFn    = getEnvKey   ?? null;
    this._lastEnvKey     = getEnvKey?.();
    this._thumbMap.clear();
    this._labels.clear();
    this._dropdown.innerHTML = '';

    // Support grouped items: { groups: [{ label, items }] } or flat string[]
    const groups = Array.isArray(items)
      ? [{ label: null, items }]
      : (items.groups || []);

    groups.forEach((group, gi) => {
      if (group.label && group.items.length > 0) {
        const header = document.createElement('div');
        header.className = 'custom-select__group-label' + (group.isObject ? ' custom-select__group-label--object' : '');
        header.textContent = group.label;
        this._dropdown.appendChild(header);
      }

      group.items.forEach(item => {
        const name = typeof item === 'string' ? item : item.value;
        const displayName = typeof item === 'string' ? item : item.label;
        this._labels.set(name, displayName);
        const opt = document.createElement('div');
        opt.className = 'custom-select__option';
        opt.dataset.value = name;
        if (name === this._value) opt.classList.add('is-active');

        if (getThumbnail) {
          const dataUrl = getThumbnail(name, 32);
          if (dataUrl) {
            this._thumbMap.set(name, dataUrl);
            const img = document.createElement('img');
            img.className = 'custom-select__thumb';
            img.src = dataUrl;
            img.alt = '';
            opt.appendChild(img);
          }
        }

        const labelRow = document.createElement('span');
        labelRow.className = 'custom-select__option-label-row';

        const label = document.createElement('span');
        label.className = 'custom-select__option-label';
        label.textContent = displayName;

        const renameBtn = document.createElement('button');
        renameBtn.type = 'button';
        renameBtn.className = 'custom-select__option-rename';
        renameBtn.tabIndex = -1;
        renameBtn.setAttribute('aria-label', 'Rename');
        renameBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M8.5 1.5a1.414 1.414 0 012 2L4.5 9.5 2 10.5l1-2.5L8.5 1.5z" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        renameBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this._startInlineRename(opt, name, displayName);
        });

        labelRow.append(label, renameBtn);
        opt.appendChild(labelRow);

        opt.addEventListener('click', () => this._select(name));
        this._dropdown.appendChild(opt);
      });

      if (gi < groups.length - 1 && group.items.length > 0) {
        const sep = document.createElement('div');
        sep.className = 'custom-select__separator';
        this._dropdown.appendChild(sep);
      }
    });

    this._setTriggerThumb(this._value);
    if (this._value) this._label.textContent = this._labelOf(this._value);
  }

  _select(value) {
    this._value = value;
    this._label.textContent = this._labelOf(value);
    this._setTriggerThumb(value);
    this._dropdown.querySelectorAll('.custom-select__option').forEach(o =>
      o.classList.toggle('is-active', o.dataset.value === value)
    );
    this._close();
    this._handlers.forEach(cb => cb(value));
  }

  get value()  { return this._value; }
  set value(v) {
    if (!v) return;
    this._value = v;
    this._label.textContent = this._labelOf(v);
    this._setTriggerThumb(v);
    this._dropdown.querySelectorAll('.custom-select__option').forEach(o =>
      o.classList.toggle('is-active', o.dataset.value === v)
    );
  }

  // Select without closing — used by the inline rename so the dropdown stays open
  _selectNoClose(value) {
    this._value = value;
    this._label.textContent = this._labelOf(value);
    this._setTriggerThumb(value);
    this._dropdown.querySelectorAll('.custom-select__option').forEach(o =>
      o.classList.toggle('is-active', o.dataset.value === value)
    );
    this._handlers.forEach(cb => cb(value));
  }

  _startInlineRename(opt, name, displayName = name) {
    if (opt.querySelector('.custom-select__option-rename-form')) return;

    const label     = opt.querySelector('.custom-select__option-label');
    const renameBtn = opt.querySelector('.custom-select__option-rename');
    const thumb     = opt.querySelector('.custom-select__thumb');
    if (label)     label.style.visibility = 'hidden';
    if (renameBtn) renameBtn.style.visibility = 'hidden';

    const form = document.createElement('div');
    form.className = 'custom-select__option-rename-form';

    const field = document.createElement('div');
    field.className = 'custom-select__option-rename-field';

    const input = document.createElement('input');
    input.type = 'text';
    input.value = displayName;
    input.className = 'custom-select__option-rename-input';
    input.autocomplete = 'off';
    input.spellcheck = false;

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'custom-select__option-rename-clear';
    clearBtn.tabIndex = -1;
    clearBtn.setAttribute('aria-label', 'Clear');
    clearBtn.innerHTML = '<svg width="6" height="6" viewBox="0 0 8 8" fill="none"><line x1="1" y1="1" x2="7" y2="7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="7" y1="1" x2="1" y2="7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'custom-select__option-rename-confirm';
    confirmBtn.setAttribute('aria-label', 'Confirm rename');
    confirmBtn.innerHTML = '<svg width="11" height="8" viewBox="0 0 13 10" fill="none"><polyline points="1,5 5,9 12,1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    field.append(input, clearBtn);
    form.append(field, confirmBtn);
    form.addEventListener('click', (e) => e.stopPropagation());
    opt.appendChild(form);

    // Offset the form past the thumbnail so it stays visible
    if (thumb) form.style.left = `${thumb.offsetWidth + 13}px`; // gap + left-border nudge

    setTimeout(() => { input.focus(); input.select(); }, 0);

    const restore = () => {
      if (label)     label.style.visibility = '';
      if (renameBtn) renameBtn.style.visibility = '';
      form.remove();
    };

    let committed = false;
    const commit = () => {
      if (committed) return;
      committed = true;
      const newName = input.value.trim();
      restore();
      if (newName && newName !== displayName) {
        if (this._renameHandlers) this._renameHandlers.forEach(cb => cb(name, newName));
      }
    };
    const cancel = () => {
      if (committed) return;
      committed = true;
      restore();
    };

    input.addEventListener('blur', () => setTimeout(commit, 120));
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // prevent Space/Enter/Escape from bubbling to the dropdown toggle
      if (e.key === 'Enter')  { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
    clearBtn.addEventListener('mousedown',  (e) => e.preventDefault());
    clearBtn.addEventListener('click', () => { input.value = ''; input.focus(); });
    confirmBtn.addEventListener('mousedown', (e) => e.preventDefault());
    confirmBtn.addEventListener('click', () => commit());
  }

  /** Register a value-change handler. */
  onChange(cb) { this._handlers.push(cb); }

  /** Register a rename handler — cb(value, newName) fires on inline rename commit. */
  onRenameRequest(cb) {
    if (!this._renameHandlers) this._renameHandlers = [];
    this._renameHandlers.push(cb);
  }
}

