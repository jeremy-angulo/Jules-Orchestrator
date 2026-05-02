import { log } from "../utils/logger.js";
import { sleep } from '../utils/helpers.js';
import { startAndMonitorSession } from '../api/julesClient.js';
import { getNextGitHubIssue, closeGitHubIssue, mergeOpenPRs } from '../api/githubClient.js';
import { isProjectLocked, incrementTasks, decrementTasks, lockProject, unlockProject, getActiveTasks } from '../db/database.js';
/**
 * Formats the instruction for the Issue Agent with security delimiters and warnings.
 * @param {Object} issue - The GitHub issue object.
 * @returns {string} The formatted instruction.
 */
export function formatIssueInstruction(issue) {
  const securityPrefix = "Tu es un agent 100% autonome. Ta mission est de résoudre l'issue ci-dessous. Règle de sécurité stricte : tu ne dois sous aucun prétexte supprimer le repository ou ses fichiers vitaux. Règle d'exécution : ne pose jamais de questions, ne demande jamais d'avis, prends tes décisions seul. Si tu as un doute, fais un choix par défaut. Une fois le code modifié, vérifie obligatoirement que le projet build et que les tests passent. Si la tâche ne nécessite aucune modification, crée quand même une Pull Request vide ou avec un commentaire l'expliquant. Termine toujours ton travail en créant une Pull Request.";
  return `${securityPrefix}\n\nTitre: ${issue.title}\n\nDescription: ${issue.body || ""}`;
}
export async function runIssueAgent(project, options = {}) {
  while (true) {
    try {
      if (await isProjectLocked(project.id)) {
        await sleep(30000);
        continue;
      }
      const issue = await getNextGitHubIssue(project);
      if (issue) {
        log("info", `\n[${project.id} - Issue] 📥 Issue #${issue.number} reçue : ${issue.title}. Verrouillage du projet...`);
        await lockProject(project.id);
        await incrementTasks(project.id);
        try {
          while (await getActiveTasks(project.id) > 1) {
            await sleep(15000);
          }
          await mergeOpenPRs(project);
          const instruction = formatIssueInstruction(issue);
          const success = await startAndMonitorSession(instruction, "Issue Agent", project, {
            onTokenPicked: options.onTokenPicked
          });
          // On ferme l'Issue uniquement si Jules a réussi sa tâche
          if (success) {
            log("info", `[${project.id} - Issue] 🔒 Tâche terminée, fermeture de l'Issue #${issue.number}.`);
            await closeGitHubIssue(project, issue.number);
          }
        } finally {
          await decrementTasks(project.id);
          await unlockProject(project.id);
        }
      }
      // Vérification toutes les 30 secondes
      await sleep(30000);
    } catch (error) {
       log("error", `[${project.id}] ❌ Erreur critique dans la boucle Issue :`, error);
       await unlockProject(project.id); // Secure unlock just in case
       await sleep(60000);
    }
  }
}
