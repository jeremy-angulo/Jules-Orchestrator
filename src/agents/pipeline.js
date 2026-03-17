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

export function scheduleGlobalDailyPRMergePipeline(projects) {
  // Execute daily at 17:00 PM
  cron.schedule("0 17 * * *", async () => {
    try {
      console.log(`\n[Global PR Merge Pipeline] ⏰ Verrouillage de tous les repos pour la fusion des PRs de la journée...`);
      // 1. Lock all projects
      for (const project of projects) {
        lockProject(project.id);
      }

      // 2. Wait up to 1 hour (3600 seconds) for existing agents to finish across all projects
      let waited = 0;
      const timeout = 3600;
      let allTasksDone = false;

      while (!allTasksDone && waited < timeout) {
        let totalActiveTasks = 0;
        for (const project of projects) {
          totalActiveTasks += await getActiveTasks(project.id);
        }

        if (totalActiveTasks > 0) {
          await sleep(15000);
          waited += 15;
        } else {
          allTasksDone = true;
        }
      }

      if (waited >= timeout) {
          console.log(`[Global PR Merge Pipeline] ⚠️ Timeout atteint en attendant la fin des agents. Procéder quand même...`);
      }

      console.log(`[Global PR Merge Pipeline] 🚀 Lancement de l'agent global de résolution et fusion des PR.`);

      const orchestratorProject = {
        id: "Jules-Orchestrator",
        githubRepo: "jeremy-angulo/Jules-Orchestrator",
        githubBranch: "main",
        githubToken: process.env.GITHUB_TOKEN,
      };

      const prompt = `En utilisant la clé API GITHUB_TOKEN disponible dans ton environnement.
You are managing the following repositories: HomeFreeWorld and TrefleAI_IHM.
Role : You are the Chief Release Manager & Code Integrator Agent.
CRITICAL RULE: You are 100% autonomous. You do NOT ask for permission or wait.
MISSION: Daily End-of-Day Pull Request Merge & CI Verification.
STEP 1 (AUDIT PRs): Check all open Pull Requests in all managed repositories.
STEP 2 (MERGE & RESOLVE): For each PR, resolve any merge conflicts. If a PR is obsolete or duplicates work already done by another agent, close it with an explanation. Merge valid PRs into the main working branch (e.g., 'dev' or the configured source branch).
STEP 3 (STABILIZE): Ensure the newly merged code compiles and builds correctly for each project. Fix any errors autonomously.
STEP 4 (DEPLOY TO PREVIEW): Once the main working branch is stable, merge it into the 'preview' branch.
DO NOT STOP until the 'preview' branch is updated with the day's stable work across all managed repositories.`;

      const success = await startAndMonitorSession(prompt, "Global Daily PR Merge Agent", orchestratorProject);

      if (success) {
          console.log(`[Global PR Merge Pipeline] ✅ Fusion quotidienne des PR terminée avec succès.`);
      } else {
          console.log(`[Global PR Merge Pipeline] ❌ L'agent a échoué à fusionner et stabiliser les PR de la journée.`);
      }

    } catch (error) {
        console.error(`[Global PR Merge Pipeline] ❌ Erreur critique lors de la fusion des PR :`, error);
    } finally {
        // Unlock all projects
        for (const project of projects) {
          unlockProject(project.id);
        }
    }
  });
}
