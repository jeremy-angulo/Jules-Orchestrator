import express from 'express';
import { PROJECTS } from './config.js';
import { runBackgroundAgent } from './agents/background.js';
import { runIssueAgent } from './agents/issueAgent.js';
import { scheduleBuildAndMergePipeline } from './agents/pipeline.js';
import { initProjectState } from './db/database.js';
// Serveur de santé pour Render
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => {
    res.status(200).send('Orchestrator is alive');
});
app.get('/health', (req, res) => {
    res.status(200).send('Orchestrator is alive');
});
app.listen(PORT, () => {
});
PROJECTS.forEach(project => {
  if (project.githubRepo) {
    // Initialisation de l'état en base de données SQLite
    initProjectState(project.id);
    // Lancement asynchrone des 3 cerveaux pour ce projet
    runBackgroundAgent(project).catch(err => {
        console.error(`[${project.id}] 💥 Exception non gérée dans Background Agent:`, err);
    });
    runIssueAgent(project).catch(err => {
        console.error(`[${project.id}] 💥 Exception non gérée dans Issue Agent:`, err);
    });
    scheduleBuildAndMergePipeline(project);
  }
});
