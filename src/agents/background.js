import { sleep } from '../utils/helpers.js';
import { startAndMonitorSession } from '../api/julesClient.js';

export async function runBackgroundAgent(project) {
  let index = 0;

  if (!project.backgroundPrompts || project.backgroundPrompts.length === 0) {
      console.log(`[${project.id}] ℹ️ Aucun prompt background configuré pour ce projet.`);
      return;
  }

  while (true) {
    try {
      // Vérification du verrouillage : Si le Pipeline quotidien se prépare, on attend.
      if (project.state.isLockedForDaily) {
        console.log(`[${project.id}] 🛑 Background Agent en pause (Le Pipeline quotidien arrive)...`);
        await sleep(60000);
        continue;
      }

      project.state.activeTasks++; // On bloque une place
      const prompt = project.backgroundPrompts[index % project.backgroundPrompts.length];

      await startAndMonitorSession(prompt, "Background Agent", project);

      project.state.activeTasks--; // On libère la place
      index++;

      // Pause de 5 minutes entre chaque tâche de fond
      await sleep(300000);
    } catch (error) {
       console.error(`[${project.id}] ❌ Erreur critique dans la boucle background :`, error);
       // Assurer qu'on libère la place s'il y a eu une erreur et qu'on l'a incrémentée
       if (project.state.activeTasks > 0) {
           project.state.activeTasks--;
       }
       // Attendre avant de réessayer pour éviter de spammer
       await sleep(60000);
    }
  }
}
