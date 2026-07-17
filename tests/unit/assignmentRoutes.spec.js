import { test, expect, vi } from 'vitest';
import esmock from 'esmock';
import express from 'express';

async function startTestApp(router) {
    const app = express();
    app.use(express.json());
    app.use('/assignments', router);
    const server = app.listen(0);
    const port = server.address().port;
    return {
        url: `http://127.0.0.1:${port}`,
        close: () => server.close()
    };
}

test('Assignment Routes - GET / returns list of enriched assignments', async () => {
    const mockAssignments = [
        { id: 1, project_id: 'p1', agent_id: 'a1', enabled: 1, wait_for_pr_merge: 0 }
    ];

    const assignmentRoutes = await esmock('../../src/routes/assignmentRoutes.js', {
        '../../src/db/database.js': {
            listAssignments: vi.fn(async () => mockAssignments)
        },
        '../../src/controlCenter.js': {
            controlCenter: {
                isAssignmentRunning: vi.fn((id) => id === 1),
                _invalidateAssignmentsCache: vi.fn()
            }
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next(),
            requireCriticalConfirmation: (req, res, next) => next(),
            audit: vi.fn()
        }
    });

    const { url, close } = await startTestApp(assignmentRoutes.default);

    try {
        const response = await fetch(url + '/assignments');
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.assignments.length).toBe(1);
        expect(data.assignments[0].running).toBe(true);
    } finally {
        close();
    }
});

test('Assignment Routes - POST /:id/run triggers one-shot run', async () => {
    const runAssignmentOnce = vi.fn(async () => 'run-789');
    const audit = vi.fn();

    const assignmentRoutes = await esmock('../../src/routes/assignmentRoutes.js', {
        '../../src/controlCenter.js': {
            controlCenter: {
                runAssignmentOnce
            }
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next(),
            requireCriticalConfirmation: (req, res, next) => next(),
            audit
        }
    });

    const { url, close } = await startTestApp(assignmentRoutes.default);

    try {
        const response = await fetch(url + '/assignments/123/run', { method: 'POST' });
        const data = await response.json();

        expect(response.status).toBe(202);
        expect(data.ok).toBe(true);
        expect(data.runnerId).toBe('run-789');
        expect(runAssignmentOnce).toHaveBeenCalledWith(123);
        expect(audit).toHaveBeenCalledWith(expect.anything(), 'assignment.runOnce', '123', { runnerId: 'run-789' });
    } finally {
        close();
    }
});

test('Assignment Routes - POST /:id/run handles errors', async () => {
    const assignmentRoutes = await esmock('../../src/routes/assignmentRoutes.js', {
        '../../src/controlCenter.js': {
            controlCenter: {
                runAssignmentOnce: vi.fn(async () => { throw new Error('Run failed'); })
            }
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next(),
            requireCriticalConfirmation: (req, res, next) => next(),
            audit: vi.fn()
        }
    });

    const { url, close } = await startTestApp(assignmentRoutes.default);

    try {
        const response = await fetch(url + '/assignments/123/run', { method: 'POST' });
        const data = await response.json();

        expect(response.status).toBe(500);
        expect(data.error).toBe('Run failed');
    } finally {
        close();
    }
});

test('Assignment Routes - DELETE /:id stops and deletes', async () => {
    const deleteAssignment = vi.fn();
    const stopAssignment = vi.fn();
    const _invalidateAssignmentsCache = vi.fn();
    const audit = vi.fn();

    const assignmentRoutes = await esmock('../../src/routes/assignmentRoutes.js', {
        '../../src/db/database.js': {
            deleteAssignment
        },
        '../../src/controlCenter.js': {
            controlCenter: {
                stopAssignment,
                _invalidateAssignmentsCache
            }
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next(),
            requireCriticalConfirmation: (req, res, next) => next(),
            audit
        }
    });

    const { url, close } = await startTestApp(assignmentRoutes.default);

    try {
        const response = await fetch(url + '/assignments/789', {
            method: 'DELETE'
        });
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.ok).toBe(true);
        expect(stopAssignment).toHaveBeenCalledWith(789);
        expect(deleteAssignment).toHaveBeenCalledWith(789);
        expect(_invalidateAssignmentsCache).toHaveBeenCalled();
        expect(audit).toHaveBeenCalledWith(expect.anything(), 'assignment.delete', '789');
    } finally {
        close();
    }
});

