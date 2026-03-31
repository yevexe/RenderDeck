
// PROJECTSTORAGE.JS — Project management (IndexedDB)
// Projects are top-level containers. Custom models, scenes, and materials
// are tagged with a projectId. This module manages the project list and
// tracks which project is currently active.

import * as IDBStorage from './indexedDBStorage.js';

const ACTIVE_PROJECT_KEY = 'activeProjectId';
const LS_ACTIVE_PROJECT_KEY = 'rd_active_project'; // localStorage mirror for sync reads

function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// ─────────────────────────────────────────────
// CRUD
// ─────────────────────────────────────────────

export async function createProject(name) {
  const project = {
    id: generateId(),
    name: name.trim() || 'Untitled Project',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await IDBStorage.put('projects', project.id, project);
  return project;
}

export async function listProjects() {
  const all = await IDBStorage.getAll('projects');
  // getAll returns values array — sort newest first
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getProject(id) {
  return IDBStorage.get('projects', id);
}

export async function updateProject(id, changes) {
  const project = await getProject(id);
  if (!project) throw new Error(`Project ${id} not found`);
  const updated = { ...project, ...changes, updatedAt: Date.now() };
  await IDBStorage.put('projects', id, updated);
  return updated;
}

export async function deleteProject(id) {
  await IDBStorage.del('projects', id);
}

// ─────────────────────────────────────────────
// Active project
// ─────────────────────────────────────────────

export async function getActiveProjectId() {
  return IDBStorage.get('metadata', ACTIVE_PROJECT_KEY);
}

export async function setActiveProjectId(id) {
  try { localStorage.setItem(LS_ACTIVE_PROJECT_KEY, id); } catch (_) {}
  return IDBStorage.put('metadata', ACTIVE_PROJECT_KEY, id);
}

// Synchronous read — returns the localStorage mirror (may be null on very first load)
export function getActiveProjectIdSync() {
  try { return localStorage.getItem(LS_ACTIVE_PROJECT_KEY); } catch (_) { return null; }
}

export async function getActiveProject() {
  const id = await getActiveProjectId();
  if (!id) return null;
  return getProject(id);
}

// Ensures an active project always exists.
// Called on app init — creates "Default Project" if nothing exists.
export async function ensureActiveProject() {
  const activeId = await getActiveProjectId();
  if (activeId) {
    const project = await getProject(activeId);
    if (project) return project;
  }
  // Active project missing or deleted — fall back to first available
  const all = await listProjects();
  if (all.length > 0) {
    const first = all[all.length - 1]; // oldest first after reverse sort
    await setActiveProjectId(first.id);
    return first;
  }
  // No projects at all — create the default
  const project = await createProject('Default Project');
  await setActiveProjectId(project.id);
  return project;
}
