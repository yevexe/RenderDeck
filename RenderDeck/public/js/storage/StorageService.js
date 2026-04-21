/**
 * Routing layer: guest users → IndexedDB, logged-in users → CloudStorage API.
 * Import this instead of calling CloudStorage or indexedDBStorage directly.
 */
import { isLoggedInAsync } from '../auth/AuthService.js';
import * as cloud from './CloudStorage.js';
import * as idb from './indexedDBStorage.js';

// ─── Projects ────────────────────────────────────────────────────────────────

export async function listProjects() {
    if (await isLoggedInAsync()) return cloud.get('/api/projects');
    return idb.getAll('projects');
}

export async function createProject(name) {
    if (await isLoggedInAsync()) return cloud.post('/api/projects', { name });
    return idb.put('projects', { id: crypto.randomUUID(), name, createdAt: Date.now() });
}

export async function deleteProject(projectId) {
    if (await isLoggedInAsync()) return cloud.del(`/api/projects/${projectId}`);
    return idb.remove('projects', projectId);
}

// ─── Materials ───────────────────────────────────────────────────────────────

export async function listMaterials(projectId) {
    if (await isLoggedInAsync()) return cloud.get(`/api/projects/${projectId}/materials`);
    return idb.getAll(`materials:${projectId}`);
}

export async function saveMaterial(projectId, material) {
    if (await isLoggedInAsync()) {
        if (material.id) {
            return cloud.put(`/api/materials/${material.id}`, {
                name: material.name,
                materialValues: material.values,
            });
        }
        return cloud.post(`/api/projects/${projectId}/materials`, {
            name: material.name,
            materialValues: material.values,
        });
    }
    return idb.put(`materials:${projectId}`, material);
}

export async function deleteMaterial(projectId, materialId) {
    if (await isLoggedInAsync()) return cloud.del(`/api/projects/${projectId}/materials/${materialId}`);
    return idb.remove(`materials:${projectId}`, materialId);
}

export async function saveChannelMap(projectId, materialId, channel, file) {
    if (await isLoggedInAsync()) {
        // Backend accepts the file directly — upserts by channel name
        return cloud.putFile(
            `/api/projects/${projectId}/materials/${materialId}/channel-maps/${channel}`,
            file
        );
    }
    // Guest: store blob in IndexedDB keyed by materialId + channel
    return idb.put(`channelMaps:${materialId}`, { channel, blob: file });
}

// ─── Scenes ──────────────────────────────────────────────────────────────────

export async function listScenes(projectId) {
    if (await isLoggedInAsync()) return cloud.get(`/api/projects/${projectId}/scenes`);
    return idb.getAll(`scenes:${projectId}`);
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
    return idb.put(`scenes:${projectId}`, scene);
}

export async function deleteScene(projectId, sceneId) {
    if (await isLoggedInAsync()) return cloud.del(`/api/projects/${projectId}/scenes/${sceneId}`);
    return idb.remove(`scenes:${projectId}`, sceneId);
}

// ─── Models ──────────────────────────────────────────────────────────────────

export async function listModels(projectId) {
    if (await isLoggedInAsync()) return cloud.get(`/api/projects/${projectId}/models`);
    return idb.getAll(`models:${projectId}`);
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
        });
    }
    return idb.put(`models:${projectId}`, model);
}

export async function deleteModel(modelId, projectId) {
    if (await isLoggedInAsync()) return cloud.del(`/api/models/${modelId}`);
    return idb.remove(`models:${projectId}`, modelId);
}

// ─── Prop Assets ─────────────────────────────────────────────────────────────

export async function listPropAssets(projectId) {
    if (await isLoggedInAsync()) return cloud.get(`/api/projects/${projectId}/props`);
    return idb.getAll(`props:${projectId}`);
}

export async function uploadPropAsset(projectId, name, file) {
    if (await isLoggedInAsync()) {
        const asset = await cloud.uploadFile('/api/assets', file, { projectId });
        return cloud.post(`/api/projects/${projectId}/prop-assets`, { name, assetId: asset.id });
    }
    // Guest: store blob locally
    const id = crypto.randomUUID();
    const url = URL.createObjectURL(file);
    return idb.put(`props:${projectId}`, { id, name, localUrl: url });
}

export async function deletePropAsset(projectId, propAssetId) {
    if (await isLoggedInAsync()) return cloud.del(`/api/prop-assets/${propAssetId}`);
    return idb.remove(`props:${projectId}`, propAssetId);
}

// ─── Assets (generic) ────────────────────────────────────────────────────────

export async function uploadAsset(projectId, file) {
    if (await isLoggedInAsync()) {
        return cloud.uploadFile('/api/assets', file, { projectId });
    }
    // Guest: blob URL only
    return { id: crypto.randomUUID(), localUrl: URL.createObjectURL(file) };
}

export async function getAssetSignedUrl(assetId) {
    if (await isLoggedInAsync()) {
        const { url } = await cloud.get(`/api/assets/${assetId}/signed-url`);
        return url;
    }
    throw new Error('getAssetSignedUrl requires login');
}
