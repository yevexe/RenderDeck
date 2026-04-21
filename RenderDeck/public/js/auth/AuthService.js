import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = window.__SUPABASE_URL__ || '';
const SUPABASE_ANON_KEY = window.__SUPABASE_ANON_KEY__ || '';

let supabase = null;
let _authChangeCallbacks = [];

function getClient() {
    if (!supabase) {
        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
            throw new Error('Supabase env vars not set on window.__SUPABASE_URL__ / __SUPABASE_ANON_KEY__');
        }
        supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        supabase.auth.onAuthStateChange((event, session) => {
            _authChangeCallbacks.forEach(cb => cb(event, session));
        });
    }
    return supabase;
}

export function init() {
    getClient();
}

export async function getSession() {
    const { data } = await getClient().auth.getSession();
    return data.session;
}

export async function getUser() {
    const session = await getSession();
    return session?.user ?? null;
}

export async function getAccessToken() {
    const session = await getSession();
    return session?.access_token ?? null;
}

export function isLoggedIn() {
    // Synchronous check via cached session — call after init()
    return getClient().auth.getUser !== undefined && !!getClient()._session;
}

export async function isLoggedInAsync() {
    const user = await getUser();
    return user !== null;
}

export async function signInWithEmail(email, password) {
    const { data, error } = await getClient().auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
}

export async function signUpWithEmail(email, password) {
    const { data, error } = await getClient().auth.signUp({ email, password });
    if (error) throw error;
    return data;
}

export async function signOut() {
    const { error } = await getClient().auth.signOut();
    if (error) throw error;
}

export function onAuthChange(callback) {
    _authChangeCallbacks.push(callback);
}
