import cron from 'node-cron';
import { sleep } from '../utils/helpers.js';
import { startAndMonitorSession } from '../api/julesClient.js';
import { createAndMergePR } from '../api/githubClient.js';

export function scheduleBuildAndMergePipeline(project) {
  if (!project.buildAndMergePipeline) return;

  cron.schedule(project.buildAndMergePipeline.cronSchedule, async () => {
    console.log(`\n[${project.id} - Pipeline] ⏰ Verrouillage du repo pour le Build & Merge...`);

    // 1. Lever le drapeau rouge
    project.state.isLockedForDaily = true;

    // 2. Attendre que les agents en cours finissent leur travail proprement
    while (project.state.activeTasks > 0) {
      console.log(`[${project.id} - Pipeline] ⏳ Attente de la fin de ${project.state.activeTasks} tâche(s) en cours...`);
      await sleep(15000);
    }

    console.log(`[${project.id} - Pipeline] 🚀 Repo libre ! Jules vérifie le build sur la branche ${project.buildAndMergePipeline.sourceBranch}.`);

    const pipeline = project.buildAndMergePipeline;
    const prompt = pipeline.prompt
      .replace(/{sourceBranch}/g, pipeline.sourceBranch)
      .replace(/{targetBranch}/g, pipeline.targetBranch);

    project.state.activeTasks++;

    // 3. Jules valide, nettoie et commit sur dev
    const success = await startAndMonitorSession(prompt, "Build & Merge Agent", project);

    // 4. Si Jules a réussi à stabiliser le build, Node.js crée la PR et la fusionne
    if (success) {
      await createAndMergePR(project, pipeline.sourceBranch, pipeline.targetBranch);
    } else {
      console.log(`[${project.id} - Pipeline] ⚠️ Jules a échoué à réparer le build. L'auto-merge est annulé par sécurité.`);
    }

    project.state.activeTasks--;

    // 5. Baisse du drapeau rouge, les agents de fond reprennent
    console.log(`[${project.id} - Pipeline] 🔓 Pipeline terminé ! Déverrouillage du repo.`);
    project.state.isLockedForDaily = false;
  });

  console.log(`[${project.id}] 🗓️ Pipeline planifié avec le cron : ${project.buildAndMergePipeline.cronSchedule}`);
}
