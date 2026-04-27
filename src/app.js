import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { controlCenter } from './controlCenter.js';
import { mergeOpenPRs, listOpenPRs, closePR, mergePRWithResult } from './api/githubClient.js';
import { getSession, listActivities } from './api/julesClient.js';
import { listAgentSessions } from './db/database.js';

// PR cache — shared across all users to avoid hammering the GitHub API
const PR_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes
const prCache = new Map(); // projectId → { prs, fetchedAt }
const prCacheInflight = new Map(); // projectId → Promise (deduplicates concurrent fetches)

async function getCachedPRs(project) {
    const cached = prCache.get(project.id);
    if (cached && Date.now() - cached.fetchedAt < PR_CACHE_TTL_MS) return cached.prs;

    // Deduplicate: if a fetch is already in progress for this project, wait for it
    if (prCacheInflight.has(project.id)) return prCacheInflight.get(project.id);

    const fetchPromise = listOpenPRs(project).then(prs => {
        prCache.set(project.id, { prs, fetchedAt: Date.now() });
        prCacheInflight.delete(project.id);
        return prs;
    }).catch(err => {
        prCacheInflight.delete(project.id);
        throw err;
    });

    prCacheInflight.set(project.id, fetchPromise);
    return fetchPromise;
}

function invalidatePRCache(projectId) {
    prCache.delete(projectId);
}
import { listSources, getSource } from './api/julesClient.js';
import {
    hasAnyDashboardUser,
    createDashboardUser,
    authenticateDashboardUser,
    createDashboardSession,
    getDashboardSessionUser,
    deleteDashboardSession,
    listDashboardUsers,
    updateDashboardUserRole,
    updateDashboardUserPassword,
    deleteDashboardUser
} from './auth/dashboardAuth.js';
import { hasPermission } from './auth/permissions.js';
import {
    listAuditEvents,
    recordAuditEvent,
    recordDashboardMetric,
    listDashboardMetrics,
    listServiceErrors,
    getServiceErrorSummary,
    listServiceChecks,
    getServiceUptime,
    recordServiceCheck,
    listPromptsByProject,
    upsertPrompt,
    getTokenName,
    upsertTokenName,
    listTokenNames,
    listAgents,
    getAgent,
    createAgent,
    updateAgent,
    reorderAgents,
    deleteAgent,
    listProjectsConfig,
    getProjectConfig,
    upsertProjectConfig,
    deleteProjectConfig,
    listAssignments,
    getAssignment,
    createAssignment,
    updateAssignment,
    deleteAssignment,
    deleteAssignmentsByProject,
    toggleAssignment
} from './db/database.js';
import { getTokenStatusSummary } from './api/tokenRotation.js';
import { GLOBAL_CONFIG } from './config.js';

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, '..', 'public');
const isProduction = process.env.NODE_ENV === 'production';
const sessionCookieName = 'orchestrator_session';
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const loginAttempts = new Map();

// Security configuration
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

const parseCookies = (cookieHeader = '') => {
    const out = {};
    const raw = String(cookieHeader || '').split(';');
    for (const item of raw) {
        const index = item.indexOf('=');
        if (index === -1) continue;
        const key = item.slice(0, index).trim();
        const value = item.slice(index + 1).trim();
        if (!key) continue;
        out[key] = decodeURIComponent(value);
    }
    return out;
};

const attachDashboardUser = (req, res, next) => {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[sessionCookieName];
    req.dashboardUser = getDashboardSessionUser(token);
    req.dashboardSessionToken = token;
    next();
};

/**
 * Security headers middleware following Helmet best practices.
 */
export const securityHeaders = (req, res, next) => {
    // Prevents browsers from guessing the MIME type
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Prevents clickjacking
    res.setHeader('X-Frame-Options', 'DENY');
    // Basic CSP to prevent injection
    const reqPath = req.path || '';
    const isDashboardRoute =
        reqPath === '/' ||
        reqPath.startsWith('/api') ||
        reqPath.startsWith('/assets') ||
        reqPath.startsWith('/dashboard') ||
        reqPath.startsWith('/login') ||
        reqPath.startsWith('/auth');
    if (isDashboardRoute) {
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    } else {
        res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    }
    // Strict-Transport-Security
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    // Disable XSS auditor as it can be used for data leakage
    res.setHeader('X-XSS-Protection', '0');
    // Control how much referrer information is sent
    res.setHeader('Referrer-Policy', 'no-referrer');
    // Prevents Internet Explorer from executing downloads in site's context
    res.setHeader('X-Download-Options', 'noopen');
    // Restricts Adobe Flash/PDF content from loading data from this domain
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    next();
};

/**
 * Strict CORS policy middleware.
 * Since this is a health check server for internal use (Render), we can be very restrictive.
 * We do not use 'null' as it is a security anti-pattern.
 */
export const strictCors = (req, res, next) => {
    // By not setting 'Access-Control-Allow-Origin', we default to same-origin.
    // For a health-check server, we typically don't need to allow any cross-origin requests.
    // We only explicitly handle preflight if needed, but here we prefer to be fully restrictive.

    if (req.method === 'OPTIONS') {
        // We do not want to allow any cross-origin OPTIONS requests.
        return res.status(403).end();
    }
    next();
};

const rateLimitMap = new Map();
// Simple cleanup for the rateLimitMap every 10 minutes to prevent memory leaks.
setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of rateLimitMap.entries()) {
        if (now - data.firstRequest > 60 * 1000) {
            rateLimitMap.delete(ip);
        }
    }
}, 10 * 60 * 1000).unref();

/**
 * Simple in-memory rate limiter middleware.
 * Limits requests per IP within a 1-minute window.
 */
export const rateLimiter = (req, res, next) => {
    const ip = req.ip || req.get('x-forwarded-for') || req.connection.remoteAddress;
    const now = Date.now();
    const windowMs = 60 * 1000;
    const limit = 5;

    if (!rateLimitMap.has(ip)) {
        rateLimitMap.set(ip, { count: 1, firstRequest: now });
        return next();
    }

    const userData = rateLimitMap.get(ip);
    const msSinceFirst = now - userData.firstRequest;

    if (msSinceFirst > windowMs) {
        // Window expired, reset
        rateLimitMap.set(ip, { count: 1, firstRequest: now });
        return next();
    }

    if (userData.count >= limit) {
        const retryAfter = Math.ceil((windowMs - msSinceFirst) / 1000);
        res.setHeader('Retry-After', retryAfter);
        return res.status(429).send('Too many requests, please try again later.');
    }

    userData.count++;
    next();
};

