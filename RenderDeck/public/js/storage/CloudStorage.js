import { getAccessToken } from '../auth/AuthService.js';

const API_BASE = window.__API_BASE__ || 'http://localhost:8080';

async function authHeaders() {
    const token = await getAccessToken();
    return {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
    };
}

async function request(method, path, body) {
    const headers = await authHeaders();
    const res = await fetch(API_BASE + path, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `HTTP ${res.status}`);
    }
    if (res.status === 204) return null;
    return res.json();
}

export const get   = (path)       => request('GET',    path);
export const post  = (path, body) => request('POST',   path, body);
export const put   = (path, body) => request('PUT',    path, body);
export const patch = (path, body) => request('PATCH',  path, body);
export const del   = (path)       => request('DELETE', path);

export async function uploadFile(path, file, extraFields = {}) {
    const token = await getAccessToken();
    const form = new FormData();
    form.append('file', file);
    for (const [k, v] of Object.entries(extraFields)) {
        form.append(k, v);
    }
    const res = await fetch(API_BASE + path, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: form,
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
}

export async function putFile(path, file) {
    const token = await getAccessToken();
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(API_BASE + path, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}` },
        body: form,
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
}
