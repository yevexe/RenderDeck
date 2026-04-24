/**
 * Routing layer: guest users → existing IDB-backed storage classes,
 * logged-in users → CloudStorage API → Spring Boot backend → Supabase.
 *
 * Import this from main.js / ModelManager.js / etc. instead of calling
 * CloudStorage or the IDB classes directly. See FRONTEND_BACKEND_LINKING.md
 * for the wiring plan and which call sites still need to be swapped.
 *
 * Cloud URL paths must mirror the backend controllers exactly. If you change
 * a route on either side, update this file in lockstep.
 */
import { isLoggedInAsync } from '../auth/AuthService.js';
import * as cloud from './CloudStorage.js';
import * as ProjectStorage from './ProjectStorage.js';
import { CustomSceneStorage } from '../scenes/CustomSceneStorage.js';
import * as signedUrls from './signedUrlCache.js';

// Lazy singletons so guest delegation reuses one instance per page lifetime.
let _sceneStorage = null;
const sceneStorage = () => (_sceneStorage ||= new CustomSceneStorage());

// Standard error for guest paths whose existing call sites already use a
// purpose-built manager (MaterialManager, PropManager, CustomModelStorage).
// Those call sites stay as-is for guests; only the cloud branch flows
// through StorageService for now. Phase 3+ will reconcile per type.
function guestNotRouted(method) {
    return new Error(
        `${method} guest path not routed through StorageService — ` +
        `the existing call site keeps using its dedicated manager. ` +
        `See FRONTEND_BACKEND_LINKING.md.`
    );
}

// ─── Projects ────────────────────────────────────────────────────────────────

export async function listProjects() {
    if (await isLoggedInAsync()) {
        const list = await cloud.get('/api/projects');
        // Match guest ordering (newest-first by updatedAt)
        return list.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    }
    return ProjectStorage.listProjects();
}

export async function getProject(projectId) {
    if (await isLoggedInAsync()) return cloud.get(`/api/projects/${projectId}`);
    return ProjectStorage.getProject(projectId);
}

export async function createProject(name) {
    if (await isLoggedInAsync()) return cloud.post('/api/projects', { name });
    return ProjectStorage.createProject(name);
}

// Cloud only supports { name, thumbnailAssetId } today. Other fields
// (e.g. guest-mode base64 `thumbnail`) are silently dropped for cloud
// users — thumbnail-as-asset upload is a separate future task.
export async function updateProject(projectId, changes) {
    if (await isLoggedInAsync()) {
        const body = {};
        if (changes.name !== undefined) body.name = changes.name;
        if (changes.thumbnailAssetId !== undefined) body.thumbnailAssetId = changes.thumbnailAssetId;
        // Skip the round-trip if the caller only asked to persist fields
        // the cloud doesn't support (e.g. a base64 thumbnail).
        if (Object.keys(body).length === 0) return null;
        return cloud.patch(`/api/projects/${projectId}`, body);
    }
    return ProjectStorage.updateProject(projectId, changes);
}

export async function deleteProject(projectId) {
    if (await isLoggedInAsync()) return cloud.del(`/api/projects/${projectId}`);
    return ProjectStorage.deleteProject(projectId);
}

/**
 * Auth-aware version of ProjectStorage.ensureActiveProject.
 * - Cloud users: honors the locally-stored last-active ID if it still
 *   exists, otherwise picks the newest cloud project, otherwise creates
 *   "Default Project". Writes the chosen ID to the local active-project
 *   mirror so sync readers (getActiveProjectIdSync) see it.
 * - Guest users: delegates to ProjectStorage.ensureActiveProject.
 */
export async function ensureActiveProject() {
    if (!(await isLoggedInAsync())) {
        return ProjectStorage.ensureActiveProject();
    }

    const localActiveId = ProjectStorage.getActiveProjectIdSync();
    if (localActiveId) {
        const existing = await getProject(localActiveId).catch(() => null);
        if (existing) {
            await ProjectStorage.setActiveProjectId(existing.id);
            return existing;
        }
    }

    const projects = await listProjects();
    if (projects.length > 0) {
        const first = projects[0];
        await ProjectStorage.setActiveProjectId(first.id);
        return first;
    }

    const created = await createProject('Default Project');
    await ProjectStorage.setActiveProjectId(created.id);
    return created;
}

// ─── Materials ───────────────────────────────────────────────────────────────

export async function listMaterials(projectId) {
    if (await isLoggedInAsync()) return cloud.get(`/api/projects/${projectId}/materials`);
    throw guestNotRouted('listMaterials');
}

// Backend PUT /api/projects/{projectId}/materials/{materialId} is upsert,
// so we generate a UUID client-side when the material is new.
export async function saveMaterial(projectId, material) {
    if (await isLoggedInAsync()) {
        const id = material.id || crypto.randomUUID();
        await cloud.put(`/api/projects/${projectId}/materials/${id}`, {
            name: material.name,
            materialValues: material.values,
        });
        return id;
    }
    throw guestNotRouted('saveMaterial');
}

export async function deleteMaterial(projectId, materialId) {
    if (await isLoggedInAsync()) {
        return cloud.del(`/api/projects/${projectId}/materials/${materialId}`);
    }
    throw guestNotRouted('deleteMaterial');
}

export async function saveChannelMap(projectId, materialId, channel, file) {
    if (await isLoggedInAsync()) {
        return cloud.putFile(
            `/api/projects/${projectId}/materials/${materialId}/channel-maps/${channel}`,
            file
        );
    }
    throw guestNotRouted('saveChannelMap');
}

