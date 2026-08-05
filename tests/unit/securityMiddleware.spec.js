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

        it('should set standard security headers exactly as expected for compliance', () => {
            req.path = '/';
            securityHeaders(req, res, next);
            expect(res.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
            expect(res.setHeader).toHaveBeenCalledWith('X-Frame-Options', 'DENY');
            expect(res.setHeader).toHaveBeenCalledWith('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
            expect(res.setHeader).toHaveBeenCalledWith('X-XSS-Protection', '0');
            expect(res.setHeader).toHaveBeenCalledWith('Referrer-Policy', 'no-referrer');
            expect(res.setHeader).toHaveBeenCalledWith('X-Download-Options', 'noopen');
            expect(res.setHeader).toHaveBeenCalledWith('X-Permitted-Cross-Domain-Policies', 'none');
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

        it('should fall back to x-forwarded-for header when IP is not present on request', () => {
            req.ip = undefined;
            req.get.mockReturnValue('1.1.1.1');

            rateLimiter(req, res, next);
            expect(req.get).toHaveBeenCalledWith('x-forwarded-for');
            expect(next).toHaveBeenCalled();
        });

        it('should fall back to remoteAddress when IP and x-forwarded-for header are not present', () => {
            req.ip = undefined;
            req.get.mockReturnValue(undefined);
            req.connection = { remoteAddress: '2.2.2.2' };

            rateLimiter(req, res, next);
            expect(next).toHaveBeenCalled();
        });

        it('should set correct Retry-After header with positive integer on 429 response', () => {
            req.ip = '3.3.3.3';
            for (let i = 0; i < 121; i++) {
                rateLimiter(req, res, next);
            }
            expect(res.status).toHaveBeenCalledWith(429);
            expect(res.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(Number));
        });

        it('should isolate requests and limits for different clients/IPs', () => {
            const reqA = { ip: 'client-a', get: vi.fn(), connection: { remoteAddress: 'client-a' } };
            const reqB = { ip: 'client-b', get: vi.fn(), connection: { remoteAddress: 'client-b' } };

            // Limit client-a to maximum requests
            for (let i = 0; i < 120; i++) {
                rateLimiter(reqA, res, next);
            }

            // 121st request for client-a should be rate-limited
            rateLimiter(reqA, res, next);
            expect(res.status).toHaveBeenCalledWith(429);

            // But client-b should still be allowed
            const nextB = vi.fn();
            rateLimiter(reqB, res, nextB);
            expect(nextB).toHaveBeenCalled();
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

        it('should fall back to x-forwarded-for header when IP is not present on request', () => {
            req.ip = undefined;
            req.get.mockReturnValue('10.10.10.10');

            apiRateLimiter(req, res, next);
            expect(req.get).toHaveBeenCalledWith('x-forwarded-for');
            expect(next).toHaveBeenCalled();
        });

        it('should fall back to remoteAddress when IP and x-forwarded-for header are not present', () => {
            req.ip = undefined;
            req.get.mockReturnValue(undefined);
            req.connection = { remoteAddress: '20.20.20.20' };

            apiRateLimiter(req, res, next);
            expect(next).toHaveBeenCalled();
        });

        it('should reset after window expires', () => {
            req.ip = '11.11.11.11';
            apiRateLimiter(req, res, next);
            expect(next).toHaveBeenCalledTimes(1);

            vi.advanceTimersByTime(61000); // Window is 60s

            apiRateLimiter(req, res, next);
            expect(next).toHaveBeenCalledTimes(2);
        });

        it('should set correct Retry-After header with positive integer on 429 response', () => {
            req.ip = '12.12.12.12';
            for (let i = 0; i < 251; i++) {
                apiRateLimiter(req, res, next);
            }
            expect(res.status).toHaveBeenCalledWith(429);
            expect(res.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(Number));
        });

        it('should isolate API requests and limits for different clients/IPs', () => {
            const reqA = { ip: 'client-api-a', get: vi.fn(), connection: { remoteAddress: 'client-api-a' } };
            const reqB = { ip: 'client-api-b', get: vi.fn(), connection: { remoteAddress: 'client-api-b' } };

            // Limit client-api-a to maximum requests
            for (let i = 0; i < 250; i++) {
                apiRateLimiter(reqA, res, next);
            }

            // 251st request for client-api-a should be rate-limited
            apiRateLimiter(reqA, res, next);
            expect(res.status).toHaveBeenCalledWith(429);

            // But client-api-b should still be allowed
            const nextB = vi.fn();
            apiRateLimiter(reqB, res, nextB);
            expect(nextB).toHaveBeenCalled();
        });
    });
});
