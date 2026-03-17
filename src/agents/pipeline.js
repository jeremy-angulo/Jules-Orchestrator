import cron from 'node-cron';
import { sleep } from '../utils/helpers.js';
import { startAndMonitorSession } from '../api/julesClient.js';
import { createAndMergePR } from '../api/githubClient.js';
import { lockProject, unlockProject, incrementTasks, decrementTasks, getActiveTasks } from '../db/database.js';
export function scheduleBuildAndMergePipeline(project) {
  if (!project.buildAndMergePipeline) return;
  cron.schedule(project.buildAndMergePipeline.cronSchedule, async () => {
    try {
      console.log(`\n[${project.id} - Pipeline] ⏰ Verrouillage du repo pour le Build & Merge...`);
      // 1. Lever le drapeau rouge
      await lockProject(project.id);
      // 2. Attendre que les agents en cours finissent leur travail proprement
      while (await getActiveTasks(project.id) > 0) {
        await sleep(15000);
      }
      console.log(`[${project.id} - Pipeline] 🚀 Repo libre ! Jules vérifie le build sur la branche ${project.buildAndMergePipeline.sourceBranch}.`);
      const pipeline = project.buildAndMergePipeline;
      const prompt = pipeline.prompt
        .replace(/{sourceBranch}/g, pipeline.sourceBranch)
        .replace(/{targetBranch}/g, pipeline.targetBranch);
      await incrementTasks(project.id);
      // 3. Jules valide, nettoie et commit sur dev
      const success = await startAndMonitorSession(prompt, "Build & Merge Agent", project);
      // 4. Si Jules a réussi à stabiliser le build, Node.js crée la PR et la fusionne
      if (success) {
        await createAndMergePR(project, pipeline.sourceBranch, pipeline.targetBranch);
      } else {
        console.log(`[${project.id} - Pipeline] ⚠️ Jules a échoué à réparer le build. L'auto-merge est annulé par sécurité.`);
      }
    } catch (error) {
        console.error(`[${project.id} - Pipeline] ❌ Erreur critique lors du Build & Merge :`, error);
    } finally {
        await decrementTasks(project.id);
        // 5. Baisse du drapeau rouge, les agents de fond reprennent
        await unlockProject(project.id);
    }
  });
}
