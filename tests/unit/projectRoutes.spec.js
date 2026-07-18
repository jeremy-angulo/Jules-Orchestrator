import { test, expect, vi } from 'vitest';
import esmock from 'esmock';
import express from 'express';
import request from 'supertest';

const mockProject = {
    id: 'p1',
    githubRepo: 'owner/repo',
    githubBranch: 'main'
};

const setupRouter = async (mocks = {}) => {
    return await esmock('../../src/routes/projectRoutes.js', {
        '../../src/db/database.js': {
            listProjectsConfig: vi.fn(async () => [mockProject]),
            upsertProjectConfig: vi.fn(),
            getProjectConfig: vi.fn(async (id) => ({ id, github_repo: 'owner/repo' })),
            deleteProjectConfig: vi.fn(),
            deleteAssignmentsByProject: vi.fn(),
            listAgentSessions: vi.fn(async () => []),
            listJournalByProject: vi.fn(async () => []),
            listAssignments: vi.fn(async () => []),
            createAssignment: vi.fn(async () => 1),
            getAssignment: vi.fn(async (id) => ({ id, project_id: 'p1' })),
            ...mocks.database
        },
        '../../src/controlCenter.js': {
            controlCenter: {
                getProjectRuntime: vi.fn(async (id) => ({ id, githubRepo: 'owner/repo' })),
                init: vi.fn(),
                stopSchedulers: vi.fn(),
                startSchedulers: vi.fn(),
                listRunners: vi.fn(() => []),
                getStatus: vi.fn(async () => ({ projects: [{ id: 'p1', locked: true }] })),
                removeProject: vi.fn(),
                isAssignmentRunning: vi.fn(() => false),
                startAssignment: vi.fn(),
                setProjectLock: vi.fn(),
                resetProjectTasks: vi.fn(),
                runPipelineNow: vi.fn(async () => 'runner-123'),
                runBatchConflictNow: vi.fn(async () => 'runner-456'),
                ...mocks.controlCenter
            }
        },
        '../../src/api/julesClient.js': {
            getSource: vi.fn(async () => ({ githubRepo: { repo: 'new-repo', defaultBranch: { displayName: 'develop' } } })),
            ...mocks.julesClient
        },
        '../../src/services/githubService.js': {
            getCachedPRs: vi.fn(async () => []),
            invalidatePRCache: vi.fn(),
            ...mocks.githubService
        },
        '../../src/api/githubClient.js': {
            mergePRWithResult: vi.fn(async () => ({ status: 'merged' })),
            closePR: vi.fn(),
            ...mocks.githubClient
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next(),
            requireCriticalConfirmation: (req, res, next) => next(),
            audit: vi.fn(async () => {}),
            ...mocks.authMiddleware
        }
    });
};

const createApp = (router) => {
    const app = express();
    app.use(express.json());
    app.use('/projects', router);
    return app;
};

test('Project Routes - GET /config returns list of projects', async () => {
    const router = await setupRouter();
    const app = createApp(router);

    const res = await request(app).get('/projects/config');
    expect(res.status).toBe(200);
    expect(res.body.projects).toHaveLength(1);
    expect(res.body.projects[0].id).toBe('p1');
});

