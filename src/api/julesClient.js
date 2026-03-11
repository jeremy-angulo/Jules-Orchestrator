import { GLOBAL_CONFIG } from '../config.js';
import { sleep } from '../utils/helpers.js';

const JULES_API_BASE = "https://jules.googleapis.com/v1alpha";

/**
 * Base API client for Jules REST API
 */
export async function julesAPI(endpoint, method = 'GET', body = null, queryParams = null) {
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

  const options = {
    method,
    headers: { 'X-Goog-Api-Key': `${GLOBAL_CONFIG.JULES_API_TOKEN}` }
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

export async function listSources(pageSize, pageToken, filter) {
  return julesAPI('/sources', 'GET', null, { pageSize, pageToken, filter });
}

export async function getSource(sourceId) {
  const safeId = sourceId.startsWith('sources/') ? sourceId : `sources/${sourceId}`;
  return julesAPI(`/${safeId}`);
}

// ==========================================
// SESSIONS METHODS
// ==========================================

export async function createSession(prompt, title, sourceId, startingBranch, automationMode) {
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

  return julesAPI('/sessions', 'POST', body);
}

export async function listSessions(pageSize, pageToken) {
  return julesAPI('/sessions', 'GET', null, { pageSize, pageToken });
}

export async function getSession(sessionId) {
  const safeId = sessionId.startsWith('sessions/') ? sessionId : `sessions/${sessionId}`;
  return julesAPI(`/${safeId}`);
}

export async function deleteSession(sessionId) {
  const safeId = sessionId.startsWith('sessions/') ? sessionId : `sessions/${sessionId}`;
  return julesAPI(`/${safeId}`, 'DELETE');
}

export async function sendMessage(sessionId, message) {
  const safeId = sessionId.startsWith('sessions/') ? sessionId : `sessions/${sessionId}`;
  return julesAPI(`/${safeId}:sendMessage`, 'POST', { prompt: message });
}

export async function approvePlan(sessionId) {
  const safeId = sessionId.startsWith('sessions/') ? sessionId : `sessions/${sessionId}`;
  return julesAPI(`/${safeId}:approvePlan`, 'POST', {});
}

// ==========================================
// ACTIVITIES METHODS
// ==========================================

export async function listActivities(sessionId, pageSize, pageToken, createTime) {
  const safeId = sessionId.startsWith('sessions/') ? sessionId : `sessions/${sessionId}`;
  return julesAPI(`/${safeId}/activities`, 'GET', null, { pageSize, pageToken, createTime });
}

export async function getActivity(sessionId, activityId) {
  const safeSessionId = sessionId.startsWith('sessions/') ? sessionId : `sessions/${sessionId}`;
  return julesAPI(`/${safeSessionId}/activities/${activityId}`);
}

// ==========================================
// WORKFLOW METHODS
// ==========================================

/**
 * Starts a Jules session and monitors it until completion or failure.
 */
export async function startAndMonitorSession(instruction, agentName, project) {
  console.log(`\n[${project.id} - ${agentName}] 🟢 Lancement de la session Jules...`);

  try {
    // Format sourceId: replace '/' with '-' and prepend 'github-'
    const formattedSourceId = `sources/github-${project.githubRepo.replace('/', '-')}`;

    // Create the session
    const session = await createSession(
      instruction,
      `${agentName} Task for ${project.id}`,
      formattedSourceId,
      'main', // Defaulting to main, might need to be configurable
      "AUTO_CREATE_PR"
    );

    if (!session || !session.name) {
      console.error(`[${project.id} - ${agentName}] ❌ Erreur de création de session.`);
      return false;
    }

    let sessionName = session.name;

    // Boucle de surveillance infinie jusqu'à complétion ou échec
    while (true) {
      const state = await getSession(sessionName);

      if (!state) {
        console.error(`[${project.id} - ${agentName}] ⚠️ Impossible de récupérer l'état de la session (retour nul). Nouvelle tentative dans ${GLOBAL_CONFIG.POLLING_INTERVAL}ms...`);
        await sleep(GLOBAL_CONFIG.POLLING_INTERVAL);
        continue;
      }

      if (state.state === 'COMPLETED') {
        // Anti-Triche : Vérifier qu'une PR a bien été créée
        let hasPR = false;
        if (state.outputs && Array.isArray(state.outputs)) {
          for (const output of state.outputs) {
            if (output.pullRequest) {
              hasPR = true;
              break;
            }
          }
        }

        if (!hasPR) {
          console.warn(`[\u26A0\uFE0F ${project.id} - ${agentName}] Session COMPLETED mais aucune Pull Request détectée !`);
          return false;
        }

        console.log(`[${project.id} - ${agentName}] ✅ Travail terminé avec succès et PR détectée !`);
        return true;
      }
      else if (state.state === 'FAILED') {
        console.log(`[${project.id} - ${agentName}] ❌ Échec de la tâche côté Jules.`);
        return false;
      }

      // On attend avant de revérifier l'état
      await sleep(GLOBAL_CONFIG.POLLING_INTERVAL);
    }
  } catch (e) {
    console.error(`[${project.id} - ${agentName}] Erreur critique lors de la surveillance :`, e);
    return false;
  }
}