const apiRateLimitMap = new Map();
export const apiRateLimiter = (req, res, next) => {
    const ip = req.ip || req.get('x-forwarded-for') || req.connection.remoteAddress;
    const now = Date.now();
    const windowMs = 60 * 1000;
    const limit = 80;

    if (!apiRateLimitMap.has(ip)) {
        apiRateLimitMap.set(ip, { count: 1, firstRequest: now });
        return next();
    }

    const userData = apiRateLimitMap.get(ip);
    const msSinceFirst = now - userData.firstRequest;

    if (msSinceFirst > windowMs) {
        apiRateLimitMap.set(ip, { count: 1, firstRequest: now });
        return next();
    }

    if (userData.count >= limit) {
        const retryAfter = Math.ceil((windowMs - msSinceFirst) / 1000);
        res.setHeader('Retry-After', retryAfter);
        return res.status(429).json({ error: 'Too many API requests. Please retry later.' });
    }

    userData.count++;
    next();
};

const requireDashboardAuth = (req, res, next) => {
    if (!req.dashboardUser) {
        if (req.path.startsWith('/api')) {
            return res.status(401).json({ error: 'Authentication required.' });
        }
        return res.redirect('/login');
    }
    next();
};

const requireDashboardAdmin = (req, res, next) => {
    // Optional legacy admin key for automation/scripts.
    const expected = process.env.DASHBOARD_API_KEY;
    const provided = req.get('x-admin-key') || req.query.key;
    if (expected && provided && provided === expected) {
        return next();
    }
    if (!req.dashboardUser) {
        return res.status(401).json({ error: 'Authentication required.' });
    }
    if (req.dashboardUser.role !== 'admin') {
        return res.status(403).json({ error: 'Admin role required.' });
    }
    next();
};

const requirePermission = (permission) => (req, res, next) => {
    const expected = process.env.DASHBOARD_API_KEY;
    const provided = req.get('x-admin-key') || req.query.key;
    if (expected && provided && provided === expected) {
        return next();
    }
    if (!req.dashboardUser) {
        return res.status(401).json({ error: 'Authentication required.' });
    }
    if (!hasPermission(req.dashboardUser.role, permission)) {
        return res.status(403).json({ error: `Missing permission: ${permission}` });
    }
    next();
};

const requireCriticalConfirmation = (req, res, next) => {
    const token = req.get('x-confirm-action');
    if (token !== 'CONFIRM') {
        return res.status(400).json({ error: 'Missing x-confirm-action=CONFIRM header for critical action.' });
    }
    next();
};

const getRequestIp = (req) => req.ip || req.get('x-forwarded-for') || req.connection.remoteAddress || null;

const audit = (req, action, target, details = null) => {
    recordAuditEvent({
        userId: req.dashboardUser?.id || null,
        userEmail: req.dashboardUser?.email || null,
        action,
        target,
        details,
        ip: getRequestIp(req)
    });
};

const getLoginAttemptState = (email) => {
    const key = String(email || '').trim().toLowerCase();
    const now = Date.now();
    const state = loginAttempts.get(key) || { count: 0, firstAttempt: now, lockedUntil: 0 };
    if (state.lockedUntil && state.lockedUntil < now) {
        state.count = 0;
        state.firstAttempt = now;
        state.lockedUntil = 0;
    }
    if (now - state.firstAttempt > LOGIN_LOCK_MS) {
        state.count = 0;
        state.firstAttempt = now;
    }
    loginAttempts.set(key, state);
    return state;
};

function getProjectOrFail(projectId, res) {
    const project = controlCenter.getProjectRuntime(projectId);
    if (!project) {
        res.status(404).json({ error: `Unknown project: ${projectId}` });
        return null;
    }
    return project;
}

app.use(securityHeaders);
app.use(strictCors);
app.use(attachDashboardUser);
app.use('/assets', express.static(path.join(publicDir, 'assets')));

app.get('/', (req, res) => {
    if (!hasAnyDashboardUser()) {
        return res.redirect('/login?setup=1');
    }
    if (!req.dashboardUser) {
        return res.redirect('/login');
    }
    return res.redirect('/dashboard');
});

app.get('/login', (req, res) => {
    if (req.dashboardUser) {
        return res.redirect('/dashboard');
    }
    res.sendFile(path.join(publicDir, 'login.html'));
});

app.post('/auth/bootstrap-admin', apiRateLimiter, (req, res) => {
    try {
        if (hasAnyDashboardUser()) {
            return res.status(409).json({ error: 'Setup already completed.' });
        }
        const { email, password } = req.body || {};
        const user = createDashboardUser(email, password, 'admin');
        const session = createDashboardSession(user.id);
        res.cookie(sessionCookieName, session.token, {
            httpOnly: true,
            secure: isProduction,
            sameSite: 'strict',
            path: '/',
            maxAge: session.expiresAt - Date.now()
        });
        return res.status(201).json({ ok: true, user });
    } catch (error) {
        return res.status(400).json({ error: String(error?.message || error) });
    }
});

app.post('/auth/login', apiRateLimiter, (req, res) => {
    const { email, password, mfaCode } = req.body || {};
    const state = getLoginAttemptState(email);
    if (state.lockedUntil && state.lockedUntil > Date.now()) {
        return res.status(429).json({ error: 'Too many failed login attempts. Account temporarily locked.' });
    }

    const expectedMfaCode = process.env.DASHBOARD_MFA_CODE;
    if (expectedMfaCode && String(mfaCode || '') !== String(expectedMfaCode)) {
        state.count += 1;
        if (state.count >= LOGIN_MAX_ATTEMPTS) {
            state.lockedUntil = Date.now() + LOGIN_LOCK_MS;
        }
        return res.status(401).json({ error: 'Invalid MFA code.' });
    }

    const user = authenticateDashboardUser(email, password);
    if (!user) {
        state.count += 1;
        if (state.count >= LOGIN_MAX_ATTEMPTS) {
            state.lockedUntil = Date.now() + LOGIN_LOCK_MS;
        }
        return res.status(401).json({ error: 'Invalid credentials.' });
    }

    state.count = 0;
    state.lockedUntil = 0;
    state.firstAttempt = Date.now();
    const session = createDashboardSession(user.id);
    res.cookie(sessionCookieName, session.token, {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'strict',
        path: '/',
        maxAge: session.expiresAt - Date.now()
    });
    return res.status(200).json({ ok: true, user });
});