test('Assignment Routes - POST / creates and starts an assignment', async () => {
    const mockAssignment = { id: 123, project_id: 'p1', agent_id: 'a1', enabled: 1, wait_for_pr_merge: 1 };

    const createAssignment = vi.fn(async () => 123);
    const getAssignment = vi.fn(async (id) => id === 123 ? mockAssignment : null);
    const startAssignment = vi.fn();
    const _invalidateAssignmentsCache = vi.fn();
    const audit = vi.fn();

    const assignmentRoutes = await esmock('../../src/routes/assignmentRoutes.js', {
        '../../src/db/database.js': {
            createAssignment,
            getAssignment
        },
        '../../src/controlCenter.js': {
            controlCenter: {
                isAssignmentRunning: vi.fn(() => false),
                _invalidateAssignmentsCache,
                startAssignment
            }
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next(),
            requireCriticalConfirmation: (req, res, next) => next(),
            audit
        }
    });

    const { url, close } = await startTestApp(assignmentRoutes.default);

    try {
        const response = await fetch(url + '/assignments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ project_id: 'p1', agent_id: 'a1', wait_for_pr_merge: true })
        });
        const data = await response.json();

        expect(response.status).toBe(201);
        expect(data.ok).toBe(true);
        expect(data.assignment.id).toBe(123);
        expect(data.assignment.wait_for_pr_merge).toBe(1);
        expect(createAssignment).toHaveBeenCalledWith(expect.objectContaining({ wait_for_pr_merge: true }));
        expect(startAssignment).toHaveBeenCalledWith(123);
        expect(_invalidateAssignmentsCache).toHaveBeenCalled();
        expect(audit).toHaveBeenCalledWith(expect.anything(), 'assignment.create', '123', expect.anything());
    } finally {
        close();
    }
});

test('Assignment Routes - PUT /:id updates and restarts', async () => {
    const mockAssignment = { id: 456, project_id: 'p1', agent_id: 'a1', enabled: 1, wait_for_pr_merge: 1 };
    const updateAssignment = vi.fn();
    const stopAssignment = vi.fn();
    const startAssignment = vi.fn();

    const assignmentRoutes = await esmock('../../src/routes/assignmentRoutes.js', {
        '../../src/db/database.js': {
            getAssignment: vi.fn(async () => mockAssignment),
            updateAssignment
        },
        '../../src/controlCenter.js': {
            controlCenter: {
                isAssignmentRunning: vi.fn(() => true),
                _invalidateAssignmentsCache: vi.fn(),
                stopAssignment,
                startAssignment
            }
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next(),
            requireCriticalConfirmation: (req, res, next) => next(),
            audit: vi.fn()
        }
    });

    const { url, close } = await startTestApp(assignmentRoutes.default);

    try {
        const response = await fetch(url + '/assignments/456', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ wait_for_pr_merge: true, enabled: true })
        });
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(updateAssignment).toHaveBeenCalledWith(456, expect.objectContaining({ wait_for_pr_merge: true }));
        expect(stopAssignment).toHaveBeenCalledWith(456);
        expect(startAssignment).toHaveBeenCalledWith(456);
    } finally {
        close();
    }
});

