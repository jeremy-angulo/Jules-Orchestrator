import { GLOBAL_CONFIG } from '../config.js';
import { sleep } from '../utils/helpers.js';
import { checkAndMergePR } from './githubClient.js';
import { getAvailableToken } from './tokenRotation.js';
import { recordApiCall } from '../db/database.js';
import { recordServiceCheck, recordServiceError } from '../db/database.js';
const JULES_API_BASE = "https://jules.googleapis.com/v1alpha";
/**
 * Base API client for Jules REST API
 */
export async function julesAPI(agentName, endpoint, method = 'GET', body = null, queryParams = null, requestOptions = {}) {
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
  const token = await getAvailableToken(agentName, requestOptions);
  // Track usage for sessions creation / messages
  if (method === 'POST' && (endpoint === '/sessions' || endpoint.includes(':sendMessage'))) {
    await recordApiCall(token, agentName);
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
    const startedAt = Date.now();
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[DEBUG] julesAPI: ${method} ${url}`);
    }
    const res = await fetch(url, options);
    const responseMs = Date.now() - startedAt;
    recordServiceCheck('jules_api', res.ok, {
      statusCode: res.status,
      responseMs
    });
    if (!res.ok) {
      let errorDetails = '';
      try {
        const errJson = await res.json();
        errorDetails = JSON.stringify(errJson);
      } catch (e) {
        errorDetails = await res.text().catch(() => '');
      }
      console.error(`[julesAPI] Error API: ${res.status} ${res.statusText} - ${errorDetails}`);
      recordServiceError('jules_api', `Jules API returned ${res.status}`, {
        code: String(res.status),
        statusCode: res.status,
        statusText: res.statusText,
        endpoint,
        method,
        responseMs,
        errorDetails
      });
      return null;
    }
    // Some endpoints like DELETE might return empty responses
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  } catch (error) {
    console.error(`[julesAPI] Network Error:`, error);
    recordServiceCheck('jules_api', false, {
      statusCode: null,
      responseMs: null
    });
    recordServiceError('jules_api', 'Jules API network error', {
      code: error?.name || 'NETWORK_ERROR',
      endpoint,
      method,
      message: String(error?.message || error)
    });
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
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[DEBUG] getSource: agentName=${agentName}, sourceId=${sourceId}, safeId=${safeId}`);
  }
  return julesAPI(agentName, `/${safeId}`);
}
// ==========================================
// SESSIONS METHODS
// ==========================================
export async function createSession(agentName, prompt, title, sourceId, startingBranch, automationMode, requestOptions = {}, media = null) {
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
  
  if (media && media.length > 0) {
    body.sourceContext.mediaContext = {
      media: media // array of { inlineData: { mimeType, data } }
    };
  }

  if (automationMode) {
    body.automationMode = automationMode;
  }
  return julesAPI(agentName, '/sessions', 'POST', body, null, requestOptions);
}
export async function getSession(agentName, sessionId, requestOptions = {}) {
  const safeId = sessionId.startsWith('sessions/') ? sessionId : `sessions/${sessionId}`;
  return julesAPI(agentName, `/${safeId}`, 'GET', null, null, requestOptions);
}
export async function deleteSession(agentName, sessionId, requestOptions = {}) {
  const safeId = sessionId.startsWith('sessions/') ? sessionId : `sessions/${sessionId}`;
  return julesAPI(agentName, `/${safeId}`, 'DELETE', null, null, requestOptions);
}
export async function sendMessage(agentName, sessionId, message, requestOptions = {}) {
  const safeId = sessionId.startsWith('sessions/') ? sessionId : `sessions/${sessionId}`;
  return julesAPI(agentName, `/${safeId}:sendMessage`, 'POST', { prompt: message }, null, requestOptions);
}
export async function approvePlan(agentName, sessionId, requestOptions = {}) {
  const safeId = sessionId.startsWith('sessions/') ? sessionId : `sessions/${sessionId}`;
  return julesAPI(agentName, `/${safeId}:approvePlan`, 'POST', {}, null, requestOptions);
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
 * Monitors an already-running Jules session until it completes or fails.
 * Returns true if completed with a PR, false otherwise.
 */
export async function monitorExistingSession(sessionName, agentName, project, options = {}) {
  const shouldStop = typeof options.shouldStop === 'function' ? options.shouldStop : () => false;
  const requestOptions = options.preferredTokenId ? { preferredTokenId: String(options.preferredTokenId) } : {};

  const state = await getSession(agentName, sessionName, requestOptions).catch(() => null);
  if (!state) return false;
  // Session already done — treat as if we just missed the end
  if (state.state === 'COMPLETED' || state.state === 'FAILED') {
    const hasPR = state.outputs?.some(o => o.pullRequest);
    return state.state === 'COMPLETED' && hasPR;
  }

  // Resume the monitoring loop
  while (true) {
    if (shouldStop()) return false;
    const s = await getSession(agentName, sessionName, requestOptions).catch(() => null);
    if (!s) { await sleep(GLOBAL_CONFIG.POLLING_INTERVAL); continue; }
    if (s.state === 'AWAITING_PLAN_APPROVAL') {
      await approvePlan(agentName, sessionName, requestOptions).catch(() => {});
    } else if (s.state === 'AWAITING_USER_FEEDBACK') {
      await sendMessage(agentName, sessionName, 'keep going', requestOptions).catch(() => {});
    } else if (s.state === 'COMPLETED') {
      const hasPR = s.outputs?.some(o => o.pullRequest);
      if (!hasPR) return false;
      console.log(`[${project.id} - ${agentName}] ✅ Resumed session completed with PR.`);
      return true;
    } else if (s.state === 'FAILED') {
      return false;
    }
    await sleep(GLOBAL_CONFIG.POLLING_INTERVAL);
  }
}

/**
 * Starts a Jules session and monitors it until completion or failure.
 */
export async function startAndMonitorSession(instruction, agentName, project, options = {}) {
  console.log(`\n[${project.id} - ${agentName}] 🟢 Lancement de la session Jules...`);
  const MAX_RETRIES = 3;
  let attempt = 0;
  const shouldStop = typeof options.shouldStop === 'function' ? options.shouldStop : () => false;
  const preferredTokenId = options.preferredTokenId ? String(options.preferredTokenId) : null;
  const requestOptions = preferredTokenId ? { preferredTokenId } : {};
  while (attempt < MAX_RETRIES) {
    if (shouldStop()) {
      console.log(`[${project.id} - ${agentName}] 🛑 Arrêt demandé avant création de session.`);
      return false;
    }
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
        "AUTO_CREATE_PR",
        requestOptions,
        options.media
      );
      if (!session || !session.name) {
        console.error(`[${project.id} - ${agentName}] ❌ Erreur de création de session. (Tentative ${attempt}/${MAX_RETRIES})`);
        if (attempt >= MAX_RETRIES) return false;
        await sleep(30000);
        continue;
      }
      let sessionName = session.name;
      if (typeof options.onSessionCreated === 'function') {
        options.onSessionCreated(sessionName);
      }
      
      // Boucle de surveillance infinie jusqu'à complétion ou échec
      while (true) {
        if (shouldStop()) {
          console.log(`[${project.id} - ${agentName}] 🛑 Arrêt demandé pendant la surveillance de session.`);
          return false;
        }
        const state = await getSession(agentName, sessionName, requestOptions);
        if (!state) {
          await sleep(GLOBAL_CONFIG.POLLING_INTERVAL);
          continue;
        }
        if (state.state === 'AWAITING_PLAN_APPROVAL') {
          await approvePlan(agentName, sessionName, requestOptions);
        } else if (state.state === 'AWAITING_USER_FEEDBACK') {
          console.log(`[${project.id} - ${agentName}] 💬 Session bloquée en attente d'un retour. Injection de "keep going"...`);
          await sendMessage(agentName, sessionName, "keep going", requestOptions);
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
                  // On planifie une vérification et un merge automatique rapide
                  setTimeout(() => checkAndMergePR(project, prNumber).catch(() => {}), 60000);
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
        if (shouldStop()) {
          console.log(`[${project.id} - ${agentName}] 🛑 Arrêt demandé avant prochain polling.`);
          return false;
        }
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
