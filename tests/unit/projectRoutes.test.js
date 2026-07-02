import { GLOBAL_CONFIG } from '../../src/config.js';
GLOBAL_CONFIG.JULES_MAIN_TOKEN = 'test-token';
GLOBAL_CONFIG.JULES_SECONDARY_TOKENS = [];

import test from 'node:test';
import assert from 'node:assert/strict';
import esmock from 'esmock';
import request from 'supertest';
import express from 'express';

test('Project Routes - GET /config returns list of project configs', async () => {
    const mockProjects = [{ id: 'p1', github_repo: 'repo1' }];
    const projectRoutes = await esmock('../../src/routes/projectRoutes.js', {
        '../../src/db/database.js': {
            listProjectsConfig: async () => mockProjects
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next(),
            audit: async () => {}
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        }
    });

    const app = express();
    app.use(express.json());
    app.use('/api/projects', projectRoutes);

    const res = await request(app).get('/api/projects/config');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.projects, mockProjects);
});

test('Project Routes - GET /:projectId/journal returns journal entries', async () => {
    const mockJournal = [{ session_id: 's1', project_id: 'p1', status: 'completed' }];
    const projectRoutes = await esmock('../../src/routes/projectRoutes.js', {
        '../../src/db/database.js': {
            listJournalByProject: async (pid, limit) => {
                assert.equal(pid, 'p1');
                assert.equal(limit, 50);
                return mockJournal;
            }
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next()
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        }
    });

    const app = express();
    app.use('/api/projects', projectRoutes);

    const res = await request(app).get('/api/projects/p1/journal');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.journal, mockJournal);
});

test('Project Routes - GET /:projectId/assignments returns enriched assignments', async () => {
    const mockAssignments = [{ id: 1, project_id: 'p1' }];
    const projectRoutes = await esmock('../../src/routes/projectRoutes.js', {
        '../../src/db/database.js': {
            listAssignments: async (pid) => mockAssignments
        },
        '../../src/controlCenter.js': {
            controlCenter: {
                isAssignmentRunning: (id) => id === 1
            }
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next()
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        }
    });

    const app = express();
    app.use('/api/projects', projectRoutes);

    const res = await request(app).get('/api/projects/p1/assignments');
    assert.equal(res.status, 200);
    assert.equal(res.body.assignments[0].running, true);
});

test('Project Routes - GET /:projectId/detail returns project runtime detail', async () => {
    const projectRoutes = await esmock('../../src/routes/projectRoutes.js', {
        '../../src/controlCenter.js': {
            controlCenter: {
                getProjectRuntime: async (pid) => ({
                    id: pid,
                    githubRepo: 'owner/repo',
                    githubBranch: 'main'
                }),
                listRunners: () => [],
                getStatus: async () => ({
                    projects: [{ id: 'p1', locked: false }]
                })
            }
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next()
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        }
    });

    const app = express();
    app.use('/api/projects', projectRoutes);

    const res = await request(app).get('/api/projects/p1/detail');
    assert.equal(res.status, 200);
    assert.equal(res.body.projectId, 'p1');
    assert.equal(res.body.project.githubRepo, 'owner/repo');
});
