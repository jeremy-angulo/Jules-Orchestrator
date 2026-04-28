import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Middlewares
import { securityHeaders, strictCors } from './middleware/securityMiddleware.js';
import { attachDashboardUser, requireDashboardAuth } from './middleware/authMiddleware.js';

// Routes
import authRoutes from './routes/authRoutes.js';
import projectRoutes from './routes/projectRoutes.js';
import agentRoutes from './routes/agentRoutes.js';
import assignmentRoutes from './routes/assignmentRoutes.js';
import systemRoutes from './routes/systemRoutes.js';

// Helpers & Database
import { hasAnyDashboardUser } from './auth/dashboardAuth.js';
import { recordServiceCheck } from './db/database.js';

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, '..', 'public');

// Global Middlewares
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(securityHeaders);
app.use(strictCors);
app.use(attachDashboardUser);

// Static assets
app.use('/assets', express.static(path.join(publicDir, 'assets')));

// View Routes
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

// Modular API Routes
app.use('/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/agents', agentRoutes);
app.use('/api/assignments', assignmentRoutes);
app.use('/api', systemRoutes); // For global /status, /metrics, etc.

export default app;
