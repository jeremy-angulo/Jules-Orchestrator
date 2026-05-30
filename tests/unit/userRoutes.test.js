import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';

// Mock dependencies
vi.mock('../../src/auth/dashboardAuth.js', () => ({
    listDashboardUsers: vi.fn(),
    createDashboardUser: vi.fn(),
    updateDashboardUserRole: vi.fn(),
    deleteDashboardUser: vi.fn()
}));

vi.mock('../../src/middleware/authMiddleware.js', () => ({
    requirePermission: () => (req, res, next) => next(),
    audit: vi.fn()
}));

vi.mock('../../src/middleware/securityMiddleware.js', () => ({
    apiRateLimiter: (req, res, next) => next()
}));

// We need to import the router AFTER mocking the dependencies
const userRoutes = (await import('../../src/routes/userRoutes.js')).default;
const { listDashboardUsers, createDashboardUser, updateDashboardUserRole, deleteDashboardUser } = await import('../../src/auth/dashboardAuth.js');
const { audit } = await import('../../src/middleware/authMiddleware.js');

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

describe('User Routes (Vitest)', () => {
    let appInfo;

    beforeEach(async () => {
        vi.clearAllMocks();
    });

    it('GET / returns list of users', async () => {
        const mockUsers = [{ id: 1, email: 'user1@example.com', role: 'admin' }];
        listDashboardUsers.mockResolvedValue(mockUsers);

        appInfo = await startTestApp(userRoutes);
        try {
            const response = await fetch(appInfo.url + '/');
            const data = await response.json();
            expect(response.status).toBe(200);
            expect(data.users).toEqual(mockUsers);
        } finally {
            appInfo.close();
        }
    });

    it('POST / creates a user', async () => {
        const newUser = { id: 1, email: 'new@example.com', role: 'editor' };
        createDashboardUser.mockResolvedValue(newUser);

        appInfo = await startTestApp(userRoutes);
        try {
            // Successful creation
            const response = await fetch(appInfo.url + '/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: 'new@example.com', password: 'password123', role: 'editor' })
            });
            const data = await response.json();
            expect(response.status).toBe(201);
            expect(data.ok).toBe(true);
            expect(data.user.email).toBe('new@example.com');
            expect(audit).toHaveBeenCalled();

            // Missing fields
            const failResponse = await fetch(appInfo.url + '/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: 'new@example.com' })
            });
            expect(failResponse.status).toBe(400);
        } finally {
            appInfo.close();
        }
    });

    it('PATCH /:id updates user role', async () => {
        const updatedUser = { id: '123', email: 'user@example.com', role: 'admin' };
        updateDashboardUserRole.mockResolvedValue(updatedUser);

        appInfo = await startTestApp(userRoutes);
        try {
            const response = await fetch(appInfo.url + '/123', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role: 'admin' })
            });
            const data = await response.json();
            expect(response.status).toBe(200);
            expect(data.ok).toBe(true);
            expect(updateDashboardUserRole).toHaveBeenCalledWith('123', 'admin');

            // Missing role
            const failResponse = await fetch(appInfo.url + '/123', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
            expect(failResponse.status).toBe(400);
        } finally {
            appInfo.close();
        }
    });

    it('DELETE /:id deletes user', async () => {
        deleteDashboardUser.mockResolvedValue(true);

        appInfo = await startTestApp(userRoutes);
        try {
            const response = await fetch(appInfo.url + '/456', {
                method: 'DELETE'
            });
            const data = await response.json();
            expect(response.status).toBe(200);
            expect(data.ok).toBe(true);
            expect(deleteDashboardUser).toHaveBeenCalledWith('456');
        } finally {
            appInfo.close();
        }
    });

    it('handles service errors', async () => {
        listDashboardUsers.mockRejectedValue(new Error('Database error'));

        appInfo = await startTestApp(userRoutes);
        try {
            const response = await fetch(appInfo.url + '/');
            const data = await response.json();
            expect(response.status).toBe(500);
            expect(data.error).toBe('Database error');
        } finally {
            appInfo.close();
        }
    });
});
