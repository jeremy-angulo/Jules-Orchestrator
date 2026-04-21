import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { controlCenter } from './controlCenter.js';
import { mergeOpenPRs } from './api/githubClient.js';
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
import { listAuditEvents, recordAuditEvent, recordDashboardMetric, listDashboardMetrics } from './db/database.js';
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
const isMockMode = GLOBAL_CONFIG.MOCK_MODE;
const MOCK_MODE_MESSAGE = 'Mock mode enabled: no real agent or external API call executed.';

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

const respondMockAction = (req, res, action, target, extra = {}, statusCode = 200) => {
    audit(req, `${action}.mock`, target, extra);
    return res.status(statusCode).json({
        ok: true,
        mock: true,
        message: MOCK_MODE_MESSAGE,
        ...extra
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
    const project = controlCenter.getProject(projectId);
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

app.get('/api/status', apiRateLimiter, requireDashboardAuth, (req, res) => {
    let payload = controlCenter.getStatus();
    if (isMockMode) {
        const mockNotice = {
            id: 'mock-mode',
            at: new Date().toISOString(),
            level: 'info',
            message: 'Mock mode active: agent actions are simulated only.',
            meta: {}
        };
        payload = {
            ...payload,
            runners: [],
            events: [mockNotice, ...(payload.events || []).slice(0, 20)],
            schedulers: {
                globalDailyMerge: false,
                autoMergeService: false,
                perProjectPipelines: []
            },
            projects: (payload.projects || []).map((project) => {
                const reasons = Array.from(new Set([...(project.readiness?.reasons || []), 'Mock mode enabled']));
                return {
                    ...project,
                    readiness: {
                        ...(project.readiness || {}),
                        readyForBackground: false,
                        readyForIssue: false,
                        reasons
                    }
                };
            })
        };
    }
    payload.currentUser = req.dashboardUser;
    payload.mockMode = isMockMode;
    recordDashboardMetric('active_runners', payload.runners.length);
    recordDashboardMetric('active_tasks', payload.projects.reduce((sum, p) => sum + p.activeTasks, 0));
    recordDashboardMetric('locked_projects', payload.projects.filter((p) => p.locked).length);
    res.status(200).json(payload);
});

app.post('/api/runners/:runnerId/stop', apiRateLimiter, requirePermission('runners.stop'), requireCriticalConfirmation, (req, res) => {
    if (isMockMode) {
        return respondMockAction(req, res, 'runner.stop', req.params.runnerId, { runnerId: req.params.runnerId });
    }
    const ok = controlCenter.stopRunner(req.params.runnerId);
    if (!ok) {
        return res.status(404).json({ error: 'Runner not found.' });
    }
    audit(req, 'runner.stop', req.params.runnerId);
    res.status(200).json({ ok: true, runnerId: req.params.runnerId });
});

app.post('/api/runners/:runnerId/kill-after', apiRateLimiter, requirePermission('runners.killAfter'), requireCriticalConfirmation, (req, res) => {
    const timeoutMs = Number(req.body?.timeoutMs || 0);
    if (isMockMode) {
        return respondMockAction(req, res, 'runner.killAfter', req.params.runnerId, {
            runnerId: req.params.runnerId,
            timeoutMs
        });
    }
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
        if (isMockMode) {
            return respondMockAction(req, res, 'background.start', projectId, { started: [] });
        }
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
    if (isMockMode) {
        return respondMockAction(req, res, 'background.stop', projectId, { stopped: 0 });
    }
    const stopped = controlCenter.stopBy(projectId, 'background');
    audit(req, 'background.stop', projectId, { stopped });
    res.status(200).json({ ok: true, stopped });
});

app.post('/api/projects/:projectId/agents/issue/start', apiRateLimiter, requirePermission('agents.control'), async (req, res) => {
    try {
        const projectId = req.params.projectId;
        if (!getProjectOrFail(projectId, res)) return;
        if (isMockMode) {
            return respondMockAction(req, res, 'issue.start', projectId, { runnerId: `mock-${projectId}-issue` });
        }
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
    if (isMockMode) {
        return respondMockAction(req, res, 'issue.stop', projectId, { stopped: 0 });
    }
    const stopped = controlCenter.stopBy(projectId, 'issue');
    audit(req, 'issue.stop', projectId, { stopped });
    res.status(200).json({ ok: true, stopped });
});

app.post('/api/projects/:projectId/lock', apiRateLimiter, requirePermission('project.lock'), requireCriticalConfirmation, async (req, res) => {
    const projectId = req.params.projectId;
    if (!getProjectOrFail(projectId, res)) return;
    if (isMockMode) {
        return respondMockAction(req, res, 'project.lock', projectId, { projectId, locked: true });
    }
    await controlCenter.setProjectLock(projectId, true);
    audit(req, 'project.lock', projectId);
    res.status(200).json({ ok: true, projectId, locked: true });
});

app.post('/api/projects/:projectId/unlock', apiRateLimiter, requirePermission('project.lock'), requireCriticalConfirmation, async (req, res) => {
    const projectId = req.params.projectId;
    if (!getProjectOrFail(projectId, res)) return;
    if (isMockMode) {
        return respondMockAction(req, res, 'project.unlock', projectId, { projectId, locked: false });
    }
    await controlCenter.setProjectLock(projectId, false);
    audit(req, 'project.unlock', projectId);
    res.status(200).json({ ok: true, projectId, locked: false });
});

app.post('/api/projects/:projectId/tasks/reset', apiRateLimiter, requirePermission('project.resetTasks'), requireCriticalConfirmation, async (req, res) => {
    const projectId = req.params.projectId;
    if (!getProjectOrFail(projectId, res)) return;
    if (isMockMode) {
        return respondMockAction(req, res, 'project.tasks.reset', projectId, { projectId, activeTasks: 0 });
    }
    await controlCenter.resetProjectTasks(projectId);
    audit(req, 'project.tasks.reset', projectId);
    res.status(200).json({ ok: true, projectId, activeTasks: 0 });
});

app.post('/api/projects/:projectId/pipeline/run', apiRateLimiter, requirePermission('pipeline.run'), requireCriticalConfirmation, async (req, res) => {
    try {
        const projectId = req.params.projectId;
        if (!getProjectOrFail(projectId, res)) return;
        if (isMockMode) {
            return respondMockAction(req, res, 'pipeline.run', projectId, { runnerId: `mock-${projectId}-pipeline` }, 202);
        }
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
        if (isMockMode) {
            return respondMockAction(req, res, 'issue.runOnce', projectId, {
                started: true,
                runnerId: `mock-${projectId}-issue-once`,
                issueNumber: null
            });
        }
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
        if (isMockMode) {
            return respondMockAction(req, res, 'background.runOnce', projectId, {
                runnerId: `mock-${projectId}-background-once`,
                label,
                tokenId
            }, 202);
        }
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
        if (isMockMode) {
            return respondMockAction(req, res, 'customLoop.start', projectId, {
                runnerId: `mock-${projectId}-custom-loop`,
                label,
                intervalMs,
                tokenId
            }, 202);
        }
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
        if (isMockMode) {
            return respondMockAction(req, res, 'prs.mergeOpen', projectId);
        }
        await mergeOpenPRs(project);
        audit(req, 'prs.mergeOpen', projectId);
        return res.status(200).json({ ok: true });
    } catch (error) {
        return res.status(500).json({ error: String(error?.message || error) });
    }
});

app.get('/health', rateLimiter, (req, res) => {
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
    if (isMockMode) {
        return res.status(200).json({
            ...summary,
            mockMode: true,
            message: `Mock mode active. ${summary.message}`
        });
    }
    res.status(200).json(summary);
});

app.post('/api/schedulers/:scheduler/start', apiRateLimiter, requirePermission('schedulers.control'), (req, res) => {
    const { scheduler } = req.params;
    const projectId = req.body?.projectId;
    if (isMockMode) {
        return respondMockAction(req, res, 'scheduler.start', scheduler, { scheduler, projectId: projectId || null });
    }
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
    if (isMockMode) {
        return respondMockAction(req, res, 'scheduler.stop', scheduler, { scheduler, projectId: projectId || null });
    }
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

export default app;
