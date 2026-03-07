// historyUtils.js — shared helpers for all state managers

export function formatAge(timestamp) {
  const sec = Math.floor((Date.now() - timestamp) / 1000);
  if (sec < 5)  return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  return `${Math.floor(min / 60)}h ago`;
}

export function renderHistoryList(containerId, history, onJump) {
  const list = document.getElementById(containerId);
  if (!list) return;
  const entries = history.getEntries();
  if (entries.length === 0) {
    list.innerHTML = '<p class="empty-message">No history yet</p>';
    return;
  }
  list.innerHTML = '';
  entries.forEach(entry => {
    const div = document.createElement('div');
    div.className = 'history-entry' + (entry.isCurrent ? ' current' : '');
    div.innerHTML = `<span class="h-label">${entry.label}</span><span class="h-time">${formatAge(entry.timestamp)}</span>`;
    div.addEventListener('click', () => onJump(entry.originalIndex));
    list.appendChild(div);
  });
}
