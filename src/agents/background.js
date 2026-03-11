import { sleep } from '../utils/helpers.js';
import { startAndMonitorSession } from '../api/julesClient.js';
import { isProjectLocked, incrementTasks, decrementTasks } from '../db/database.js';

export async function runBackgroundAgent(project) {
  if (!project.backgroundPrompts || project.backgroundPrompts.length === 0) {
      console.log(`[${project.id}] ℹ️ Aucun prompt background configuré pour ce projet.`);
      return;
  }

  // Parallélisation des prompts : un agent par prompt
  await Promise.all(project.backgroundPrompts.map(async (prompt, index) => {
    while (true) {
      try {
        // Vérification du verrouillage : Si le Pipeline quotidien se prépare, on attend.
        if (isProjectLocked(project.id)) {
          console.log(`[${project.id}] 🛑 Background Agent ${index} en pause (Le Pipeline quotidien arrive)...`);
          await sleep(60000);
          continue;
        }

        incrementTasks(project.id); // On bloque une place

        await startAndMonitorSession(prompt, `Background Agent ${index}`, project);

        decrementTasks(project.id); // On libère la place

        // Pause de 5 minutes entre chaque tâche de fond
        await sleep(300000);
      } catch (error) {
         console.error(`[${project.id}] ❌ Erreur critique dans la boucle background ${index} :`, error);
         // Assurer qu'on libère la place s'il y a eu une erreur et qu'on l'a incrémentée
         decrementTasks(project.id);
         // Attendre avant de réessayer pour éviter de spammer
         await sleep(60000);
      }
    }
  }));
}
