// =========================================================
// State & DOM refs
// =========================================================
const AGENT_COLORS = ['#3f8cff','#16d68f','#e7a321','#ff5f7b','#a855f7','#f97316','#06b6d4','#84cc16'];

const el = {
  navItems: Array.from(document.querySelectorAll('.nav-item')),
  views: Array.from(document.querySelectorAll('.view')),
  sidebarProjects: document.querySelector('#sidebarProjects'),
  pageEyebrow: document.querySelector('#pageEyebrow'),
  pageTitle: document.querySelector('#pageTitle'),
  pageSubtitle: document.querySelector('#pageSubtitle'),
  currentUserLabel: document.querySelector('#currentUserLabel'),
  modeBadge: document.querySelector('#modeBadge'),
  clockLabel: document.querySelector('#clockLabel'),
  refreshBtn: document.querySelector('#refreshBtn'),
  logoutBtn: document.querySelector('#logoutBtn'),
  systemToggleBtn: document.querySelector('#systemToggleBtn'),
  toast: document.querySelector('#toast'),

  // Overview
  overviewMetrics: document.querySelector('#overviewMetrics'),
  eventsFeed: document.querySelector('#eventsFeed'),
  quickProjectStatus: document.querySelector('#quickProjectStatus'),

  // Projects
  addProjectBtn: document.querySelector('#addProjectBtn'),
  refreshSourcesBtn: document.querySelector('#refreshSourcesBtn'),
  projectsCards: document.querySelector('#projectsCards'),
  julesSourcesRows: document.querySelector('#julesSourcesRows'),

  // Project detail
  projectDetailTitle: document.querySelector('#projectDetailTitle'),
  projectDetailContent: document.querySelector('#projectDetailContent'),

  // Agents
  createAgentBtn: document.querySelector('#createAgentBtn'),
  agentsGrid: document.querySelector('#agentsGrid'),
  runnersGrid: document.querySelector('#runnersGrid'),
  schedulerState: document.querySelector('#schedulerState'),

  // Sessions
  sessionSummary: document.querySelector('#sessionSummary'),
  sessionsRows: document.querySelector('#sessionsRows'),

  // Health
  keysSummary: document.querySelector('#keysSummary'),
  tokenUsageList: document.querySelector('#tokenUsageList'),
  serviceStatusList: document.querySelector('#serviceStatusList'),
  requestVolumeBars: document.querySelector('#requestVolumeBars'),
  systemConsole: document.querySelector('#systemConsole'),

  // Users
  inviteUserBtn: document.querySelector('#inviteUserBtn'),
  usersNotice: document.querySelector('#usersNotice'),
  usersRows: document.querySelector('#usersRows'),
};

const pageMeta = {
  overview: { eyebrow: 'Dashboard', title: 'Overview', subtitle: 'Orchestrator at a glance' },
  projects: { eyebrow: 'Projects', title: 'Projects', subtitle: 'Connected repositories and their assignments' },
  'project-detail': { eyebrow: 'Project', title: '', subtitle: '' },
  agents: { eyebrow: 'Agents', title: 'Agent Library', subtitle: 'Reusable agents you can assign to any project' },
  sessions: { eyebrow: 'Sessions', title: 'Session Monitor', subtitle: 'Live and recent Jules sessions' },
  health: { eyebrow: 'Health', title: 'System Health', subtitle: 'API usage and service status' },
  users: { eyebrow: 'Users', title: 'User Management', subtitle: 'Roles and permissions' },
};

const state = {
  activeView: 'overview',
  status: null,
  keys: null,
  metrics: null,
  health: null,
  agents: [],
  assignments: [],
  users: [],
  usersError: null,
  expandedServiceErrors: {},
  selectedProjectDetail: null,
  projectDetailData: null,
};

let pollTimer = null;
let clockTimer = null;
let toastTimer = null;

// =========================================================
// Utils
// =========================================================
function fmtDate(v) { return v ? new Date(v).toLocaleString() : '-'; }
function fmtSince(iso) {
  if (!iso) return '-';
  const sec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  if (sec < 86400 * 30) return `${Math.floor(sec / 86400)}d`;
  if (sec < 86400 * 365) return `${Math.floor(sec / (86400 * 30))}mo`;
  return `${Math.floor(sec / (86400 * 365))}y`;
}
function fmtMs(ms) {
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  return `${m}m`;
}
function escapeHtml(t) {
  return String(t).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}
function pickLevel(l) {
  if (l === 'error' || l === 'failed') return 'error';
  if (l === 'warn') return 'warn';
  if (l === 'success' || l === 'completed') return 'success';
  return 'info';
}

function showToast(msg, isErr = false) {
  el.toast.textContent = msg;
  el.toast.style.borderColor = isErr ? '#6f2434' : '#275343';
  el.toast.style.background = isErr ? '#2a131b' : '#0f251d';
  el.toast.style.color = isErr ? '#ff90a4' : '#65f1be';
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2800);
}

function setLoading(btn, on) {
  if (!btn) return;
  btn.disabled = on;
  btn.classList.toggle('is-loading', on);
}

function createChip(text, cls = '') {
  const s = document.createElement('span');
  s.className = `chip ${cls}`.trim();
  s.textContent = text;
  return s;
}

function createMetric(label, value, sub, color = '') {
  const c = document.createElement('article');
  c.className = 'metric';
  c.innerHTML = `<p class="metric-label">${label}</p><p class="metric-value" style="${color ? `color:${color}` : ''}">${value}</p><p class="metric-sub">${sub}</p>`;
  return c;
}

// =========================================================
// API helpers
// =========================================================
async function apiGet(url) {
  const res = await fetch(url);
  if (res.status === 401) { window.location.replace('/login'); throw new Error('Auth required'); }
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || `GET ${url} failed ${res.status}`); }
  return res.json();
}

async function apiPost(url, body = null, critical = false) {
  const headers = { 'Content-Type': 'application/json' };
  if (critical) headers['x-confirm-action'] = 'CONFIRM';
  const res = await fetch(url, { method: 'POST', headers, body: body ? JSON.stringify(body) : null });
  if (res.status === 401) { window.location.replace('/login'); throw new Error('Auth required'); }
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || `POST ${url} failed ${res.status}`); }
  return res.json().catch(() => ({}));
}

async function apiPut(url, body = null) {
  const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : null });
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || `PUT ${url} failed ${res.status}`); }
  return res.json().catch(() => ({}));
}

async function apiDelete(url, critical = false) {
  const headers = { 'Content-Type': 'application/json' };
  if (critical) headers['x-confirm-action'] = 'CONFIRM';
  const res = await fetch(url, { method: 'DELETE', headers });
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || `DELETE ${url} failed ${res.status}`); }
  return res.json().catch(() => ({}));
}

// =========================================================
// Navigation
// =========================================================
function switchView(view) {
  state.activeView = view;
  localStorage.setItem('jules_view', view);
  el.navItems.forEach(i => i.classList.toggle('is-active', i.dataset.view === view));
  el.views.forEach(s => s.classList.toggle('is-active', s.dataset.view === view));

  const meta = pageMeta[view] || pageMeta.overview;
  el.pageEyebrow.textContent = meta.eyebrow;
  el.pageTitle.textContent = meta.title;
  el.pageSubtitle.textContent = meta.subtitle;

  // Keep URL in sync so page refresh works
  const params = new URLSearchParams({ view });
  if (view === 'project-detail' && state.selectedProjectDetail) params.set('project', state.selectedProjectDetail);
  history.replaceState(null, '', `?${params}`);

  renderSidebarProjects();
  if (view === 'projects') fetchJulesSources();
  if (view === 'project-detail' && state.selectedProjectDetail) fetchProjectDetail(state.selectedProjectDetail);
}

// =========================================================
// Dashboard data fetch
// =========================================================
async function refreshDashboard() {
  try {
    const [status, keys, metrics, health, agentsData, logsData] = await Promise.all([
      apiGet('/api/status'),
      apiGet('/api/keys').catch(() => ({ keys: [], message: 'unavailable' })),
      apiGet('/api/analytics/metrics?hours=24').catch(() => ({ hours: 24, series: {} })),
      apiGet('/api/health-status?hours=24').catch(() => ({ hours: 24, services: [] })),
      apiGet('/api/agents').catch(() => ({ agents: [] })),
      apiGet('/api/logs').catch(() => ({ logs: [] })),
    ]);

    state.status = status;
    state.keys = keys;
    state.metrics = metrics;
    state.health = health;
    state.agents = agentsData.agents || [];
    state.logs = logsData.logs || [];

    try {
      const usersData = await apiGet('/api/users');
      state.users = usersData.users || [];
      state.usersError = null;
    } catch (e) {
      state.users = [];
      state.usersError = e.message;
    }

    renderAll();
  } catch (e) {
    el.modeBadge.textContent = `Error: ${e.message}`;
    el.modeBadge.style.display = '';
  }
}

function renderAll() {
  if (!state.status) return;
  renderHeader();
  renderSidebarProjects();
  renderOverview();
  renderProjects();
  renderAgentLibrary();
  renderSessions();
  renderHealth();
  renderUsers();
}

// =========================================================
// Sidebar project list
// =========================================================
function renderSidebarProjects() {
  if (!el.sidebarProjects) return;
  const projects = state.status?.projects || [];
  el.sidebarProjects.innerHTML = '';
  for (const p of projects) {
    const btn = document.createElement('button');
    btn.className = 'sidebar-project-item';
    btn.type = 'button';
    const isActive = state.activeView === 'project-detail' && state.selectedProjectDetail === p.id;
    if (isActive) btn.classList.add('is-active');
    btn.innerHTML = `<span class="sidebar-project-dot" style="background:${p.locked ? '#ff5f7b' : '#16d68f'}"></span><span class="sidebar-project-name">${escapeHtml(p.id)}</span>`;
    btn.addEventListener('click', () => {
      state.selectedProjectDetail = p.id;
      switchView('project-detail');
    });
    el.sidebarProjects.appendChild(btn);
  }
}

// =========================================================
// Header
// =========================================================
function renderHeader() {
  const user = state.status?.currentUser;
  el.currentUserLabel.textContent = user ? `${user.email} (${user.role})` : '-';
  el.modeBadge.style.display = 'none';
}

// =========================================================
// Overview
// =========================================================
function renderOverview() {
  const projects = state.status?.projects || [];
  const runners = state.status?.runners || [];
  const events = state.status?.events || [];
  const keys = state.keys?.keys || [];

  const activeTasks = projects.reduce((s, p) => s + Number(p.activeTasks || 0), 0);
  const running = runners.filter(r => r.status === 'running').length;
  const used = keys.reduce((s, k) => s + Number(k.usage24h || 0), 0);
  const limit = keys.reduce((s, k) => s + Number(k.limit24h || 0), 0);
  const pct = limit > 0 ? Math.round((used / limit) * 100) : 0;
  const errors = events.filter(e => e.level === 'error' || e.level === 'warn').length;

  el.overviewMetrics.innerHTML = '';
  el.overviewMetrics.append(
    createMetric('Active Sessions', String(running), `${runners.length} total runners`, '#16d68f'),
    createMetric('Projects', String(projects.length), `${activeTasks} active tasks`, '#3f8cff'),
    createMetric('API Usage (24h)', `${pct}%`, `${used}/${limit} requests`, '#e7a321'),
    createMetric('Agents', String(state.agents.length), `${state.assignments?.length || 0} assignments`, '#a855f7'),
  );

  const feed = el.eventsFeed;
  const recentEvents = (state.status?.events || []).slice(0, 20);

  if (recentEvents.length === 0) {
    feed.innerHTML = '<li class="feed-item muted">No recent events.</li>';
  } else {
    if (feed.children.length > 0 && feed.children[0].classList.contains('muted')) {
      feed.innerHTML = ''; // Clear "no events" message
    }

    const wasScrolledToTop = feed.scrollTop < 5;
    const oldScrollHeight = feed.scrollHeight;
    const existingIds = new Set(Array.from(feed.children).map(c => c.dataset.eventId));
    
    // Find new events and prepend them, oldest-of-the-new first
    const newEvents = recentEvents.filter(ev => !existingIds.has(ev.id));
    for (const ev of newEvents.reverse()) {
      const li = document.createElement('li');
      li.className = 'feed-item';
      li.dataset.eventId = ev.id;
      li.innerHTML = `
        <span class="feed-time mono">${new Date(ev.at).toLocaleTimeString()}</span>
        <span class="dot ${pickLevel(ev.level)}"></span>
        <span class="feed-message">${escapeHtml(ev.message || '')}</span>
      `;
      feed.prepend(li);
    }

    // Remove old event elements that are no longer in the top 20
    const newEventIds = new Set(recentEvents.map(e => e.id));
    for (const child of Array.from(feed.children)) {
      if (child.dataset.eventId && !newEventIds.has(child.dataset.eventId)) {
        child.remove();
      }
    }

    if (wasScrolledToTop) {
      const newScrollHeight = feed.scrollHeight;
      feed.scrollTop += newScrollHeight - oldScrollHeight;
    }
  }

  el.quickProjectStatus.innerHTML = '';
  for (const p of projects) {
    const pRunners = runners.filter(r => r.projectId === p.id && r.status === 'running').length;
    const item = document.createElement('div');
    item.className = 'stack-item clickable';
    item.innerHTML = `
      <div class="row-between">
        <strong>${escapeHtml(p.id)}</strong>
        <span class="chip ${p.locked ? 'warn' : 'ok'}">${p.locked ? 'LOCKED' : 'ACTIVE'}</span>
      </div>
      <p class="muted small">${escapeHtml(p.githubRepo || '')} — ${pRunners} runner(s) active</p>
    `;
    item.addEventListener('click', () => { state.selectedProjectDetail = p.id; switchView('project-detail'); });
    el.quickProjectStatus.appendChild(item);
  }
}

