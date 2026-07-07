import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { securityHeaders, strictCors, rateLimiter, apiRateLimiter } from '../../src/middleware/securityMiddleware.js';

describe('securityMiddleware.js', () => {
    let req, res, next;

    beforeEach(() => {
        req = {
            path: '/',
            ip: '127.0.0.1',
            get: vi.fn(),
            connection: { remoteAddress: '127.0.0.1' }
        };
        res = {
            setHeader: vi.fn(),
            status: vi.fn().mockReturnThis(),
            send: vi.fn().mockReturnThis(),
            json: vi.fn().mockReturnThis(),
            end: vi.fn().mockReturnThis()
        };
        next = vi.fn();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('securityHeaders', () => {
        it('should set security headers for dashboard routes', () => {
            req.path = '/api/test';
            securityHeaders(req, res, next);
            expect(res.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
            expect(res.setHeader).toHaveBeenCalledWith('X-Frame-Options', 'DENY');
            const csp = res.setHeader.mock.calls.find(call => call[0] === 'Content-Security-Policy')[1];
            expect(csp).toContain("default-src 'self'");
            expect(next).toHaveBeenCalled();
        });

        it('should set strict CSP for non-dashboard routes', () => {
            req.path = '/some-other-path';
            securityHeaders(req, res, next);
            const csp = res.setHeader.mock.calls.find(call => call[0] === 'Content-Security-Policy')[1];
            expect(csp).toContain("default-src 'none'");
            expect(next).toHaveBeenCalled();
        });
    });

    describe('strictCors', () => {
        it('should block OPTIONS requests', () => {
            req.method = 'OPTIONS';
            strictCors(req, res, next);
            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.end).toHaveBeenCalled();
            expect(next).not.toHaveBeenCalled();
        });

        it('should allow other methods', () => {
            req.method = 'GET';
            strictCors(req, res, next);
            expect(next).toHaveBeenCalled();
        });
    });

    describe('rateLimiter', () => {
        it('should allow requests within limit and block when exceeded', () => {
            const ip = '1.2.3.4';
            req.ip = ip;

            // 120 is the limit in the code
            for (let i = 0; i < 120; i++) {
                rateLimiter(req, res, next);
            }
            expect(next).toHaveBeenCalledTimes(120);
            expect(res.status).not.toHaveBeenCalledWith(429);

            rateLimiter(req, res, next);
            expect(res.status).toHaveBeenCalledWith(429);
            expect(res.send).toHaveBeenCalledWith(expect.stringContaining('Too many requests'));
        });

        it('should reset after window expires', () => {
            req.ip = '5.6.7.8';
            rateLimiter(req, res, next);
            expect(next).toHaveBeenCalledTimes(1);

            vi.advanceTimersByTime(61000); // Window is 60s

            rateLimiter(req, res, next);
            expect(next).toHaveBeenCalledTimes(2);
        });
    });

    describe('apiRateLimiter', () => {
        it('should allow requests within limit and block when exceeded', () => {
            req.ip = '9.10.11.12';

            // 250 is the limit for API
            for (let i = 0; i < 250; i++) {
                apiRateLimiter(req, res, next);
            }
            expect(next).toHaveBeenCalledTimes(250);

            apiRateLimiter(req, res, next);
            expect(res.status).toHaveBeenCalledWith(429);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
        });
    });
});
