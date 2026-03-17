import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('Manual verification of src/app.js middleware logic', (t) => {
    // Since we cannot import src/app.js due to missing node_modules/express,
    // and we cannot use esmock for the same reason,
    // we will parse the file content to extract the middleware logic and eval it for testing.

    const appJsContent = readFileSync(join(process.cwd(), 'src/app.js'), 'utf8');

    // Extract securityHeaders function
    const securityHeadersMatch = appJsContent.match(/export const securityHeaders = \(req, res, next\) => \{([\s\S]*?)\};/);
    if (!securityHeadersMatch) throw new Error('Could not find securityHeaders in src/app.js');
    const securityHeadersLogic = securityHeadersMatch[1];
    const securityHeaders = new Function('req', 'res', 'next', securityHeadersLogic);

    // Extract strictCors function
    const strictCorsMatch = appJsContent.match(/export const strictCors = \(req, res, next\) => \{([\s\S]*?)\};/);
    if (!strictCorsMatch) throw new Error('Could not find strictCors in src/app.js');
    const strictCorsLogic = strictCorsMatch[1];
    const strictCors = new Function('req', 'res', 'next', strictCorsLogic);

    // Test Security Headers
    const headers = {};
    const res = {
        setHeader: (name, value) => {
            headers[name.toLowerCase()] = value;
        }
    };
    const req = { method: 'GET' };
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
});

test('src/app.js disables x-powered-by', (t) => {
    const appJsContent = readFileSync(join(process.cwd(), 'src/app.js'), 'utf8');
    assert.ok(appJsContent.includes("app.disable('x-powered-by')"));
});