// =========================================================
// Projects
// =========================================================
function renderProjects() {
  el.projectsCards.innerHTML = '';
  const projects = state.status?.projects || [];
  if (projects.length === 0) {
    el.projectsCards.innerHTML = '<div class="empty-state">No projects yet. Click "Add Project" to connect one.</div>';
    return;
  }

  for (const p of projects) {
    const runners = (state.status?.runners || []).filter(r => r.projectId === p.id && r.status === 'running');
    const card = document.createElement('article');
    card.className = 'project-card clickable';
    card.dataset.project = p.id;
    card.dataset.action = 'view-detail';
    card.innerHTML = `
      <div class="project-card-bar" style="background:${p.locked ? '#ff5f7b' : '#16d68f'}"></div>
      <div class="project-card-body">
        <div class="project-card-header">
          <div>
            <p class="project-name">${escapeHtml(p.id)}</p>
            <p class="muted small mono">${escapeHtml(p.githubRepo || '')} · ${escapeHtml(p.githubBranch || 'main')}</p>
          </div>
          <span class="chip ${p.locked ? 'warn' : 'ok'}">${p.locked ? 'LOCKED' : 'ACTIVE'}</span>
        </div>
        <div class="project-stats-grid">
          <div class="stat-item">
            <span class="stat-value">${p.openPRCount || 0}</span>
            <span class="stat-label">PRs</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">${runners.length}</span>
            <span class="stat-label">Running</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">${p.totalAgentsLaunched || 0}</span>
            <span class="stat-label">Total</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">${p.activeTasks}</span>
            <span class="stat-label">Tasks</span>
          </div>
        </div>
      </div>
    `;
    el.projectsCards.appendChild(card);
  }

  el.projectsCards.addEventListener('click', handleProjectsClick, { once: false });
}

async function handleProjectsClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const projectId = btn.dataset.project;
  setLoading(btn, true);
  try {
    if (action === 'view-detail') {
      state.selectedProjectDetail = projectId;
      switchView('project-detail');
    } else if (action === 'run-agent-once') {
      openRunAgentModal(projectId);
    } else if (action === 'toggle-lock') {
      const p = (state.status?.projects || []).find(x => x.id === projectId);
      if (!p) return;

      const wasLocked = p.locked;
      const endpoint = wasLocked ? `/api/projects/${projectId}/unlock` : `/api/projects/${projectId}/lock`;

      // Optimistic UI update
      p.locked = !wasLocked;
      renderProjects(); 
      renderSidebarProjects();

      try {
        await apiPost(endpoint, null, true);
        showToast(`Project ${wasLocked ? 'unlocked' : 'locked'}`);
      } catch (err) {
        p.locked = wasLocked; // Revert on failure
        renderProjects();
        renderSidebarProjects();
        throw err;
      }
      await refreshDashboard();
    } else if (action === 'run-pipeline') {
      await apiPost(`/api/projects/${projectId}/pipeline/run`, null, true);
      showToast('Pipeline started');
      await refreshDashboard();
    }
  } catch (err) {
    showToast(err.message, true);
  } finally {
    setLoading(btn, false);
  }
}

