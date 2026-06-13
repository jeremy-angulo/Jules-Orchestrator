import { test, expect, vi } from 'vitest';
import esmock from 'esmock';
import express from 'express';
import request from 'supertest';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

test('api.js - registers modular routes and handles session retrieval', async () => {
    const mockSession = { id: 'test-session', status: 'COMPLETED' };
    const mockActivities = { activities: [{ id: 'activity-1' }] };

    const targetPath = resolve(__dirname, '../../src/routes/api.js');

    const apiRouter = await esmock(targetPath, {
        [resolve(__dirname, '../../src/api/julesClient.js')]: {
            getSession: vi.fn(async (agent, id) => {
                if (id === 'test-session' || id === 'sessions/test-session') return mockSession;
                throw new Error('Not found');
            }),
            listActivities: vi.fn(async (agent, id) => mockActivities),
        },
        [resolve(__dirname, '../../src/api/githubClient.js')]: {
            mergeOpenPRs: vi.fn(),
            closePR: vi.fn(),
            mergePRWithResult: vi.fn(),
        },
        [resolve(__dirname, '../../src/services/githubService.js')]: {
            getCachedPRs: vi.fn(),
            invalidatePRCache: vi.fn(),
        },
        [resolve(__dirname, '../../src/db/database.js')]: {
            listAgentSessions: vi.fn(),
            upsertProjectConfig: vi.fn(),
            getProjectConfig: vi.fn(),
            deleteProjectConfig: vi.fn(),
            deleteAssignmentsByProject: vi.fn(),
            listAssignments: vi.fn(),
            toggleAssignment: vi.fn(),
            createAssignment: vi.fn(),
            deleteAssignment: vi.fn(),
            listAgents: vi.fn(),
            getAgent: vi.fn(),
            createAgent: vi.fn(),
            updateAgent: vi.fn(),
            deleteAgent: vi.fn(),
            reorderAgents: vi.fn(),
            listAuditEvents: vi.fn(),
        },
        [resolve(__dirname, '../../src/api/tokenRotation.js')]: {
            getTokenStatusSummary: vi.fn(),
        },
        [resolve(__dirname, '../../src/middleware/securityMiddleware.js')]: {
            apiRateLimiter: (req, res, next) => next(),
        },
        [resolve(__dirname, '../../src/middleware/authMiddleware.js')]: {
            requirePermission: () => (req, res, next) => {
                req.user = { role: 'admin' };
                next();
            },
            requireCriticalConfirmation: (req, res, next) => next(),
            audit: async () => {},
        },
        [resolve(__dirname, '../../src/routes/projectRoutes.js')]: express.Router(),
        [resolve(__dirname, '../../src/routes/agentRoutes.js')]: express.Router(),
        [resolve(__dirname, '../../src/routes/assignmentRoutes.js')]: express.Router(),
        [resolve(__dirname, '../../src/routes/systemRoutes.js')]: express.Router(),
        [resolve(__dirname, '../../src/routes/julesRoutes.js')]: express.Router(),
        [resolve(__dirname, '../../src/routes/userRoutes.js')]: express.Router(),
        [resolve(__dirname, '../../src/routes/siteCheckRoutes.js')]: express.Router(),
    });

    const app = express();
    app.use(express.json());
    app.use('/api', apiRouter);

    // Test session retrieval - Success
    const successRes = await request(app).get('/api/sessions/test-session');
    expect(successRes.status).toBe(200);
    expect(successRes.body.session).toEqual(mockSession);
    expect(successRes.body.activities).toEqual(mockActivities.activities);

    // Test session retrieval - Not Found
    const notFoundRes = await request(app).get('/api/sessions/unknown-session');
    expect(notFoundRes.status).toBe(404);
    expect(notFoundRes.body.error).toBe('Session not found');

    // Test session retrieval - Encoded ID
    const encodedRes = await request(app).get('/api/sessions/sessions%2Ftest-session');
    expect(encodedRes.status).toBe(200);
    expect(encodedRes.body.session).toEqual(mockSession);
});

test('api.js - handles errors in session retrieval', async () => {
    const targetPath = resolve(__dirname, '../../src/routes/api.js');

    const apiRouter = await esmock(targetPath, {
        [resolve(__dirname, '../../src/api/julesClient.js')]: {
            getSession: vi.fn(async () => {
                throw new Error('API Error');
            }),
            listActivities: vi.fn(async () => {
                throw new Error('API Error');
            }),
        },
        [resolve(__dirname, '../../src/api/githubClient.js')]: {
            mergeOpenPRs: vi.fn(),
            closePR: vi.fn(),
            mergePRWithResult: vi.fn(),
        },
        [resolve(__dirname, '../../src/services/githubService.js')]: {
            getCachedPRs: vi.fn(),
            invalidatePRCache: vi.fn(),
        },
        [resolve(__dirname, '../../src/db/database.js')]: {
            listAgentSessions: vi.fn(),
            upsertProjectConfig: vi.fn(),
            getProjectConfig: vi.fn(),
            deleteProjectConfig: vi.fn(),
            deleteAssignmentsByProject: vi.fn(),
            listAssignments: vi.fn(),
            toggleAssignment: vi.fn(),
            createAssignment: vi.fn(),
            deleteAssignment: vi.fn(),
            listAgents: vi.fn(),
            getAgent: vi.fn(),
            createAgent: vi.fn(),
            updateAgent: vi.fn(),
            deleteAgent: vi.fn(),
            reorderAgents: vi.fn(),
            listAuditEvents: vi.fn(),
        },
        [resolve(__dirname, '../../src/api/tokenRotation.js')]: {
            getTokenStatusSummary: vi.fn(),
        },
        [resolve(__dirname, '../../src/middleware/securityMiddleware.js')]: {
            apiRateLimiter: (req, res, next) => next(),
        },
        [resolve(__dirname, '../../src/middleware/authMiddleware.js')]: {
            requirePermission: () => (req, res, next) => next(),
            requireCriticalConfirmation: (req, res, next) => next(),
            audit: async () => {},
        },
        [resolve(__dirname, '../../src/routes/projectRoutes.js')]: express.Router(),
        [resolve(__dirname, '../../src/routes/agentRoutes.js')]: express.Router(),
        [resolve(__dirname, '../../src/routes/assignmentRoutes.js')]: express.Router(),
        [resolve(__dirname, '../../src/routes/systemRoutes.js')]: express.Router(),
        [resolve(__dirname, '../../src/routes/julesRoutes.js')]: express.Router(),
        [resolve(__dirname, '../../src/routes/userRoutes.js')]: express.Router(),
        [resolve(__dirname, '../../src/routes/siteCheckRoutes.js')]: express.Router(),
    });

    const app = express();
    app.use('/api', apiRouter);

    const res = await request(app).get('/api/sessions/any-session');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('API Error');
});
