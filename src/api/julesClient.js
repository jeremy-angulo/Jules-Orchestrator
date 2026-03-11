import { GLOBAL_CONFIG } from '../config.js';
import { sleep } from '../utils/helpers.js';

const JULES_API_BASE = "https://jules.googleapis.com/v1alpha";

export async function julesAPI(endpoint, method = 'GET', body = null) {
  const options = {
    method,
    headers: { 'X-Goog-Api-Key': `${GLOBAL_CONFIG.JULES_API_TOKEN}`, 'Content-Type': 'application/json' }
  };
  if (body) options.body = JSON.stringify(body);
  try {
    const res = await fetch(`${JULES_API_BASE}${endpoint}`, options);
    if (!res.ok) {
      console.error(`[julesAPI] Error API: ${res.status} ${res.statusText}`);
      return null;
    }
    return await res.json();
  } catch (error) {
    console.error(`[julesAPI] Network Error:`, error);
    return null;
  }
}

export async function startAndMonitorSession(instruction, agentName, project) {
  // On force le contexte du repository pour que Jules ne se perde pas
  const contextualizedInstruction = `[CONTEXTE: Tu dois travailler UNIQUEMENT sur le repository GitHub "${project.githubRepo}"]\n\n${instruction}`;
  console.log(`\n[${project.id} - ${agentName}] 🟢 Lancement de la session Jules...`);

  try {
    const session = await julesAPI('/sessions', 'POST', { prompt: contextualizedInstruction });
    if (!session || !session.name) {
      console.error(`[${project.id} - ${agentName}] ❌ Erreur de création de session.`);
      return false;
    }

    let sessionName = session.name;

    // Boucle de surveillance infinie jusqu'à complétion ou échec
    while (true) {
      const state = await julesAPI(`/${sessionName}`);

      if (!state) {
        console.error(`[${project.id} - ${agentName}] ⚠️ Impossible de récupérer l'état de la session (retour nul). Nouvelle tentative dans ${GLOBAL_CONFIG.POLLING_INTERVAL}ms...`);
        await sleep(GLOBAL_CONFIG.POLLING_INTERVAL);
        continue;
      }

      if (state.status === 'WAITING_FOR_PLAN_APPROVAL') {
        console.log(`[${project.id} - ${agentName}] ⏳ Validation automatique du plan...`);
        await julesAPI(`/${sessionName}:approvePlan`, 'POST');
      }
      else if (state.status === 'WAITING_FOR_USER_INPUT') {
        // LA ROBUSTESSE EST ICI : On débloque Jules instantanément sans intervention humaine
        console.log(`[${project.id} - ${agentName}] 💬 Jules demande un avis -> Déblocage automatique envoyé ("Keep going").`);
        await julesAPI(`/${sessionName}:sendMessage`, 'POST', {
          message: "Keep going, resolve any errors autonomously and finish the task without waiting for further input."
        });
      }
      else if (state.status === 'COMPLETED') {
        console.log(`[${project.id} - ${agentName}] ✅ Travail terminé avec succès !`);
        return true;
      }
      else if (state.status === 'FAILED') {
        console.log(`[${project.id} - ${agentName}] ❌ Échec de la tâche côté Jules.`);
        return false;
      }

      // On attend avant de revérifier l'état (par défaut 15 secondes)
      await sleep(GLOBAL_CONFIG.POLLING_INTERVAL);
    }
  } catch (e) {
    console.error(`[${project.id} - ${agentName}] Erreur critique lors de la surveillance :`, e);
    return false;
  }
}