async function fetchJulesSources() {
  el.julesSourcesRows.innerHTML = '<tr><td colspan="4">Loading...</td></tr>';
  try {
    const data = await apiGet('/api/jules/sources');
    const sources = data.sources || [];
    el.julesSourcesRows.innerHTML = '';
    if (sources.length === 0) {
      el.julesSourcesRows.innerHTML = '<tr><td colspan="4" class="muted">No sources found in Jules.</td></tr>';
      return;
    }
    for (const s of sources) {
      const repo = s.githubRepo || {};
      if (!s.id) continue;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="mono small">${escapeHtml(s.id)}</td>
        <td><strong>${escapeHtml(`${repo.owner}/${repo.repo}`)}</strong></td>
        <td><span class="chip">${repo.isPrivate ? 'Private' : 'Public'}</span></td>
        <td><button class="btn btn-secondary btn-small" data-action="connect-source" data-repo="${escapeHtml(`${repo.owner}/${repo.repo}`)}" data-source-id="${escapeHtml(s.id)}">Connect</button></td>
      `;
      el.julesSourcesRows.appendChild(tr);
    }
  } catch (e) {
    el.julesSourcesRows.innerHTML = `<tr><td colspan="4" style="color:#ff5f7b">${escapeHtml(e.message)}</td></tr>`;
  }
}

// =========================================================
// Project Detail
// =========================================================
async function fetchProjectDetail(projectId) {
  if (!el.projectDetailContent.hasChildNodes()) {
    el.projectDetailContent.innerHTML = '<div class="card">Loading...</div>';
  }
  el.pageTitle.textContent = projectId;
  el.pageSubtitle.textContent = '';
  try {
    const [detailData, assignmentsData] = await Promise.all([
      apiGet(`/api/projects/${projectId}/detail`),
      apiGet(`/api/projects/${projectId}/assignments`),
    ]);
    state.projectDetailData = detailData;
    state.assignments = assignmentsData.assignments || [];
    el.pageTitle.textContent = detailData.project?.id || projectId;
    el.pageSubtitle.textContent = detailData.project?.githubRepo || '';
    renderProjectDetail(detailData, state.assignments);
  } catch (e) {
    el.projectDetailContent.innerHTML = `<div class="card" style="color:#ff5f7b">Error: ${escapeHtml(e.message)}</div>`;
  }
}

// Per-project active tab state
function getProjectDetailTab(projectId) {
  return localStorage.getItem('jules_tab_' + projectId) || 'prs';
}

function setProjectDetailTab(projectId, tabId) {
  localStorage.setItem('jules_tab_' + projectId, tabId);
}

function renderProjectDetail(data, assignments) {
  const { project, runners, summary } = data;

  // Update page header — show project name + repo inline
  el.projectDetailTitle.textContent = '';
  el.projectDetailTitle.innerHTML = `
    <span class="detail-lock-icon ${project.locked ? 'locked' : 'unlocked'}" data-action="toggle-lock-detail" data-project="${project.id}" title="${project.locked ? 'Locked — click to unlock' : 'Unlocked — click to lock'}">
      ${project.locked ? lockIconSVG('red') : lockIconSVG('green')}
    </span>
    <span class="detail-project-name">${escapeHtml(project.id)}</span>
    <span class="detail-project-meta">${escapeHtml(project.githubRepo)} · ${escapeHtml(project.githubBranch)}</span>
    <div style="margin-left:auto;display:flex;gap:6px">
      <button class="btn btn-ghost btn-small" data-action="edit-project" data-project="${project.id}">Edit</button>
      <button class="btn btn-danger btn-small" data-action="delete-project" data-project="${project.id}">Delete</button>
    </div>
  `;

  el.projectDetailContent.innerHTML = '';

  // Pipeline Timeline
  const timelineHtml = renderPipelineTimeline(project);
  if (timelineHtml) {
    const timelineWrapper = document.createElement('div');
    timelineWrapper.innerHTML = timelineHtml;
    el.projectDetailContent.appendChild(timelineWrapper);
  }

  // --- Tab bar ---
  const activeTab = getProjectDetailTab(project.id);
  const tabs = [
    { id: 'prs', label: 'Pull Requests', badge: null },
    { id: 'agents', label: 'Agents', badge: summary.runningCount || null },
    { id: 'pipelines', label: 'Pipelines', badge: null },
    { id: 'site-check', label: 'Site Check', badge: null },
  ];

  const tabBar = document.createElement('div');
  tabBar.className = 'detail-tab-bar';
  tabBar.innerHTML = tabs.map(t => `
    <button class="detail-tab-btn${t.id === activeTab ? ' is-active' : ''}" data-tab="${t.id}">
      ${escapeHtml(t.label)}
      ${t.badge ? `<span class="detail-tab-badge">${t.badge}</span>` : ''}
    </button>
  `).join('');

  // Right side quick action
  const tabActions = document.createElement('div');
  tabActions.className = 'detail-tab-actions';
  tabActions.innerHTML = `<button class="btn btn-small" data-action="run-agent-once" data-project="${project.id}">+ Run Agent</button>`;
  tabBar.appendChild(tabActions);

  el.projectDetailContent.appendChild(tabBar);

  // --- Tab panels ---
  const panels = document.createElement('div');
  panels.className = 'detail-tab-panels';
  el.projectDetailContent.appendChild(panels);

  function showTab(tabId) {
    setProjectDetailTab(project.id, tabId);
    tabBar.querySelectorAll('.detail-tab-btn').forEach(b => b.classList.toggle('is-active', b.dataset.tab === tabId));
    panels.innerHTML = '';

    if (tabId === 'prs') renderPRTab(panels, project);
    else if (tabId === 'agents') renderAgentsTab(panels, project, assignments, runners);
    else if (tabId === 'pipelines') renderPipelinesTab(panels, project);
    else if (tabId === 'site-check') renderSiteCheckTab(panels, project);
  }

  tabBar.addEventListener('click', e => {
    const btn = e.target.closest('.detail-tab-btn');
    if (btn) showTab(btn.dataset.tab);
  });

  showTab(activeTab);

  // Wire up detail actions (lock icon, run-agent, assignment buttons)
  el.projectDetailTitle.addEventListener('click', handleDetailClick);
  el.projectDetailContent.addEventListener('click', handleDetailClick);
}

function lockIconSVG(color) {
  const c = color === 'red' ? '#ff5050' : '#00d06c';
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    ${color === 'red'
      ? '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'
      : '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>'}
  </svg>`;
}

function updatePRActionButtons(projectId) {
  const selected = getSelectedPRNumbers(projectId);
  const mergeBtn = document.querySelector('#prMergeSelected');
  const closeBtn = document.querySelector('#prCloseSelected');
  if (!mergeBtn || !closeBtn) return;

  const hasSelection = selected.length > 0;
  mergeBtn.disabled = !hasSelection;
  closeBtn.disabled = !hasSelection;

  if (hasSelection) {
    mergeBtn.className = 'btn btn-small'; // green
    closeBtn.className = 'btn btn-danger btn-small';
  } else {
    mergeBtn.className = 'btn btn-secondary btn-small';
    closeBtn.className = 'btn btn-ghost btn-small';
  }
}

function renderPRTab(container, project) {
  const prSection = document.createElement('div');
  prSection.className = 'card';
  prSection.id = `pr-section-${project.id}`;
  prSection.innerHTML = `
    <div class="panel-head">
      <div style="display:flex;align-items:center;gap:8px">
        <h2>Open Pull Requests</h2>
        <button class="btn-icon-refresh" id="prRefreshBtn" title="Refresh PRs">↻</button>
        <span id="prLoadStatus" class="pr-load-status"></span>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-secondary btn-small" id="prMergeSelected" disabled>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;vertical-align:text-bottom"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/></svg>
          Merge
        </button>
        <button class="btn btn-ghost btn-small" id="prCloseSelected" disabled>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;vertical-align:text-bottom"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          Close
        </button>
      </div>
    </div>
    <div id="prListContainer"><p class="muted">Loading PRs...</p></div>
  `;
  container.appendChild(prSection);
  prSection.querySelector('#prRefreshBtn').onclick = () => loadPRs(project.id);
  prSection.querySelector('#prMergeSelected').onclick = () => mergeSelectedPRs(project.id);
  prSection.querySelector('#prCloseSelected').onclick = () => closeSelectedPRs(project.id);
  loadPRs(project.id);
}

function renderAgentsTab(container, project, assignments, runners) {
  // Assignments
  const assignSection = document.createElement('div');
  assignSection.className = 'card';
  const assignHeader = document.createElement('div');
  assignHeader.className = 'panel-head';
  assignHeader.innerHTML = `<h2>Assignments (${assignments.length})</h2>`;
  const addBtn = document.createElement('button');
  addBtn.className = 'btn';
  addBtn.textContent = '+ Add Assignment';
  addBtn.addEventListener('click', () => openAssignmentModal(project.id));
  assignHeader.appendChild(addBtn);
  assignSection.appendChild(assignHeader);

  if (assignments.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.style.marginTop = '1rem';
    empty.textContent = 'No assignments yet. Add one to start running agents on this project.';
    assignSection.appendChild(empty);
  } else {
    const grid = document.createElement('div');
    grid.className = 'assignments-grid';
    grid.style.marginTop = '1rem';
    for (const a of assignments) grid.appendChild(createAssignmentCard(a, project.id));
    assignSection.appendChild(grid);
  }
  container.appendChild(assignSection);

  // Active runners
  if (runners.running.length > 0) {
    const sec = document.createElement('div');
    sec.className = 'card';
    sec.style.marginTop = '1rem';
    sec.innerHTML = `<h3 style="margin-bottom:.75rem">Active (${runners.running.length})</h3>`;
    for (const r of runners.running) sec.appendChild(createRunnerCard(r, 'running'));
    container.appendChild(sec);
  }

  // Completed + Failed
  const history = [...runners.completed.slice(0, 5), ...runners.failed.slice(0, 5)];
  if (history.length > 0) {
    const sec = document.createElement('div');
    sec.className = 'card';
    sec.style.marginTop = '1rem';
    sec.innerHTML = `<h3 style="margin-bottom:.75rem">Recent Sessions</h3>`;
    for (const r of runners.completed.slice(0, 5)) sec.appendChild(createRunnerCard(r, 'completed'));
    for (const r of runners.failed.slice(0, 5)) sec.appendChild(createRunnerCard(r, 'failed'));
    container.appendChild(sec);
  }

  // Session history from DB
  const histSec = document.createElement('div');
  histSec.className = 'card';
  histSec.style.marginTop = '1rem';
  histSec.innerHTML = `<h3 style="margin-bottom:.75rem">Session History</h3><p class="muted small">Loading…</p>`;
  container.appendChild(histSec);
  apiGet(`/api/projects/${project.id}/sessions`).then(data => {
    const sessions = data.sessions || [];
    if (sessions.length === 0) { histSec.querySelector('p').textContent = 'No recorded sessions yet.'; return; }
    histSec.querySelector('p').remove();
    const table = document.createElement('div');
    table.className = 'session-history-list';
    for (const s of sessions) {
      const row = document.createElement('div');
      row.className = 'session-history-row';
      const sid = s.session_id.split('/').pop();
      const statusColor = s.status === 'completed' ? 'var(--green)' : s.status === 'failed' ? '#ff5050' : 'var(--blue)';
      row.innerHTML = `
        <div>
          <span class="mono small" style="color:var(--muted)">${sid}</span>
          <span class="muted small"> · ${escapeHtml(s.agent_name)} · ${fmtSince(s.started_at)} ago</span>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <span style="font-size:11px;font-weight:700;color:${statusColor}">${s.status.toUpperCase()}</span>
          <button class="btn btn-ghost btn-small" data-action="view-session-id" data-session-id="${escapeHtml(s.session_id)}">View</button>
        </div>
      `;
      table.appendChild(row);
    }
    histSec.appendChild(table);
  }).catch(() => { histSec.querySelector('p').textContent = 'Failed to load session history.'; });
}

function renderPipelinesTab(container, project) {
  const sec = document.createElement('div');
  sec.className = 'card';
  
  let buildPipelineHtml = `
    <div class="stack-item" style="opacity: ${project.buildPipelineEnabled ? '1' : '0.5'}">
      <div class="row-between">
        <div>
          <div style="display:flex;align-items:center;gap:8px">
            <strong>Build & Test Pipeline</strong>
            <span class="chip ${project.buildPipelineEnabled ? 'ok' : ''}">${project.buildPipelineEnabled ? 'ENABLED' : 'DISABLED'}</span>
          </div>
          <p class="muted small">
            ${project.hasPipeline ? (project.buildAndMergePipeline?.cronSchedule ? `Schedule: <span class="mono">${escapeHtml(project.buildAndMergePipeline.cronSchedule)}</span>` : 'Manual Trigger Only') : 'No agent instructions configured'}
          </p>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
           <button class="btn btn-ghost btn-small" id="editPipelineBtn">Configure</button>
           <button class="btn btn-secondary btn-small" data-action="run-pipeline" data-project="${project.id}" ${project.hasPipeline ? '' : 'disabled'}>Run Now</button>
        </div>
      </div>
    </div>
  `;

  let conflictResolverHtml = `
    <div class="stack-item" style="margin-top:1.5rem; opacity: ${project.conflictResolverEnabled ? '1' : '0.5'}">
      <div class="row-between">
        <div>
          <div style="display:flex;align-items:center;gap:8px">
            <strong>Batch Conflict Resolver</strong>
            <span class="chip ${project.conflictResolverEnabled ? 'ok' : ''}">${project.conflictResolverEnabled ? 'ENABLED' : 'DISABLED'}</span>
          </div>
          <p class="muted small">
            Schedule: <span class="mono">${escapeHtml(project.conflictResolverCron || '0 18 * * *')}</span>
          </p>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
           <button class="btn btn-ghost btn-small" id="editConflictResolverBtn">Configure</button>
           <button class="btn btn-secondary btn-small" data-action="run-conflict-resolver" data-project="${project.id}">Run Now</button>
        </div>
      </div>
    </div>
  `;

  sec.innerHTML = `
    <div class="panel-head">
      <h2>Project Automations</h2>
    </div>
    <div id="pipelinesListContainer" style="margin-top:1rem">
      ${buildPipelineHtml}
      ${conflictResolverHtml}
    </div>
    <p class="muted small" style="margin-top:1.5rem">
      • <strong>Build Pipeline</strong>: Runs a specific agent on schedule (or manual) to stabilize the branch.<br>
      • <strong>Conflict Resolver</strong>: Scans for "dirty" PRs and dispatches an agent if ≥3 conflicts are found.
    </p>
  `;
  container.appendChild(sec);

  // Bind buttons
  sec.querySelector('#editPipelineBtn')?.addEventListener('click', () => openPipelineModal(project.id, project.buildAndMergePipeline, project.buildPipelineEnabled));
  sec.querySelector('#editConflictResolverBtn')?.addEventListener('click', () => openConflictResolverModal(project.id, project.conflictResolverCron, project.conflictResolverEnabled));
}

// =========================================================
// Site Check Tab
// =========================================================

async function renderSiteCheckTab(container, project) {
  const sec = document.createElement('div');
  sec.innerHTML = '<div class="card"><p class="muted small">Loading site check data…</p></div>';
  container.appendChild(sec);

  let siteCheckData = { config: { enabled: false, baseUrl: '', pauseMs: 5000 }, stats: {}, running: false };
  let pages = [];

  try {
    const [scRes, pagesRes] = await Promise.all([
      fetch(`/api/projects/${project.id}/site-check`).then(r => r.json()),
      fetch(`/api/projects/${project.id}/site-check/pages?limit=200`).then(r => r.json()),
    ]);
    siteCheckData = scRes;
    pages = pagesRes.pages || [];
  } catch (e) {
    sec.innerHTML = `<div class="card" style="color:var(--red)">Error loading site check: ${escapeHtml(e.message)}</div>`;
    return;
  }

  const { config, stats, running } = siteCheckData;
  const totalAnalyzed = (stats.total || 0) - (stats.neverAnalyzed || 0);
  const pct = stats.total ? Math.round((totalAnalyzed / stats.total) * 100) : 0;
  const gitBase = project.githubRepo ? `https://github.com/${project.githubRepo}/blob/${project.githubBranch || 'dev'}/` : null;

  sec.innerHTML = `
    <div class="card" style="margin-bottom:1rem">
      <div class="panel-head">
        <h2>Site Check</h2>
        <span class="status-pill ${running ? 'status-ok' : 'status-muted'}">${running ? 'Running' : 'Stopped'}</span>
      </div>
      <p class="muted small" style="margin-bottom:1rem">
        Screenshots each page in order (oldest first), analyzes with Claude Vision, and opens a Jules fix session if issues are found.
        Screenshots are committed to <code>screenshots/{locale}/{path}.png</code> in the repo.
      </p>

      <div class="form-group" style="display:grid;grid-template-columns:120px 130px 130px 110px 110px;gap:12px;align-items:end;margin-bottom:1rem">
        <div>
          <label class="form-label">Locale</label>
          <select id="scLocale" class="form-control">
            <option value="fr" ${(config.locale || 'fr') === 'fr' ? 'selected' : ''}>fr</option>
            <option value="en" ${config.locale === 'en' ? 'selected' : ''}>en</option>
          </select>
        </div>
        <div>
          <label class="form-label">Concurrency</label>
          <input id="scConcurrency" type="number" class="form-control" min="1" max="50" value="${config.concurrency || 1}" />
        </div>
        <div>
          <label class="form-label">Pause (ms)</label>
          <input id="scPauseMs" type="number" class="form-control" min="0" step="1000" value="${config.pauseMs || 5000}" />
        </div>
        <button id="scUpdateBtn" class="btn" type="button" style="${config.enabled ? '' : 'display:none'}; background: var(--purple); color: white; border: none;">
          Update
        </button>
        <button id="scToggleBtn" class="btn ${config.enabled ? 'btn-danger' : 'btn'}" type="button">
          ${config.enabled ? 'Disable' : 'Enable'}
        </button>
      </div>
      <p class="muted x-small" style="margin-top:-0.5rem;margin-bottom:1rem">L'agent Jules lancera automatiquement le projet en local pour effectuer les tests visuels et techniques.</p>

      <div style="margin-bottom:1.5rem">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px">
          <span class="small muted">Pages analyzed: ${totalAnalyzed} / ${stats.total || 0}</span>
          <span class="small muted">${pct}%</span>
        </div>
        <div style="height:8px;background:var(--surface-2,#2a2a3a);border-radius:4px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:var(--blue,#3f8cff);transition:width .3s"></div>
        </div>
        <div style="display:flex;gap:16px;margin-top:8px">
          <span class="status-pill status-ok">✓ OK: ${stats.ok || 0}</span>
          <span class="status-pill status-warn" style="background:rgba(255,180,0,.15);color:#ffb400">⚠ FIX: ${stats.fix || 0}</span>
          <span class="status-pill status-muted">◌ Pending: ${(stats.neverAnalyzed || 0) + (stats.analyze || 0)}</span>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="panel-head" style="margin-bottom:.75rem">
        <h2>Pages</h2>
        <div style="display:flex;gap:8px">
          <select id="scFilterStatus" class="form-control" style="width:120px">
            <option value="">All</option>
            <option value="OK">OK</option>
            <option value="FIX">FIX</option>
            <option value="ANALYZE">Pending</option>
          </select>
        </div>
      </div>
      <div class="table-wrap">
        <table id="scPagesTable">
          <thead>
            <tr>
              <th>URL</th><th>Group</th><th>Status</th><th>Last check</th><th>Screenshot</th><th>Issues</th>
            </tr>
          </thead>
          <tbody id="scPagesBody"></tbody>
        </table>
      </div>
    </div>
  `;

  // Render page rows
  function renderRows(filteredPages) {
    const tbody = sec.querySelector('#scPagesBody');
    tbody.innerHTML = filteredPages.map(p => {
      const statusCls = p.status === 'OK' ? 'status-ok' : p.status === 'FIX' ? 'status-warn' : 'status-muted';
      const statusLabel = p.status === 'OK' ? '✓ OK' : p.status === 'FIX' ? '⚠ FIX' : '◌ Pending';
      const lastCheck = p.last_screenshot_at ? new Date(p.last_screenshot_at).toLocaleString() : 'Never';
      const screenshotUrl = gitBase && p.screenshot_path ? `${gitBase}${p.screenshot_path}` : null;
      const screenshotLink = screenshotUrl
        ? `<a href="${escapeHtml(screenshotUrl)}" target="_blank" class="mono small">View</a>`
        : '<span class="muted small">—</span>';
      const issueCount = p.issues?.length ? `<span style="color:var(--red)">${p.issues.length} issue(s)</span>` : '<span class="muted">—</span>';

      return `<tr>
        <td class="mono small" style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(p.url)}">${escapeHtml(p.url)}</td>
        <td><span class="status-pill status-muted">${escapeHtml(p.group_name)}</span></td>
        <td><span class="status-pill ${statusCls}">${statusLabel}</span></td>
        <td class="small muted">${lastCheck}</td>
        <td>${screenshotLink}</td>
        <td>${issueCount}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="6" class="muted small" style="text-align:center">No pages match the filter</td></tr>';
  }

  renderRows(pages);

  // Filters
  function applyFilters() {
    const status = sec.querySelector('#scFilterStatus').value;
    renderRows(pages.filter(p => !status || p.status === status));
  }
  sec.querySelector('#scFilterStatus').addEventListener('change', applyFilters);

  async function saveSiteCheck(newEnabled) {
    const pauseMs = Number(sec.querySelector('#scPauseMs').value) || 5000;
    const locale  = sec.querySelector('#scLocale').value;
    const concurrency = Number(sec.querySelector('#scConcurrency').value) || 1;
    const res = await fetch(`/api/projects/${project.id}/site-check/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: newEnabled, baseUrl: null, pauseMs, locale, concurrency }),
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
    showToast(`Site Check ${newEnabled ? (newEnabled === config.enabled ? 'updated' : 'enabled') : 'disabled'}`);
    container.innerHTML = '';
    renderSiteCheckTab(container, project);
  }

  // Update button
  sec.querySelector('#scUpdateBtn')?.addEventListener('click', async () => {
    const btn = sec.querySelector('#scUpdateBtn');
    btn.disabled = true;
    btn.textContent = 'Updating…';
    try {
      await saveSiteCheck(config.enabled);
    } catch (e) {
      showToast(`Error: ${e.message}`, 'error');
      btn.disabled = false;
      btn.textContent = 'Update';
    }
  });

  // Toggle button
  sec.querySelector('#scToggleBtn').addEventListener('click', async () => {
    const btn = sec.querySelector('#scToggleBtn');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      await saveSiteCheck(!config.enabled);
    } catch (e) {
      showToast(`Error: ${e.message}`, 'error');
      btn.disabled = false;
      btn.textContent = config.enabled ? 'Disable' : 'Enable';
    }
  });
}

// =========================================================
// PR Management
// =========================================================

const prStateByProject = {}; // { projectId: [{ ...pr, _uiStatus }] }

async function loadPRs(projectId) {
  const container = document.querySelector('#prListContainer');
  const statusEl = document.querySelector('#prLoadStatus');
  if (!container) return;

  const alreadyLoaded = !!prStateByProject[projectId];
  if (!alreadyLoaded) container.innerHTML = '<p class="muted">Loading PRs...</p>';

  const refreshBtn = document.querySelector('#prRefreshBtn');
  if (refreshBtn) { refreshBtn.classList.add('spinning'); refreshBtn.disabled = true; }
  if (statusEl) { statusEl.className = 'pr-load-status'; statusEl.textContent = ''; }

  try {
    const data = await apiGet(`/api/projects/${projectId}/prs`);
    // Preserve _uiStatus for rows that are mid-action
    const existing = {};
    (prStateByProject[projectId] || []).forEach(p => { existing[p.number] = p; });
    prStateByProject[projectId] = (data.prs || []).map(pr => ({
      ...pr,
      _uiStatus: existing[pr.number]?._uiStatus || 'idle',
      _selected: existing[pr.number]?._selected || false
    }));
    renderPRList(projectId);
    const age = data.cachedAt ? `updated ${fmtSince(data.cachedAt)} ago` : 'updated';
    if (statusEl) { statusEl.className = 'pr-load-status ok'; statusEl.textContent = `✓ ${age}`; setTimeout(() => { if (statusEl) { statusEl.textContent = ''; statusEl.className = 'pr-load-status'; } }, 4000); }
  } catch (e) {
    if (!alreadyLoaded) container.innerHTML = `<p style="color:#ff5f7b">Failed to load PRs: ${escapeHtml(e.message)}</p>`;
    if (statusEl) { statusEl.className = 'pr-load-status err'; statusEl.textContent = '✗'; }
  } finally {
    if (refreshBtn) { refreshBtn.classList.remove('spinning'); refreshBtn.disabled = false; }
  }
}

function renderPRList(projectId) {
  const container = document.querySelector('#prListContainer');
  if (!container) return;
  const prs = prStateByProject[projectId] || [];

  if (prs.length === 0) {
    container.innerHTML = '<p class="muted" style="margin-top:.5rem">No open pull requests.</p>';
    return;
  }

  container.innerHTML = '';
  const table = document.createElement('table');
  table.className = 'pr-table';
  const allSelected = prs.length > 0 && prs.filter(p => p._uiStatus === 'idle').every(p => p._selected);
  table.innerHTML = `
    <thead>
      <tr>
        <th style="width:32px"><input type="checkbox" id="prSelectAllChk" title="Select all" ${allSelected ? 'checked' : ''} /></th>
        <th>#</th>
        <th>Title</th>
        <th>Branch</th>
        <th>Author</th>
        <th>Status</th>
        <th>Age</th>
      </tr>
    </thead>
  `;
  const tbody = document.createElement('tbody');
  tbody.id = `pr-tbody-${projectId}`;

  for (const pr of prs) {
    tbody.appendChild(createPRRow(pr, projectId));
  }
  table.appendChild(tbody);
  const wrap = document.createElement('div');
  wrap.className = 'pr-table-wrap';
  wrap.appendChild(table);
  container.appendChild(wrap);

  table.querySelector('#prSelectAllChk')?.addEventListener('change', e => {
    const idlePRs = (prStateByProject[projectId] || []).filter(p => p._uiStatus === 'idle');
    for (const p of idlePRs) p._selected = e.target.checked;
    renderPRList(projectId);
  });

  updatePRActionButtons(projectId);
}

function createPRRow(pr, projectId) {
  const tr = document.createElement('tr');
  tr.id = `pr-row-${projectId}-${pr.number}`;
  tr.className = 'pr-row';
  tr.dataset.prNumber = pr.number;

  const mergeChip = getMergeStatusChip(pr);
  const uiClass = pr._uiStatus === 'merged' ? 'pr-row-success'
    : pr._uiStatus === 'failed' ? 'pr-row-failed'
    : pr._uiStatus === 'skipped' ? 'pr-row-skipped'
    : (pr._uiStatus === 'merging' || pr._uiStatus === 'closing') ? 'pr-row-loading'
    : pr._uiStatus === 'closed' ? 'pr-row-success'
    : '';
  if (uiClass) tr.classList.add(uiClass);
  const statusText = pr._uiStatus === 'merged' ? '✓ Merged'
    : pr._uiStatus === 'failed' ? `✗ ${pr._uiReason || 'Failed'}`
    : pr._uiStatus === 'merging' ? '⏳ Merging...'
    : pr._uiStatus === 'closing' ? '⏳ Closing...'
    : pr._uiStatus === 'skipped' ? '— Skipped'
    : pr._uiStatus === 'closed' ? '✓ Closed'
    : '';

  tr.innerHTML = `
    <td><input type="checkbox" class="pr-checkbox" data-pr="${pr.number}" ${pr._selected ? 'checked' : ''} /></td>
    <td class="mono small"><a href="${escapeHtml(pr.html_url)}" target="_blank" rel="noopener" class="pr-link">#${pr.number}</a></td>
    <td class="pr-title-cell">
      <a href="${escapeHtml(pr.html_url)}" target="_blank" rel="noopener" class="pr-link pr-title">${escapeHtml(pr.title)}</a>
      ${statusText ? `<span class="pr-status-inline">${escapeHtml(statusText)}</span>` : ''}
    </td>
    <td class="mono small muted">${escapeHtml(pr.head?.ref || '')}</td>
    <td class="muted small">${escapeHtml(pr.user?.login || '')}</td>
    <td>${mergeChip}</td>
    <td class="muted small">${fmtSince(pr.created_at)}</td>
  `;

  tr.querySelector('.pr-checkbox').addEventListener('change', e => {
    const p = (prStateByProject[projectId] || []).find(x => x.number === pr.number);
    if (p) p._selected = e.target.checked;
    updatePRActionButtons(projectId);
  });

  return tr;
}

function getMergeStatusChip(pr) {
  if (pr.draft) return '<span class="pr-status-chip chip-draft">Draft</span>';
  const s = pr.mergeable_state;
  if (s === 'clean' || s === 'has_hooks') return '<span class="pr-status-chip chip-clean">Ready</span>';
  if (s === 'unstable') return '<span class="pr-status-chip chip-blocked">Unstable</span>';
  if (s === 'dirty' || pr.mergeable === false) return '<span class="pr-status-chip chip-conflict">Conflicts</span>';
  if (s === 'blocked') return '<span class="pr-status-chip chip-blocked">Blocked</span>';
  if (s === 'behind') return '<span class="pr-status-chip chip-behind">Behind</span>';
  return '<span class="pr-status-chip chip-unknown">—</span>';
}

function toggleSelectAllPRs(projectId) {
  const prs = prStateByProject[projectId] || [];
  const allSelected = prs.every(p => p._selected);
  for (const p of prs) p._selected = !allSelected;
  renderPRList(projectId);
}

function getSelectedPRNumbers(projectId) {
  return (prStateByProject[projectId] || [])
    .filter(p => p._selected && p._uiStatus === 'idle')
    .map(p => p.number);
}

async function mergeSelectedPRs(projectId) {
  const selected = getSelectedPRNumbers(projectId);
  if (selected.length === 0) return showToast('Select at least one PR', true);
  await runMergeBatch(projectId, selected);
}


async function runMergeBatch(projectId, prNumbers) {
  const prs = prStateByProject[projectId] || [];
  // Newest first
  const sorted = [...prNumbers].sort((a, b) => b - a);

  // Set all to merging
  for (const num of sorted) {
    const p = prs.find(x => x.number === num);
    if (p) p._uiStatus = 'merging';
  }
  renderPRList(projectId);

  // Disable buttons during operation
  const btns = document.querySelectorAll(`#pr-section-${projectId} button`);
  btns.forEach(b => b.disabled = true);

  try {
    const data = await apiPost(`/api/projects/${projectId}/prs/merge-batch`, { prNumbers: sorted });
    const results = data.results || [];

    for (const r of results) {
      const p = prs.find(x => x.number === r.prNumber);
      if (!p) continue;
      p._uiStatus = r.status === 'merged' ? 'merged' : r.status === 'skipped' ? 'skipped' : 'failed';
      p._uiReason = r.reason || '';
      p._selected = false;
    }

    renderPRList(projectId);

    // Fade out successful rows after 2s
    setTimeout(() => {
      for (const r of results) {
        if (r.status === 'merged') {
          const p = prs.find(x => x.number === r.prNumber);
          if (p) p._uiStatus = 'gone';
        }
      }
      prStateByProject[projectId] = prs.filter(p => p._uiStatus !== 'gone');
      renderPRList(projectId);
    }, 2500);

    const merged = results.filter(r => r.status === 'merged').length;
    const failed = results.filter(r => r.status === 'failed').length;
    showToast(`${merged} merged${failed > 0 ? `, ${failed} failed` : ''}`, failed > 0 && merged === 0);
  } catch (e) {
    showToast(e.message, true);
    for (const num of sorted) {
      const p = prs.find(x => x.number === num);
      if (p && p._uiStatus === 'merging') p._uiStatus = 'idle';
    }
    renderPRList(projectId);
  } finally {
    btns.forEach(b => b.disabled = false);
  }
}

async function closeSelectedPRs(projectId) {
  const selected = (prStateByProject[projectId] || [])
    .filter(p => p._selected && p._uiStatus === 'idle')
    .map(p => p.number);
  if (selected.length === 0) return showToast('Select at least one PR', true);

  if (!confirm(`Close ${selected.length} PR(s)?`)) return;

  const prs = prStateByProject[projectId] || [];
  for (const num of selected) {
    const p = prs.find(x => x.number === num);
    if (p) p._uiStatus = 'closing';
  }
  renderPRList(projectId);

  try {
    const data = await apiPost(`/api/projects/${projectId}/prs/close-batch`, { prNumbers: selected });
    for (const r of data.results || []) {
      const p = prs.find(x => x.number === r.prNumber);
      if (p) { p._uiStatus = r.status === 'closed' ? 'closed' : 'failed'; p._selected = false; }
    }
    renderPRList(projectId);
    setTimeout(() => {
      prStateByProject[projectId] = prs.filter(p => p._uiStatus !== 'closed');
      renderPRList(projectId);
    }, 2500);
    showToast(`${selected.length} PR(s) closed`);
  } catch (e) {
    showToast(e.message, true);
    for (const num of selected) {
      const p = prs.find(x => x.number === num);
      if (p && p._uiStatus === 'closing') p._uiStatus = 'idle';
    }
    renderPRList(projectId);
  }
}

function createAssignmentCard(a, projectId) {
  const card = document.createElement('article');
  card.className = 'assignment-card';
  card.dataset.assignmentId = a.id;

  const modeLabel = a.mode === 'loop'
    ? `Loop · pause ${fmtMs(a.loop_pause_ms || 300000)}`
    : `Scheduled · ${a.cron_schedule || '?'}`;

  const statusDot = a.running ? 'ok' : (a.enabled ? '' : 'muted');

  card.innerHTML = `
    <div class="assignment-card-accent" style="background:${a.agent_color || '#3f8cff'}"></div>
    <div class="assignment-card-body">
      <div class="row-between">
        <div>
          <p class="assignment-name">${escapeHtml(a.agent_name || (a.agent_id ? `Agent #${a.agent_id}` : 'Custom Assignment'))}</p>
          <p class="muted small">${escapeHtml(modeLabel)}</p>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          ${a.running ? '<span class="chip ok">Running</span>' : ''}
          <span class="chip ${a.enabled ? 'ok' : 'muted-chip'}">${a.enabled ? 'Enabled' : 'Disabled'}</span>
        </div>
      </div>
      <div class="assignment-stats">
        <span>${a.total_runs} total runs</span>
        <span>Last run: ${a.last_run_at ? fmtSince(a.last_run_at) + ' ago' : 'never'}</span>
      </div>
      <div class="action-row" style="margin-top:.75rem">
        <button class="btn btn-ghost btn-small" data-action="assignment-run" data-assignment="${a.id}">Run Now</button>
        ${a.running
          ? `<button class="btn btn-ghost btn-small" data-action="assignment-stop" data-assignment="${a.id}">Stop</button>`
          : ''}
        <button class="btn btn-ghost btn-small" data-action="assignment-toggle" data-assignment="${a.id}">${a.enabled ? 'Disable' : 'Enable'}</button>
        <button class="btn btn-ghost btn-small" data-action="assignment-edit" data-assignment="${a.id}" data-project="${projectId}">Edit</button>
        <button class="btn btn-danger btn-small" data-action="assignment-delete" data-assignment="${a.id}">Delete</button>
      </div>
    </div>
  `;
  return card;
}

function createRunnerCard(runner, status) {
  const card = document.createElement('article');
  card.className = 'card runner-card-detail';

  const duration = runner.stoppedAt
    ? Math.round((new Date(runner.stoppedAt) - new Date(runner.startedAt)) / 1000)
    : Math.round((Date.now() - new Date(runner.startedAt)) / 1000);
  const durStr = duration > 60 ? `${Math.floor(duration / 60)}m ${duration % 60}s` : `${duration}s`;

  card.innerHTML = `
    <div class="row-between">
      <div>
        <p style="font-weight:600">${escapeHtml(runner.label || runner.type)}</p>
        <p class="muted small">Type: ${runner.type} · Mode: ${runner.mode}</p>
        <p class="muted small">Started: ${fmtDate(runner.startedAt)} · ${runner.stoppedAt ? `Duration: ${durStr}` : `Running for: ${durStr}`}</p>
        ${runner.lastError ? `<p class="small" style="color:#ff5f7b">Error: ${escapeHtml(runner.lastError)}</p>` : ''}
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <button class="btn btn-ghost btn-small" data-action="view-session" data-runner="${runner.id}" ${!runner.sessionId ? 'disabled title="No Jules session yet"' : ''}>Session</button>
        ${status === 'running' ? `<button class="btn btn-ghost btn-small" data-action="stop-runner" data-runner="${runner.id}">Stop</button>` : ''}
        <span class="chip ${status === 'running' ? 'ok' : status === 'failed' ? 'bad' : ''}">${status}</span>
      </div>
    </div>
  `;
  return card;
}

// =========================================================
// Session Drawer
// =========================================================
let _drawerPollTimer = null;
let _drawerRunnerId = null;
let _drawerSessionId = null; // for historical sessions without a live runner

function openSessionDrawer(runnerId, sessionId = null) {
  _drawerRunnerId = runnerId;
  _drawerSessionId = sessionId;
  const drawer = document.querySelector('#sessionDrawer');
  const backdrop = document.querySelector('#sessionDrawerBackdrop');
  drawer.classList.add('is-open');
  backdrop.classList.add('is-open');
  document.querySelector('#sessionDrawerFeed').innerHTML = '<p class="muted">Loading session…</p>';
  document.querySelector('#sessionDrawerStatus').innerHTML = '';
  clearInterval(_drawerPollTimer);
  pollSessionDrawer();
  _drawerPollTimer = setInterval(pollSessionDrawer, 5000);
}

function closeSessionDrawer() {
  clearInterval(_drawerPollTimer);
  _drawerPollTimer = null;
  _drawerRunnerId = null;
  document.querySelector('#sessionDrawer').classList.remove('is-open');
  document.querySelector('#sessionDrawerBackdrop').classList.remove('is-open');
}

async function pollSessionDrawer() {
  if (!_drawerRunnerId && !_drawerSessionId) return;
  try {
    const url = _drawerRunnerId
      ? `/api/runners/${_drawerRunnerId}/session`
      : `/api/sessions/${encodeURIComponent(_drawerSessionId)}`;
    const data = await apiGet(url);
    renderSessionDrawer(data);
    // Stop polling if runner finished or session is terminal
    const done = data.runner ? data.runner.status !== 'running' : (data.session?.state === 'COMPLETED' || data.session?.state === 'FAILED');
    if (done) { clearInterval(_drawerPollTimer); _drawerPollTimer = null; }
  } catch (e) {
    document.querySelector('#sessionDrawerFeed').innerHTML = `<p style="color:#ff5050">Error: ${escapeHtml(e.message)}</p>`;
  }
}

function renderSessionDrawer(data) {
  const { runner, session, activities } = data;

  const sessionId = runner?.sessionId || _drawerSessionId || '';
  document.querySelector('#sessionDrawerLabel').textContent = runner?.label || runner?.type || 'Session';
  document.querySelector('#sessionDrawerMeta').textContent = [
    runner?.projectId,
    sessionId ? sessionId.split('/').pop() : null,
    runner?.status,
  ].filter(Boolean).join(' · ');

  // Status bar
  const stateLabel = session?.state || (runner?.status === 'running' ? 'RUNNING' : runner?.status?.toUpperCase() || '—');
  const isLive = runner?.status === 'running' || (session?.state && !['COMPLETED','FAILED'].includes(session.state));
  const stateColor = session?.state === 'COMPLETED' ? 'var(--green)'
    : session?.state === 'FAILED' ? '#ff5050'
    : isLive ? 'var(--blue)' : 'var(--muted)';
  const prOutput = session?.outputs?.find(o => o.pullRequest);

  document.querySelector('#sessionDrawerStatus').innerHTML = `
    <div class="session-state-row">
      <span class="session-state-chip" style="background:${stateColor}22;color:${stateColor}">${escapeHtml(stateLabel)}</span>
      ${isLive ? '<span class="session-state-live">● Live</span>' : ''}
      ${prOutput ? `<a href="${escapeHtml(prOutput.pullRequest.url)}" target="_blank" class="btn btn-ghost btn-small" rel="noopener">View PR ↗</a>` : ''}
      ${session?.createTime ? `<span class="muted small">${fmtDate(session.createTime)}</span>` : ''}
    </div>
  `;

  const feed = document.querySelector('#sessionDrawerFeed');
  if (!activities || activities.length === 0) {
    feed.innerHTML = !sessionId
      ? '<p class="muted small">No Jules session started yet.</p>'
      : '<p class="muted small">No activities yet — session may be initializing…</p>';
    return;
  }

  feed.innerHTML = '';
  for (const act of activities) {
    const role = act.author?.role || act.role || '';
    const isUser = role === 'USER';
    const isSystem = role === 'SYSTEM' || role === 'ORCHESTRATOR';
    const bubbleClass = isUser ? 'bubble-user' : isSystem ? 'bubble-system' : 'bubble-agent';
    const roleLabel = isUser ? 'You' : isSystem ? 'System' : (act.author?.name || 'Jules');

    let parts = Array.isArray(act.parts) ? act.parts : [];
    if (parts.length === 0 && act.content && Array.isArray(act.content.parts)) {
      parts = act.content.parts;
    }
    if (parts.length === 0 && act.message?.content?.parts && Array.isArray(act.message.content.parts)) {
      parts = act.message.content.parts;
    }

    const textFallback = act.text || act.content?.text || act.message?.content?.text;
    if (parts.length === 0 && !textFallback) {
      // If we still have nothing, but there are keys, maybe show it raw
      const keys = Object.keys(act).filter(k => !['name', 'createTime', 'author', 'role'].includes(k));
      if (keys.length > 0) {
        const bubble = document.createElement('div');
        bubble.className = `session-bubble bubble-system`;
        bubble.innerHTML = `<div class="bubble-role">Debug</div><pre class="bubble-code" style="opacity:0.5">${escapeHtml(JSON.stringify(act, null, 2))}</pre>`;
        feed.appendChild(bubble);
      }
      continue;
    }

    const bubble = document.createElement('div');
    bubble.className = `session-bubble ${bubbleClass}`;

    const roleEl = document.createElement('div');
    roleEl.className = 'bubble-role';
    roleEl.textContent = roleLabel;
    bubble.appendChild(roleEl);

    // Render each part with its proper type
    for (const part of parts) {
      if (part.text) {
        const el = document.createElement('div');
        el.className = 'bubble-text';
        el.textContent = part.text;
        bubble.appendChild(el);
      } else if (part.code) {
        const el = document.createElement('pre');
        el.className = 'bubble-code';
        el.textContent = part.code;
        bubble.appendChild(el);
      } else if (part.functionCall || part.toolCall) {
        const fc = part.functionCall || part.toolCall;
        const el = document.createElement('div');
        el.className = 'bubble-tool-call';
        el.innerHTML = `<span class="tool-name">⚙ ${escapeHtml(fc.name || 'tool_call')}</span>`;
        if (fc.args && Object.keys(fc.args).length) {
          const pre = document.createElement('pre');
          pre.className = 'tool-args';
          pre.textContent = JSON.stringify(fc.args, null, 2);
          el.appendChild(pre);
        }
        bubble.appendChild(el);
      } else if (part.functionResponse || part.toolResponse) {
        const fr = part.functionResponse || part.toolResponse;
        const el = document.createElement('div');
        el.className = 'bubble-tool-response';
        const resp = fr.response ?? fr.content ?? fr;
        const text = typeof resp === 'string' ? resp : JSON.stringify(resp, null, 2);
        el.innerHTML = `<span class="tool-name muted">↩ ${escapeHtml(fr.name || 'response')}</span>`;
        const pre = document.createElement('pre');
        pre.className = 'tool-args';
        pre.textContent = text.length > 800 ? text.slice(0, 800) + '\n…' : text;
        el.appendChild(pre);
        bubble.appendChild(el);
      } else {
        // Unknown part type — show raw so nothing is hidden
        const keys = Object.keys(part);
        if (keys.length) {
          const el = document.createElement('pre');
          el.className = 'bubble-code';
          el.style.opacity = '0.5';
          el.textContent = JSON.stringify(part, null, 2);
          bubble.appendChild(el);
        }
      }
    }

    // Fallback: top-level text field
    if (parts.length === 0 && textFallback) {
      const el = document.createElement('div');
      el.className = 'bubble-text';
      el.textContent = textFallback;
      bubble.appendChild(el);
    }

    if (bubble.childElementCount > 1) feed.appendChild(bubble);
  }

  if (feed.childElementCount === 0) {
    feed.innerHTML = `<p class="muted small">Activities received (${activities.length}) but no renderable content — check console for raw shape.</p>`;
    console.log('[session-drawer] raw activities:', activities);
  }

  feed.scrollTop = feed.scrollHeight;
}

function initSessionDrawer() {
  document.querySelector('#sessionDrawerClose')?.addEventListener('click', closeSessionDrawer);
  document.querySelector('#sessionDrawerBackdrop')?.addEventListener('click', closeSessionDrawer);
}

async function handleDetailClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const projectId = btn.dataset.project || state.selectedProjectDetail;
  const assignmentId = btn.dataset.assignment;
  const runnerId = btn.dataset.runner;

  setLoading(btn, true);
  try {
    if (action === 'toggle-lock-detail') {
      const p = (state.status?.projects || []).find(x => x.id === projectId);
      if (!p) return;
      const wasLocked = p.locked;
      const endpoint = wasLocked ? `/api/projects/${projectId}/unlock` : `/api/projects/${projectId}/lock`;
      
      // Optimistic UI update
      p.locked = !wasLocked;
      if (state.projectDetailData && state.projectDetailData.project) {
        state.projectDetailData.project.locked = !wasLocked;
      }
      renderProjectDetail(state.projectDetailData, state.assignments);
      renderSidebarProjects();

      try {
        await apiPost(endpoint, null, true);
        showToast(wasLocked ? 'Project unlocked' : 'Project locked');
      } catch (err) {
        p.locked = wasLocked;
        if (state.projectDetailData && state.projectDetailData.project) {
          state.projectDetailData.project.locked = wasLocked;
        }
        renderProjectDetail(state.projectDetailData, state.assignments);
        renderSidebarProjects();
        throw err;
      }
      await refreshDashboard();
    } else if (action === 'run-pipeline') {
      await apiPost(`/api/projects/${projectId}/pipeline/run`, null, true);
      showToast('Pipeline started');
    } else if (action === 'run-conflict-resolver') {
      await apiPost(`/api/projects/${projectId}/batch-conflict/run`, null, true);
      showToast('Conflict resolver started');
    } else if (action === 'run-agent-once') {
      openRunAgentModal(projectId);
      setLoading(btn, false);
      return;
    } else if (action === 'assignment-run') {
      await apiPost(`/api/assignments/${assignmentId}/run`);
      showToast('Agent session started');
    } else if (action === 'assignment-stop') {
      await apiPost(`/api/assignments/${assignmentId}/stop`, null, true);
      showToast('Assignment stopped');
    } else if (action === 'assignment-toggle') {
      await apiPost(`/api/assignments/${assignmentId}/toggle`);
      showToast('Assignment updated');
    } else if (action === 'assignment-edit') {
      const a = state.assignments.find(x => x.id === Number(assignmentId));
      openAssignmentModal(btn.dataset.project || projectId, a);
      setLoading(btn, false);
      return;
    } else if (action === 'assignment-delete') {
      if (!confirm('Delete this assignment?')) { setLoading(btn, false); return; }
      await apiDelete(`/api/assignments/${assignmentId}`, true);
      showToast('Assignment deleted');
    } else if (action === 'view-session') {
      openSessionDrawer(runnerId, null);
      setLoading(btn, false);
      return;
    } else if (action === 'view-session-id') {
      openSessionDrawer(null, btn.dataset.sessionId);
      setLoading(btn, false);
      return;
    } else if (action === 'stop-runner') {
      await apiPost(`/api/runners/${runnerId}/stop`, null, true);
      showToast('Runner stopped');
    } else if (action === 'edit-project') {
      openProjectModal(projectId);
      setLoading(btn, false);
      return;
    } else if (action === 'delete-project') {
      if (!confirm(`Delete project "${projectId}"? This will also stop all running agents and delete assignments.`)) { setLoading(btn, false); return; }
      await apiDelete(`/api/projects/${projectId}/delete`, true);
      showToast('Project deleted');
      switchView('projects');
    }
    await refreshDashboard();
    if (state.selectedProjectDetail) await fetchProjectDetail(state.selectedProjectDetail);
  } catch (err) {
    showToast(err.message, true);
  } finally {
    setLoading(btn, false);
  }
}

// =========================================================
// Agent Library
// =========================================================
function openPipelineModal(projectId, config = null, enabled = false) {
  const modal = document.querySelector('#pipelineModal');
  document.querySelector('#pipelineModalProjectId').value = projectId;
  document.querySelector('#pipelineModalTitle').textContent = config ? 'Edit Build Pipeline' : 'Configure Build Pipeline';
  document.querySelector('#pipelineModalEnabled').checked = !!enabled;
  
  setCronBuilderFromExpr('#pipelineCronBuilder', '#pipelineCronExpr', config?.cronSchedule || '');
  
  document.querySelector('#pipelineModalPrompt').value = config?.prompt || '';
  
  const saveBtn = document.querySelector('#pipelineModalSave');
  const deleteBtn = document.querySelector('#pipelineModalDelete');
  saveBtn.textContent = config ? 'Update Pipeline' : 'Save Pipeline';
  deleteBtn.style.display = config ? 'block' : 'none';

  modal.classList.add('show');
}

async function savePipeline() {
  const projectId = document.querySelector('#pipelineModalProjectId').value;
  const cron = document.querySelector('#pipelineCronExpr').value;
  const prompt = document.querySelector('#pipelineModalPrompt').value;
  const enabled = document.querySelector('#pipelineModalEnabled').checked;

  const btn = document.querySelector('#pipelineModalSave');
  setLoading(btn, true);

  try {
    const data = await apiGet('/api/projects/config');
    const project = (data.projects || []).find(p => p.id === projectId);
    if (!project) throw new Error('Project configuration not found');

    await apiPost('/api/projects/config', {
      ...project,
      pipeline_cron: cron,
      pipeline_prompt: prompt,
      build_pipeline_enabled: enabled ? 1 : 0
    });

    showToast('Pipeline saved');
    document.querySelector('#pipelineModal').classList.remove('show');
    await refreshDashboard();
    if (state.activeView === 'project-detail' && state.selectedProjectDetail === projectId) {
      await fetchProjectDetail(projectId);
    }
  } catch (err) {
    showToast(err.message, true);
  } finally {
    setLoading(btn, false);
  }
}

function openConflictResolverModal(projectId, cron, enabled) {
  const modal = document.querySelector('#conflictResolverModal');
  document.querySelector('#conflictResolverModalProjectId').value = projectId;
  document.querySelector('#conflictResolverModalEnabled').checked = Boolean(enabled);
  
  setCronBuilderFromExpr('#conflictResolverCronBuilder', '#conflictResolverCronExpr', cron || '0 18 * * *');
  modal.classList.add('show');
}

async function saveConflictResolver() {
  const projectId = document.querySelector('#conflictResolverModalProjectId').value;
  const cron = document.querySelector('#conflictResolverCronExpr').value;
  const enabled = document.querySelector('#conflictResolverModalEnabled').checked;

  const btn = document.querySelector('#conflictResolverModalSave');
  setLoading(btn, true);

  try {
    const data = await apiGet('/api/projects/config');
    const project = (data.projects || []).find(p => p.id === projectId);
    if (!project) throw new Error('Project configuration not found');

    await apiPost('/api/projects/config', {
      ...project,
      conflict_resolver_cron: cron,
      conflict_resolver_enabled: enabled ? 1 : 0
    });

    showToast('Conflict resolver settings saved');
    document.querySelector('#conflictResolverModal').classList.remove('show');
    await refreshDashboard();
    if (state.activeView === 'project-detail' && state.selectedProjectDetail === projectId) {
      await fetchProjectDetail(projectId);
    }
  } catch (err) {
    showToast(err.message, true);
  } finally {
    setLoading(btn, false);
  }
}

async function deletePipeline() {
  if (!confirm('Are you sure you want to remove this pipeline?')) return;
  
  const projectId = document.querySelector('#pipelineModalProjectId').value;
  const btn = document.querySelector('#pipelineModalDelete');
  setLoading(btn, true);

  try {
    const data = await apiGet('/api/projects/config');
    const project = (data.projects || []).find(p => p.id === projectId);
    if (!project) throw new Error('Project configuration not found');

    await apiPost('/api/projects/config', {
      id: project.id,
      github_repo: project.github_repo,
      github_branch: project.github_branch,
      github_token: project.github_token,
      pipeline_cron: null,
      pipeline_prompt: null
    });

    showToast('Pipeline removed');
    document.querySelector('#pipelineModal').classList.remove('show');
    await refreshDashboard();
    if (state.activeView === 'project-detail' && state.selectedProjectDetail === projectId) {
      await fetchProjectDetail(projectId);
    }
  } catch (err) {
    showToast(err.message, true);
  } finally {
    setLoading(btn, false);
  }
}

function initAgentDragAndDrop() {
  const grid = el.agentsGrid;
  let dragItem = null;

  grid.addEventListener('dragstart', (e) => {
    dragItem = e.target.closest('.agent-library-card');
    if (dragItem) {
      dragItem.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    }
  });

  grid.addEventListener('dragend', (e) => {
    if (dragItem) {
      dragItem.classList.remove('dragging');
      dragItem = null;
    }
    // Remove all drag-over classes
    grid.querySelectorAll('.agent-library-card').forEach(c => c.classList.remove('drag-over'));
  });

  grid.addEventListener('dragover', (e) => {
    e.preventDefault();
    const overItem = e.target.closest('.agent-library-card');
    if (overItem && overItem !== dragItem) {
      overItem.classList.add('drag-over');
    }
  });

  grid.addEventListener('dragleave', (e) => {
    const overItem = e.target.closest('.agent-library-card');
    if (overItem) overItem.classList.remove('drag-over');
  });

  grid.addEventListener('drop', async (e) => {
    e.preventDefault();
    const dropTarget = e.target.closest('.agent-library-card');
    if (dropTarget && dragItem && dropTarget !== dragItem) {
      const items = Array.from(grid.querySelectorAll('.agent-library-card'));
      const fromIndex = items.indexOf(dragItem);
      const toIndex = items.indexOf(dropTarget);

      // Reorder in state
      const [moved] = state.agents.splice(fromIndex, 1);
      state.agents.splice(toIndex, 0, moved);

      // Save to server
      try {
        const ids = state.agents.map(a => a.id);
        await apiPost('/api/agents/reorder', { ids }, true);
        renderAgentLibrary(); // Re-render to clear any messy DOM states
      } catch (err) {
        showToast(err.message, true);
        await refreshDashboard(); // Revert on failure
      }
    }
  });
}

function renderAgentLibrary() {
  const agents = state.agents;
  const schedulers = state.status?.schedulers || {};
  const runners = state.status?.runners || [];

  // Scheduler chips
  el.schedulerState.innerHTML = '';
  el.schedulerState.append(
    createChip(`Global merge: ${schedulers.globalDailyMerge ? 'ON' : 'OFF'}`, schedulers.globalDailyMerge ? 'ok' : ''),
    createChip(`Auto merge: ${schedulers.autoMergeService ? 'ON' : 'OFF'}`, schedulers.autoMergeService ? 'ok' : ''),
    createChip(`Pipelines: ${(schedulers.perProjectPipelines || []).length}`),
  );

  // Agent library grid
  el.agentsGrid.innerHTML = '';
  if (agents.length === 0) {
    el.agentsGrid.innerHTML = '<div class="empty-state">No agents yet. Create your first agent to get started.</div>';
  } else {
    for (const agent of agents) {
      el.agentsGrid.appendChild(createAgentCard(agent));
    }
  }

  initAgentDragAndDrop();

  // Active runners
  el.runnersGrid.innerHTML = '';
  if (runners.length === 0) {
    el.runnersGrid.innerHTML = '<div class="stack-item muted">No active runners.</div>';
  } else {
    for (const runner of runners) {
      const item = document.createElement('div');
      item.className = 'stack-item';
      item.innerHTML = `
        <div class="row-between">
          <div>
            <strong>${escapeHtml(runner.label || runner.type)}</strong>
            <span class="muted small"> · ${escapeHtml(runner.projectId)} · ${runner.mode}</span>
          </div>
          <div style="display:flex;gap:6px;align-items:center">
            ${runner.tokenInfo ? `<span class="chip" style="background:var(--bg-accent);color:var(--text-dim)">${escapeHtml(runner.tokenInfo.label)}</span>` : ''}
            <span class="chip ${runner.status === 'running' ? 'ok' : runner.status === 'failed' ? 'bad' : ''}">${runner.status}</span>
            <button class="btn btn-ghost btn-small" data-action="view-session" data-runner="${runner.id}" ${!runner.sessionId ? 'disabled' : ''}>Session</button>
            <button class="btn btn-ghost btn-small" data-action="stop-runner-agents" data-runner="${runner.id}">Stop</button>
          </div>
        </div>
        <p class="muted small">iterations: ${runner.iterations || 0} · errors: ${runner.errorCount || 0} · last beat: ${fmtSince(runner.lastHeartbeatAt)} ago</p>
      `;
      el.runnersGrid.appendChild(item);
    }
  }
}

function createAgentCard(agent) {
  const card = document.createElement('article');
  card.className = 'agent-library-card';
  card.draggable = true;
  card.dataset.id = agent.id;
  
  const preview = agent.prompt ? agent.prompt.substring(0, 120) + (agent.prompt.length > 120 ? '…' : '') : '';
  card.innerHTML = `
    <div class="agent-card-accent" style="background:${agent.color || '#3f8cff'}"></div>
    <div class="agent-card-body">
      <div class="row-between">
        <div style="display:flex;align-items:center;gap:8px">
          <h3 class="agent-card-name">${escapeHtml(agent.name)}</h3>
          <div class="drag-handle" title="Drag to reorder">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 6h2v2H8V6zm5 0h2v2h-2V6zm-5 5h2v2H8v-2zm5 0h2v2h-2v-2zm-5 5h2v2H8v-2zm5 0h2v2h-2v-2z" />
            </svg>
          </div>
        </div>
        <div style="display:flex;gap:6px">
          <button class="btn btn-ghost btn-small" data-action="edit-agent" data-agent="${agent.id}">Edit</button>
          <button class="btn btn-danger btn-small" data-action="delete-agent" data-agent="${agent.id}">Delete</button>
        </div>
      </div>
      ${agent.description ? `<p class="muted small" style="margin:.25rem 0">${escapeHtml(agent.description)}</p>` : ''}
      <p class="agent-prompt-preview">${escapeHtml(preview)}</p>
    </div>
  `;
  return card;
}

// =========================================================
// Sessions
// =========================================================
function renderSessions() {
  const runners = state.status?.runners || [];
  const cRunning = runners.filter(r => r.status === 'running').length;
  const cFailed = runners.filter(r => r.status === 'failed').length;
  const cDone = runners.filter(r => r.status !== 'running' && r.status !== 'failed').length;

  el.sessionSummary.innerHTML = '';
  el.sessionSummary.append(
    createChip(`Total ${runners.length}`),
    createChip(`Running ${cRunning}`, 'ok'),
    createChip(`Done ${cDone}`),
    createChip(`Failed ${cFailed}`, cFailed > 0 ? 'bad' : ''),
  );

  const wasScrolledToTop = window.scrollY < 5;
  const oldPageHeight = wasScrolledToTop ? document.body.scrollHeight : 0;

  el.sessionsRows.innerHTML = '';
  if (runners.length === 0) {
    el.sessionsRows.innerHTML = '<tr><td colspan="5" class="muted">No sessions.</td></tr>';
    return;
  }
  for (const r of runners) {
    const tr = document.createElement('tr');
    // Extract a cleaner display name for the session/agent
    const displayName = r.label || r.type || 'Jules Agent';
    const shortId = r.sessionId ? r.sessionId.split('/').pop() : '-';
    const julesUrl = r.sessionId ? `https://jules.google.com/session/${shortId}` : null;
    const keyLabel = r.tokenInfo?.label || '<span class="muted small">—</span>';

    tr.innerHTML = `
      <td>
        <strong>${escapeHtml(displayName)}</strong>
        <p class="muted small mono">${escapeHtml(r.projectId)}</p>
      </td>
      <td>
        ${julesUrl ? `<a href="${julesUrl}" target="_blank" rel="noopener" class="pr-link mono small">${shortId} ↗</a>` : '<span class="muted small">—</span>'}
      </td>
      <td>${keyLabel}</td>
      <td><span class="chip ${r.status === 'running' ? 'ok' : r.status === 'failed' ? 'bad' : ''}">${r.status}</span></td>
      <td>${fmtSince(r.startedAt)}</td>
      <td>
        <button class="btn btn-ghost btn-small" data-action="view-session" data-runner="${r.id}" ${!r.sessionId ? 'disabled' : ''}>Logs</button>
      </td>
    `;

    el.sessionsRows.appendChild(tr);
  }

  if (wasScrolledToTop) {
    const newPageHeight = document.body.scrollHeight;
    window.scrollBy(0, newPageHeight - oldPageHeight);
  }
}

