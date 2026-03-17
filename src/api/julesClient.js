import { GLOBAL_CONFIG } from '../config.js';
import { sleep } from '../utils/helpers.js';
import { checkAndMergePR } from './githubClient.js';
import { getAvailableToken, QuotaExceededError } from './tokenRotation.js';
import { incrementTokenUsage } from '../db/database.js';
const JULES_API_BASE = "https://jules.googleapis.com/v1alpha";
/**
 * Base API client for Jules REST API
 */
export async function julesAPI(agentName, endpoint, method = 'GET', body = null, queryParams = null) {
  let url = `${JULES_API_BASE}${endpoint}`;
  if (queryParams) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(queryParams)) {
      if (value !== undefined && value !== null) {
        params.append(key, value);
      }
    }
    const queryString = params.toString();
    if (queryString) {
      url += `?${queryString}`;
    }
  }
  // Use dynamic token logic via tokenRotation.js
  const token = getAvailableToken(agentName);
  // Track usage for sessions creation / messages
  if (method === 'POST' && (endpoint === '/sessions' || endpoint.includes(':sendMessage'))) {
    incrementTokenUsage(token, agentName);
  }
  const options = {
    method,
    headers: { 'X-Goog-Api-Key': token }
  };
  if (body) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  try {
    const res = await fetch(url, options);
    if (!res.ok) {
      let errorDetails = '';
      try {
        const errJson = await res.json();
        errorDetails = JSON.stringify(errJson);
      } catch (e) {
        errorDetails = await res.text().catch(() => '');
      }
      console.error(`[julesAPI] Error API: ${res.status} ${res.statusText} - ${errorDetails}`);
      return null;
    }
    // Some endpoints like DELETE might return empty responses
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  } catch (error) {
    console.error(`[julesAPI] Network Error:`, error);
    return null;
  }
}
// ==========================================
// SOURCES METHODS
// ==========================================
export async function listSources(agentName, pageSize, pageToken, filter) {
  return julesAPI(agentName, '/sources', 'GET', null, { pageSize, pageToken, filter });
}
export async function getSource(agentName, sourceId) {
  const safeId = sourceId.startsWith('sources/') ? sourceId : `sources/${sourceId}`;
  return julesAPI(agentName, `/${safeId}`);
}
// ==========================================
// SESSIONS METHODS
// ==========================================
export async function createSession(agentName, prompt, title, sourceId, startingBranch, automationMode) {
  const body = {
    prompt,
    title,
    sourceContext: {
      source: sourceId.startsWith('sources/') ? sourceId : `sources/${sourceId}`,
      githubRepoContext: {
        startingBranch: startingBranch || 'main'
      }
    }
  };
  if (automationMode) {
    body.automationMode = automationMode;
  }
  return julesAPI(agentName, '/sessions', 'POST', body);
}
export async function getSession(agentName, sessionId) {
  const safeId = sessionId.startsWith('sessions/') ? sessionId : `sessions/${sessionId}`;
  return julesAPI(agentName, `/${safeId}`);
}
export async function deleteSession(agentName, sessionId) {
  const safeId = sessionId.startsWith('sessions/') ? sessionId : `sessions/${sessionId}`;
  return julesAPI(agentName, `/${safeId}`, 'DELETE');
}
export async function sendMessage(agentName, sessionId, message) {
  const safeId = sessionId.startsWith('sessions/') ? sessionId : `sessions/${sessionId}`;
  return julesAPI(agentName, `/${safeId}:sendMessage`, 'POST', { prompt: message });
}
export async function approvePlan(agentName, sessionId) {
  const safeId = sessionId.startsWith('sessions/') ? sessionId : `sessions/${sessionId}`;
  return julesAPI(agentName, `/${safeId}:approvePlan`, 'POST', {});
}
// ==========================================
// ACTIVITIES METHODS
// ==========================================
export async function listActivities(agentName, sessionId, pageSize, pageToken, createTime) {
  const safeId = sessionId.startsWith('sessions/') ? sessionId : `sessions/${sessionId}`;
  return julesAPI(agentName, `/${safeId}/activities`, 'GET', null, { pageSize, pageToken, createTime });
}
export async function getActivity(agentName, sessionId, activityId) {
  const safeSessionId = sessionId.startsWith('sessions/') ? sessionId : `sessions/${sessionId}`;
  return julesAPI(agentName, `/${safeSessionId}/activities/${activityId}`);
}
// ==========================================
// WORKFLOW METHODS
// ==========================================
/**
 * Starts a Jules session and monitors it until completion or failure.
 */
export async function startAndMonitorSession(instruction, agentName, project) {
  console.log(`\n[${project.id} - ${agentName}] 🟢 Lancement de la session Jules...`);
  const MAX_RETRIES = 3;
  let attempt = 0;
  while (attempt < MAX_RETRIES) {
    attempt++;
    try {
      // Format sourceId: prepend 'sources/github/'
      const formattedSourceId = `sources/github/${project.githubRepo || ''}`;
      // Create the session
      const session = await createSession(
        agentName,
        instruction,
        `${agentName} Task for ${project.id}`,
        formattedSourceId,
        project.githubBranch || 'main', // Using configured branch or defaulting to main
        "AUTO_CREATE_PR"
      );
      if (!session || !session.name) {
        console.error(`[${project.id} - ${agentName}] ❌ Erreur de création de session. (Tentative ${attempt}/${MAX_RETRIES})`);
        if (attempt >= MAX_RETRIES) return false;
        await sleep(30000);
        continue;
      }
      let sessionName = session.name;
      // Boucle de surveillance infinie jusqu'à complétion ou échec
      while (true) {
        const state = await getSession(agentName, sessionName);
        if (!state) {
          await sleep(GLOBAL_CONFIG.POLLING_INTERVAL);
          continue;
        }
        if (state.state === 'AWAITING_PLAN_APPROVAL') {
          await approvePlan(agentName, sessionName);
        } else if (state.state === 'AWAITING_USER_FEEDBACK') {
          console.log(`[${project.id} - ${agentName}] 💬 Session bloquée en attente d'un retour. Injection de "keep going"...`);
          await sendMessage(agentName, sessionName, "keep going");
        } else if (state.state === 'COMPLETED') {
          // Anti-Triche : Vérifier qu'une PR a bien été créée
          let hasPR = false;
          let prUrl = null;
          if (state.outputs && Array.isArray(state.outputs)) {
            for (const output of state.outputs) {
              if (output.pullRequest) {
                hasPR = true;
                prUrl = output.pullRequest.url;
                break;
              }
            }
          }
          if (prUrl) {
              const match = prUrl.match(/\/pull\/(\d+)$/);
              if (match) {
                  const prNumber = match[1];
                  // Planifier la vérification et le merge après 3 minutes
                  setTimeout(() => checkAndMergePR(project, prNumber), 180000);
              }
          }
          if (!hasPR) {
            return false;
          }
          console.log(`[${project.id} - ${agentName}] ✅ Travail terminé avec succès et PR détectée !`);
          return true;
        }
        else if (state.state === 'FAILED') {
          break; // Sort de la boucle de surveillance pour recommencer une nouvelle session
        }
        // On attend avant de revérifier l'état
        await sleep(GLOBAL_CONFIG.POLLING_INTERVAL);
      }
    } catch (e) {
      console.error(`[${project.id} - ${agentName}] Erreur critique lors de la surveillance (Tentative ${attempt}/${MAX_RETRIES}):`, e);
    }
    if (attempt < MAX_RETRIES) {
      await sleep(30000); // Wait before retrying
    }
  }
  return false;
}
