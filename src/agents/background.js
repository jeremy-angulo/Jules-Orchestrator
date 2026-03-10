import { sleep } from '../utils/helpers.js';
import { startAndMonitorSession } from '../api/julesClient.js';

export async function runBackgroundAgent(project) {
  let index = 0;
  while (true) {
    // Vérification du verrouillage : Si le Pipeline quotidien se prépare, on attend.
    if (project.state.isLockedForDaily) {
      console.log(`[${project.id}] 🛑 Background Agent en pause (Le Pipeline quotidien arrive)...`);
      await sleep(60000);
      continue;
    }

    if (!project.backgroundPrompts || project.backgroundPrompts.length === 0) {
      console.log(`[${project.id}] ⚠️ Aucun prompt de fond configuré. Le Background Agent s'arrête.`);
      return;
    }

    project.state.activeTasks++; // On bloque une place
    const prompt = project.backgroundPrompts[index % project.backgroundPrompts.length];

    await startAndMonitorSession(prompt, "Background Agent", project);

    project.state.activeTasks--; // On libère la place
    index++;

    // Pause de 5 minutes entre chaque tâche de fond
    await sleep(300000);
  }
}
