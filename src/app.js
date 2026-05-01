import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Middlewares
import { securityHeaders, strictCors } from './middleware/securityMiddleware.js';
import { attachDashboardUser, requireDashboardAuth } from './middleware/authMiddleware.js';

// Routes
import authRoutes from './routes/authRoutes.js';
import apiRouter from './routes/api.js';

// Helpers & Database
import { hasAnyDashboardUser } from './auth/dashboardAuth.js';
import { recordServiceCheck } from './db/database.js';

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, '..', 'public');

// 1. Basic Middlewares
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(securityHeaders);
app.use(strictCors);

// 2. IMPORTANT: User identification must come BEFORE any auth protection
app.use(attachDashboardUser);

// 3. Static assets
app.use('/assets', express.static(path.join(publicDir, 'assets')));

// 4. View Routes
app.get('/', async (req, res) => {
    if (!(await hasAnyDashboardUser())) return res.redirect('/login?setup=1');
    if (!req.dashboardUser) return res.redirect('/login');
    return res.redirect('/dashboard');
});

app.get('/login', (req, res) => {
    if (req.dashboardUser) return res.redirect('/dashboard');
    res.sendFile(path.join(publicDir, 'login.html'));
});

app.get('/dashboard', requireDashboardAuth, (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
});

// Health check (Public)
app.get('/health', async (req, res) => {
    await recordServiceCheck('website', true, { statusCode: 200, responseMs: 0, source: 'external_hit' });
    res.status(200).send('Orchestrator is alive');
});

// 5. Modular Routes
app.use('/auth', authRoutes);

// Group all /api routes behind auth (which now has user info from attachDashboardUser)
app.use('/api', requireDashboardAuth, apiRouter);

// Global Error Handler
app.use((err, req, res, next) => {
    console.error(`[GlobalError] ${req.method} ${req.url}:`, err);
    const isApi = req.url.startsWith('/api/') || req.url === '/api' || req.url.startsWith('/auth/');
    if (isApi) {
        return res.status(500).json({ error: 'Internal Server Error', message: String(err.message) });
    }
    res.status(500).send('Internal Server Error');
});

export default app;
