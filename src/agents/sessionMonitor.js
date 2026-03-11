import { julesAPI } from '../api/julesClient.js';
import { sleep } from '../utils/helpers.js';
import { GLOBAL_CONFIG } from '../config.js';

export async function runSessionMonitor() {
  console.log("👁️  Démarrage du moniteur global de sessions Jules...");

  while (true) {
    try {
      // 1. Fetch all sessions
      const sessionsResponse = await julesAPI('/sessions', 'GET');

      if (!sessionsResponse || !sessionsResponse.sessions) {
         console.error("[SessionMonitor] ⚠️ Impossible de récupérer la liste des sessions. Réessai dans quelques secondes...");
         await sleep(GLOBAL_CONFIG.POLLING_INTERVAL);
         continue;
      }

      const activeSessions = sessionsResponse.sessions.filter(s =>
        s.state !== 'COMPLETED' && s.state !== 'FAILED' && s.state !== 'QUEUED' && s.state !== 'STATE_UNSPECIFIED'
      );

      if (activeSessions.length > 0) {
          console.log(`[SessionMonitor] 🔎 Surveillance de ${activeSessions.length} session(s) active(s)...`);
      }

      // 2. Iterate and check state
      for (const session of activeSessions) {
        if (session.state === 'WAITING_FOR_PLAN_APPROVAL') {
           console.log(`[SessionMonitor] ⏳ Session ${session.id} en attente d'approbation du plan. Validation automatique...`);
           await julesAPI(`/${session.name}:approvePlan`, 'POST', {});
        } else if (session.state === 'AWAITING_USER_FEEDBACK') {
           console.log(`[SessionMonitor] 💬 Session ${session.id} bloquée en attente d'un retour. Injection de "keep going"...`);
           await julesAPI(`/${session.name}:sendMessage`, 'POST', {
               message: "keep going"
           });
        }
      }

      await sleep(GLOBAL_CONFIG.POLLING_INTERVAL);
    } catch (error) {
      console.error("[SessionMonitor] ❌ Erreur critique dans la boucle de surveillance :", error);
      await sleep(GLOBAL_CONFIG.POLLING_INTERVAL);
    }
  }
}