test('Assignment Routes - POST /:id/toggle toggles assignment and handles start/stop', async () => {
    let currentEnabled = true;
    const mockAssignmentBefore = { id: 123, project_id: 'p1', agent_id: 'a1', enabled: 1 };
    const mockAssignmentAfter = { id: 123, project_id: 'p1', agent_id: 'a1', enabled: 0 };

    const toggleAssignment = vi.fn(async (id, enabled) => {
        currentEnabled = enabled;
    });
    const stopAssignment = vi.fn();
    const startAssignment = vi.fn();
    const _invalidateAssignmentsCache = vi.fn();
    const audit = vi.fn();

    const assignmentRoutes = await esmock('../../src/routes/assignmentRoutes.js', {
        '../../src/db/database.js': {
            getAssignment: vi.fn(async (id) => currentEnabled ? mockAssignmentBefore : mockAssignmentAfter),
            toggleAssignment
        },
        '../../src/controlCenter.js': {
            controlCenter: {
                isAssignmentRunning: vi.fn(() => false),
                _invalidateAssignmentsCache,
                stopAssignment,
                startAssignment
            }
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next(),
            requireCriticalConfirmation: (req, res, next) => next(),
            audit
        }
    });

    const { url, close } = await startTestApp(assignmentRoutes.default);

    try {
        // Toggle from enabled (1) to disabled (0)
        const response1 = await fetch(url + '/assignments/123/toggle', { method: 'POST' });
        const data1 = await response1.json();

        expect(response1.status).toBe(200);
        expect(data1.ok).toBe(true);
        expect(toggleAssignment).toHaveBeenCalledWith(123, false);
        expect(stopAssignment).toHaveBeenCalledWith(123);
        expect(startAssignment).not.toHaveBeenCalled();
        expect(_invalidateAssignmentsCache).toHaveBeenCalled();
        expect(audit).toHaveBeenCalledWith(expect.anything(), 'assignment.toggle', '123', { enabled: false });

        // Toggle from disabled (0) to enabled (1)
        const response2 = await fetch(url + '/assignments/123/toggle', { method: 'POST' });
        const data2 = await response2.json();

        expect(response2.status).toBe(200);
        expect(data2.ok).toBe(true);
        expect(toggleAssignment).toHaveBeenLastCalledWith(123, true);
        expect(startAssignment).toHaveBeenCalledWith(123);
        expect(audit).toHaveBeenLastCalledWith(expect.anything(), 'assignment.toggle', '123', { enabled: true });
    } finally {
        close();
    }
});

test('Assignment Routes - POST /:id/stop stops assignment', async () => {
    const stopAssignment = vi.fn();
    const audit = vi.fn();

    const assignmentRoutes = await esmock('../../src/routes/assignmentRoutes.js', {
        '../../src/controlCenter.js': {
            controlCenter: {
                stopAssignment
            }
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next(),
            requireCriticalConfirmation: (req, res, next) => next(),
            audit
        }
    });

    const { url, close } = await startTestApp(assignmentRoutes.default);

    try {
        const response = await fetch(url + '/assignments/999/stop', { method: 'POST' });
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.ok).toBe(true);
        expect(stopAssignment).toHaveBeenCalledWith(999);
        expect(audit).toHaveBeenCalledWith(expect.anything(), 'assignment.stop', '999');
    } finally {
        close();
    }
});

test('Assignment Routes - GET /:id/journal returns assignment journal with custom limit', async () => {
    const mockJournal = [
        { id: 1, session_id: 's1', assignment_id: 123, project_id: 'p1', agent_name: 'a1', status: 'completed' }
    ];
    const listJournalByAssignment = vi.fn(async (id, limit) => {
        expect(id).toBe(123);
        expect(limit).toBe(50);
        return mockJournal;
    });

    const assignmentRoutes = await esmock('../../src/routes/assignmentRoutes.js', {
        '../../src/db/database.js': {
            listJournalByAssignment
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next()
        }
    });

    const { url, close } = await startTestApp(assignmentRoutes.default);

    try {
        const response = await fetch(url + '/assignments/123/journal?limit=50');
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.journal).toEqual(mockJournal);
        expect(listJournalByAssignment).toHaveBeenCalledWith(123, 50);
    } finally {
        close();
    }
});

