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
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[sessionCookieName];
    req.dashboardUser = await getDashboardSessionUser(token);
    req.dashboardSessionToken = token;
    next();
};

export const requireDashboardAuth = (req, res, next) => {
    if (!req.dashboardUser) {
        if (req.path.startsWith('/api')) return res.status(401).json({ error: 'Authentication required.' });
        return res.redirect('/login');
    }
    next();
};

export const requirePermission = (permission) => (req, res, next) => {
    const expected = process.env.DASHBOARD_API_KEY;
    const provided = req.get('x-admin-key') || req.query.key;
    if (expected && provided && provided === expected) return next();
    if (!req.dashboardUser) return res.status(401).json({ error: 'Authentication required.' });
    if (!hasPermission(req.dashboardUser.role, permission)) {
        return res.status(403).json({ error: `Missing permission: ${permission}` });
    }
    next();
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
