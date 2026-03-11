import { sleep } from '../utils/helpers.js';
import { GLOBAL_CONFIG } from '../config.js';
import { listSessions, approvePlan, sendMessage } from '../api/julesClient.js';

export async function runSessionMonitor() {
  console.log("👁️  Démarrage du moniteur global de sessions Jules...");

  while (true) {
    try {
      let activeSessions = [];
      let pageToken = undefined;

      // 1. Fetch all sessions with pagination
      do {
        const sessionsResponse = await listSessions(100, pageToken);

        if (!sessionsResponse || !sessionsResponse.sessions) {
           console.error("[SessionMonitor] ⚠️ Impossible de récupérer la liste des sessions. Réessai dans quelques secondes...");
           break; // Break pagination loop on error, retry on next main loop iteration
        }

        const filtered = sessionsResponse.sessions.filter(s =>
          s.state !== 'COMPLETED' && s.state !== 'FAILED' && s.state !== 'QUEUED' && s.state !== 'STATE_UNSPECIFIED'
        );
        activeSessions = activeSessions.concat(filtered);

        pageToken = sessionsResponse.nextPageToken;
      } while (pageToken);

      if (activeSessions.length > 0) {
          console.log(`[SessionMonitor] 🔎 Surveillance de ${activeSessions.length} session(s) active(s)...`);
      }

      // 2. Iterate and check state
      for (const session of activeSessions) {
        if (session.state === 'AWAITING_PLAN_APPROVAL') {
           console.log(`[SessionMonitor] ⏳ Session ${session.id} en attente d'approbation du plan. Validation automatique...`);
           await approvePlan(session.name);
        } else if (session.state === 'AWAITING_USER_FEEDBACK') {
           console.log(`[SessionMonitor] 💬 Session ${session.id} bloquée en attente d'un retour. Injection de "keep going"...`);
           await sendMessage(session.name, "keep going");
        }
      }

      await sleep(GLOBAL_CONFIG.POLLING_INTERVAL);
    } catch (error) {
      console.error("[SessionMonitor] ❌ Erreur critique dans la boucle de surveillance :", error);
      await sleep(GLOBAL_CONFIG.POLLING_INTERVAL);
    }
  }
}