test('Assignment Routes - POST / handles database errors', async () => {
    const assignmentRoutes = await esmock('../../src/routes/assignmentRoutes.js', {
        '../../src/db/database.js': {
            createAssignment: vi.fn(async () => { throw new Error('Database create failure'); })
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next(),
            requireCriticalConfirmation: (req, res, next) => next(),
            audit: vi.fn()
        }
    });

    const { url, close } = await startTestApp(assignmentRoutes.default);

    try {
        const response = await fetch(url + '/assignments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ project_id: 'p1', agent_id: 'a1' })
        });
        const data = await response.json();

        expect(response.status).toBe(500);
        expect(data.error).toBe('Database create failure');
    } finally {
        close();
    }
});

test('Assignment Routes - POST /:id/toggle handles database errors', async () => {
    const assignmentRoutes = await esmock('../../src/routes/assignmentRoutes.js', {
        '../../src/db/database.js': {
            getAssignment: vi.fn(async () => { throw new Error('Database read failure'); })
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next(),
            requireCriticalConfirmation: (req, res, next) => next(),
            audit: vi.fn()
        }
    });

    const { url, close } = await startTestApp(assignmentRoutes.default);

    try {
        const response = await fetch(url + '/assignments/123/toggle', { method: 'POST' });
        const data = await response.json();

        expect(response.status).toBe(500);
        expect(data.error).toBe('Database read failure');
    } finally {
        close();
    }
});

test('Assignment Routes - PUT /:id handles database errors', async () => {
    const assignmentRoutes = await esmock('../../src/routes/assignmentRoutes.js', {
        '../../src/db/database.js': {
            getAssignment: vi.fn(async () => { throw new Error('Database update failure'); })
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next(),
            requireCriticalConfirmation: (req, res, next) => next(),
            audit: vi.fn()
        }
    });

    const { url, close } = await startTestApp(assignmentRoutes.default);

    try {
        const response = await fetch(url + '/assignments/456', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: true })
        });
        const data = await response.json();

        expect(response.status).toBe(500);
        expect(data.error).toBe('Database update failure');
    } finally {
        close();
    }
});

test('Assignment Routes - DELETE /:id handles database errors', async () => {
    const assignmentRoutes = await esmock('../../src/routes/assignmentRoutes.js', {
        '../../src/controlCenter.js': {
            controlCenter: {
                stopAssignment: vi.fn(async () => { throw new Error('ControlCenter stop failure'); })
            }
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next(),
            requireCriticalConfirmation: (req, res, next) => next(),
            audit: vi.fn()
        }
    });

    const { url, close } = await startTestApp(assignmentRoutes.default);

    try {
        const response = await fetch(url + '/assignments/789', {
            method: 'DELETE'
        });
        const data = await response.json();

        expect(response.status).toBe(500);
        expect(data.error).toBe('ControlCenter stop failure');
    } finally {
        close();
    }
});

test('Assignment Routes - GET /:id/journal handles database errors', async () => {
    const assignmentRoutes = await esmock('../../src/routes/assignmentRoutes.js', {
        '../../src/db/database.js': {
            listJournalByAssignment: vi.fn(async () => { throw new Error('Database journal failure'); })
        },
        '../../src/middleware/securityMiddleware.js': {
            apiRateLimiter: (req, res, next) => next()
        },
        '../../src/middleware/authMiddleware.js': {
            requirePermission: () => (req, res, next) => next()
        }
    });

    const { url, close } = await startTestApp(assignmentRoutes.default);

    try {
        const response = await fetch(url + '/assignments/123/journal');
        const data = await response.json();

        expect(response.status).toBe(500);
        expect(data.error).toBe('Database journal failure');
    } finally {
        close();
    }
});
