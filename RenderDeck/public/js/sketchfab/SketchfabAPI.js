const BASE_URL = 'https://api.sketchfab.com/v3';

export class SketchfabAPI {
  constructor() {
    this.token = localStorage.getItem('renderdeck_sketchfab_token') || '';
  }

  setToken(token) {
    this.token = token.trim();
    if (this.token) localStorage.setItem('renderdeck_sketchfab_token', this.token);
    else localStorage.removeItem('renderdeck_sketchfab_token');
  }

  hasToken() { return !!this.token; }

  _headers() {
    return { 'Authorization': `Token ${this.token}` };
  }

  async searchModels(query, nextUrl = null) {
    let url = nextUrl;
    if (!url) {
      const params = new URLSearchParams({
        type:         'models',
        q:            query,
        downloadable: 'true',
        count:        '24',
      });
      url = `${BASE_URL}/search?${params}`;
    }
    const res = await fetch(url, { headers: this._headers(), cache: 'no-store' });
    if (res.status === 401) throw new Error('Invalid API token — check Settings → Password & API on Sketchfab.');
    if (!res.ok)            throw new Error(`Sketchfab API error (${res.status})`);
    const json = await res.json();
    return json;
  }

  async getDownloadUrls(uid) {
    const res = await fetch(`${BASE_URL}/models/${uid}/download`, { headers: this._headers() });
    if (res.status === 403) throw new Error('This model is not available for download — the creator has not enabled downloads.');
    if (!res.ok)            throw new Error(`Download API error (${res.status})`);
    return res.json(); // { glb: { url, size }, gltf: { url, size }, source: { url, size } }
  }

  async fetchZip(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download ZIP (${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  }
}
