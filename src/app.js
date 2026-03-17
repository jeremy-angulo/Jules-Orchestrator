import express from 'express';

const app = express();

// Security configuration
app.disable('x-powered-by');

/**
 * Security headers middleware following Helmet best practices.
 */
export const securityHeaders = (req, res, next) => {
    // Prevents browsers from guessing the MIME type
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Prevents clickjacking
    res.setHeader('X-Frame-Options', 'DENY');
    // Basic CSP to prevent injection
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    // Strict-Transport-Security
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    // Disable XSS auditor as it can be used for data leakage
    res.setHeader('X-XSS-Protection', '0');
    // Control how much referrer information is sent
    res.setHeader('Referrer-Policy', 'no-referrer');
    // Prevents Internet Explorer from executing downloads in site's context
    res.setHeader('X-Download-Options', 'noopen');
    // Restricts Adobe Flash/PDF content from loading data from this domain
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    next();
};

/**
 * Strict CORS policy middleware.
 * Since this is a health check server for internal use (Render), we can be very restrictive.
 * We do not use 'null' as it is a security anti-pattern.
 */
export const strictCors = (req, res, next) => {
    // By not setting 'Access-Control-Allow-Origin', we default to same-origin.
    // For a health-check server, we typically don't need to allow any cross-origin requests.
    // We only explicitly handle preflight if needed, but here we prefer to be fully restrictive.

    if (req.method === 'OPTIONS') {
        // We do not want to allow any cross-origin OPTIONS requests.
        return res.status(403).end();
    }
    next();
};

app.use(securityHeaders);
app.use(strictCors);

app.get('/', (req, res) => {
    res.status(200).send('Orchestrator is alive');
});

app.get('/health', (req, res) => {
    res.status(200).send('Orchestrator is alive');
});

export default app;
