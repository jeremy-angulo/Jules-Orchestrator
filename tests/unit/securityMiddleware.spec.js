import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import esmock from 'esmock';

describe('securityMiddleware.js', () => {
    let securityMiddleware;
    let req, res, next;

    beforeEach(async () => {
        vi.useFakeTimers();
        // Use esmock to load a fresh instance of securityMiddleware under fake timers
        securityMiddleware = await esmock('../../src/middleware/securityMiddleware.js');

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
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('securityHeaders', () => {
        it('should set security headers for dashboard routes', () => {
            req.path = '/api/test';
            securityMiddleware.securityHeaders(req, res, next);
            expect(res.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
            expect(res.setHeader).toHaveBeenCalledWith('X-Frame-Options', 'DENY');
            const csp = res.setHeader.mock.calls.find(call => call[0] === 'Content-Security-Policy')[1];
            expect(csp).toContain("default-src 'self'");
            expect(next).toHaveBeenCalled();
        });

        it('should identify all dashboard routes correctly', () => {
            const dashboardPaths = ['/', '/api/v1', '/assets/logo.png', '/dashboard/home', '/login', '/auth/callback'];
            for (const p of dashboardPaths) {
                res.setHeader.mockClear();
                req.path = p;
                securityMiddleware.securityHeaders(req, res, next);
                const csp = res.setHeader.mock.calls.find(call => call[0] === 'Content-Security-Policy')[1];
                expect(csp).toContain("default-src 'self'");
            }
        });

        it('should set strict CSP for non-dashboard routes', () => {
            req.path = '/some-other-path';
            securityMiddleware.securityHeaders(req, res, next);
            const csp = res.setHeader.mock.calls.find(call => call[0] === 'Content-Security-Policy')[1];
            expect(csp).toContain("default-src 'none'");
            expect(next).toHaveBeenCalled();
        });

        it('should set standard security headers exactly as expected for compliance', () => {
            req.path = '/';
            securityMiddleware.securityHeaders(req, res, next);
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
            securityMiddleware.strictCors(req, res, next);
            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.end).toHaveBeenCalled();
            expect(next).not.toHaveBeenCalled();
        });

        it('should allow other methods', () => {
            req.method = 'GET';
            securityMiddleware.strictCors(req, res, next);
            expect(next).toHaveBeenCalled();
        });
    });

    describe('rateLimiter', () => {
        it('should allow requests within limit and block when exceeded', () => {
            const ip = '1.2.3.4';
            req.ip = ip;

            // 120 is the limit in the code
            for (let i = 0; i < 120; i++) {
                securityMiddleware.rateLimiter(req, res, next);
            }
            expect(next).toHaveBeenCalledTimes(120);
            expect(res.status).not.toHaveBeenCalledWith(429);

            securityMiddleware.rateLimiter(req, res, next);
            expect(res.status).toHaveBeenCalledWith(429);
            expect(res.send).toHaveBeenCalledWith(expect.stringContaining('Too many requests'));
        });

        it('should reset after window expires', () => {
            req.ip = '5.6.7.8';
            securityMiddleware.rateLimiter(req, res, next);
            expect(next).toHaveBeenCalledTimes(1);

            vi.advanceTimersByTime(61000); // Window is 60s

            securityMiddleware.rateLimiter(req, res, next);
            expect(next).toHaveBeenCalledTimes(2);
        });

        it('should fall back to x-forwarded-for header when IP is not present on request', () => {
            req.ip = undefined;
            req.get.mockReturnValue('1.1.1.1');

            securityMiddleware.rateLimiter(req, res, next);
            expect(req.get).toHaveBeenCalledWith('x-forwarded-for');
            expect(next).toHaveBeenCalled();
        });

        it('should fall back to remoteAddress when IP and x-forwarded-for header are not present', () => {
            req.ip = undefined;
            req.get.mockReturnValue(undefined);
            req.connection = { remoteAddress: '2.2.2.2' };

            securityMiddleware.rateLimiter(req, res, next);
            expect(next).toHaveBeenCalled();
        });

        it('should set correct Retry-After header with positive integer on 429 response', () => {
            req.ip = '3.3.3.3';
            for (let i = 0; i < 121; i++) {
                securityMiddleware.rateLimiter(req, res, next);
            }
            expect(res.status).toHaveBeenCalledWith(429);
            expect(res.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(Number));
        });

        it('should isolate requests and limits for different clients/IPs', () => {
            const reqA = { ip: 'client-a', get: vi.fn(), connection: { remoteAddress: 'client-a' } };
            const reqB = { ip: 'client-b', get: vi.fn(), connection: { remoteAddress: 'client-b' } };

            // Limit client-a to maximum requests
            for (let i = 0; i < 120; i++) {
                securityMiddleware.rateLimiter(reqA, res, next);
            }

            // 121st request for client-a should be rate-limited
            securityMiddleware.rateLimiter(reqA, res, next);
            expect(res.status).toHaveBeenCalledWith(429);

            // But client-b should still be allowed
            const nextB = vi.fn();
            securityMiddleware.rateLimiter(reqB, res, nextB);
            expect(nextB).toHaveBeenCalled();
        });
    });

    describe('apiRateLimiter', () => {
        it('should allow requests within limit and block when exceeded', () => {
            req.ip = '9.10.11.12';

            // 250 is the limit for API
            for (let i = 0; i < 250; i++) {
                securityMiddleware.apiRateLimiter(req, res, next);
            }
            expect(next).toHaveBeenCalledTimes(250);

            securityMiddleware.apiRateLimiter(req, res, next);
            expect(res.status).toHaveBeenCalledWith(429);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
        });

        it('should fall back to x-forwarded-for header when IP is not present on request', () => {
            req.ip = undefined;
            req.get.mockReturnValue('10.10.10.10');

            securityMiddleware.apiRateLimiter(req, res, next);
            expect(req.get).toHaveBeenCalledWith('x-forwarded-for');
            expect(next).toHaveBeenCalled();
        });

        it('should fall back to remoteAddress when IP and x-forwarded-for header are not present', () => {
            req.ip = undefined;
            req.get.mockReturnValue(undefined);
            req.connection = { remoteAddress: '20.20.20.20' };

            securityMiddleware.apiRateLimiter(req, res, next);
            expect(next).toHaveBeenCalled();
        });

        it('should reset after window expires', () => {
            req.ip = '11.11.11.11';
            securityMiddleware.apiRateLimiter(req, res, next);
            expect(next).toHaveBeenCalledTimes(1);

            vi.advanceTimersByTime(61000); // Window is 60s

            securityMiddleware.apiRateLimiter(req, res, next);
            expect(next).toHaveBeenCalledTimes(2);
        });

        it('should set correct Retry-After header with positive integer on 429 response', () => {
            req.ip = '12.12.12.12';
            for (let i = 0; i < 251; i++) {
                securityMiddleware.apiRateLimiter(req, res, next);
            }
            expect(res.status).toHaveBeenCalledWith(429);
            expect(res.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(Number));
        });

        it('should isolate API requests and limits for different clients/IPs', () => {
            const reqA = { ip: 'client-api-a', get: vi.fn(), connection: { remoteAddress: 'client-api-a' } };
            const reqB = { ip: 'client-api-b', get: vi.fn(), connection: { remoteAddress: 'client-api-b' } };

            // Limit client-api-a to maximum requests
            for (let i = 0; i < 250; i++) {
                securityMiddleware.apiRateLimiter(reqA, res, next);
            }

            // 251st request for client-api-a should be rate-limited
            securityMiddleware.apiRateLimiter(reqA, res, next);
            expect(res.status).toHaveBeenCalledWith(429);

            // But client-api-b should still be allowed
            const nextB = vi.fn();
            securityMiddleware.apiRateLimiter(reqB, res, nextB);
            expect(nextB).toHaveBeenCalled();
        });
    });

    describe('cleanup intervals', () => {
        it('should clean up expired entries in rateLimitMap after 10 minutes', async () => {
            const { rateLimiter } = securityMiddleware;

            // 1. Add client A (will be expired when interval runs)
            const reqA = { ip: 'client-a', get: vi.fn(), connection: { remoteAddress: 'client-a' } };
            rateLimiter(reqA, res, next);

            // 2. Advance time by 9.5 minutes (570,000 ms)
            await vi.advanceTimersByTimeAsync(9.5 * 60 * 1000);

            // 3. Add client B (will NOT be expired when interval runs because it was just added 30s ago)
            const reqB = { ip: 'client-b', get: vi.fn(), connection: { remoteAddress: 'client-b' } };
            const nextB = vi.fn();
            rateLimiter(reqB, res, nextB);

            // Let's exhaust client B's limits to 120 so we can verify its count/state is preserved
            for (let i = 1; i < 120; i++) {
                rateLimiter(reqB, res, nextB);
            }

            // 4. Advance time by 30 seconds (30,000 ms) to trigger the 10-minute interval callback
            await vi.advanceTimersByTimeAsync(30 * 1000);

            // At 10 minutes, the cleanup interval has run:
            // - client-a (first request at 0ms, now 10 mins old) > 60s -> should be deleted
            // - client-b (first request at 9.5 mins, now 30s old) <= 60s -> should NOT be deleted

            // Verify client-a was deleted (next request should be allowed and reset)
            const nextA2 = vi.fn();
            rateLimiter(reqA, res, nextA2);
            expect(nextA2).toHaveBeenCalled();

            // Verify client-b is still limited (it was at 120, so 121st request should be blocked)
            const resB = {
                status: vi.fn().mockReturnThis(),
                send: vi.fn().mockReturnThis(),
                setHeader: vi.fn()
            };
            rateLimiter(reqB, resB, nextB);
            expect(resB.status).toHaveBeenCalledWith(429);
        });

        it('should clean up expired entries in apiRateLimitMap after 10 minutes', async () => {
            const { apiRateLimiter } = securityMiddleware;

            // 1. Add client A
            const reqA = { ip: 'api-client-a', get: vi.fn(), connection: { remoteAddress: 'api-client-a' } };
            apiRateLimiter(reqA, res, next);

            // 2. Advance time by 9.5 minutes (570,000 ms)
            await vi.advanceTimersByTimeAsync(9.5 * 60 * 1000);

            // 3. Add client B and max its limits (250)
            const reqB = { ip: 'api-client-b', get: vi.fn(), connection: { remoteAddress: 'api-client-b' } };
            const nextB = vi.fn();
            apiRateLimiter(reqB, res, nextB);
            for (let i = 1; i < 250; i++) {
                apiRateLimiter(reqB, res, nextB);
            }

            // 4. Advance time by 30 seconds (30,000 ms) to trigger the 10-minute interval callback
            await vi.advanceTimersByTimeAsync(30 * 1000);

            // Verify client-a was deleted
            const nextA2 = vi.fn();
            apiRateLimiter(reqA, res, nextA2);
            expect(nextA2).toHaveBeenCalled();

            // Verify client-b is still limited (251st request blocked)
            const resB = {
                status: vi.fn().mockReturnThis(),
                json: vi.fn().mockReturnThis(),
                setHeader: vi.fn()
            };
            apiRateLimiter(reqB, resB, nextB);
            expect(resB.status).toHaveBeenCalledWith(429);
        });
    });
});