app.post('/auth/logout', apiRateLimiter, (req, res) => {
    deleteDashboardSession(req.dashboardSessionToken);
    res.clearCookie(sessionCookieName, { path: '/' });
    return res.status(200).json({ ok: true });
});

app.get('/auth/me', apiRateLimiter, (req, res) => {
    if (!req.dashboardUser) {
        return res.status(401).json({ authenticated: false });
    }
    return res.status(200).json({ authenticated: true, user: req.dashboardUser, setupDone: hasAnyDashboardUser() });
});

app.get('/dashboard', requireDashboardAuth, (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
});

app.get('/api/jules/sources', apiRateLimiter, requireDashboardAuth, async (req, res) => {
    try {
        const pageSize = Math.min(100, Number(req.query.pageSize) || 30);
        const pageToken = req.query.pageToken;
        const filter = req.query.filter;

        const data = await listSources('System', pageSize, pageToken, filter);
        if (!data) {
            return res.status(502).json({ error: 'Failed to fetch sources from Jules API' });
        }
        
        // Debug: log source IDs
        if (data.sources && data.sources.length > 0) {
            console.log(`[DEBUG] Jules returned ${data.sources.length} sources:`);
            data.sources.slice(0, 3).forEach(s => {
                console.log(`  - id: ${s.id}, repo: ${s.githubRepo?.repo}`);
            });
        }
        
        res.status(200).json(data);
    } catch (error) {
        res.status(500).json({ error: String(error?.message || error) });
    }
});

app.get('/api/jules/sources/:sourceId', apiRateLimiter, requireDashboardAuth, async (req, res) => {
    try {
        const sourceId = req.params.sourceId;
        const data = await getSource('System', sourceId);
        if (!data) {
            return res.status(404).json({ error: 'Source not found in Jules' });
        }
        res.status(200).json(data);
    } catch (error) {
        res.status(500).json({ error: String(error?.message || error) });
    }
});

app.post('/api/projects/add', apiRateLimiter, requirePermission('projects.add'), async (req, res) => {
    try {
        const { repoPath, sourceId } = req.body || {}; // e.g. "owner/repo" and actual Jules sourceId
        if (!repoPath || !repoPath.includes('/')) {
            return res.status(400).json({ error: 'repoPath is required (format: owner/repo)' });
        }

        // 1. Check if source exists in Jules
        // Use provided sourceId if available, otherwise try to construct it
        let actualSourceId = sourceId;
        
        // Debug: log what we're receiving
        console.log(`[DEBUG] /api/projects/add: repoPath=${repoPath}, sourceId=${sourceId}`);
        
        // If sourceId is missing or empty, try to reconstruct (fallback only)
        if (!actualSourceId) {
            console.log(`[DEBUG] sourceId is missing or empty, reconstructing from repoPath`);
            actualSourceId = `github/${repoPath}`; // Format must match Jules API: github/owner/repo
            console.warn(`[WARNING] Using reconstructed sourceId: ${actualSourceId}`);
        }
        
        console.log(`[DEBUG] Final actualSourceId: ${actualSourceId}`);
        
        const source = await getSource('System', actualSourceId);
        
        if (!source || !source.githubRepo) {
            console.log(`[DEBUG] Source not found. Response: ${JSON.stringify(source)}`);
            return res.status(404).json({ error: `Source ${repoPath} not found in Jules. Make sure it is connected in Jules interface first.` });
        }

        const repoData = source.githubRepo;
        const projectId = repoData.repo; // Use repo name as ID

        // 2. Check if already added
        if (controlCenter.getProject(projectId)) {
            return res.status(409).json({ error: `Project ${projectId} is already connected.` });
        }

        // 3. Create project config
        const newProject = {
            id: projectId,
            githubRepo: repoPath,
            githubBranch: repoData.defaultBranch?.displayName || 'main',
            githubToken: process.env.GITHUB_TOKEN, // Use default token
            backgroundPrompts: [], // Empty by default
            // Optional: add some default background prompts if needed
        };

        // 4. Add to control center
        controlCenter.addProject(newProject);
        audit(req, 'projects.add', projectId, { repoPath });

        res.status(201).json({ ok: true, project: newProject });
    } catch (error) {
        res.status(500).json({ error: String(error?.message || error) });
    }
});

app.get('/api/status', apiRateLimiter, requireDashboardAuth, (req, res) => {
    let payload = controlCenter.getStatus();
    payload.currentUser = req.dashboardUser;
    recordDashboardMetric('active_runners', payload.runners.length);
    recordDashboardMetric('active_tasks', payload.projects.reduce((sum, p) => sum + p.activeTasks, 0));
    recordDashboardMetric('locked_projects', payload.projects.filter((p) => p.locked).length);
    res.status(200).json(payload);
});