// =========================================================
// Health
// =========================================================
function renderHealth() {
  const keys = state.keys?.keys || [];
  const services = state.health?.services || [];

  el.keysSummary.textContent = state.keys?.message || 'No token info.';
  el.tokenUsageList.innerHTML = '';
  for (const key of keys) {
    const used = Number(key.usage24h || 0);
    const max = Number(key.limit24h || 100);
    const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
    const item = document.createElement('div');
    item.className = 'stack-item';
    item.innerHTML = `
      <div class="row-between">
        <div style="display:flex;align-items:center;gap:6px">
          <strong>${escapeHtml(key.label || key.id)}</strong>
          <button class="btn btn-icon-mini" data-action="rename-token" data-token-index="${key.index}" title="Rename">✎</button>
        </div>
        <span class="mono">${used}/${max}</span>
      </div>
      <div class="bars" style="height:12px;margin-top:8px;padding:2px">
        <div class="bar" style="height:100%;max-width:${pct}%;flex:0 0 ${pct}%;background:${pct > 85 ? '#ff5f7b' : pct > 65 ? '#e7a321' : '#16d68f'}"></div>
      </div>
    `;
    el.tokenUsageList.appendChild(item);
  }
  if (keys.length === 0) el.tokenUsageList.innerHTML = '<div class="stack-item muted">No keys configured.</div>';

  el.serviceStatusList.innerHTML = '';
  for (const s of services) {
    const expanded = Boolean(state.expandedServiceErrors[s.id]);
    const hasErrors = Number(s.errors || 0) > 0;
    const line = document.createElement('div');
    line.className = 'stack-item';
    line.innerHTML = `
      <div class="row-between">
        <span>${escapeHtml(s.label)}</span>
        <div style="display:flex;gap:8px;align-items:center">
          <span class="mono muted">${s.latencyMs != null ? `${s.latencyMs}ms` : '-'}</span>
          <span class="chip ${hasErrors ? 'warn' : 'ok'}">${hasErrors ? 'DEGRADED' : 'OK'}</span>
        </div>
      </div>
      <div style="margin-top:8px">
        ${!hasErrors
          ? '<span class="chip ok">No errors</span>'
          : `<button class="btn btn-ghost" data-action="toggle-service-errors" data-service="${s.id}">${s.errors} error(s) in ${s.windowHours}h ${expanded ? '▲' : '▼'}</button>`
        }
      </div>
    `;
    if (expanded && hasErrors) {
      const list = document.createElement('div');
      list.style.marginTop = '10px';
      for (const err of (s.recentErrors || [])) {
        const row = document.createElement('div');
        row.className = 'stack-item';
        row.innerHTML = `<div class="row-between"><span class="mono small">${fmtDate(err.timestamp)}</span><span class="chip warn">${err.code || 'ERR'}</span></div><p class="muted small">${escapeHtml(err.message || '')}</p>`;
        list.appendChild(row);
      }
      line.appendChild(list);
    }
    el.serviceStatusList.appendChild(line);
  }
  if (services.length === 0) el.serviceStatusList.innerHTML = '<div class="stack-item muted">No health data.</div>';

  el.requestVolumeBars.innerHTML = '';
  const values = (state.metrics?.series?.active_runners || []).slice(-40).map(i => Number(i.value || 0));
  const max = Math.max(1, ...values);
  for (const v of values) {
    const b = document.createElement('span');
    b.className = 'bar';
    b.style.height = `${Math.max(6, Math.round((v / max) * 100))}%`;
    b.title = String(v);
    el.requestVolumeBars.appendChild(b);
  }
  if (values.length === 0) el.requestVolumeBars.innerHTML = '<span class="muted">No data yet.</span>';

  renderLogs();
}

