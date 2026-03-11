import { sleep } from '../utils/helpers.js';
import { startAndMonitorSession } from '../api/julesClient.js';
import { getNextGitHubIssue, closeGitHubIssue } from '../api/githubClient.js';
import { isProjectLocked, incrementTasks, decrementTasks } from '../db/database.js';

/**
 * Formats the instruction for the WhatsApp Agent with security delimiters and warnings.
 * @param {Object} issue - The GitHub issue object.
 * @returns {string} The formatted instruction.
 */
export function formatIssueInstruction(issue) {
  const securityPrefix = "Tu ne dois sous aucun prétexte supprimer partiellement ou totalement le repository.";
  return `${securityPrefix}\n\nTitre: ${issue.title}\n\nDescription: ${issue.body || ""}`;
}

export async function runWhatsAppAgent(project) {
  while (true) {
    try {
      if (isProjectLocked(project.id)) {
        await sleep(30000);
        continue;
      }

      const issue = await getNextGitHubIssue(project);
      if (issue) {
        incrementTasks(project.id);
        console.log(`\n[${project.id} - WhatsApp] 📥 Issue #${issue.number} reçue : ${issue.title}`);

      const instruction = formatIssueInstruction(issue);
      const success = await startAndMonitorSession(instruction, "WhatsApp Agent", project);

        // On ferme l'Issue uniquement si Jules a réussi sa tâche
        if (success) {
          console.log(`[${project.id} - WhatsApp] 🔒 Tâche terminée, fermeture de l'Issue #${issue.number}.`);
          await closeGitHubIssue(project, issue.number);
        }
        decrementTasks(project.id);
      }

      // Vérification toutes les 30 secondes
      await sleep(30000);
    } catch (error) {
       console.error(`[${project.id}] ❌ Erreur critique dans la boucle WhatsApp :`, error);
       decrementTasks(project.id);
       await sleep(60000);
    }
  }
}