test('Project Routes - POST /config upserts and restarts schedulers', async () => {
    const upsertSpy = vi.fn();
    const router = await setupRouter({
        database: { upsertProjectConfig: upsertSpy }
    });
    const app = createApp(router);

    const res = await request(app)
        .post('/projects/config')
        .send({ id: 'p1', github_repo: 'owner/repo' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(upsertSpy).toHaveBeenCalled();
});

test('Project Routes - GET /:projectId/detail returns runtime info', async () => {
    const router = await setupRouter();
    const app = createApp(router);

    const res = await request(app).get('/projects/p1/detail');
    expect(res.status).toBe(200);
    expect(res.body.project.id).toBe('p1');
    expect(res.body.project.locked).toBe(true);
});

test('Project Routes - POST /add connects new project', async () => {
    const router = await setupRouter({
        controlCenter: { getProjectRuntime: vi.fn(async () => null) }
    });
    const app = createApp(router);

    const res = await request(app)
        .post('/projects/add')
        .send({ repoPath: 'owner/new-repo' });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.project.id).toBe('new-repo');
});

test('Project Routes - POST /:projectId/lock locks the project', async () => {
    const lockSpy = vi.fn();
    const router = await setupRouter({
        controlCenter: { setProjectLock: lockSpy }
    });
    const app = createApp(router);

    const res = await request(app).post('/projects/p1/lock');
    expect(res.status).toBe(200);
    expect(res.body.locked).toBe(true);
    expect(lockSpy).toHaveBeenCalledWith('p1', true);
});

test('Project Routes - DELETE /:projectId/delete removes the project', async () => {
    const deleteSpy = vi.fn();
    const router = await setupRouter({
        database: { deleteProjectConfig: deleteSpy }
    });
    const app = createApp(router);

    const res = await request(app).delete('/projects/p1/delete');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(deleteSpy).toHaveBeenCalledWith('p1');
});

test('Project Routes - GET /:projectId/prs returns PRs', async () => {
    const mockPrs = [{ number: 1, title: 'Fix bug' }];
    const router = await setupRouter({
        githubService: { getCachedPRs: vi.fn(async () => mockPrs) }
    });
    const app = createApp(router);

    const res = await request(app).get('/projects/p1/prs');
    expect(res.status).toBe(200);
    expect(res.body.prs).toEqual(mockPrs);
});

test('Project Routes - POST /:projectId/pipeline/run triggers pipeline', async () => {
    const router = await setupRouter();
    const app = createApp(router);

    const res = await request(app).post('/projects/p1/pipeline/run');
    expect(res.status).toBe(202);
    expect(res.body.runnerId).toBe('runner-123');
});

test('Project Routes - POST /:projectId/unlock unlocks the project', async () => {
    const unlockSpy = vi.fn();
    const router = await setupRouter({
        controlCenter: { setProjectLock: unlockSpy }
    });
    const app = createApp(router);

    const res = await request(app).post('/projects/p1/unlock');
    expect(res.status).toBe(200);
    expect(res.body.locked).toBe(false);
    expect(unlockSpy).toHaveBeenCalledWith('p1', false);
});

test('Project Routes - POST /:projectId/tasks/reset resets project active tasks', async () => {
    const resetSpy = vi.fn();
    const router = await setupRouter({
        controlCenter: { resetProjectTasks: resetSpy }
    });
    const app = createApp(router);

    const res = await request(app).post('/projects/p1/tasks/reset');
    expect(res.status).toBe(200);
    expect(res.body.activeTasks).toBe(0);
    expect(resetSpy).toHaveBeenCalledWith('p1');
});

test('Project Routes - PUT /:projectId updates project config successfully', async () => {
    const upsertSpy = vi.fn();
    const router = await setupRouter({
        database: { upsertProjectConfig: upsertSpy }
    });
    const app = createApp(router);

    const res = await request(app)
        .put('/projects/p1')
        .send({ github_repo: 'new/repo' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.project.github_repo).toBe('owner/repo');
    expect(upsertSpy).toHaveBeenCalled();
});

test('Project Routes - PUT /:projectId fails if github_repo is missing', async () => {
    const router = await setupRouter();
    const app = createApp(router);

    const res = await request(app)
        .put('/projects/p1')
        .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('github_repo is required.');
});

test('Project Routes - POST /:projectId/prs/merge-batch merges multiple PRs', async () => {
    const mergeSpy = vi.fn().mockResolvedValue({ status: 'merged' });
    const router = await setupRouter({
        githubClient: { mergePRWithResult: mergeSpy }
    });
    const app = createApp(router);

    const res = await request(app)
        .post('/projects/p1/prs/merge-batch')
        .send({ prNumbers: [100, 200] });

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(2);
    expect(res.body.results[0]).toEqual({ prNumber: 100, status: 'merged' });
    expect(mergeSpy).toHaveBeenCalledTimes(2);
});

test('Project Routes - POST /:projectId/prs/merge-batch fails if prNumbers is not an array', async () => {
    const router = await setupRouter();
    const app = createApp(router);

    const res = await request(app)
        .post('/projects/p1/prs/merge-batch')
        .send({ prNumbers: 'not-an-array' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('prNumbers array is required');
});

test('Project Routes - POST /:projectId/prs/close-batch closes multiple PRs and handles error', async () => {
    const closeSpy = vi.fn()
        .mockResolvedValueOnce()
        .mockRejectedValueOnce(new Error('GitHub Error'));
    const router = await setupRouter({
        githubClient: { closePR: closeSpy }
    });
    const app = createApp(router);

    const res = await request(app)
        .post('/projects/p1/prs/close-batch')
        .send({ prNumbers: [100, 200] });

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(2);
    expect(res.body.results[0]).toEqual({ prNumber: 100, status: 'closed' });
    expect(res.body.results[1]).toEqual({ prNumber: 200, status: 'failed', error: 'GitHub Error' });
    expect(closeSpy).toHaveBeenCalledTimes(2);
});

test('Project Routes - POST /:projectId/prs/close-batch fails if prNumbers is not an array', async () => {
    const router = await setupRouter();
    const app = createApp(router);

    const res = await request(app)
        .post('/projects/p1/prs/close-batch')
        .send({ prNumbers: 'not-an-array' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('prNumbers array is required');
});

test('Project Routes - POST /:projectId/batch-conflict/run triggers batch conflict resolver', async () => {
    const triggerSpy = vi.fn().mockResolvedValue('conflict-runner-id');
    const router = await setupRouter({
        controlCenter: { runBatchConflictNow: triggerSpy }
    });
    const app = createApp(router);

    const res = await request(app).post('/projects/p1/batch-conflict/run');
    expect(res.status).toBe(202);
    expect(res.body.runnerId).toBe('conflict-runner-id');
    expect(triggerSpy).toHaveBeenCalledWith('p1');
});

test('Project Routes - handles unknown project with 404 in getProjectOrFail', async () => {
    const router = await setupRouter({
        controlCenter: { getProjectRuntime: vi.fn(async () => null) }
    });
    const app = createApp(router);

    const res = await request(app).post('/projects/unknown-p/lock');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Unknown project: unknown-p');
});