app.get('/api/projects/:projectId/detail', apiRateLimiter, requireDashboardAuth, (req, res) => {
    const projectId = req.params.projectId;
    const project = controlCenter.getProject(projectId);
    if (!project) {
        return res.status(404).json({ error: `Project ${projectId} not found` });
    }

    // Get all runners for this project
    const allRunners = controlCenter.listRunners();
    const projectRunners = allRunners.filter(r => r.projectId === projectId);

    // Group runners by status
    const running = projectRunners.filter(r => r.status === 'running');
    const completed = projectRunners.filter(r => r.status === 'stopped' && !r.lastError && r.stoppedAt);
    const failed = projectRunners.filter(r => r.lastError || (r.status === 'stopped' && r.lastError));

    // Sort by time
    const sortByTime = (a, b) => {
        const aTime = new Date(a.stoppedAt || a.startedAt).getTime();
        const bTime = new Date(b.stoppedAt || b.startedAt).getTime();
        return bTime - aTime; // Most recent first
    };

    res.status(200).json({
        projectId,
        project: {
            id: project.id,
            githubRepo: project.githubRepo,
            githubBranch: project.githubBranch,
            locked: (controlCenter.getStatus().projects.find(p => p.id === projectId) || {}).locked,
            hasPipeline: !!project.buildAndMergePipeline,
            pipelineConfig: project.buildAndMergePipeline ? {
                cronSchedule: project.buildAndMergePipeline.cronSchedule,
                prompt: project.buildAndMergePipeline.prompt
            } : null
        },
        runners: {
            running: running.sort(sortByTime),
            completed: completed.sort(sortByTime),
            failed: failed.sort(sortByTime)
        },
        summary: {
            total: projectRunners.length,
            runningCount: running.length,
            completedCount: completed.length,
            failedCount: failed.length
        }
    });
});

app.get('/api/projects/:projectId/sessions', apiRateLimiter, requirePermission('dashboard.read'), (req, res) => {
    const sessions = listAgentSessions(req.params.projectId);
    res.status(200).json({ sessions });
});

app.get('/api/runners/:runnerId/session', apiRateLimiter, requirePermission('dashboard.read'), async (req, res) => {
    const runner = controlCenter.runners.get(req.params.runnerId);
    if (!runner) return res.status(404).json({ error: 'Runner not found.' });

    const snapshot = controlCenter.getRunnerSnapshot(runner);
    if (!snapshot.sessionId) return res.status(200).json({ runner: snapshot, session: null, activities: [] });

    try {
        const agentName = runner.details?.agentName || 'Agent';
        const [session, activitiesRes] = await Promise.all([
            getSession(agentName, snapshot.sessionId).catch(() => null),
            listActivities(agentName, snapshot.sessionId, 100).catch(() => null),
        ]);
        const activities = activitiesRes?.activities || [];
        if (activities.length > 0) {
            console.log('[session-debug] sample activity:', JSON.stringify(activities[0], null, 2));
        }
        return res.status(200).json({ runner: snapshot, session, activities });
    } catch (e) {
        return res.status(200).json({ runner: snapshot, session: null, activities: [], error: e.message });
    }
});

