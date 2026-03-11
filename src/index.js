import express from 'express';
import { PROJECTS } from './config.js';
import { runBackgroundAgent } from './agents/background.js';
import { runWhatsAppAgent } from './agents/whatsapp.js';
import { scheduleBuildAndMergePipeline } from './agents/pipeline.js';
import { runSessionMonitor } from './agents/sessionMonitor.js';
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
    console.log(`🌐 Serveur de santé démarré sur le port ${PORT}`);
});

console.log("🚀 Démarrage du Super-Orchestrateur Multi-Projets...");

// Démarrage du moniteur global de sessions en arrière-plan
runSessionMonitor().catch(err => {
    console.error(`💥 Exception non gérée dans Session Monitor:`, err);
});

PROJECTS.forEach(project => {
  if (project.githubRepo) {
    // Initialisation de l'état en base de données SQLite
    initProjectState(project.id);

    console.log(`⚙️  Initialisation du projet : ${project.id}`);

    // Lancement asynchrone des 3 cerveaux pour ce projet
    runBackgroundAgent(project).catch(err => {
        console.error(`[${project.id}] 💥 Exception non gérée dans Background Agent:`, err);
    });

    runWhatsAppAgent(project).catch(err => {
        console.error(`[${project.id}] 💥 Exception non gérée dans WhatsApp Agent:`, err);
    });

    scheduleBuildAndMergePipeline(project);
  }
});
