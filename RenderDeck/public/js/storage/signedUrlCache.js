/**
 * In-memory cache of Supabase signed URLs by assetId.
 *
 * Signed URLs are issued by the backend with a 1-hour expiry (see
 * SupabaseStorageService.getSignedUrl). Hitting the backend for every
 * texture on every render reload produces N requests per page load —
 * unacceptable on cold-start hosting. This cache cuts that to one
 * request per asset per ~50 minutes.
 *
 * TTL is set deliberately below the backend's 1-hour expiry so a cached
 * URL is never close to expiring when handed back to a caller.
 */

const TTL_MS = 50 * 60 * 1000; // 50 minutes — Supabase signs for 60.

const cache = new Map(); // assetId → { url, expiresAt }

/**
 * Returns a signed URL for the given assetId, fetching it via the supplied
 * loader only on cache miss / TTL expiry.
 *
 * @param {string} assetId
 * @param {() => Promise<string>} loader  Fetches a fresh URL when needed.
 * @returns {Promise<string>}
 */
export async function getSignedUrl(assetId, loader) {
    const now = Date.now();
    const hit = cache.get(assetId);
    if (hit && hit.expiresAt > now) return hit.url;

    const url = await loader();
    cache.set(assetId, { url, expiresAt: now + TTL_MS });
    return url;
}

/**
 * Evict a single asset's cached URL. Call this after deleting an asset or
 * replacing it (e.g. re-uploading a material's channel map) so the next
 * lookup re-fetches.
 */
export function evict(assetId) {
    cache.delete(assetId);
}

/** Clear the entire cache — useful on logout to drop stale entries. */
export function clear() {
    cache.clear();
}
