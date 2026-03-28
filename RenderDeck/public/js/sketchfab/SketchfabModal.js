function formatFaces(n) {
  if (!n) return '?';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1000)      return Math.round(n / 1000) + 'K';
  return String(n);
}

function faceColor(n, max) {
  if (!n) return '#888';
  const r = n / max;
  if (r < 0.4)  return '#4caf50';
  if (r < 0.75) return '#ff9800';
  return '#f44336';
}

function bestThumb(thumbnails) {
  const imgs = thumbnails?.images ?? [];
  return [...imgs].sort((a, b) => Math.abs(a.width - 200) - Math.abs(b.width - 200))[0]?.url ?? '';
}

const CSS = `
.sf-overlay {
  display: none; position: fixed; inset: 0;
  background: rgba(0,0,0,0.78); z-index: 9999;
  align-items: center; justify-content: center;
}
.sf-overlay.open { display: flex; }
.sf-modal {
  background: #1e1e1e; border: 1px solid #444; border-radius: 8px;
  width: min(880px, 96vw); max-height: 88vh;
  display: flex; flex-direction: column; overflow: hidden;
  box-shadow: 0 12px 48px rgba(0,0,0,0.7);
}
.sf-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 13px 16px; border-bottom: 1px solid #333; background: #181818; flex-shrink: 0;
}
.sf-header h3 { margin: 0; font-size: 14px; color: #e0e0e0; font-weight: 600; }
.sf-close {
  background: none; border: none; color: #777; font-size: 18px;
  cursor: pointer; padding: 0 2px; line-height: 1;
}
.sf-close:hover { color: #fff; }
.sf-body { flex: 1; overflow-y: auto; padding: 14px 16px; }

.sf-token-view {
  display: flex; flex-direction: column; gap: 12px;
  max-width: 420px; margin: 36px auto;
}
.sf-token-view p { color: #aaa; font-size: 13px; line-height: 1.6; margin: 0; }
.sf-token-view a { color: #7eb3ff; }
.sf-input {
  background: #2a2a2a; border: 1px solid #444; border-radius: 4px;
  color: #e0e0e0; padding: 8px 10px; font-size: 13px;
  width: 100%; box-sizing: border-box;
}
.sf-input:focus { outline: none; border-color: #2a80cc; }
.sf-btn {
  background: #333; border: 1px solid #505050; border-radius: 4px;
  color: #ddd; padding: 7px 14px; font-size: 13px; cursor: pointer;
}
.sf-btn:hover:not(:disabled) { background: #444; }
.sf-btn.primary { background: #1a6fbc; border-color: #2a80cc; color: #fff; }
.sf-btn.primary:hover:not(:disabled) { background: #2280cc; }
.sf-btn:disabled { opacity: 0.45; cursor: not-allowed; }

.sf-search-bar {
  display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 10px;
}
.sf-search-input {
  flex: 1; min-width: 180px;
  background: #2a2a2a; border: 1px solid #444; border-radius: 4px;
  color: #e0e0e0; padding: 7px 10px; font-size: 13px;
}
.sf-search-input:focus { outline: none; border-color: #2a80cc; }
.sf-face-select {
  background: #2a2a2a; border: 1px solid #444; border-radius: 4px;
  color: #e0e0e0; padding: 7px 8px; font-size: 13px;
}
.sf-status { font-size: 12px; color: #777; min-height: 16px; margin-bottom: 8px; }
.sf-status.error { color: #f44336; }
.sf-change-token {
  font-size: 11px; color: #555; background: none; border: none;
  cursor: pointer; text-decoration: underline;
}
.sf-change-token:hover { color: #999; }

.sf-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(155px, 1fr));
  gap: 10px;
}
.sf-card {
  background: #242424; border: 1px solid #363636; border-radius: 6px;
  overflow: hidden; display: flex; flex-direction: column;
  transition: border-color 0.15s;
}
.sf-card:hover { border-color: #505050; }
.sf-thumb {
  width: 100%; aspect-ratio: 4/3; object-fit: cover;
  background: #1a1a1a; display: block;
}
.sf-card-info { padding: 7px 8px 8px; display: flex; flex-direction: column; gap: 3px; }
.sf-card-name {
  font-size: 11px; color: #ddd; font-weight: 500;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.sf-card-author {
  font-size: 10px; color: #666;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.sf-card-meta { display: flex; align-items: center; justify-content: space-between; margin-top: 5px; }
.sf-face-badge { font-size: 10px; font-weight: 600; padding: 2px 4px; border-radius: 3px; background: #1a1a1a; }
.sf-add-btn {
  font-size: 10px; padding: 3px 8px; border-radius: 3px;
  background: #1a6fbc; border: none; color: #fff; cursor: pointer;
}
.sf-add-btn:hover:not(:disabled) { background: #2280cc; }
.sf-add-btn:disabled { opacity: 0.5; cursor: not-allowed; background: #333; }

.sf-footer {
  padding: 12px 16px; border-top: 1px solid #2e2e2e;
  display: none; justify-content: center; flex-shrink: 0;
}
`;