function renderLogs() {
  if (!el.systemConsole) return;
  const logs = state.logs || [];
  
  const consoleEl = el.systemConsole;
  
  // Only re-render if count changed or empty to avoid jitter
  if (consoleEl.children.length === logs.length && logs.length > 0) return;

  const wasNearBottom = consoleEl.scrollHeight - consoleEl.scrollTop - consoleEl.clientHeight < 50;

  consoleEl.innerHTML = '';
  // Logs are unshifted (newest first) in CC, but we want to show them in order in a console
  const displayLogs = [...logs].reverse();

  for (const log of displayLogs) {
    const div = document.createElement('div');
    div.className = `log-line level-${log.level}`;
    
    const time = new Date(log.at).toLocaleTimeString();
    const metaStr = Object.keys(log.meta || {}).length ? JSON.stringify(log.meta) : '';

    div.innerHTML = `
      <span class="log-time">${time}</span>
      <span class="log-level level-${log.level}">${log.level}</span>
      <span class="log-msg">${escapeHtml(log.message)}</span>
      ${metaStr ? `<span class="log-meta">${escapeHtml(metaStr)}</span>` : ''}
    `;
    consoleEl.appendChild(div);
  }

  if (logs.length === 0) {
    consoleEl.innerHTML = '<div class="muted">No logs available.</div>';
  } else if (wasNearBottom) {
    // Auto-scroll to bottom
    consoleEl.scrollTop = consoleEl.scrollHeight;
  }
}

