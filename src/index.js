import { PROJECTS } from './config.js';
import { runBackgroundAgent } from './agents/background.js';
import { runWhatsAppAgent } from './agents/whatsapp.js';
import { scheduleBuildAndMergePipeline } from './agents/pipeline.js';

console.log("🚀 Démarrage du Super-Orchestrateur Multi-Projets...");

PROJECTS.forEach(project => {
  if (project.githubRepo) {
    // Initialisation de l'état en mémoire pour sécuriser les conflits Git
    project.state = {
      isLockedForDaily: false,
      activeTasks: 0
    };

    console.log(`⚙️  Initialisation du projet : ${project.id}`);

    // Lancement asynchrone des 3 cerveaux pour ce projet
    runBackgroundAgent(project);
    runWhatsAppAgent(project);
    scheduleBuildAndMergePipeline(project);
  }
});
