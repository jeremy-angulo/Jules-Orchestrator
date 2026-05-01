const rateLimitMap = new Map();
const apiRateLimitMap = new Map();

// Cleanup intervals
setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of rateLimitMap.entries()) {
        if (now - data.firstRequest > 60 * 1000) rateLimitMap.delete(ip);
    }
}, 10 * 60 * 1000).unref();

setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of apiRateLimitMap.entries()) {
        if (now - data.firstRequest > 60 * 1000) apiRateLimitMap.delete(ip);
    }
}, 10 * 60 * 1000).unref();

export const securityHeaders = (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    const reqPath = req.path || '';
    const isDashboardRoute = reqPath === '/' || reqPath.startsWith('/api') || reqPath.startsWith('/assets') || reqPath.startsWith('/dashboard') || reqPath.startsWith('/login') || reqPath.startsWith('/auth');
    if (isDashboardRoute) {
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    } else {
        res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    }
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    res.setHeader('X-XSS-Protection', '0');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Download-Options', 'noopen');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    next();
};

export const strictCors = (req, res, next) => {
    if (req.method === 'OPTIONS') return res.status(403).end();
    next();
};

export const rateLimiter = (req, res, next) => {
    const ip = req.ip || req.get('x-forwarded-for') || req.connection.remoteAddress;
    const now = Date.now();
    const windowMs = 60 * 1000;
    const limit = 120; // Increased from 60

    if (!rateLimitMap.has(ip)) {
        rateLimitMap.set(ip, { count: 1, firstRequest: now });
        return next();
    }
    const userData = rateLimitMap.get(ip);
    const msSinceFirst = now - userData.firstRequest;
    if (msSinceFirst > windowMs) {
        rateLimitMap.set(ip, { count: 1, firstRequest: now });
        return next();
    }
    if (userData.count >= limit) {
        const retryAfter = Math.ceil((windowMs - msSinceFirst) / 1000);
        res.setHeader('Retry-After', retryAfter);
        return res.status(429).send('Too many requests, please try again later.');
    }
    userData.count++;
    next();
};

export const apiRateLimiter = (req, res, next) => {
    const ip = req.ip || req.get('x-forwarded-for') || req.connection.remoteAddress;
    const now = Date.now();
    const windowMs = 60 * 1000;
    const limit = 250; // Increased from 80

    if (!apiRateLimitMap.has(ip)) {
        apiRateLimitMap.set(ip, { count: 1, firstRequest: now });
        return next();
    }
    const userData = apiRateLimitMap.get(ip);
    const msSinceFirst = now - userData.firstRequest;
    if (msSinceFirst > windowMs) {
        apiRateLimitMap.set(ip, { count: 1, firstRequest: now });
        return next();
    }
    if (userData.count >= limit) {
        const retryAfter = Math.ceil((windowMs - msSinceFirst) / 1000);
        res.setHeader('Retry-After', retryAfter);
        return res.status(429).json({ error: 'Too many API requests. Please retry later.' });
    }
    userData.count++;
    next();
};
