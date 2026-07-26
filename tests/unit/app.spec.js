import { describe, test, expect, vi, beforeEach } from 'vitest';
import esmock from 'esmock';
import request from 'supertest';
import express from 'express';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('App.js Server Unit Tests', () => {
    let app;
    let mockUser = null;
    let hasUsers = false;
    let recordServiceCheckMock = vi.fn();

    // Custom routers to verify routing registration
    const mockAuthRouter = express.Router();
    mockAuthRouter.get('/test-auth', (req, res) => {
        res.status(200).json({ ok: true, source: 'auth' });
    });
    mockAuthRouter.get('/trigger-error', (req, res, next) => {
        next(new Error('Auth endpoint failed'));
    });

    const mockApiRouter = express.Router();
    mockApiRouter.get('/test-api', (req, res) => {
        res.status(200).json({ ok: true, source: 'api' });
    });
    mockApiRouter.get('/trigger-error', (req, res, next) => {
        next(new Error('API endpoint failed'));
    });

    beforeEach(async () => {
        vi.clearAllMocks();
        mockUser = null;
        hasUsers = false;

        const targetPath = resolve(__dirname, '../../src/app.js');

        app = await esmock(targetPath, {
            [resolve(__dirname, '../../src/middleware/securityMiddleware.js')]: {
                securityHeaders: (req, res, next) => {
                    res.setHeader('X-Security-Test', 'enabled');
                    next();
                },
                strictCors: (req, res, next) => {
                    res.setHeader('Access-Control-Allow-Origin', '*');
                    next();
                }
            },
            [resolve(__dirname, '../../src/middleware/authMiddleware.js')]: {
                attachDashboardUser: (req, res, next) => {
                    if (mockUser) {
                        req.dashboardUser = mockUser;
                    }
                    next();
                },
                requireDashboardAuth: (req, res, next) => {
                    if (!req.dashboardUser) {
                        return res.redirect('/login');
                    }
                    next();
                }
            },
            [resolve(__dirname, '../../src/routes/authRoutes.js')]: mockAuthRouter,
            [resolve(__dirname, '../../src/routes/api.js')]: mockApiRouter,
            [resolve(__dirname, '../../src/auth/dashboardAuth.js')]: {
                hasAnyDashboardUser: async () => hasUsers
            },
            [resolve(__dirname, '../../src/services/metricsStore.js')]: {
                recordServiceCheck: recordServiceCheckMock
            }
        });
    });

    test('GET /health records service check and returns 200', async () => {
        const res = await request(app).get('/health');
        expect(res.status).toBe(200);
        expect(res.text).toBe('Orchestrator is alive');
        expect(recordServiceCheckMock).toHaveBeenCalledWith(
            'website',
            true,
            expect.objectContaining({ statusCode: 200, source: 'external_hit' })
        );
    });

    test('Security headers and CORS are set correctly', async () => {
        const res = await request(app).get('/health');
        expect(res.headers['x-security-test']).toBe('enabled');
        expect(res.headers['access-control-allow-origin']).toBe('*');
    });

    test('GET / redirects to /login?setup=1 when there are no users in DB', async () => {
        hasUsers = false;
        mockUser = null;

        const res = await request(app).get('/');
        expect(res.status).toBe(302);
        expect(res.headers.location).toBe('/login?setup=1');
    });

    test('GET / redirects to /login when users exist but no logged in session', async () => {
        hasUsers = true;
        mockUser = null;

        const res = await request(app).get('/');
        expect(res.status).toBe(302);
        expect(res.headers.location).toBe('/login');
    });

    test('GET / redirects to /dashboard when user is logged in', async () => {
        hasUsers = true;
        mockUser = { id: 1, email: 'user@example.com' };

        const res = await request(app).get('/');
        expect(res.status).toBe(302);
        expect(res.headers.location).toBe('/dashboard');
    });

    test('GET /login serves login page when not logged in', async () => {
        mockUser = null;

        const res = await request(app).get('/login');
        expect(res.status).toBe(200);
        expect(res.text).toContain('<!DOCTYPE html>');
        expect(res.text).toContain('Connexion');
    });

    test('GET /login redirects to /dashboard when already logged in', async () => {
        mockUser = { id: 1, email: 'user@example.com' };

        const res = await request(app).get('/login');
        expect(res.status).toBe(302);
        expect(res.headers.location).toBe('/dashboard');
    });

    test('GET /dashboard redirects to /login when not logged in', async () => {
        mockUser = null;

        const res = await request(app).get('/dashboard');
        expect(res.status).toBe(302);
        expect(res.headers.location).toBe('/login');
    });

    test('GET /dashboard serves index page when logged in', async () => {
        mockUser = { id: 1, email: 'user@example.com' };

        const res = await request(app).get('/dashboard');
        expect(res.status).toBe(200);
        expect(res.text).toContain('<!DOCTYPE html>');
        expect(res.text).toContain('Jules Orchestrator');
    });

    test('/auth routes are mounted and accessible', async () => {
        const res = await request(app).get('/auth/test-auth');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ok: true, source: 'auth' });
    });

    test('/api routes require authentication', async () => {
        mockUser = null;
        const res = await request(app).get('/api/test-api');
        expect(res.status).toBe(302);
        expect(res.headers.location).toBe('/login');
    });

    test('/api routes are accessible when authenticated', async () => {
        mockUser = { id: 1, email: 'user@example.com' };
        const res = await request(app).get('/api/test-api');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ok: true, source: 'api' });
    });

    test('Global Error Handler serves status 500 html/text for standard endpoints', async () => {
        const res = await request(app).get('/auth/trigger-error');
        expect(res.status).toBe(500);
        expect(res.body).toEqual({
            error: 'Internal Server Error',
            message: 'Auth endpoint failed'
        });
    });

    test('Global Error Handler returns JSON 500 for API routes', async () => {
        mockUser = { id: 1, email: 'user@example.com' };
        const res = await request(app).get('/api/trigger-error');
        expect(res.status).toBe(500);
        expect(res.body).toEqual({
            error: 'Internal Server Error',
            message: 'API endpoint failed'
        });
    });

    test('Global Error Handler returns 500 HTML/Text for other routes', async () => {
        recordServiceCheckMock.mockRejectedValueOnce(new Error('Database disconnect'));

        const res = await request(app).get('/health');
        expect(res.status).toBe(500);
        expect(res.text).toBe('Internal Server Error');
    });
});
