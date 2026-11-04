import { CONFIG } from '../../config.js';

const REQUESTED_WITH = 'RenderDeck';
const AUTH_REFRESH_LOCK = 'renderdeck-auth-refresh';
const transientStatuses = new Set([408, 425, 502, 503, 504]);
let accessToken = null;
let currentUser = null;
let refreshInFlight = null;
let wakeChannel = null;

if (typeof BroadcastChannel !== 'undefined') {
  wakeChannel = new BroadcastChannel('renderdeck-auth');
  wakeChannel.onmessage = event => {
    if (event.data?.type === 'refreshed' && typeof event.data.accessToken === 'string') {
      accessToken = event.data.accessToken;
      currentUser = event.data.user || currentUser;
      notifySessionChanged();
    } else if (event.data?.type === 'logged-out') {
      accessToken = null;
      currentUser = null;
      notifySessionChanged();
    }
  };
}

const sessionEvents = new EventTarget();

export function getCurrentUser() {
  return currentUser;
}

export function isSignedIn() {
  return Boolean(accessToken && currentUser);
}

export function onSessionChange(listener) {
  sessionEvents.addEventListener('change', listener);
  return () => sessionEvents.removeEventListener('change', listener);
}

export function initializeSession({ onWake } = {}) {
  return refresh({ onWake, silent: true }).catch(() => null);
}

export async function register(email, password, options = {}) {
  const result = await api('/api/auth/register', {
    method: 'POST', body: { email, password }, wake: true, onWake: options.onWake,
  });
  setSession(result);
  return result.user;
}

export async function login(email, password, options = {}) {
  const result = await api('/api/auth/login', {
    method: 'POST', body: { email, password }, wake: true, onWake: options.onWake,
  });
  setSession(result);
  return result.user;
}

export async function logout(options = {}) {
  try {
    await api('/api/auth/logout', {
      method: 'POST',
      headers: { 'X-Requested-With': REQUESTED_WITH },
      wake: true,
      onWake: options.onWake,
      retryUnauthorized: false,
    });
  } finally {
    clearSession();
  }
}

export async function passwordForgot(email, options = {}) {
  return api('/api/auth/password/forgot', {
    method: 'POST', body: { email }, wake: true, onWake: options.onWake,
  });
}

export async function passwordReset(token, newPassword, options = {}) {
  return api('/api/auth/password/reset', {
    method: 'POST', body: { token, newPassword }, wake: true, onWake: options.onWake,
  });
}

export async function verifyEmail(token, options = {}) {
  return api('/api/auth/email/verify', {
    method: 'POST', body: { token }, wake: true, onWake: options.onWake,
  });
}

export async function resendVerification(options = {}) {
  return api('/api/auth/email/resend-verification', {
    method: 'POST', authenticated: true, wake: true, onWake: options.onWake,
  });
}

export async function passwordChange(currentPassword, newPassword, options = {}) {
  return api('/api/auth/password/change', {
    method: 'POST', body: { currentPassword, newPassword }, authenticated: true, wake: true, onWake: options.onWake,
  });
}

export async function deleteAccount(password, options = {}) {
  await api('/api/me', {
    method: 'DELETE', body: { password }, authenticated: true, wake: true, onWake: options.onWake,
  });
  clearSession();
}

export async function getHealth() {
  return request('/api/health', { method: 'GET', wake: false, retryUnauthorized: false });
}

export async function getMe() {
  return api('/api/me', { method: 'GET', authenticated: true, wake: true });
}

async function api(path, options = {}) {
  try {
    return await request(path, options);
  } catch (error) {
    if (error.status !== 401 || !options.authenticated || options.retryUnauthorized === false) throw error;
    await refresh({ onWake: options.onWake });
    return request(path, { ...options, retryUnauthorized: false });
  }
}

