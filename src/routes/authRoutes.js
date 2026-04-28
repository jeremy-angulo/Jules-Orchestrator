import express from 'express';
import { 
    hasAnyDashboardUser, 
    createDashboardUser, 
    authenticateDashboardUser, 
    createDashboardSession, 
    deleteDashboardSession 
} from '../auth/dashboardAuth.js';
import { apiRateLimiter } from '../middleware/securityMiddleware.js';

const router = express.Router();
const sessionCookieName = 'orchestrator_session';
const isProduction = process.env.NODE_ENV === 'production';

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const loginAttempts = new Map();

const getLoginAttemptState = (email) => {
    const key = String(email || '').trim().toLowerCase();
    const now = Date.now();
    const state = loginAttempts.get(key) || { count: 0, firstAttempt: now, lockedUntil: 0 };
    if (state.lockedUntil && state.lockedUntil < now) {
        state.count = 0; state.firstAttempt = now; state.lockedUntil = 0;
    }
    if (now - state.firstAttempt > LOGIN_LOCK_MS) {
        state.count = 0; state.firstAttempt = now;
    }
    loginAttempts.set(key, state);
    return state;
};

router.post('/bootstrap-admin', apiRateLimiter, async (req, res) => {
    try {
        if (await hasAnyDashboardUser()) return res.status(409).json({ error: 'Setup already completed.' });
        const { email, password } = req.body || {};
        const user = await createDashboardUser(email, password, 'admin');
        const session = await createDashboardSession(user.id);
        res.cookie(sessionCookieName, session.token, { httpOnly: true, secure: isProduction, sameSite: 'strict', path: '/', maxAge: session.expiresAt - Date.now() });
        return res.status(201).json({ ok: true, user });
    } catch (error) {
        return res.status(400).json({ error: String(error?.message || error) });
    }
});

router.post('/login', apiRateLimiter, async (req, res) => {
    const { email, password } = req.body || {};
    const state = getLoginAttemptState(email);
    if (state.lockedUntil && state.lockedUntil > Date.now()) {
        return res.status(429).json({ error: 'Too many failed login attempts. Account temporarily locked.' });
    }
    const user = await authenticateDashboardUser(email, password);
    if (!user) {
        state.count += 1;
        if (state.count >= LOGIN_MAX_ATTEMPTS) state.lockedUntil = Date.now() + LOGIN_LOCK_MS;
        return res.status(401).json({ error: 'Invalid credentials.' });
    }
    state.count = 0; state.lockedUntil = 0; state.firstAttempt = Date.now();
    const session = await createDashboardSession(user.id);
    res.cookie(sessionCookieName, session.token, { httpOnly: true, secure: isProduction, sameSite: 'strict', path: '/', maxAge: session.expiresAt - Date.now() });
    return res.status(200).json({ ok: true, user });
});

router.post('/logout', apiRateLimiter, async (req, res) => {
    await deleteDashboardSession(req.dashboardSessionToken);
    res.clearCookie(sessionCookieName, { path: '/' });
    return res.status(200).json({ ok: true });
});

router.get('/me', apiRateLimiter, async (req, res) => {
    if (!req.dashboardUser) return res.status(401).json({ authenticated: false });
    return res.status(200).json({ authenticated: true, user: req.dashboardUser, setupDone: await hasAnyDashboardUser() });
});

export default router;
