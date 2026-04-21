const el = {
  currentUserLabel: document.querySelector('#currentUserLabel'),
  modeBadge: document.querySelector('#modeBadge'),
  refreshBtn: document.querySelector('#refreshBtn'),
  logoutBtn: document.querySelector('#logoutBtn'),
  overviewStats: document.querySelector('#overviewStats'),
  projectsList: document.querySelector('#projectsList'),
  runnersList: document.querySelector('#runnersList'),
  keysSummary: document.querySelector('#keysSummary'),
  keysList: document.querySelector('#keysList'),
  eventsList: document.querySelector('#eventsList')
};

let pollTimer = null;

function fmtDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

function stat(label, value) {
  const item = document.createElement('div');
  item.className = 'stat';
  item.textContent = `${label}: ${value}`;
  return item;
}

function listItem(text) {
  const li = document.createElement('li');
  li.textContent = text;
  return li;
}

async function apiGet(url) {
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json'
    }
  });
  if (!res.ok) {
    throw new Error(`GET ${url} failed: ${res.status}`);
  }
  return res.json();
}

async function apiPost(url, body = null) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : null
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error || `POST ${url} failed: ${res.status}`);
  }
  return res.json().catch(() => ({}));
}

function renderModeBadge(isMockMode) {
  el.modeBadge.className = `status-pill ${isMockMode ? 'status-mock' : 'status-live'}`;
  el.modeBadge.textContent = isMockMode ? 'Mode MOCK (aucun agent reel)' : 'Mode LIVE';
}

function renderOverview(status, keys) {
  el.overviewStats.innerHTML = '';
  const running = (status.runners || []).filter((runner) => runner.status === 'running').length;
  const activeTasks = (status.projects || []).reduce((sum, project) => sum + Number(project.activeTasks || 0), 0);
  const readyProjects = (status.projects || []).filter((project) => project.readiness?.readyForBackground || project.readiness?.readyForIssue).length;

  el.overviewStats.appendChild(stat('Projects', (status.projects || []).length));
  el.overviewStats.appendChild(stat('Runners actifs', running));
  el.overviewStats.appendChild(stat('Tasks actives', activeTasks));
  el.overviewStats.appendChild(stat('Projects ready', readyProjects));
  el.overviewStats.appendChild(stat('Boot', fmtDate(status.startedAt)));
  el.overviewStats.appendChild(stat('Keys', keys.configured ? (keys.keys || []).length : 0));
}

function renderProjects(status) {
  el.projectsList.innerHTML = '';
  const projects = status.projects || [];
  if (projects.length === 0) {
    el.projectsList.appendChild(listItem('Aucun projet configure.'));
    return;
  }

  projects.forEach((project) => {
    const readiness = project.readiness || {};
    const reasons = (readiness.reasons || []).join(', ') || 'OK';
    el.projectsList.appendChild(listItem(`${project.id} | locked=${project.locked ? 'yes' : 'no'} | tasks=${project.activeTasks} | readiness=${reasons}`));
  });
}

function renderRunners(status) {
  el.runnersList.innerHTML = '';
  const runners = status.runners || [];
  if (runners.length === 0) {
    el.runnersList.appendChild(listItem('Aucun runner en cours.'));
    return;
  }

  runners.forEach((runner) => {
    el.runnersList.appendChild(listItem(`${runner.projectId} / ${runner.type} | ${runner.status} | beat=${fmtDate(runner.lastHeartbeatAt)}`));
  });
}

function renderKeys(keys) {
  el.keysSummary.textContent = keys.message || 'Pas de donnees key.';
  el.keysList.innerHTML = '';

  const list = keys.keys || [];
  if (list.length === 0) {
    el.keysList.appendChild(listItem('Aucune key configuree.'));
    return;
  }

  list.forEach((key) => {
    el.keysList.appendChild(listItem(`${key.email} | ${key.id} | usage24h=${key.usage24h}`));
  });
}

function renderEvents(status) {
  el.eventsList.innerHTML = '';
  const events = status.events || [];
  if (events.length === 0) {
    el.eventsList.appendChild(listItem('Aucun event recent.'));
    return;
  }

  events.slice(0, 20).forEach((event) => {
    el.eventsList.appendChild(listItem(`[${fmtDate(event.at)}] ${String(event.level || '').toUpperCase()} - ${event.message}`));
  });
}

function renderUser(status) {
  const user = status.currentUser;
  if (!user) {
    el.currentUserLabel.textContent = 'Utilisateur: -';
    return;
  }
  el.currentUserLabel.textContent = `Utilisateur: ${user.email} (${user.role})`;
}

async function refreshDashboard() {
  try {
    const status = await apiGet('/api/status');
    const keys = await apiGet('/api/keys').catch(() => ({ configured: false, keys: [], message: 'Endpoint /api/keys indisponible.' }));

    renderUser(status);
    renderModeBadge(Boolean(status.mockMode));
    renderOverview(status, keys);
    renderProjects(status);
    renderRunners(status);
    renderKeys(keys);
    renderEvents(status);
  } catch (error) {
    if (String(error.message || '').includes('401')) {
      window.location.replace('/login');
      return;
    }
    el.modeBadge.className = 'status-pill status-muted';
    el.modeBadge.textContent = `Erreur: ${error.message}`;
  }
}

el.refreshBtn.addEventListener('click', () => {
  refreshDashboard();
});

el.logoutBtn.addEventListener('click', async () => {
  try {
    await apiPost('/auth/logout');
  } finally {
    window.location.replace('/login');
  }
});

function boot() {
  refreshDashboard();
  pollTimer = setInterval(refreshDashboard, 5000);
}

boot();