async function request(path, {
  method = 'GET',
  body,
  headers = {},
  authenticated = false,
  wake = true,
  onWake,
  retryUnauthorized = true,
} = {}) {
  const deadline = Date.now() + (wake ? 90_000 : 5_000);
  let hasWaited = false;
  while (true) {
    const controller = new AbortController();
    const attemptTimeout = setTimeout(() => controller.abort(), Math.min(10_000, Math.max(1000, deadline - Date.now())));
    try {
      const requestHeaders = new Headers(headers);
      if (body !== undefined) requestHeaders.set('Content-Type', 'application/json');
      if (authenticated && accessToken) requestHeaders.set('Authorization', `Bearer ${accessToken}`);
      const response = await fetch(new URL(path, CONFIG.API_BASE_URL), {
        method,
        headers: requestHeaders,
        credentials: 'include',
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(attemptTimeout);
      if (transientStatuses.has(response.status) && wake) {
        if (response.status === 503) {
          const payload = await response.clone().json().catch(() => null);
          if (payload?.code === 'EMAIL_DISABLED') throw await responseError(response);
        }
        if (Date.now() >= deadline) {
          throw new AuthClientError('The server did not wake up within 90 seconds. Please try again.', 'SERVER_UNAVAILABLE', 0);
        }
        hasWaited = true;
        onWake?.('Waking the server…');
        await delay(1500);
        continue;
      }
      if (!response.ok) throw await responseError(response);
      if (response.status === 204 || response.status === 202) return null;
      return await response.json();
    } catch (error) {
      clearTimeout(attemptTimeout);
      if (error instanceof AuthClientError) {
        throw error;
      }
      if (!wake || Date.now() >= deadline) {
        throw new AuthClientError(
          hasWaited ? 'The server did not wake up within 90 seconds. Please try again.' : 'The server could not be reached.',
          'SERVER_UNAVAILABLE',
          0,
        );
      }
      hasWaited = true;
      onWake?.('Waking the server…');
      await delay(1500);
    }
  }
}

async function refresh({ onWake, silent = false } = {}) {
  if (refreshInFlight) return refreshInFlight;
  const previousToken = accessToken;
  refreshInFlight = (async () => {
    const perform = async () => {
      if (accessToken && accessToken !== previousToken) return { accessToken, user: currentUser };
      return request('/api/auth/refresh', {
        method: 'POST',
        headers: { 'X-Requested-With': REQUESTED_WITH },
        wake: !silent,
        onWake,
        retryUnauthorized: false,
      });
    };
    try {
      const result = navigator.locks?.request
        ? await navigator.locks.request(AUTH_REFRESH_LOCK, { mode: 'exclusive' }, perform)
        : await perform();
      setSession(result);
      if (!silent) wakeChannel?.postMessage({ type: 'refreshed', accessToken, user: currentUser });
      return result;
    } catch (error) {
      if (error.status === 401 || error.status === 403) clearSession();
      throw error;
    }
  })().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

function setSession(result, notify = true) {
  if (!result || typeof result.accessToken !== 'string' || !result.user) {
    throw new AuthClientError('The server returned an invalid sign-in response.', 'INVALID_RESPONSE', 0);
  }
  accessToken = result.accessToken;
  currentUser = result.user;
  if (notify) notifySessionChanged();
}

function clearSession() {
  accessToken = null;
  currentUser = null;
  notifySessionChanged();
  wakeChannel?.postMessage({ type: 'logged-out' });
}

function notifySessionChanged() {
  sessionEvents.dispatchEvent(new Event('change'));
}

async function responseError(response) {
  let payload = null;
  try { payload = await response.json(); } catch {}
  const messages = {
    INVALID_CREDENTIALS: 'Email or password is incorrect.',
    INVALID_TOKEN: 'This link is invalid or has expired. Request a new one and try again.',
    INVALID_REFRESH_TOKEN: 'Your session expired. Please sign in again.',
    EMAIL_DISABLED: 'Email actions are temporarily unavailable.',
    EMAIL_ALREADY_REGISTERED: 'Could not create an account with those details.',
    INVALID_PASSWORD: 'The current password is incorrect.',
    RATE_LIMITED: 'Too many attempts. Wait a little and try again.',
    REGISTRATION_UNAVAILABLE: 'Unable to create an account with those details.',
    WEAK_PASSWORD: payload?.message || 'Password must be at least 10 characters and no more than 72 UTF-8 bytes.',
    STORAGE_QUOTA_EXCEEDED: 'Your account storage is full.',
  };
  const code = typeof payload?.code === 'string' ? payload.code : 'REQUEST_FAILED';
  return new AuthClientError(
    messages[code] || payload?.message || `Request failed (${response.status}).`,
    code,
    response.status,
  );
}

class AuthClientError extends Error {
  constructor(message, code, status) {
    super(message);
    this.name = 'AuthClientError';
    this.code = code;
    this.status = status;
  }
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}