// =========================================================
// Users
// =========================================================
function renderUsers() {
  el.usersRows.innerHTML = '';
  if (state.usersError) {
    el.usersNotice.textContent = `Users unavailable: ${state.usersError}`;
    return;
  }
  el.usersNotice.textContent = `${state.users.length} users`;
  for (const u of state.users) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${escapeHtml(u.email)}</strong></td>
      <td><span class="role-pill role-${u.role}">${u.role}</span></td>
      <td>${fmtDate(u.createdAt)}</td>
      <td>${fmtDate(u.lastLoginAt)}</td>
      <td>
        <button class="btn btn-ghost btn-small" data-action="change-role" data-user="${u.id}" data-email="${escapeHtml(u.email)}">Role</button>
        <button class="btn btn-danger btn-small" data-action="delete-user" data-user="${u.id}" data-email="${escapeHtml(u.email)}">Delete</button>
      </td>
    `;
    el.usersRows.appendChild(tr);
  }
  if (state.users.length === 0) el.usersRows.innerHTML = '<tr><td colspan="5" class="muted">No users.</td></tr>';
}

// =========================================================
// Agent Modal
// =========================================================
function openAgentModal(agent = null) {
  const modal = document.querySelector('#agentModal');
  document.querySelector('#agentModalTitle').textContent = agent ? 'Edit Agent' : 'Create Agent';
  document.querySelector('#agentModalId').value = agent?.id || '';
  document.querySelector('#agentModalName').value = agent?.name || '';
  document.querySelector('#agentModalDesc').value = agent?.description || '';
  document.querySelector('#agentModalPrompt').value = agent?.prompt || '';
  document.querySelector('#agentModalColor').value = agent?.color || '#3f8cff';

  // Color picker
  const picker = document.querySelector('#agentModalColorPicker');
  picker.innerHTML = '';
  for (const c of AGENT_COLORS) {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'color-dot';
    dot.style.background = c;
    dot.style.outline = c === (agent?.color || '#3f8cff') ? '3px solid white' : 'none';
    dot.addEventListener('click', () => {
      document.querySelector('#agentModalColor').value = c;
      picker.querySelectorAll('.color-dot').forEach(d => d.style.outline = 'none');
      dot.style.outline = '3px solid white';
    });
    picker.appendChild(dot);
  }

  modal.classList.add('show');
}

async function saveAgent() {
  const id = document.querySelector('#agentModalId').value;
  const name = document.querySelector('#agentModalName').value.trim();
  const description = document.querySelector('#agentModalDesc').value.trim();
  const prompt = document.querySelector('#agentModalPrompt').value.trim();
  const color = document.querySelector('#agentModalColor').value;

  if (!name) return showToast('Name is required', true);
  if (!prompt) return showToast('Prompt is required', true);

  const btn = document.querySelector('#agentModalSave');
  setLoading(btn, true);
  try {
    if (id) {
      await apiPut(`/api/agents/${id}`, { name, description, prompt, color });
      showToast('Agent updated');
    } else {
      await apiPost('/api/agents', { name, description, prompt, color });
      showToast('Agent created');
    }
    closeModal('#agentModal');
    await refreshDashboard();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    setLoading(btn, false);
  }
}

// =========================================================
// Cron Builder
// =========================================================
function initCronBuilder(containerSelector, hiddenInputSelector) {
  const container = document.querySelector(containerSelector);
  if (!container) return;

  // Set default state if not already set
  container.dataset.cronFreq = container.dataset.cronFreq || 'daily';

  // Populate hour selects
  ['.cronDailyHour', '.cronWeeklyHour'].forEach(cls => {
    const sel = container.querySelector(cls);
    if (!sel || sel.options.length) return;
    for (let h = 0; h < 24; h++) {
      const o = document.createElement('option');
      o.value = h;
      o.textContent = String(h).padStart(2, '0');
      sel.appendChild(o);
    }
    sel.value = 9;
  });

  // Populate minute selects (0, 15, 30, 45)
  ['.cronDailyMin', '.cronWeeklyMin'].forEach(cls => {
    const sel = container.querySelector(cls);
    if (!sel || sel.options.length) return;
    [0, 15, 30, 45].forEach(m => {
      const o = document.createElement('option');
      o.value = m;
      o.textContent = String(m).padStart(2, '0');
      sel.appendChild(o);
    });
    sel.value = 0;
  });

  // Freq tab switching
  container.querySelectorAll('.cron-freq-btn').forEach(btn => {
    // remove existing listeners if any (by cloning)
    const newBtn = btn.cloneNode(true);
    btn.replaceWith(newBtn);
    newBtn.addEventListener('click', () => {
      container.querySelectorAll('.cron-freq-btn').forEach(b => b.classList.remove('is-active'));
      newBtn.classList.add('is-active');
      container.dataset.cronFreq = newBtn.dataset.freq;
      if (container.querySelector('.cronPanelDaily')) container.querySelector('.cronPanelDaily').style.display = container.dataset.cronFreq === 'daily' ? '' : 'none';
      if (container.querySelector('.cronPanelWeekly')) container.querySelector('.cronPanelWeekly').style.display = container.dataset.cronFreq === 'weekly' ? '' : 'none';
      if (container.querySelector('.cronPanelHourly')) container.querySelector('.cronPanelHourly').style.display = container.dataset.cronFreq === 'hourly' ? '' : 'none';
      if (container.querySelector('.cronPreviewRow')) container.querySelector('.cronPreviewRow').style.display = container.dataset.cronFreq === 'none' ? 'none' : 'flex';
      updateCronPreview(container, hiddenInputSelector);
    });
  });

  // Day picker toggles
  container.querySelectorAll('.cron-day-btn').forEach(btn => {
    const newBtn = btn.cloneNode(true);
    btn.replaceWith(newBtn);
    newBtn.addEventListener('click', () => {
      newBtn.classList.toggle('is-active');
      updateCronPreview(container, hiddenInputSelector);
    });
  });

  // Live update on time changes
  ['.cronDailyHour', '.cronDailyMin', '.cronWeeklyHour', '.cronWeeklyMin', '.cronHourlyN'].forEach(cls => {
    const el = container.querySelector(cls);
    if (el) {
      const newEl = el.cloneNode(true);
      el.replaceWith(newEl);
      newEl.addEventListener('change', () => updateCronPreview(container, hiddenInputSelector));
      newEl.addEventListener('input', () => updateCronPreview(container, hiddenInputSelector));
    }
  });

  updateCronPreview(container, hiddenInputSelector);
}

function updateCronPreview(container, hiddenInputSelector) {
  const expr = buildCronExpression(container);
  const previewEl = container.querySelector('.cronPreviewExpr');
  const hiddenEl = document.querySelector(hiddenInputSelector);
  if (previewEl) previewEl.textContent = expr;
  if (hiddenEl) hiddenEl.value = expr;
}

function buildCronExpression(container) {
  const freq = container.dataset.cronFreq || 'daily';
  if (freq === 'none') {
    return '';
  }
  if (freq === 'daily') {
    const h = container.querySelector('.cronDailyHour')?.value ?? 9;
    const m = container.querySelector('.cronDailyMin')?.value ?? 0;
    return `${m} ${h} * * *`;
  }
  if (freq === 'weekly') {
    const h = container.querySelector('.cronWeeklyHour')?.value ?? 9;
    const m = container.querySelector('.cronWeeklyMin')?.value ?? 0;
    const days = [...container.querySelectorAll('.cron-day-btn.is-active')].map(b => b.dataset.day);
    const dayStr = days.length ? days.join(',') : '1';
    return `${m} ${h} * * ${dayStr}`;
  }
  if (freq === 'hourly') {
    const n = Number(container.querySelector('.cronHourlyN')?.value) || 6;
    return `0 */${n} * * *`;
  }
  return '0 9 * * *';
}

function setCronBuilderFromExpr(containerSelector, hiddenInputSelector, expr) {
  const container = document.querySelector(containerSelector);
  if (!container) return;

  if (!expr) { 
    container.dataset.cronFreq = 'none'; 
    switchCronFreqTab(container, 'none'); 
    updateCronPreview(container, hiddenInputSelector);
    return; 
  }
  const parts = expr.split(' ');
  if (parts.length !== 5) return;
  const [min, hour, , , dow] = parts;

  if (dow !== '*' && hour !== '*') {
    container.dataset.cronFreq = 'weekly';
    switchCronFreqTab(container, 'weekly');
    container.querySelector('.cronWeeklyHour').value = hour;
    container.querySelector('.cronWeeklyMin').value = min;
    const activeDays = dow.split(',');
    container.querySelectorAll('.cron-day-btn').forEach(b => {
      b.classList.toggle('is-active', activeDays.includes(b.dataset.day));
    });
  } else if (hour.startsWith('*/') && container.querySelector('.cronHourlyN')) {
    container.dataset.cronFreq = 'hourly';
    switchCronFreqTab(container, 'hourly');
    container.querySelector('.cronHourlyN').value = hour.replace('*/', '');
  } else {
    container.dataset.cronFreq = 'daily';
    switchCronFreqTab(container, 'daily');
    container.querySelector('.cronDailyHour').value = hour;
    container.querySelector('.cronDailyMin').value = min;
  }
  updateCronPreview(container, hiddenInputSelector);
}

function switchCronFreqTab(container, freq) {
  container.querySelectorAll('.cron-freq-btn').forEach(b => b.classList.toggle('is-active', b.dataset.freq === freq));
  if (container.querySelector('.cronPanelDaily')) container.querySelector('.cronPanelDaily').style.display = freq === 'daily' ? '' : 'none';
  if (container.querySelector('.cronPanelWeekly')) container.querySelector('.cronPanelWeekly').style.display = freq === 'weekly' ? '' : 'none';
  if (container.querySelector('.cronPanelHourly')) container.querySelector('.cronPanelHourly').style.display = freq === 'hourly' ? '' : 'none';
  if (container.querySelector('.cronPreviewRow')) container.querySelector('.cronPreviewRow').style.display = freq === 'none' ? 'none' : 'flex';
}

// =========================================================
// Assignment Modal
// =========================================================
function openAssignmentModal(projectId, existing = null) {
  const modal = document.querySelector('#assignmentModal');
  if (!modal) return;
  document.querySelector('#assignmentModalTitle').textContent = existing ? 'Edit Assignment' : 'Add Assignment';
  document.querySelector('#assignmentModalId').value = existing?.id || '';
  document.querySelector('#assignmentModalProjectId').value = projectId;

  // Populate agent dropdown
  const sel = document.querySelector('#assignmentModalAgent');
  const agents = state.agents || [];
  const agentOptions = agents.map(a => `<option value="${a.id}" ${existing?.agent_id === a.id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('');
  sel.innerHTML = `<option value="custom" ${existing && !existing.agent_id ? 'selected' : ''}>-- Custom --</option>${agentOptions}`;

  const customBox = document.querySelector('#assignCustomPromptBox');
  const customInput = document.querySelector('#assignCustomPrompt');
  if (customInput) customInput.value = existing?.custom_prompt || '';
  
  if (sel) {
    sel.onchange = () => {
      if (customBox) customBox.style.display = sel.value === 'custom' ? '' : 'none';
    };
    sel.onchange();
  }

  // Mode
  const mode = existing?.mode || 'loop';
  document.querySelectorAll('input[name="assignMode"]').forEach(r => { r.checked = r.value === mode; });
  updateAssignmentModeUI(mode);

  // Loop pause
  const pauseMs = existing?.loop_pause_ms || 300000;
  const isHours = pauseMs >= 3600000 && pauseMs % 3600000 === 0;
  const pauseUnitEl = document.querySelector('#assignLoopPauseUnit');
  const pauseValEl = document.querySelector('#assignLoopPauseVal');
  if (pauseUnitEl) pauseUnitEl.value = isHours ? '3600000' : '60000';
  if (pauseValEl) pauseValEl.value = isHours ? pauseMs / 3600000 : Math.round(pauseMs / 60000);

  // Cron builder
  setCronBuilderFromExpr('#assignCronBuilder', '#assignCronExpr', existing?.cron_schedule || '');

  // Concurrent instances
  const concurrencyEl = document.querySelector('#assignConcurrency');
  if (concurrencyEl) concurrencyEl.value = existing?.concurrency || 1;

  modal.classList.add('show');
}

function updateAssignmentModeUI(mode) {
  document.querySelector('#assignLoopConfig').style.display = mode === 'loop' ? '' : 'none';
  document.querySelector('#assignCronConfig').style.display = mode === 'scheduled' ? '' : 'none';
}

async function saveAssignment() {
  const id = document.querySelector('#assignmentModalId').value;
  const projectId = document.querySelector('#assignmentModalProjectId').value;
  const agentVal = document.querySelector('#assignmentModalAgent').value;
  const agent_id = agentVal === 'custom' ? null : Number(agentVal);
  const custom_prompt = agentVal === 'custom' ? document.querySelector('#assignCustomPrompt').value : null;
  const mode = document.querySelector('input[name="assignMode"]:checked')?.value || 'loop';
  const pauseVal = Number(document.querySelector('#assignLoopPauseVal').value) || 5;
  const pauseUnit = Number(document.querySelector('#assignLoopPauseUnit').value) || 60000;
  const loop_pause_ms = pauseVal * pauseUnit;
  const cron_schedule = document.querySelector('#assignCronExpr').value.trim() || null;
  const concurrency = Number(document.querySelector('#assignConcurrency').value) || 1;

  if (agentVal === 'custom' && !custom_prompt?.trim()) return showToast('Enter custom instructions', true);
  if (mode === 'scheduled' && !cron_schedule) return showToast('Cron schedule is required', true);

  const btn = document.querySelector('#assignmentModalSave');
  setLoading(btn, true);
  try {
    const payload = { 
      agent_id, 
      custom_prompt,
      mode, 
      loop_pause_ms, 
      cron_schedule,
      concurrency
    };

    if (id) {
      await apiPut(`/api/assignments/${id}`, payload);
      showToast('Assignment updated');
    } else {
      await apiPost(`/api/projects/${projectId}/assignments`, payload);
      showToast('Assignment created and started');
    }
    closeModal('#assignmentModal');
    await fetchProjectDetail(projectId);
    await refreshDashboard();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    setLoading(btn, false);
  }
}

// =========================================================
// Run Agent Once Modal
// =========================================================
function openRunAgentModal(projectId) {
  const modal = document.querySelector('#runAgentModal');
  document.querySelector('#runAgentModalProjectId').value = projectId;
  document.querySelector('#runAgentModalProjectLabel').textContent = `Project: ${projectId}`;
  document.querySelector('#runAgentModalInstructions').value = '';
  document.querySelector('#runAgentModalMedia').value = '';

  const sel = document.querySelector('#runAgentModalSelect');
  const agentOptions = state.agents.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
  sel.innerHTML = `<option value="custom">-- Custom Prompt --</option>${agentOptions}`;

  function updatePreview() {
    const val = sel.value;
    const isCustom = val === 'custom';
    document.querySelector('#runAgentModalCustomBox').style.display = isCustom ? '' : 'none';
    
    const preview = document.querySelector('#runAgentModalPreview');
    if (isCustom) {
      preview.textContent = '';
    } else {
      const agent = state.agents.find(a => a.id === Number(val));
      preview.textContent = agent?.prompt ? agent.prompt.substring(0, 200) + (agent.prompt.length > 200 ? '…' : '') : '';
    }
  }
  sel.onchange = updatePreview;
  updatePreview();
  modal.classList.add('show');
}

async function confirmRunAgent() {
  const projectId = document.querySelector('#runAgentModalProjectId').value;
  const agentId = document.querySelector('#runAgentModalSelect').value;
  const customInstructions = document.querySelector('#runAgentModalInstructions').value.trim();
  const mediaFiles = document.querySelector('#runAgentModalMedia').files;

  if (agentId === 'custom' && !customInstructions) {
    return showToast('Please provide custom instructions', true);
  }

  const btn = document.querySelector('#runAgentModalConfirm');
  setLoading(btn, true);
  try {
    // Process media files to base64
    const media = [];
    for (let i = 0; i < mediaFiles.length; i++) {
      const file = mediaFiles[i];
      const base64 = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.readAsDataURL(file);
      });
      media.push({
        inlineData: {
          mimeType: file.type,
          data: base64
        }
      });
    }

    await apiPost(`/api/projects/${projectId}/agents/${agentId}/run-once`, {
      instructions: agentId === 'custom' ? customInstructions : null,
      media: media.length > 0 ? media : null
    });

    showToast('Agent session launched!');
    closeModal('#runAgentModal');
    await refreshDashboard();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    setLoading(btn, false);
  }
}

