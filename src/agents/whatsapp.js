import { sleep } from '../utils/helpers.js';
import { startAndMonitorSession } from '../api/julesClient.js';
import { getNextGitHubIssue, closeGitHubIssue } from '../api/githubClient.js';

export async function runWhatsAppAgent(project) {
  while (true) {
    try {
      if (project.state.isLockedForDaily) {
        await sleep(30000);
        continue;
      }

      const issue = await getNextGitHubIssue(project);
      if (issue) {
        project.state.activeTasks++;
        console.log(`\n[${project.id} - WhatsApp] 📥 Issue #${issue.number} reçue : ${issue.title}`);

        const instruction = `${issue.title}\n\n${issue.body || ""}`;
        const success = await startAndMonitorSession(instruction, "WhatsApp Agent", project);

        // On ferme l'Issue uniquement si Jules a réussi sa tâche
        if (success) {
          console.log(`[${project.id} - WhatsApp] 🔒 Tâche terminée, fermeture de l'Issue #${issue.number}.`);
          await closeGitHubIssue(project, issue.number);
        }
        project.state.activeTasks--;
      }

      // Vérification toutes les 30 secondes
      await sleep(30000);
    } catch (error) {
       console.error(`[${project.id}] ❌ Erreur critique dans la boucle WhatsApp :`, error);
       if (project.state.activeTasks > 0) {
           project.state.activeTasks--;
       }
       await sleep(60000);
    }
  }
}