// ─── Scenes ──────────────────────────────────────────────────────────────────
// Scenes are name-identified from the caller's perspective (the UI only knows
// scene names). Cloud storage uses UUIDs internally; these helpers bridge by
// looking up the id via a list call when needed.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Just the names — used to populate dropdowns without fetching full scene data.
export async function listSceneNames(projectId) {
    if (await isLoggedInAsync()) {
        const list = await cloud.get(`/api/projects/${projectId}/scenes`);
        return list.map(s => s.name);
    }
    return sceneStorage().getAllSceneNames();
}

// Full scene data in a flat shape (environment, props, camera, model on the
// top level) — matches what loadSceneSetup expects. Returns null if not found.
// For cloud, unwraps the server's { id, name, sceneData: {...} } envelope.
export async function getScene(projectId, name) {
    if (await isLoggedInAsync()) {
        const list = await cloud.get(`/api/projects/${projectId}/scenes`);
        const match = list.find(s => s.name === name);
        if (!match) return null;
        return { id: match.id, name: match.name, ...(match.sceneData || {}) };
    }
    return sceneStorage().getScene(name);
}

// Upsert by name. Cloud has no upsert-by-name endpoint, so we list first and
// pick up an existing id if the name is already taken. Guests identify by
// name natively.
export async function saveScene(projectId, scene) {
    if (await isLoggedInAsync()) {
        let id = scene.id;
        if (!id) {
            const list = await cloud.get(`/api/projects/${projectId}/scenes`);
            const existing = list.find(s => s.name === scene.name);
            if (existing) id = existing.id;
        }
        const body = { name: scene.name, sceneData: scene.sceneData };
        if (id) return cloud.put(`/api/projects/${projectId}/scenes/${id}`, body);
        return cloud.post(`/api/projects/${projectId}/scenes`, body);
    }
    return sceneStorage().saveScene(scene.name, scene.sceneData);
}

// Accepts either a UUID (cloud) or a name (guest, or cloud callers that only
// know the display name).
export async function deleteScene(projectId, sceneIdOrName) {
    if (await isLoggedInAsync()) {
        let id = sceneIdOrName;
        if (!UUID_RE.test(id)) {
            const list = await cloud.get(`/api/projects/${projectId}/scenes`);
            const match = list.find(s => s.name === sceneIdOrName);
            if (!match) return null;
            id = match.id;
        }
        return cloud.del(`/api/projects/${projectId}/scenes/${id}`);
    }
    return sceneStorage().deleteScene(sceneIdOrName);
}

// ─── Models ──────────────────────────────────────────────────────────────────

export async function listModels(projectId) {
    if (await isLoggedInAsync()) return cloud.get(`/api/projects/${projectId}/models`);
    throw guestNotRouted('listModels');
}

export async function saveModel(projectId, model) {
    if (await isLoggedInAsync()) {
        if (model.id) {
            return cloud.patch(`/api/models/${model.id}`, {
                name: model.name,
                baseModel: model.baseModel,
                customModelAssetId: model.customModelAssetId ?? null,
            });
        }
        return cloud.post(`/api/projects/${projectId}/models`, {
            name: model.name,
            baseModel: model.baseModel,
            customModelAssetId: model.customModelAssetId ?? null,
            sourceType: model.sourceType ?? 'standard',
        });
    }
    throw guestNotRouted('saveModel');
}

export async function deleteModel(modelId, projectId) {
    if (await isLoggedInAsync()) return cloud.del(`/api/models/${modelId}`);
    throw guestNotRouted('deleteModel');
}

// ─── Prop Assets ─────────────────────────────────────────────────────────────

export async function listPropAssets(projectId) {
    if (await isLoggedInAsync()) return cloud.get(`/api/projects/${projectId}/props`);
    throw guestNotRouted('listPropAssets');
}

// Single multipart upload — backend creates the Asset row and the PropAsset
// row in one call. `name` rides as a multipart form field (Spring's
// @RequestParam accepts both query + form).
export async function uploadPropAsset(projectId, name, file) {
    if (await isLoggedInAsync()) {
        return cloud.uploadFile(
            `/api/projects/${projectId}/props`,
            file,
            { name }
        );
    }
    throw guestNotRouted('uploadPropAsset');
}

export async function deletePropAsset(projectId, propAssetId) {
    if (await isLoggedInAsync()) {
        return cloud.del(`/api/projects/${projectId}/props/${propAssetId}`);
    }
    throw guestNotRouted('deletePropAsset');
}

// ─── Assets (generic) ────────────────────────────────────────────────────────

export async function uploadAsset(projectId, file) {
    if (await isLoggedInAsync()) {
        return cloud.uploadFile('/api/assets', file, { projectId });
    }
    // Guest mode: blob URL only — caller is responsible for revoking.
    return { id: crypto.randomUUID(), localUrl: URL.createObjectURL(file) };
}

export async function getAssetSignedUrl(assetId) {
    if (await isLoggedInAsync()) {
        return signedUrls.getSignedUrl(assetId, async () => {
            const { url } = await cloud.get(`/api/assets/${assetId}/signed-url`);
            return url;
        });
    }
    throw new Error('getAssetSignedUrl requires login');
}

/** Drop a cached signed URL — call after deleting/replacing the asset. */
export function evictSignedUrl(assetId) {
    signedUrls.evict(assetId);
}

/** Drop all cached signed URLs — call on logout. */
export function clearSignedUrls() {
    signedUrls.clear();
}