// View any historical session by its Jules session ID
app.get('/api/sessions/:sessionId', apiRateLimiter, requirePermission('dashboard.read'), async (req, res) => {
    const sessionId = req.params.sessionId;
    try {
        const [session, activitiesRes] = await Promise.all([
            getSession('Agent', sessionId).catch(() => null),
            listActivities('Agent', sessionId, 100).catch(() => null),
        ]);
        return res.status(200).json({ runner: null, session, activities: activitiesRes?.activities || [] });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
});

app.post('/api/runners/:runnerId/stop', apiRateLimiter, requirePermission('runners.stop'), requireCriticalConfirmation, (req, res) => {
    const ok = controlCenter.stopRunner(req.params.runnerId);
    if (!ok) {
        return res.status(404).json({ error: 'Runner not found.' });
    }
    audit(req, 'runner.stop', req.params.runnerId);
    res.status(200).json({ ok: true, runnerId: req.params.runnerId });
});

app.post('/api/runners/:runnerId/kill-after', apiRateLimiter, requirePermission('runners.killAfter'), requireCriticalConfirmation, (req, res) => {
    const timeoutMs = Number(req.body?.timeoutMs || 0);
    const ok = controlCenter.setRunnerKillAfter(req.params.runnerId, timeoutMs);
    if (!ok) {
        return res.status(404).json({ error: 'Runner not found.' });
    }
    audit(req, 'runner.killAfter', req.params.runnerId, { timeoutMs });
    res.status(200).json({ ok: true, runnerId: req.params.runnerId, timeoutMs });
});

app.post('/api/projects/:projectId/agents/background/start', apiRateLimiter, requirePermission('agents.control'), async (req, res) => {
    try {
        const projectId = req.params.projectId;
        if (!getProjectOrFail(projectId, res)) return;
        const started = await controlCenter.startConfiguredBackground(projectId);
        audit(req, 'background.start', projectId, { started });
        return res.status(200).json({ ok: true, started });
    } catch (error) {
        return res.status(500).json({ error: String(error?.message || error) });
    }
});

app.post('/api/projects/:projectId/agents/background/stop', apiRateLimiter, requirePermission('agents.control'), requireCriticalConfirmation, (req, res) => {
    const projectId = req.params.projectId;
    if (!getProjectOrFail(projectId, res)) return;
    const stopped = controlCenter.stopBy(projectId, 'background');
    audit(req, 'background.stop', projectId, { stopped });
    res.status(200).json({ ok: true, stopped });
});

app.post('/api/projects/:projectId/agents/issue/start', apiRateLimiter, requirePermission('agents.control'), async (req, res) => {
    try {
        const projectId = req.params.projectId;
        if (!getProjectOrFail(projectId, res)) return;
        const runnerId = await controlCenter.startIssueLoop(projectId);
        audit(req, 'issue.start', projectId, { runnerId });
        return res.status(200).json({ ok: true, runnerId });
    } catch (error) {
        return res.status(500).json({ error: String(error?.message || error) });
    }
});

app.post('/api/projects/:projectId/agents/issue/stop', apiRateLimiter, requirePermission('agents.control'), requireCriticalConfirmation, (req, res) => {
    const projectId = req.params.projectId;
    if (!getProjectOrFail(projectId, res)) return;
    const stopped = controlCenter.stopBy(projectId, 'issue');
    audit(req, 'issue.stop', projectId, { stopped });
    res.status(200).json({ ok: true, stopped });
});

app.post('/api/projects/:projectId/lock', apiRateLimiter, requirePermission('project.lock'), requireCriticalConfirmation, async (req, res) => {
    const projectId = req.params.projectId;
    if (!getProjectOrFail(projectId, res)) return;
    await controlCenter.setProjectLock(projectId, true);
    audit(req, 'project.lock', projectId);
    res.status(200).json({ ok: true, projectId, locked: true });
});

app.post('/api/projects/:projectId/unlock', apiRateLimiter, requirePermission('project.lock'), requireCriticalConfirmation, async (req, res) => {
    const projectId = req.params.projectId;
    if (!getProjectOrFail(projectId, res)) return;
    await controlCenter.setProjectLock(projectId, false);
    audit(req, 'project.unlock', projectId);
    res.status(200).json({ ok: true, projectId, locked: false });
});

app.post('/api/projects/:projectId/tasks/reset', apiRateLimiter, requirePermission('project.resetTasks'), requireCriticalConfirmation, async (req, res) => {
    const projectId = req.params.projectId;
    if (!getProjectOrFail(projectId, res)) return;
    await controlCenter.resetProjectTasks(projectId);
    audit(req, 'project.tasks.reset', projectId);
    res.status(200).json({ ok: true, projectId, activeTasks: 0 });
});

app.post('/api/projects/:projectId/delete', apiRateLimiter, requirePermission('projects.delete'), requireCriticalConfirmation, async (req, res) => {
    const projectId = req.params.projectId;
    if (!getProjectOrFail(projectId, res)) return;
    try {
        controlCenter.removeProject(projectId);
        audit(req, 'project.delete', projectId);
        res.status(200).json({ ok: true, projectId });
    } catch (error) {
        res.status(500).json({ error: String(error?.message || error) });
    }
});

app.post('/api/projects/:projectId/pipeline/run', apiRateLimiter, requirePermission('pipeline.run'), requireCriticalConfirmation, async (req, res) => {
    try {
        const projectId = req.params.projectId;
        if (!getProjectOrFail(projectId, res)) return;
        const runnerId = await controlCenter.runPipelineNow(projectId);
        audit(req, 'pipeline.run', projectId, { runnerId });
        return res.status(202).json({ ok: true, runnerId });
    } catch (error) {
        return res.status(500).json({ error: String(error?.message || error) });
    }
});

app.post('/api/projects/:projectId/issues/run-once', apiRateLimiter, requirePermission('issues.runOnce'), async (req, res) => {
    try {
        const projectId = req.params.projectId;
        if (!getProjectOrFail(projectId, res)) return;
        const result = await controlCenter.runIssueOnce(projectId);
        audit(req, 'issue.runOnce', projectId, result);
        return res.status(200).json({ ok: true, ...result });
    } catch (error) {
        return res.status(500).json({ error: String(error?.message || error) });
    }
});

app.post('/api/projects/:projectId/background/run-once', apiRateLimiter, requirePermission('background.runOnce'), async (req, res) => {
    try {
        const projectId = req.params.projectId;
        if (!getProjectOrFail(projectId, res)) return;
        const prompt = (req.body?.prompt || '').trim();
        if (!prompt) {
            return res.status(400).json({ error: 'prompt is required.' });
        }
        const label = (req.body?.label || 'Background Manual').trim();
        const tokenId = req.body?.tokenId ? String(req.body.tokenId) : null;
        const runnerId = await controlCenter.runBackgroundOnce(projectId, prompt, label, { preferredTokenId: tokenId });
        audit(req, 'background.runOnce', projectId, { label, runnerId, tokenId });
        return res.status(202).json({ ok: true, runnerId });
    } catch (error) {
        return res.status(500).json({ error: String(error?.message || error) });
    }
});

app.post('/api/projects/:projectId/custom-loop/start', apiRateLimiter, requirePermission('customLoop.start'), async (req, res) => {
    try {
        const projectId = req.params.projectId;
        if (!getProjectOrFail(projectId, res)) return;
        const prompt = String(req.body?.prompt || '');
        const label = String(req.body?.label || 'Custom Loop');
        const intervalMs = Number(req.body?.intervalMs || 120000);
        const tokenId = req.body?.tokenId ? String(req.body.tokenId) : null;
        const runnerId = await controlCenter.startCustomLoop(projectId, prompt, label, intervalMs, { preferredTokenId: tokenId });
        audit(req, 'customLoop.start', projectId, { label, intervalMs, runnerId, tokenId });
        return res.status(202).json({ ok: true, runnerId });
    } catch (error) {
        return res.status(500).json({ error: String(error?.message || error) });
    }
});

app.post('/api/projects/:projectId/prs/merge-open', apiRateLimiter, requirePermission('prs.merge'), async (req, res) => {
    try {
        const projectId = req.params.projectId;
        const project = getProjectOrFail(projectId, res);
        if (!project) return;
        await mergeOpenPRs(project);
        invalidatePRCache(projectId);
        audit(req, 'prs.mergeOpen', projectId);
        return res.status(200).json({ ok: true });
    } catch (error) {
        return res.status(500).json({ error: String(error?.message || error) });
    }
});

app.get('/health', rateLimiter, (req, res) => {
    // Recording this hit as a valid health check for the dashboard
    recordServiceCheck('website', true, {
        statusCode: 200,
        responseMs: 0,
        source: 'external_hit'
    });
    res.status(200).send('Orchestrator is alive');
});

app.get('/api/users', apiRateLimiter, requirePermission('users.read'), (req, res) => {
    res.status(200).json({ users: listDashboardUsers() });
});

app.post('/api/users', apiRateLimiter, requirePermission('users.manage'), (req, res) => {
    try {
        const { email, password, role } = req.body || {};
        const user = createDashboardUser(email, password, role || 'viewer');
        audit(req, 'users.create', String(user.id), { email: user.email, role: user.role });
        return res.status(201).json({ ok: true, user });
    } catch (error) {
        return res.status(400).json({ error: String(error?.message || error) });
    }
});

app.patch('/api/users/:userId', apiRateLimiter, requirePermission('users.manage'), (req, res) => {
    try {
        const userId = Number(req.params.userId);
        const { role, password } = req.body || {};
        let user = null;
        if (role) {
            user = updateDashboardUserRole(userId, role);
        }
        if (password) {
            updateDashboardUserPassword(userId, password);
        }
        audit(req, 'users.update', String(userId), { role: role || null, passwordReset: !!password });
        return res.status(200).json({ ok: true, user });
    } catch (error) {
        return res.status(400).json({ error: String(error?.message || error) });
    }
});

app.delete('/api/users/:userId', apiRateLimiter, requirePermission('users.manage'), requireCriticalConfirmation, (req, res) => {
    try {
        const userId = Number(req.params.userId);
        if (req.dashboardUser && req.dashboardUser.id === userId) {
            return res.status(400).json({ error: 'You cannot delete your own account.' });
        }
        deleteDashboardUser(userId);
        audit(req, 'users.delete', String(userId));
        return res.status(200).json({ ok: true });
    } catch (error) {
        return res.status(400).json({ error: String(error?.message || error) });
    }
});

app.get('/api/audit-events', apiRateLimiter, requirePermission('audit.read'), (req, res) => {
    const hours = Number(req.query.hours || 24);
    const limit = Number(req.query.limit || 200);
    res.status(200).json({ events: listAuditEvents(hours, limit) });
});

app.get('/api/analytics/metrics', apiRateLimiter, requirePermission('analytics.read'), (req, res) => {
    const hours = Number(req.query.hours || 24);
    const keys = ['active_runners', 'active_tasks', 'locked_projects'];
    const series = {};
    for (const key of keys) {
        series[key] = listDashboardMetrics(key, hours);
    }
    res.status(200).json({ hours, series });
});

app.get('/api/keys', apiRateLimiter, requirePermission('keys.read'), (req, res) => {
    const summary = getTokenStatusSummary();
    res.status(200).json(summary);
});

app.get('/api/health-status', apiRateLimiter, requirePermission('keys.read'), (req, res) => {
    const hours = Math.max(1, Number(req.query.hours || 24));
    
    // Dynamic URL detection
    const external = String(process.env.WEBSITE_HEALTH_URL || process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_BASE_URL || '').trim();
    const websiteUrl = external || (req.protocol + '://' + req.get('host') + '/health');

    const buildService = (serviceId, label) => {
        const summary = getServiceErrorSummary(serviceId, hours);
        const checks = listServiceChecks(serviceId, 40);
        const latestCheck = checks[0] || null;
        return {
            id: serviceId,
            label,
            status: summary.errors > 0 ? 'degraded' : 'operational',
            errors: summary.errors,
            windowHours: summary.windowHours,
            latencyMs: latestCheck?.responseMs ?? null,
            lastCheckedAt: latestCheck ? new Date(latestCheck.timestamp).toISOString() : null,
            recentErrors: listServiceErrors(serviceId, hours, 20)
        };
    };

    const githubApi = buildService('github_api', 'GitHub API');
    const julesApi = buildService('jules_api', 'Jules API');
    const website = buildService('website', 'Orchestrator Health');
    const websiteChecks = listServiceChecks('website', 30);
    const uptime7d = getServiceUptime('website', 24 * 7);
    const uptime30d = getServiceUptime('website', 24 * 30);

    website.ping = {
        url: websiteUrl,
        responseTime: website.latencyMs != null ? `${website.latencyMs}ms` : '-',
        lastCheck: website.lastCheckedAt,
        uptime7d: uptime7d.uptimePercent,
        uptime30d: uptime30d.uptimePercent,
        checks: websiteChecks.slice().reverse().map((check) => Boolean(check.ok))
    };

    return res.status(200).json({
        hours,
        services: [githubApi, julesApi, website]
    });
});

app.get('/api/prompts/:projectId', apiRateLimiter, requirePermission('agents.control'), (req, res) => {
    const projectId = String(req.params.projectId || '');
    return res.status(200).json({
        projectId,
        prompts: listPromptsByProject(projectId)
    });
});

app.put('/api/prompts/:projectId/:promptName', apiRateLimiter, requirePermission('agents.control'), (req, res) => {
    const projectId = String(req.params.projectId || '');
    const promptName = String(req.params.promptName || '');
    const content = String(req.body?.content || '');
    const source = String(req.body?.source || 'manual');

    if (!projectId || !promptName) {
        return res.status(400).json({ error: 'projectId and promptName are required.' });
    }

    if (!content.trim()) {
        return res.status(400).json({ error: 'Prompt content cannot be empty.' });
    }

    upsertPrompt(projectId, promptName, content, {
        source,
        isInitial: source === 'markdown'
    });

    audit(req, 'prompt.upsert', `${projectId}/${promptName}`, { source });
    return res.status(200).json({ ok: true });
});

app.get('/api/token-names', apiRateLimiter, requirePermission('keys.read'), (req, res) => {
    const names = listTokenNames();
    return res.status(200).json({ tokenNames: names });
});

app.put('/api/token-names/:tokenIndex', apiRateLimiter, requirePermission('keys.manage'), (req, res) => {
    const tokenIndex = Number(req.params.tokenIndex || 0);
    const customName = String(req.body?.customName || '').trim();

    if (!Number.isFinite(tokenIndex) || tokenIndex < 0) {
        return res.status(400).json({ error: 'Invalid token index.' });
    }

    if (!customName) {
        return res.status(400).json({ error: 'Custom name cannot be empty.' });
    }

    const success = upsertTokenName(tokenIndex, customName);
    if (!success) {
        return res.status(500).json({ error: 'Failed to update token name.' });
    }

    audit(req, 'token.rename', `token-${tokenIndex}`, { customName });
    return res.status(200).json({ ok: true, tokenIndex, customName });
});

app.post('/api/schedulers/:scheduler/start', apiRateLimiter, requirePermission('schedulers.control'), (req, res) => {
    const { scheduler } = req.params;
    const projectId = req.body?.projectId;
    let ok = false;
    if (scheduler === 'global-daily-merge') ok = controlCenter.startGlobalDailyMergeScheduler();
    if (scheduler === 'auto-merge') ok = controlCenter.startAutoMergeScheduler();
    if (scheduler === 'project-pipeline') ok = controlCenter.startProjectPipelineScheduler(projectId);
    if (!ok) {
        return res.status(400).json({ error: 'Unable to start scheduler.' });
    }
    audit(req, 'scheduler.start', scheduler, { projectId: projectId || null });
    res.status(200).json({ ok: true });
});

app.post('/api/schedulers/:scheduler/stop', apiRateLimiter, requirePermission('schedulers.control'), requireCriticalConfirmation, (req, res) => {
    const { scheduler } = req.params;
    const projectId = req.body?.projectId;
    let ok = false;
    if (scheduler === 'global-daily-merge') ok = controlCenter.stopGlobalDailyMergeScheduler();
    if (scheduler === 'auto-merge') ok = controlCenter.stopAutoMergeScheduler();
    if (scheduler === 'project-pipeline') ok = controlCenter.stopProjectPipelineScheduler(projectId);
    if (!ok) {
        return res.status(400).json({ error: 'Unable to stop scheduler.' });
    }
    audit(req, 'scheduler.stop', scheduler, { projectId: projectId || null });
    res.status(200).json({ ok: true });
});

// =========================================================
// Agent Library API
// =========================================================

app.get('/api/agents', apiRateLimiter, requirePermission('agents.control'), (req, res) => {
    res.status(200).json({ agents: listAgents() });
});

app.post('/api/agents', apiRateLimiter, requirePermission('agents.control'), (req, res) => {
    const { name, description, prompt, color } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'name is required.' });
    if (!prompt?.trim()) return res.status(400).json({ error: 'prompt is required.' });
    try {
        const agent = createAgent({ name, description, prompt, color });
        audit(req, 'agent.create', String(agent.id), { name: agent.name });
        return res.status(201).json({ ok: true, agent });
    } catch (err) {
        if (String(err.message).includes('UNIQUE')) return res.status(409).json({ error: 'Agent name already exists.' });
        return res.status(500).json({ error: String(err.message) });
    }
});