// =========================================================
// Add Project Modal
// =========================================================
function openProjectModal(projectId = null) {
  const modal = document.querySelector('#projectModal');
  const title = document.querySelector('#projectModal h2');
  const saveBtn = document.querySelector('#projectModalSave');
  const idInput = document.querySelector('#projectModalId');
  
  if (projectId) {
    const p = (state.status?.projects || []).find(x => x.id === projectId);
    title.textContent = 'Edit Project';
    saveBtn.textContent = 'Save Changes';
    idInput.value = projectId;
    idInput.disabled = true;
    document.querySelector('#projectModalRepo').value = p?.githubRepo || '';
    document.querySelector('#projectModalBranch').value = p?.githubBranch || 'main';
    document.querySelector('#projectModalToken').value = ''; // Don't show token
    // We might need to fetch the full config for cron/prompt
    apiGet('/api/projects/config').then(data => {
      const config = (data.projects || []).find(x => x.id === projectId);
      document.querySelector('#projectModalPipelineCron').value = config?.pipeline_cron || '';
      document.querySelector('#projectModalPipelinePrompt').value = config?.pipeline_prompt || '';
    });
  } else {
    title.textContent = 'Add Project';
    saveBtn.textContent = 'Add Project';
    idInput.value = '';
    idInput.disabled = false;
    document.querySelectorAll('#projectModal input, #projectModal textarea').forEach(i => { i.value = ''; });
    document.querySelector('#projectModalBranch').value = 'main';
  }
  modal.classList.add('show');
}