export class SketchfabModal {
  constructor(api, { onImportProp } = {}) {
    this.api = api;
    this.onImportProp = onImportProp ?? (() => {});
    this.nextUrl     = null;
    this.currentQuery = '';
    this.maxFaces    = 150000;
    this._busy       = false;
    this._build();
  }

  _build() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    this._el = document.createElement('div');
    this._el.className = 'sf-overlay';
    this._el.innerHTML = `
      <div class="sf-modal">
        <div class="sf-header">
          <h3>Import from Sketchfab</h3>
          <button class="sf-close">&#x2715;</button>
        </div>
        <div class="sf-body">

          <div class="sf-token-view" id="sf-token-view" style="display:none">
            <p>Paste your Sketchfab API token to search and import downloadable models.</p>
            <p>Get one at <a href="https://sketchfab.com/settings/password" target="_blank" rel="noopener">
              sketchfab.com → Settings → Password &amp; API
            </a></p>
            <input id="sf-token-input" class="sf-input" type="password" placeholder="Paste token here…">
            <button id="sf-token-save" class="sf-btn primary">Save Token &amp; Continue</button>
          </div>

          <div id="sf-search-view" style="display:none">
            <div class="sf-search-bar">
              <input id="sf-search-input" class="sf-search-input" type="text" placeholder="Search Sketchfab…">
              <select id="sf-face-select" class="sf-face-select">
                <option value="50000">Max 50K faces</option>
                <option value="100000">Max 100K faces</option>
                <option value="150000" selected>Max 150K faces</option>
                <option value="200000">Max 200K faces</option>
                <option value="500000">Max 500K faces</option>
              </select>
              <button id="sf-search-btn" class="sf-btn primary">Search</button>
              <button id="sf-change-token" class="sf-change-token">Change token</button>
            </div>
            <div id="sf-status" class="sf-status"></div>
            <div id="sf-grid" class="sf-grid"></div>
          </div>

        </div>
        <div class="sf-footer" id="sf-footer">
          <button id="sf-load-more" class="sf-btn">Load More</button>
        </div>
      </div>
    `;
    document.body.appendChild(this._el);
    this._wire();
  }

  _q(sel) { return this._el.querySelector(sel); }

  _wire() {
    this._q('.sf-close').addEventListener('click', () => this.close());
    this._el.addEventListener('click', e => { if (e.target === this._el) this.close(); });

    this._q('#sf-token-save').addEventListener('click', () => {
      const val = this._q('#sf-token-input').value.trim();
      if (!val) return;
      this.api.setToken(val);
      this._showSearch();
    });
    this._q('#sf-token-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') this._q('#sf-token-save').click();
    });

    this._q('#sf-search-btn').addEventListener('click', () => this._search());
    this._q('#sf-search-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') this._search();
    });
    this._q('#sf-face-select').addEventListener('change', e => {
      this.maxFaces = parseInt(e.target.value);
    });
    this._q('#sf-change-token').addEventListener('click', () => {
      this.api.setToken('');
      this._showToken();
    });
    this._q('#sf-load-more').addEventListener('click', () => this._loadMore());
  }

  open() {
    this._el.classList.add('open');
    this.api.hasToken() ? this._showSearch() : this._showToken();
  }

  close() { this._el.classList.remove('open'); }

  _showToken() {
    this._q('#sf-token-view').style.display = 'flex';
    this._q('#sf-search-view').style.display = 'none';
    this._q('#sf-footer').style.display = 'none';
  }

  _showSearch() {
    this._q('#sf-token-view').style.display = 'none';
    this._q('#sf-search-view').style.display = 'block';
  }

  _status(msg, error = false) {
    const el = this._q('#sf-status');
    el.textContent = msg;
    el.className = 'sf-status' + (error ? ' error' : '');
  }

  async _search() {
    const q = this._q('#sf-search-input').value.trim();
    if (!q || this._busy) return;
    this.currentQuery = q;
    this.nextUrl = null;
    this._q('#sf-grid').innerHTML = '';
    this._q('#sf-footer').style.display = 'none';
    this._status('Searching…');
    this._q('#sf-search-btn').disabled = true;
    try {
      const data = await this.api.searchModels(q, null);
      this.nextUrl = data.next || null;
      const filtered = (data.results ?? []).filter(m => m.isDownloadable !== false && (!m.faceCount || m.faceCount <= this.maxFaces));
      this._append(filtered);
      this._status(filtered.length ? `Showing ${filtered.length} downloadable models` : 'No downloadable results found.');
      if (this.nextUrl) this._q('#sf-footer').style.display = 'flex';
    } catch (e) {
      this._status(e.message, true);
    } finally {
      this._q('#sf-search-btn').disabled = false;
    }
  }

  async _loadMore() {
    if (!this.nextUrl || this._busy) return;
    const btn = this._q('#sf-load-more');
    btn.disabled = true; btn.textContent = 'Loading…';
    try {
      const data = await this.api.searchModels(this.currentQuery, this.nextUrl);
      this.nextUrl = data.next || null;
      const filtered = (data.results ?? []).filter(m => m.isDownloadable !== false && (!m.faceCount || m.faceCount <= this.maxFaces));
      this._append(filtered);
      if (!this.nextUrl) this._q('#sf-footer').style.display = 'none';
    } catch (e) {
      this._status(e.message, true);
    } finally {
      btn.disabled = false; btn.textContent = 'Load More';
    }
  }

  _append(models) {
    const grid = this._q('#sf-grid');
    models.forEach(m => grid.appendChild(this._card(m)));
  }

  _card(model) {
    const div   = document.createElement('div');
    div.className = 'sf-card';
    const faces  = model.faceCount ?? 0;
    const color  = faceColor(faces, this.maxFaces);
    const thumb  = bestThumb(model.thumbnails);
    const author = model.user?.displayName ?? '?';
    div.innerHTML = `
      <img class="sf-thumb" src="${thumb}" alt="" loading="lazy">
      <div class="sf-card-info">
        <div class="sf-card-name" title="${model.name}">${model.name}</div>
        <div class="sf-card-author">@${author}</div>
        <div class="sf-card-meta">
          <span class="sf-face-badge" style="color:${color}">${formatFaces(faces)}&thinsp;faces</span>
          <button class="sf-add-btn">+ Add</button>
        </div>
      </div>
    `;
    div.querySelector('.sf-add-btn').addEventListener('click', e => {
      if (this._busy) return;
      this._import(model.uid, model.name, e.currentTarget);
    });
    return div;
  }

  async _import(uid, name, btn) {
    this._busy = true;
    btn.disabled = true;
    btn.textContent = '…';
    this._status(`Importing "${name}"…`);
    try {
      await this.onImportProp(uid, name);
      btn.textContent = '✓';
      this._status(`"${name}" added to scene.`);
    } catch (e) {
      btn.disabled = false;
      btn.textContent = '+ Add';
      this._status(`Import failed: ${e.message}`, true);
    } finally {
      this._busy = false;
    }
  }
}