app.get('/api/agents/:id', apiRateLimiter, requirePermission('agents.control'), (req, res) => {
    const agent = getAgent(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found.' });
    res.status(200).json(agent);
});

app.put('/api/agents/:id', apiRateLimiter, requirePermission('agents.control'), (req, res) => {
    const { name, description, prompt, color } = req.body || {};
    const agent = updateAgent(req.params.id, { name, description, prompt, color });
    if (!agent) return res.status(404).json({ error: 'Agent not found.' });
    audit(req, 'agent.update', req.params.id, { name: agent.name });
    res.status(200).json({ ok: true, agent });
});

app.delete('/api/agents/:id', apiRateLimiter, requirePermission('agents.control'), requireCriticalConfirmation, (req, res) => {
    const agent = getAgent(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found.' });
    deleteAgent(req.params.id);
    audit(req, 'agent.delete', req.params.id, { name: agent.name });
    res.status(200).json({ ok: true });
});

app.post('/api/agents/reorder', apiRateLimiter, requirePermission('agents.control'), (req, res) => {
    try {
        const { ids } = req.body;
        if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids must be an array' });
        reorderAgents(ids);
        audit(req, 'agents.reorder', 'multiple', { ids });
        return res.status(200).json({ ok: true });
    } catch (err) {
        return res.status(500).json({ error: String(err.message) });
    }
});

// =========================================================
// Projects Config API (DB-stored project management)
// =========================================================

app.get('/api/projects-config', apiRateLimiter, requirePermission('dashboard.read'), (req, res) => {
    res.status(200).json({ projects: listProjectsConfig() });
});

app.post('/api/projects-config', apiRateLimiter, requirePermission('projects.add'), async (req, res) => {
    const { id, github_repo, github_branch, github_token, pipeline_cron, pipeline_prompt } = req.body || {};
    if (!id?.trim()) return res.status(400).json({ error: 'id is required.' });
    if (!github_repo?.trim()) return res.status(400).json({ error: 'github_repo is required.' });
    try {
        const row = upsertProjectConfig({ id, github_repo, github_branch, github_token, pipeline_cron, pipeline_prompt });
        const runtime = controlCenter._buildRuntimeProject(row);
        if (!controlCenter.getProject(id)) {
            controlCenter.addProject(runtime);
        }
        audit(req, 'project.upsert', id, { github_repo });
        return res.status(200).json({ ok: true, project: row });
    } catch (err) {
        return res.status(500).json({ error: String(err.message) });
    }
});

app.delete('/api/projects-config/:projectId', apiRateLimiter, requirePermission('projects.add'), requireCriticalConfirmation, async (req, res) => {
    const { projectId } = req.params;
    const existing = getProjectConfig(projectId);
    if (!existing) return res.status(404).json({ error: 'Project not found in DB.' });
    deleteProjectConfig(projectId);
    deleteAssignmentsByProject(projectId);
    try { controlCenter.removeProject(projectId); } catch (_) {}
    audit(req, 'project.delete', projectId);
    res.status(200).json({ ok: true });
});

// =========================================================
// Assignments API
// =========================================================

app.get('/api/assignments', apiRateLimiter, requirePermission('dashboard.read'), (req, res) => {
    const projectId = req.query.projectId || null;
    const assignments = listAssignments(projectId);
    const enriched = assignments.map((a) => ({
        ...a,
        running: controlCenter.isAssignmentRunning(a.id)
    }));
    res.status(200).json({ assignments: enriched });
});

app.get('/api/projects/:projectId/assignments', apiRateLimiter, requirePermission('dashboard.read'), (req, res) => {
    const { projectId } = req.params;
    const assignments = listAssignments(projectId);
    const enriched = assignments.map((a) => ({
        ...a,
        running: controlCenter.isAssignmentRunning(a.id)
    }));
    res.status(200).json({ assignments: enriched });
});

app.post('/api/projects/:projectId/assignments', apiRateLimiter, requirePermission('agents.control'), async (req, res) => {
    const { projectId } = req.params;
    const project = controlCenter.getProjectRuntime(projectId);
    if (!project) return res.status(404).json({ error: `Project ${projectId} not found.` });

    const { agent_id, custom_prompt, mode, loop_pause_ms, cron_schedule, wait_for_pr_merge } = req.body || {};
    if (!agent_id && !custom_prompt?.trim()) return res.status(400).json({ error: 'agent_id or custom_prompt is required.' });
    if (!['loop', 'scheduled', 'one-shot'].includes(mode)) return res.status(400).json({ error: 'mode must be loop, scheduled or one-shot.' });
    if (mode === 'scheduled' && !cron_schedule) return res.status(400).json({ error: 'cron_schedule is required for scheduled mode.' });

    if (agent_id) {
        const agent = getAgent(agent_id);
        if (!agent) return res.status(404).json({ error: `Agent ${agent_id} not found.` });
    }

    try {
        const assignment = createAssignment({ project_id: projectId, agent_id, custom_prompt, mode, loop_pause_ms, cron_schedule, wait_for_pr_merge });
        await controlCenter.startAssignment(assignment.id);
        audit(req, 'assignment.create', String(assignment.id), { projectId, agentId: agent_id, mode });
        return res.status(201).json({ ok: true, assignment: { ...assignment, running: controlCenter.isAssignmentRunning(assignment.id) } });
    } catch (err) {
        return res.status(500).json({ error: String(err.message) });
    }
});

app.put('/api/assignments/:id', apiRateLimiter, requirePermission('agents.control'), async (req, res) => {
    const id = Number(req.params.id);
    const existing = getAssignment(id);
    if (!existing) return res.status(404).json({ error: 'Assignment not found.' });

    const { agent_id, custom_prompt, mode, loop_pause_ms, cron_schedule, wait_for_pr_merge, enabled } = req.body || {};
    const updated = updateAssignment(id, { agent_id, custom_prompt, mode, loop_pause_ms, cron_schedule, wait_for_pr_merge, enabled });

    // Restart runner to pick up new config
    controlCenter.stopAssignment(id);
    if (updated.enabled) {
        try { await controlCenter.startAssignment(id); } catch (_) {}
    }

    audit(req, 'assignment.update', String(id));
    res.status(200).json({ ok: true, assignment: { ...updated, running: controlCenter.isAssignmentRunning(id) } });
});

app.delete('/api/assignments/:id', apiRateLimiter, requirePermission('agents.control'), requireCriticalConfirmation, (req, res) => {
    const id = Number(req.params.id);
    if (!getAssignment(id)) return res.status(404).json({ error: 'Assignment not found.' });
    controlCenter.stopAssignment(id);
    deleteAssignment(id);
    audit(req, 'assignment.delete', String(id));
    res.status(200).json({ ok: true });
});

app.post('/api/assignments/:id/run', apiRateLimiter, requirePermission('background.runOnce'), async (req, res) => {
    try {
        const runnerId = await controlCenter.runAssignmentOnce(Number(req.params.id));
        audit(req, 'assignment.runOnce', req.params.id, { runnerId });
        res.status(202).json({ ok: true, runnerId });
    } catch (err) {
        res.status(500).json({ error: String(err.message) });
    }
});

app.post('/api/assignments/:id/stop', apiRateLimiter, requirePermission('runners.stop'), requireCriticalConfirmation, (req, res) => {
    const stopped = controlCenter.stopAssignment(Number(req.params.id));
    audit(req, 'assignment.stop', req.params.id, { stopped });
    res.status(200).json({ ok: true, stopped });
});

app.post('/api/assignments/:id/toggle', apiRateLimiter, requirePermission('agents.control'), async (req, res) => {
    const id = Number(req.params.id);
    const current = getAssignment(id);
    if (!current) return res.status(404).json({ error: 'Assignment not found.' });
    const newEnabled = !current.enabled;
    const updated = toggleAssignment(id, newEnabled);

    if (newEnabled) {
        try { await controlCenter.startAssignment(id); } catch (_) {}
    } else {
        controlCenter.stopAssignment(id);
    }

    audit(req, 'assignment.toggle', String(id), { enabled: newEnabled });
    res.status(200).json({ ok: true, assignment: { ...updated, running: controlCenter.isAssignmentRunning(id) } });
});

// =========================================================
// PR Management API
// =========================================================

app.get('/api/projects/:projectId/prs', apiRateLimiter, requirePermission('dashboard.read'), async (req, res) => {
    const project = getProjectOrFail(req.params.projectId, res);
    if (!project) return;
    try {
        const prs = await getCachedPRs(project);
        const cached = prCache.get(project.id);
        return res.status(200).json({ prs, cachedAt: cached?.fetchedAt || null });
    } catch (e) {
        return res.status(500).json({ error: String(e.message) });
    }
});

app.post('/api/projects/:projectId/prs/merge-batch', apiRateLimiter, requirePermission('prs.merge'), async (req, res) => {
    const project = getProjectOrFail(req.params.projectId, res);
    if (!project) return;
    const { prNumbers } = req.body || {};
    if (!Array.isArray(prNumbers) || prNumbers.length === 0) {
        return res.status(400).json({ error: 'prNumbers array is required.' });
    }
    // Newest first (highest PR number)
    const sorted = [...prNumbers].sort((a, b) => b - a);
    const results = [];
    for (const prNumber of sorted) {
        const result = await mergePRWithResult(project, Number(prNumber));
        results.push({ prNumber: Number(prNumber), ...result });
        audit(req, 'pr.merge', String(prNumber), { projectId: project.id, status: result.status });
    }
    invalidatePRCache(project.id);
    return res.status(200).json({ results });
});

app.post('/api/projects/:projectId/prs/close-batch', apiRateLimiter, requirePermission('prs.merge'), async (req, res) => {
    const project = getProjectOrFail(req.params.projectId, res);
    if (!project) return;
    const { prNumbers } = req.body || {};
    if (!Array.isArray(prNumbers) || prNumbers.length === 0) {
        return res.status(400).json({ error: 'prNumbers array is required.' });
    }
    const results = [];
    for (const prNumber of prNumbers) {
        const ok = await closePR(project, Number(prNumber));
        results.push({ prNumber: Number(prNumber), status: ok ? 'closed' : 'failed' });
        if (ok) audit(req, 'pr.close', String(prNumber), { projectId: project.id });
    }
    invalidatePRCache(project.id);
    return res.status(200).json({ results });
});

// Run an agent once on a project (no persistent assignment)
app.post('/api/projects/:projectId/agents/:agentId/run-once', apiRateLimiter, requirePermission('background.runOnce'), async (req, res) => {
    try {
        const { projectId, agentId } = req.params;
        const { instructions, media } = req.body;
        
        const runnerId = await controlCenter.runAgentOnce(
            projectId, 
            agentId === 'custom' ? 'custom' : Number(agentId),
            { instructions, media }
        );
        
        audit(req, 'agent.runOnce', projectId, { agentId, runnerId });
        res.status(202).json({ ok: true, runnerId });
    } catch (err) {
        res.status(500).json({ error: String(err.message) });
    }
});

export default app;
