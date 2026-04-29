import { getDashboardSessionUser } from '../auth/dashboardAuth.js';
import { hasPermission } from '../auth/permissions.js';
import { recordAuditEvent } from '../db/database.js';

const sessionCookieName = 'orchestrator_session';

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

export const attachDashboardUser = async (req, res, next) => {
    // 1. Check for Admin API Key first
    const expectedKey = process.env.DASHBOARD_API_KEY;
    const providedKey = req.get('x-admin-key') || req.query.key;
    
    console.log(`[AuthDebug] Path: ${req.originalUrl}, Expected: ${expectedKey ? 'SET' : 'MISSING'}, Provided: ${providedKey ? 'SET' : 'MISSING'}`);

    if (expectedKey && providedKey && providedKey === expectedKey) {
        req.dashboardUser = { id: 0, email: 'admin@system', role: 'admin' };
        req.isAdminKey = true;
        return next();
    }

    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[sessionCookieName];
    req.dashboardUser = await getDashboardSessionUser(token);
    req.dashboardSessionToken = token;
    next();
};

export const requireDashboardAuth = (req, res, next) => {
    if (!req.dashboardUser) {
        const fullUrl = req.originalUrl || '';
        const isApi = fullUrl.startsWith('/api/') || fullUrl === '/api' || fullUrl.startsWith('/auth/');
        if (isApi) {
            return res.status(401).json({ error: 'Authentication required.' });
        }
        return res.redirect('/login');
    }
    next();
};

export const requirePermission = (permission) => (req, res, next) => {
    if (!req.dashboardUser) {
        return res.status(401).json({ error: 'Authentication required.' });
    }
    if (req.dashboardUser.role === 'admin' || hasPermission(req.dashboardUser.role, permission)) {
        return next();
    }
    return res.status(403).json({ error: `Missing permission: ${permission}` });
};

export const requireCriticalConfirmation = (req, res, next) => {
    const token = req.get('x-confirm-action');
    if (token !== 'CONFIRM') {
        return res.status(400).json({ error: 'Missing x-confirm-action=CONFIRM header for critical action.' });
    }
    next();
};

export const audit = async (req, action, target, details = null) => {
    const ip = req.ip || req.get('x-forwarded-for') || req.connection.remoteAddress || null;
    await recordAuditEvent({
        userId: req.dashboardUser?.id || null,
        userEmail: req.dashboardUser?.email || null,
        action,
        target,
        details,
        ip
    });
};
