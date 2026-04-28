import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('Manual verification of src/app.js middleware logic', async (t) => {
    // Since we cannot easily import src/app.js due to missing/broken node_modules,
    // and esmock also seems unavailable or broken in this environment,
    // we use a slightly more robust way to extract and test the middleware.
    // We will extract the functions and their surrounding context.

    const appJsContent = readFileSync(join(process.cwd(), 'src/app.js'), 'utf8');

    const extractFunction = (name) => {
        const regex = new RegExp(`export const ${name} = \\(req, res, next\\) => \\{([\\s\\S]*?)\\};`);
        const match = appJsContent.match(regex);
        if (!match) throw new Error(`Could not find ${name} in src/app.js`);
        return new Function('req', 'res', 'next', match[1]);
    };

    const securityHeaders = extractFunction('securityHeaders');
    const strictCors = extractFunction('strictCors');

    // For rateLimiter, we need the rateLimitMap state
    const rateLimiterMatch = appJsContent.match(/export const rateLimiter = \(req, res, next\) => \{([\s\S]*?)\};/);
    if (!rateLimiterMatch) throw new Error('Could not find rateLimiter in src/app.js');
    const rateLimiterFactory = new Function('return (() => { const rateLimitMap = new Map(); return (req, res, next) => {' + rateLimiterMatch[1] + '}; })()');
    const rateLimiter = rateLimiterFactory();

    // Test Security Headers
    const headers = {};
    const res = {
        setHeader: (name, value) => {
            headers[name.toLowerCase()] = value;
        }
    };
    const req = { method: 'GET', get: () => null };
    let nextCalled = false;
    const next = () => { nextCalled = true; };

    securityHeaders(req, res, next);
    assert.strictEqual(nextCalled, true);
    assert.strictEqual(headers['x-content-type-options'], 'nosniff');
    assert.strictEqual(headers['x-frame-options'], 'DENY');
    assert.ok(headers['content-security-policy'].includes("default-src 'none'"));
    assert.strictEqual(headers['strict-transport-security'], 'max-age=15552000; includeSubDomains');
    assert.strictEqual(headers['x-xss-protection'], '0');
    assert.strictEqual(headers['referrer-policy'], 'no-referrer');
    assert.strictEqual(headers['x-download-options'], 'noopen');
    assert.strictEqual(headers['x-permitted-cross-domain-policies'], 'none');

    // Test Strict CORS
    nextCalled = false;
    const corsRes = {
        status: (code) => {
            corsRes.statusCode = code;
            return {
                end: () => { corsRes.ended = true; }
            };
        }
    };

    // Test GET request
    strictCors({ method: 'GET' }, corsRes, next);
    assert.strictEqual(nextCalled, true);

    // Test OPTIONS request
    nextCalled = false;
    strictCors({ method: 'OPTIONS' }, corsRes, next);
    assert.strictEqual(nextCalled, false);
    assert.strictEqual(corsRes.statusCode, 403);
    assert.strictEqual(corsRes.ended, true);

    // Test Rate Limiter
    const ip = '127.0.0.1';
    const rateReq = { ip, get: () => null };
    let nextCalledCount = 0;
    const rateNext = () => { nextCalledCount++; };
    let lastStatusCode = null;
    let lastBody = null;
    let lastHeaders = {};
    const rateRes = {
        setHeader: (name, value) => { lastHeaders[name] = value; },
        status: (code) => {
            lastStatusCode = code;
            return {
                send: (body) => { lastBody = body; }
            };
        }
    };

    // Test successful requests within limit
    for (let i = 0; i < 60; i++) {
        rateLimiter(rateReq, rateRes, rateNext);
    }
    assert.strictEqual(nextCalledCount, 60);
    assert.strictEqual(lastStatusCode, null);

    // Test request exceeding limit
    rateLimiter(rateReq, rateRes, rateNext);
    assert.strictEqual(nextCalledCount, 60);
    assert.strictEqual(lastStatusCode, 429);
    assert.strictEqual(lastBody, 'Too many requests, please try again later.');
    assert.ok(lastHeaders['Retry-After'] !== undefined);

    // Test different IP is not affected
    nextCalledCount = 0;
    lastStatusCode = null;
    rateLimiter({ ip: '127.0.0.2', get: () => null }, rateRes, rateNext);
    assert.strictEqual(nextCalledCount, 1);
    assert.strictEqual(lastStatusCode, null);
});

test('src/app.js disables x-powered-by', (t) => {
    const appJsContent = readFileSync(join(process.cwd(), 'src/app.js'), 'utf8');
    assert.ok(appJsContent.includes("app.disable('x-powered-by')"));
});
