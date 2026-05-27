import test from 'node:test';
import assert from 'node:assert';
import esmock from 'esmock';
import express from 'express';

async function startTestApp(router) {
    const app = express();
    app.use(express.json());
    app.use('/', router);
    const server = app.listen(0);
    const port = server.address().port;
    return {
        url: `http://127.0.0.1:${port}`,
        close: () => server.close()
    };
}

const mockProject = {
    id: 'p1',
    githubRepo: 'owner/repo',
    githubBranch: 'main'
};

test('Project Routes - GET /config returns list of projects', async (t) => {
    const projectRoutes = await esmock('../../src/routes/projectRoutes.js', {
        '../../src/db/database.js': {
            listProjectsConfig: async () => [mockProject]
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: (perm) => (req, res, next) => next(),
            audit: async () => {}
        }
    });

    const { url, close } = await startTestApp(projectRoutes);

    try {
        const response = await fetch(url + '/config');
        const data = await response.json();

        assert.strictEqual(response.status, 200);
        assert.strictEqual(data.projects.length, 1);
        assert.strictEqual(data.projects[0].id, 'p1');
    } finally {
        close();
    }
});

test('Project Routes - POST /config upserts and restarts schedulers', async (t) => {
    let upserted = false;
    let inited = false;
    let stopped = false;
    let started = false;

    const projectRoutes = await esmock('../../src/routes/projectRoutes.js', {
        '../../src/db/database.js': {
            upsertProjectConfig: async () => { upserted = true; },
            getProjectConfig: async (id) => ({ id, github_repo: 'owner/repo' })
        },
        '../../src/controlCenter.js': {
            controlCenter: {
                init: async () => { inited = true; },
                stopSchedulers: async () => { stopped = true; },
                startSchedulers: async () => { started = true; }
            }
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: (perm) => (req, res, next) => next(),
            audit: async () => {}
        }
    });

    const { url, close } = await startTestApp(projectRoutes);

    try {
        const response = await fetch(url + '/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: 'p1', github_repo: 'owner/repo' })
        });
        const data = await response.json();

        assert.strictEqual(response.status, 200);
        assert.strictEqual(data.ok, true);
        assert.strictEqual(upserted, true);
        assert.strictEqual(inited, true);
        assert.strictEqual(stopped, true);
        assert.strictEqual(started, true);
    } finally {
        close();
    }
});

test('Project Routes - GET /:projectId/detail returns runtime info', async (t) => {
    const projectRoutes = await esmock('../../src/routes/projectRoutes.js', {
        '../../src/controlCenter.js': {
            controlCenter: {
                getProjectRuntime: async (id) => ({ id, githubRepo: 'owner/repo' }),
                listRunners: () => [],
                getStatus: async () => ({ projects: [{ id: 'p1', locked: true }] })
            }
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        }
    });

    const { url, close } = await startTestApp(projectRoutes);

    try {
        const response = await fetch(url + '/p1/detail');
        const data = await response.json();

        assert.strictEqual(response.status, 200);
        assert.strictEqual(data.project.id, 'p1');
        assert.strictEqual(data.project.locked, true);
    } finally {
        close();
    }
});

test('Project Routes - POST /add connects new project via Jules API', async (t) => {
    let upsertedData = null;

    const projectRoutes = await esmock('../../src/routes/projectRoutes.js', {
        '../../src/api/julesClient.js': {
            getSource: async () => ({ githubRepo: { repo: 'new-repo', defaultBranch: { displayName: 'develop' } } })
        },
        '../../src/db/database.js': {
            upsertProjectConfig: async (data) => { upsertedData = data; },
            getProjectConfig: async (id) => ({ id })
        },
        '../../src/controlCenter.js': {
            controlCenter: {
                getProjectRuntime: async () => null,
                init: async () => {}
            }
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: (perm) => (req, res, next) => next(),
            audit: async () => {}
        }
    });

    const { url, close } = await startTestApp(projectRoutes);

    try {
        const response = await fetch(url + '/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ repoPath: 'owner/new-repo' })
        });
        const data = await response.json();

        assert.strictEqual(response.status, 201);
        assert.strictEqual(data.ok, true);
        assert.strictEqual(upsertedData.id, 'new-repo');
        assert.strictEqual(upsertedData.github_branch, 'develop');
    } finally {
        close();
    }
});

test('Project Routes - POST /:projectId/lock locks the project', async (t) => {
    let lockedId = null;

    const projectRoutes = await esmock('../../src/routes/projectRoutes.js', {
        '../../src/controlCenter.js': {
            controlCenter: {
                getProjectRuntime: async (id) => ({ id }),
                setProjectLock: async (id, locked) => { if (locked) lockedId = id; }
            }
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: (perm) => (req, res, next) => next(),
            requireCriticalConfirmation: (req, res, next) => next(),
            audit: async () => {}
        }
    });

    const { url, close } = await startTestApp(projectRoutes);

    try {
        const response = await fetch(url + '/p1/lock', { method: 'POST' });
        const data = await response.json();

        assert.strictEqual(response.status, 200);
        assert.strictEqual(data.locked, true);
        assert.strictEqual(lockedId, 'p1');
    } finally {
        close();
    }
});

test('Project Routes - DELETE /:projectId/delete removes the project', async (t) => {
    let deletedId = null;

    const projectRoutes = await esmock('../../src/routes/projectRoutes.js', {
        '../../src/db/database.js': {
            deleteProjectConfig: async (id) => { deletedId = id; },
            deleteAssignmentsByProject: async () => {}
        },
        '../../src/controlCenter.js': {
            controlCenter: {
                removeProject: async () => {}
            }
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: (perm) => (req, res, next) => next(),
            requireCriticalConfirmation: (req, res, next) => next(),
            audit: async () => {}
        }
    });

    const { url, close } = await startTestApp(projectRoutes);

    try {
        const response = await fetch(url + '/p1/delete', { method: 'DELETE' });
        const data = await response.json();

        assert.strictEqual(response.status, 200);
        assert.strictEqual(data.ok, true);
        assert.strictEqual(deletedId, 'p1');
    } finally {
        close();
    }
});
