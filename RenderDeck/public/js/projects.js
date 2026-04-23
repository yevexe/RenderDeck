// PROJECTS.JS — Projects page logic
// Renders project cards and handles create/rename/delete actions.

// CRUD + active-project bootstrap go through StorageService so cloud users
// hit the backend. Local active-project ID read/write still comes from
// ProjectStorage — that's a per-device preference, not cloud-synced.
import {
  listProjects,
  createProject,
  updateProject,
  deleteProject,
  ensureActiveProject,
} from './storage/StorageService.js';
import {
  getActiveProjectId,
  setActiveProjectId,
} from './storage/ProjectStorage.js';

const grid        = document.getElementById('projects-grid');
const emptyMsg    = document.getElementById('projects-empty');
const newBtn      = document.getElementById('new-project-btn');

// Rename modal
const renameModal   = document.getElementById('rename-modal');
const renameInput   = document.getElementById('rename-input');
const renameCancel  = document.getElementById('rename-cancel');
const renameConfirm = document.getElementById('rename-confirm');

// Delete modal
const deleteModal   = document.getElementById('delete-modal');
const deleteCancel  = document.getElementById('delete-cancel');
const deleteConfirm = document.getElementById('delete-confirm');

let _renameId  = null;
let _deleteId  = null;
let _activeId  = null;

// ─────────────────────────────────────────────
// Render
// ─────────────────────────────────────────────

async function render() {
  await ensureActiveProject();
  _activeId = await getActiveProjectId();
  const projects = await listProjects();

  grid.innerHTML = '';
  emptyMsg.style.display = projects.length === 0 ? '' : 'none';

  for (const project of projects) {
    const card = document.createElement('div');
    card.className = 'project-card' + (project.id === _activeId ? ' project-card--active' : '');
    card.dataset.id = project.id;

    const updatedDate = new Date(project.updatedAt).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric'
    });

    const thumbHtml = project.thumbnail
      ? `<img src="${project.thumbnail}" class="project-card-thumb-img" alt="" draggable="false">`
      : `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;

    card.innerHTML = `
      <div class="project-card-thumb">${thumbHtml}</div>
      <div class="project-card-body">
        <div class="project-card-name">${escapeHtml(project.name)}</div>
        <div class="project-card-meta">Last edited ${updatedDate}</div>
        ${project.id === _activeId ? '<div class="project-card-active-badge">Active</div>' : ''}
      </div>
      <div class="project-card-actions">
        <button class="card-btn card-btn--open" data-id="${project.id}">Open</button>
        <button class="card-btn card-btn--rename" data-id="${project.id}" data-name="${escapeHtml(project.name)}">Rename</button>
        <button class="card-btn card-btn--delete" data-id="${project.id}">Delete</button>
      </div>
    `;

    card.querySelector('.card-btn--open').addEventListener('click', (e) => {
      e.stopPropagation();
      openProject(project.id);
    });
    card.querySelector('.card-btn--rename').addEventListener('click', (e) => {
      e.stopPropagation();
      startRename(project.id, project.name);
    });
    card.querySelector('.card-btn--delete').addEventListener('click', (e) => {
      e.stopPropagation();
      startDelete(project.id);
    });

    // Click anywhere on the card (thumb or body) to open
    card.addEventListener('click', () => openProject(project.id));

    grid.appendChild(card);
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─────────────────────────────────────────────
// Actions
// ─────────────────────────────────────────────

async function openProject(id) {
  await setActiveProjectId(id);
  window.location.href = 'index.html';
}

function startRename(id, currentName) {
  _renameId = id;
  renameInput.value = currentName;
  renameModal.style.display = '';
  renameInput.focus();
  renameInput.select();
}

function closeRenameModal() {
  renameModal.style.display = 'none';
  _renameId = null;
}

async function confirmRename() {
  if (!_renameId) return;
  const name = renameInput.value.trim();
  if (!name) return;
  await updateProject(_renameId, { name });
  closeRenameModal();
  await render();
}

function startDelete(id) {
  _deleteId = id;
  deleteModal.style.display = '';
}

function closeDeleteModal() {
  deleteModal.style.display = 'none';
  _deleteId = null;
}

async function confirmDelete() {
  if (!_deleteId) return;
  await deleteProject(_deleteId);
  // If we deleted the active project, ensureActiveProject will pick/create another
  if (_deleteId === _activeId) {
    await ensureActiveProject();
  }
  closeDeleteModal();
  await render();
}

// ─────────────────────────────────────────────
// Event listeners
// ─────────────────────────────────────────────

newBtn.addEventListener('click', async () => {
  const name = prompt('Project name:', 'New Project');
  if (!name) return;
  const project = await createProject(name.trim() || 'New Project');
  await setActiveProjectId(project.id);
  await render();
});

renameCancel.addEventListener('click', closeRenameModal);
renameConfirm.addEventListener('click', confirmRename);
renameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') confirmRename();
  if (e.key === 'Escape') closeRenameModal();
});
renameModal.addEventListener('click', (e) => { if (e.target === renameModal) closeRenameModal(); });

deleteCancel.addEventListener('click', closeDeleteModal);
deleteConfirm.addEventListener('click', confirmDelete);
deleteModal.addEventListener('click', (e) => { if (e.target === deleteModal) closeDeleteModal(); });

// ─────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────

render();