async function saveProject() {
  const id = document.querySelector('#projectModalId').value.trim();
  const github_repo = document.querySelector('#projectModalRepo').value.trim();
  const github_branch = document.querySelector('#projectModalBranch').value.trim() || 'main';
  const github_token = document.querySelector('#projectModalToken').value.trim() || null;
  const pipeline_cron = document.querySelector('#projectModalPipelineCron').value.trim() || null;
  const pipeline_prompt = document.querySelector('#projectModalPipelinePrompt').value.trim() || null;

  if (!id) return showToast('Project ID is required', true);
  if (!github_repo) return showToast('GitHub repo is required', true);

  const isEdit = document.querySelector('#projectModalId').disabled;
  const btn = document.querySelector('#projectModalSave');
  setLoading(btn, true);
  try {
    const payload = { id, github_repo, github_branch, github_token, pipeline_cron, pipeline_prompt };
    if (isEdit) {
      await apiPut(`/api/projects/${id}`, payload);
      showToast('Project updated');
    } else {
      await apiPost('/api/projects/config', payload);
      showToast('Project added');
    }
    closeModal('#projectModal');
    await refreshDashboard();
    if (state.selectedProjectDetail === id) await fetchProjectDetail(id);
  } catch (err) {
    showToast(err.message, true);
  } finally {
    setLoading(btn, false);
  }
}

// =========================================================
// Modal helpers
// =========================================================
function closeModal(selector) {
  document.querySelector(selector)?.classList.remove('show');
}

function initModals() {
  // Close on .modal-close click or overlay click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.classList.remove('show');
    });
    overlay.querySelectorAll('.modal-close').forEach(btn => {
      btn.addEventListener('click', () => overlay.classList.remove('show'));
    });
  });

  document.querySelector('#closeErrorModal')?.addEventListener('click', () => closeModal('#errorModal'));
  document.querySelector('#agentModalSave')?.addEventListener('click', saveAgent);
  document.querySelector('#assignmentModalSave')?.addEventListener('click', saveAssignment);
  document.querySelector('#runAgentModalConfirm')?.addEventListener('click', confirmRunAgent);
  document.querySelector('#projectModalSave')?.addEventListener('click', saveProject);
  document.querySelector('#pipelineModalSave')?.addEventListener('click', savePipeline);
  document.querySelector('#pipelineModalDelete')?.addEventListener('click', deletePipeline);
  document.querySelector('#conflictResolverModalSave')?.addEventListener('click', saveConflictResolver);

  // Mode radio toggle in assignment modal
  document.querySelectorAll('input[name="assignMode"]').forEach(r => {
    r.addEventListener('change', () => updateAssignmentModeUI(r.value));
  });

  // Cron builder
  initCronBuilder('#assignCronBuilder', '#assignCronExpr');
  initCronBuilder('#pipelineCronBuilder', '#pipelineCronExpr');
  initCronBuilder('#conflictResolverCronBuilder', '#conflictResolverCronExpr');
}

// =========================================================
// Global event delegation
// =========================================================
function initGlobalActions() {
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === 'edit-agent') {
      const agent = state.agents.find(a => a.id === Number(btn.dataset.agent));
      openAgentModal(agent);
    } else if (action === 'delete-agent') {
      const agent = state.agents.find(a => a.id === Number(btn.dataset.agent));
      if (!confirm(`Delete agent "${agent?.name}"?`)) return;
      setLoading(btn, true);
      try {
        await apiDelete(`/api/agents/${btn.dataset.agent}`, true);
        showToast('Agent deleted');
        await refreshDashboard();
      } catch (err) { showToast(err.message, true); }
      setLoading(btn, false);
    } else if (action === 'view-session' && !btn.closest('[id^="projectDetailContent"]')) {
      // Global agents view — runner has no projectId context
      openSessionDrawer(btn.dataset.runner, null);
    } else if (action === 'stop-runner-agents') {
      setLoading(btn, true);
      try {
        await apiPost(`/api/runners/${btn.dataset.runner}/stop`, null, true);
        showToast('Runner stopped');
        await refreshDashboard();
      } catch (err) { showToast(err.message, true); }
      setLoading(btn, false);
    } else if (action === 'toggle-service-errors') {
      state.expandedServiceErrors[btn.dataset.service] = !state.expandedServiceErrors[btn.dataset.service];
      renderHealth();
    } else if (action === 'rename-token') {
      const idx = Number(btn.dataset.tokenIndex || 0);
      const cur = (state.keys?.keys || []).find(k => k.index === idx);
      const name = window.prompt('Token label:', cur?.label || `Token ${idx + 1}`);
      if (!name?.trim()) return;
      try {
        await apiPut(`/api/token-names/${idx}`, { customName: name.trim() });
        showToast('Token renamed');
        await refreshDashboard();
      } catch (err) { showToast(err.message, true); }
    } else if (action === 'connect-source') {
      const repoPath = btn.dataset.repo;
      const parts = repoPath.split('/');
      const id = parts[parts.length - 1] || repoPath.replace('/', '-');
      document.querySelector('#projectModalId').value = id;
      document.querySelector('#projectModalRepo').value = repoPath;
      document.querySelector('#projectModal').classList.add('show');
    } else if (action === 'change-role') {
      const userId = btn.dataset.user;
      const role = window.prompt(`New role for ${btn.dataset.email}:`, 'viewer');
      if (!role) return;
      try {
        await fetch(`/api/users/${userId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }) });
        showToast('Role updated');
        await refreshDashboard();
      } catch (err) { showToast(err.message, true); }
    } else if (action === 'delete-user') {
      if (!confirm(`Delete ${btn.dataset.email}?`)) return;
      try {
        await apiDelete(`/api/users/${btn.dataset.user}`, true);
        showToast('User deleted');
        await refreshDashboard();
      } catch (err) { showToast(err.message, true); }
    }
  });
}

// =========================================================
// Clock
// =========================================================
function startClock() {
  function tick() {
    el.clockLabel.textContent = new Date().toLocaleTimeString();
  }
  tick();
  clockTimer = setInterval(tick, 1000);
}

// =========================================================
// Init
// =========================================================
async function init() {
  // Restore view — URL params take priority over localStorage
  const urlParams = new URLSearchParams(window.location.search);
  const urlView = urlParams.get('view');
  const urlProject = urlParams.get('project');
  if (urlProject) state.selectedProjectDetail = urlProject;
  const savedView = (urlProject ? 'project-detail' : urlView) || localStorage.getItem('jules_view') || 'overview';

  // Modals
  initModals();
  initGlobalActions();
  initSessionDrawer();

  // Nav clicks
  el.navItems.forEach(item => {
    item.addEventListener('click', () => switchView(item.dataset.view));
  });

  // Refresh btn
  el.refreshBtn?.addEventListener('click', async () => {
    setLoading(el.refreshBtn, true);
    const tasks = [refreshDashboard()];
    if (state.activeView === 'project-detail' && state.selectedProjectDetail) {
      tasks.push(fetchProjectDetail(state.selectedProjectDetail));
      tasks.push(loadPRs(state.selectedProjectDetail));
    }
    await Promise.allSettled(tasks);
    setLoading(el.refreshBtn, false);
  });

  // Logout
  el.logoutBtn?.addEventListener('click', async () => {
    await fetch('/auth/logout', { method: 'POST' }).catch(() => {});
    window.location.replace('/login');
  });

  // System toggle (start/stop all)
  el.systemToggleBtn?.addEventListener('click', async () => {
    const isOnline = el.systemToggleBtn.textContent.includes('ONLINE');
    try {
      if (isOnline) {
        await apiPost('/api/stop', null, true);
        el.systemToggleBtn.textContent = 'System OFFLINE';
      } else {
        await apiPost('/api/start');
        el.systemToggleBtn.textContent = 'System ONLINE';
      }
      await refreshDashboard();
    } catch (err) { showToast(err.message, true); }
  });

  // Create agent btn
  el.createAgentBtn?.addEventListener('click', () => openAgentModal());

  // Add project btn
  el.addProjectBtn?.addEventListener('click', () => {
    openProjectModal();
  });

  // Refresh sources btn
  el.refreshSourcesBtn?.addEventListener('click', fetchJulesSources);

  // Invite user btn
  el.inviteUserBtn?.addEventListener('click', async () => {
    const email = window.prompt('Email:');
    if (!email) return;
    const password = window.prompt('Password:');
    if (!password) return;
    const role = window.prompt('Role (admin/operator/viewer):', 'viewer');
    if (!role) return;
    try {
      await apiPost('/api/users', { email, password, role });
      showToast('User created');
      await refreshDashboard();
    } catch (err) { showToast(err.message, true); }
  });

  // Sources table connect
  el.julesSourcesRows?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action="connect-source"]');
    if (!btn) return;
    const repoPath = btn.dataset.repo;
    const parts = repoPath.split('/');
    const id = parts[parts.length - 1] || repoPath.replace('/', '-');
    document.querySelector('#projectModalId').value = id;
    document.querySelector('#projectModalRepo').value = repoPath;
    document.querySelector('#projectModal').classList.add('show');
  });

  startClock();
  switchView(savedView);
  await refreshDashboard();

  // Auto-poll every 15s
  pollTimer = setInterval(async () => {
    await refreshDashboard();
    if (state.activeView === 'project-detail' && state.selectedProjectDetail) {
      await fetchProjectDetail(state.selectedProjectDetail);
    }
  }, 15000);
}

// Check auth first
fetch('/api/status').then(res => {
  if (res.status === 401) window.location.replace('/login');
  else init();
}).catch(() => init());

function renderPipelineTimeline(project) {
  const pipelineReasons = ['pipeline', 'pipeline-timeout', 'pipeline-work', 'pipeline-wrapup', 'pipeline-buffer'];
  if (!project.locked || !pipelineReasons.includes(project.lockReason)) {
    return '';
  }

  const lockedAt = new Date(project.lockedAt);
  const elapsedMin = Math.round((Date.now() - (project.lockedAt || Date.now())) / 60000);
  
  const reason = project.lockReason;
  const isTimeout = reason === 'pipeline-timeout';
  const isWork = reason === 'pipeline-work' || reason === 'pipeline';
  const isWrapup = reason === 'pipeline-wrapup';
  const isBuffer = reason === 'pipeline-buffer';

  return `
    <div class="pipeline-timeline-card">
      <div class="pipeline-timeline-header">
        <span class="pipeline-timeline-title">Pipeline in Progress</span>
        <span class="pipeline-timeline-elapsed">${elapsedMin}m elapsed</span>
      </div>
      <div class="pipeline-timeline-body">
        <div class="pipeline-step is-complete">
          <div class="step-icon">🔒</div>
          <div class="step-content">
            <p class="step-label">Project Locked</p>
            <p class="step-time">${lockedAt.toLocaleTimeString()}</p>
          </div>
        </div>
        
        <div class="pipeline-step ${isTimeout ? 'is-warning' : 'is-complete'}">
          <div class="step-icon">${isTimeout ? '⚠️' : '⏳'}</div>
          <div class="step-content">
            <p class="step-label">${isTimeout ? 'Forced Lock' : 'Ready'}</p>
            <p class="step-desc">${isTimeout ? 'Agents killed.' : 'Repo cleared.'}</p>
          </div>
        </div>

        <div class="pipeline-step ${isWork ? 'is-active' : 'is-complete'}">
          <div class="step-icon">🛠️</div>
          <div class="step-content">
            <p class="step-label">Work Phase</p>
            <p class="step-desc">1h30 - Jules is working.</p>
          </div>
        </div>

        <div class="pipeline-step ${isWrapup ? 'is-active' : (isBuffer ? 'is-complete' : '')}">
          <div class="step-icon">🏁</div>
          <div class="step-content">
            <p class="step-label">Closing Phase</p>
            <p class="step-desc">30m - "Finish here".</p>
          </div>
        </div>

        <div class="pipeline-step ${isBuffer ? 'is-active' : ''}">
          <div class="step-icon">🛑</div>
          <div class="step-content">
            <p class="step-label">Final Buffer</p>
            <p class="step-desc">1h - Hard kill limit.</p>
          </div>
        </div>
      </div>
    </div>
  `;
}
