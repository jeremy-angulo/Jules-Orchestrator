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

test('Assignment Routes - GET / returns list of enriched assignments', async (t) => {
    const mockAssignments = [{ id: 1, project_id: 'p1', agent_id: 'a1', enabled: 1 }];

    const assignmentRoutes = await esmock('../../src/routes/assignmentRoutes.js', {
        '../../src/db/database.js': {
            listAssignments: async (projId) => mockAssignments
        },
        '../../src/controlCenter.js': {
            controlCenter: {
                isAssignmentRunning: (id) => id === 1,
                _invalidateAssignmentsCache: () => {}
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

    const { url, close } = await startTestApp(assignmentRoutes);

    try {
        const response = await fetch(url + '/');
        const data = await response.json();

        assert.strictEqual(response.status, 200);
        assert.strictEqual(data.assignments.length, 1);
        assert.strictEqual(data.assignments[0].running, true);
    } finally {
        close();
    }
});

test('Assignment Routes - POST / creates and starts an assignment', async (t) => {
    let startedId = null;
    let invalidated = false;

    const assignmentRoutes = await esmock('../../src/routes/assignmentRoutes.js', {
        '../../src/db/database.js': {
            createAssignment: async (data) => 123,
            getAssignment: async (id) => ({ id, project_id: 'p1', enabled: 1 })
        },
        '../../src/controlCenter.js': {
            controlCenter: {
                isAssignmentRunning: (id) => false,
                _invalidateAssignmentsCache: () => { invalidated = true; },
                startAssignment: async (id) => { startedId = id; }
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

    const { url, close } = await startTestApp(assignmentRoutes);

    try {
        const response = await fetch(url + '/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ project_id: 'p1', agent_id: 'a1' })
        });
        const data = await response.json();

        assert.strictEqual(response.status, 201);
        assert.strictEqual(data.ok, true);
        assert.strictEqual(data.assignment.id, 123);
        assert.strictEqual(startedId, 123);
        assert.strictEqual(invalidated, true);
    } finally {
        close();
    }
});

test('Assignment Routes - POST /:id/toggle toggles and restarts if enabled', async (t) => {
    let toggledTo = null;
    let stoppedId = null;
    let startedId = null;

    const assignmentRoutes = await esmock('../../src/routes/assignmentRoutes.js', {
        '../../src/db/database.js': {
            getAssignment: async (id) => ({ id, enabled: toggledTo === null ? 0 : 1 }),
            toggleAssignment: async (id, enabled) => { toggledTo = enabled; }
        },
        '../../src/controlCenter.js': {
            controlCenter: {
                isAssignmentRunning: (id) => false,
                _invalidateAssignmentsCache: () => {},
                startAssignment: async (id) => { startedId = id; },
                stopAssignment: async (id) => { stoppedId = id; }
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

    const { url, close } = await startTestApp(assignmentRoutes);

    try {
        // Toggle ON
        const response = await fetch(url + '/123/toggle', { method: 'POST' });
        const data = await response.json();

        assert.strictEqual(response.status, 200);
        assert.strictEqual(toggledTo, true);
        assert.strictEqual(startedId, 123);
    } finally {
        close();
    }
});
