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
    if (await isLoggedInAsync()) return cloud.get('/api/projects');
    return ProjectStorage.listProjects();
}

export async function createProject(name) {
    if (await isLoggedInAsync()) return cloud.post('/api/projects', { name });
    return ProjectStorage.createProject(name);
}

export async function deleteProject(projectId) {
    if (await isLoggedInAsync()) return cloud.del(`/api/projects/${projectId}`);
    return ProjectStorage.deleteProject(projectId);
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

export async function listScenes(projectId) {
    if (await isLoggedInAsync()) return cloud.get(`/api/projects/${projectId}/scenes`);
    const names = await sceneStorage().getAllSceneNames();
    return Promise.all(names.map(n => sceneStorage().getScene(n)));
}

export async function saveScene(projectId, scene) {
    if (await isLoggedInAsync()) {
        if (scene.id) {
            return cloud.put(`/api/projects/${projectId}/scenes/${scene.id}`, {
                name: scene.name,
                sceneData: scene.sceneData,
            });
        }
        return cloud.post(`/api/projects/${projectId}/scenes`, {
            name: scene.name,
            sceneData: scene.sceneData,
        });
    }
    return sceneStorage().saveScene(scene.name, scene.sceneData);
}

// In cloud mode `sceneId` is a UUID; in guest mode it's the scene name —
// CustomSceneStorage keys by name, not UUID.
export async function deleteScene(projectId, sceneId) {
    if (await isLoggedInAsync()) {
        return cloud.del(`/api/projects/${projectId}/scenes/${sceneId}`);
    }
    return sceneStorage().deleteScene(sceneId);
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
        const { url } = await cloud.get(`/api/assets/${assetId}/signed-url`);
        return url;
    }
    throw new Error('getAssetSignedUrl requires login');
}
