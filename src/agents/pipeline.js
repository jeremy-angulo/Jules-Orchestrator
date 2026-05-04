import { log } from "../utils/logger.js";
import cron from 'node-cron';
import { sleep } from '../utils/helpers.js';
import { startAndMonitorSession } from '../api/julesClient.js';
import { mergeOpenPRs } from '../api/githubClient.js';
import { lockProject, unlockProject, incrementTasks, decrementTasks, getActiveTasks } from '../db/database.js';
export async function runBuildAndMergePipelineOnce(project, options = {}) {
  if (!project.buildAndMergePipeline) {
    return;
  }

  const shouldStop = typeof options.shouldStop === 'function' ? options.shouldStop : () => false;

    try {
      log("info", `\n[${project.id} - Pipeline] ⏰ Verrouillage du repo pour la Pipeline...`);
      // 1. Lever le drapeau rouge
      await lockProject(project.id, 'pipeline');
      // 2. Attendre que les agents en cours finissent leur travail proprement (timeout 1h)
      let waited = 0;
      const timeout = 3600; // 1 heure en secondes
      while (await getActiveTasks(project.id) > 0 && waited < timeout) {
        if (shouldStop()) {
          log("info", `[${project.id} - Pipeline] 🛑 Arrêt demandé pendant l'attente des tâches actives.`);
          return;
        }
        await sleep(15000);
        waited += 15;
      }

      if (waited >= timeout) {
         log("info", `[${project.id} - Pipeline] ⚠️ Timeout d'une heure atteint, on force l'arrêt des agents restants...`);
         await lockProject(project.id, 'pipeline-timeout');
         if (typeof options.onTimeout === 'function') {
           await options.onTimeout(project.id);
         }
         // Attendre un peu que les agents s'arrêtent
         await sleep(10000);
      }

      log("info", `[${project.id} - Pipeline] 🚀 Repo libre ! Lancement de la pipeline de stabilisation.`);
      const pipeline = project.buildAndMergePipeline;
      const prompt = pipeline.prompt;
      await incrementTasks(project.id);

      // 3. Jules valide, nettoie et commit. Relance automatique jusqu'à la réussite.
      let success = false;
      const pipelineStartTime = Date.now();
      
      const PHASE_WORK_MS = 1.5 * 60 * 60 * 1000;      // 1h30
      const PHASE_WRAPUP_MS = 0.5 * 60 * 60 * 1000;    // 30min
      const PHASE_BUFFER_MS = 1.0 * 60 * 60 * 1000;    // 1h
      const TOTAL_TIMEOUT_MS = PHASE_WORK_MS + PHASE_WRAPUP_MS + PHASE_BUFFER_MS;

      while (!success) {
        const elapsed = Date.now() - pipelineStartTime;

        if (shouldStop()) {
            log("info", `[${project.id} - Pipeline] 🛑 Arrêt demandé pendant la boucle de stabilisation.`);
            break;
        }
        if (elapsed >= TOTAL_TIMEOUT_MS) {
            log("info", `[${project.id} - Pipeline] ⚠️ Timeout global du pipeline atteint (3h). Arrêt des tentatives.`);
            break;
        }

        let feedbackMessage = 'keep going';
        let currentPhase = 'pipeline-work';

        if (elapsed > (PHASE_WORK_MS + PHASE_WRAPUP_MS)) {
            // Buffer Phase
            feedbackMessage = 'FINAL CALL: Finish now and create the PR immediately. No more changes.';
            currentPhase = 'pipeline-buffer';
        } else if (elapsed > PHASE_WORK_MS) {
            // Wrap-up Phase
            feedbackMessage = 'Time is almost up. Please wrap up your current work, ensure everything is clean, and create the Pull Request now.';
            currentPhase = 'pipeline-wrapup';
        }

        await lockProject(project.id, currentPhase);

        success = await startAndMonitorSession(prompt, "Pipeline Agent", project, { 
            shouldStop,
            feedbackMessage,
            onTokenPicked: options.onTokenPicked,
            preferredTokenId: 'key-1'
        });

        if (success) {
          log("info", `[${project.id} - Pipeline] ✅ Pipeline terminée avec succès. Tentative de merge automatique...`);
          await mergeOpenPRs(project);
        } else {
          log("info", `[${project.id} - Pipeline] ⚠️ Jules a échoué (Phase: ${currentPhase}). On relance l'agent...`);
          await sleep(30000); // Attente avant de réessayer
        }
      }
    } catch (error) {
        log("error", `[${project.id} - Pipeline] ❌ Erreur critique lors de la Pipeline :`, error);
    } finally {
        await decrementTasks(project.id);

        // 5. Baisse du drapeau rouge, les agents de fond reprennent
        await unlockProject(project.id);
        log("info", `[${project.id} - Pipeline] 🔓 Projet déverrouillé, les agents repartent au galop !`);
    }
}

export function scheduleBuildAndMergePipeline(project, options = {}) {
  if (!project.buildAndMergePipeline || !project.buildAndMergePipeline.cronSchedule) return null;
  return cron.schedule(project.buildAndMergePipeline.cronSchedule, async () => {
    await runBuildAndMergePipelineOnce(project, options);
  });
}
