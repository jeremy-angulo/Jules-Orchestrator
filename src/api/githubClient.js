import { log } from "../utils/logger.js";
import { sleep } from '../utils/helpers.js';
import { recordServiceCheck, recordServiceError } from '../db/database.js';

async function githubRequest(project, url, options = {}, context = 'github_request') {
  const startedAt = Date.now();
  try {
    const res = await fetch(url, options);
    const responseMs = Date.now() - startedAt;
    recordServiceCheck('github_api', res.ok, {
      statusCode: res.status,
      responseMs
    });
    if (!res.ok) {
      recordServiceError('github_api', `${context} failed`, {
        code: String(res.status),
        statusCode: res.status,
        statusText: res.statusText,
        projectId: project?.id || null,
        repo: project?.githubRepo || null,
        responseMs
      });
    }
    return res;
  } catch (error) {
    const responseMs = Date.now() - startedAt;
    recordServiceCheck('github_api', false, {
      statusCode: null,
      responseMs
    });
    recordServiceError('github_api', `${context} network error`, {
      code: error?.name || 'NETWORK_ERROR',
      projectId: project?.id || null,
      repo: project?.githubRepo || null,
      responseMs,
      message: String(error?.message || error)
    });
    throw error;
  }
}

export async function getNextGitHubIssue(project) {
  try {
    const res = await githubRequest(project, `https://api.github.com/repos/${project.githubRepo}/issues?state=open&sort=created&direction=asc`, {
      headers: { 'Authorization': `Bearer ${project.githubToken}`, 'Accept': 'application/vnd.github.v3+json' }
    }, 'get_next_issue');
    if (!res.ok) {
        const errorText = await res.text();
        log("error", `[${project.id} - GitHub] API Error fetching issues: ${res.status} ${res.statusText} - ${errorText}`);
        return null;
    }
    const issues = await res.json();
    return issues.find(i => !i.pull_request) || null;
  } catch (error) {
    log("error", `[${project.id} - GitHub] Network Error fetching issues:`, error);
    return null;
  }
}
export async function closeGitHubIssue(project, issueNumber) {
    try {
    const res = await githubRequest(project, `https://api.github.com/repos/${project.githubRepo}/issues/${issueNumber}`, {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${project.githubToken}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ state: 'closed' })
    }, 'close_issue');
        if (!res.ok) {
             log("error", `[${project.id} - GitHub] API Error closing issue #${issueNumber}: ${res.status} ${res.statusText}`);
        }
    } catch (error) {
        log("error", `[${project.id} - GitHub] Network Error closing issue #${issueNumber}:`, error);
    }
}
export async function checkAndMergePR(project, prNumber) {
  try {
    let pr = null;
    let mergeable = null;
    let retries = 0;
    const maxRetries = 5;

    // 1. Polling loop to wait for mergeable state
    while (retries < maxRetries) {
      const getRes = await githubRequest(project, `https://api.github.com/repos/${project.githubRepo}/pulls/${prNumber}`, {
        headers: {
          'Authorization': `Bearer ${project.githubToken}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      }, 'get_pr_status');
      if (!getRes.ok) {
        log("error", `[${project.id} - PR] ❌ Erreur API GitHub lors de la récupération de la PR #${prNumber}: ${getRes.status} ${getRes.statusText}`);
        return;
      }
      pr = await getRes.json();

      if (pr.merged) {
         log("info", `[${project.id} - PR] ℹ️ PR #${prNumber} est déjà fusionnée.`);
         return;
      }
      if (pr.title && pr.title.toLowerCase().includes('bump')) {
         return;
      }

      mergeable = pr.mergeable;

      // If mergeable is true or false, we can stop polling.
      if (mergeable !== null) {
        break;
      }

      log("info", `[${project.id} - PR] ⏳ PR #${prNumber} 'mergeable' est en cours d'évaluation par GitHub... Attente 15s (${retries+1}/${maxRetries})`);
      await sleep(15000);
      retries++;
    }

    if (mergeable === null) {
       log("info", `[${project.id} - PR] ⚠️ Impossible de déterminer si la PR #${prNumber} est mergeable après plusieurs tentatives. On passe.`);
       return;
    }

    if (mergeable === false || pr.mergeable_state === 'blocked') {
       log("info", `[${project.id} - PR] ⚠️ PR #${prNumber} ne peut pas être mergée. État: ${pr.mergeable_state}. Cela peut être dû à des règles de protection de branche (ex: reviews requises manquantes, checks CI en échec ou en cours, etc).`);
       return;
    }

    // 2. Si mergeable et prête, on merge
    let mergeRes = await githubRequest(project, `https://api.github.com/repos/${project.githubRepo}/pulls/${prNumber}/merge`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${project.githubToken}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ merge_method: 'merge' })
    }, 'merge_pr');

    if (!mergeRes.ok && mergeRes.status === 405) {
      log("info", `[${project.id} - PR] ⚠️ La méthode 'merge' classique n'est pas autorisée (405). Tentative avec 'squash'...`);
      mergeRes = await githubRequest(project, `https://api.github.com/repos/${project.githubRepo}/pulls/${prNumber}/merge`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${project.githubToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ merge_method: 'squash' })
      }, 'merge_pr_squash');
    }

    if (mergeRes.ok) {
      log("info", `[${project.id} - PR] 🟢 SUCCÈS : PR #${prNumber} fusionnée automatiquement !`);
    } else {
      log("error", `[${project.id} - PR] 🔴 ÉCHEC de l'auto-merge de la PR #${prNumber}. Status: ${mergeRes.status} ${mergeRes.statusText}`);
      let errText = '';
      try { errText = await mergeRes.text(); } catch(e) {}
      if (errText) log("error", `Détails: ${errText}`);
    }
  } catch (error) {
    log("error", `[${project.id} - PR] Erreur critique lors de checkAndMergePR :`, error);
  }
}
export async function listOpenPRs(project) {
  try {
    const res = await githubRequest(project,
      `https://api.github.com/repos/${project.githubRepo}/pulls?state=open&sort=created&direction=desc&per_page=50`,
      { headers: { 'Authorization': `Bearer ${project.githubToken}`, 'Accept': 'application/vnd.github.v3+json' } },
      'list_open_prs'
    );
    if (!res.ok) return [];
    const prs = await res.json();

    // Fetch individual PR details in parallel to get mergeable/mergeable_state
    // (list endpoint always returns null for these fields)
    const detailed = await Promise.all(prs.map(async pr => {
      try {
        const r = await githubRequest(project,
          `https://api.github.com/repos/${project.githubRepo}/pulls/${pr.number}`,
          { headers: { 'Authorization': `Bearer ${project.githubToken}`, 'Accept': 'application/vnd.github.v3+json' } },
          'get_pr_detail'
        );
        return r.ok ? await r.json() : pr;
      } catch (_) { return pr; }
    }));

    return detailed.map(pr => ({
      number: pr.number,
      title: pr.title,
      html_url: pr.html_url,
      state: pr.state,
      draft: pr.draft,
      merged: pr.merged,
      mergeable: pr.mergeable,
      mergeable_state: pr.mergeable_state,
      created_at: pr.created_at,
      updated_at: pr.updated_at,
      user: { login: pr.user?.login, avatar_url: pr.user?.avatar_url },
      head: { ref: pr.head?.ref },
      base: { ref: pr.base?.ref }
    }));
  } catch (e) {
    return [];
  }
}

export async function closePR(project, prNumber) {
  try {
    const res = await githubRequest(project,
      `https://api.github.com/repos/${project.githubRepo}/pulls/${prNumber}`,
      {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${project.githubToken}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: 'closed' })
      },
      'close_pr'
    );
    return res.ok;
  } catch (e) { return false; }
}

export async function mergePRWithResult(project, prNumber) {
  try {
    const getRes = await githubRequest(project,
      `https://api.github.com/repos/${project.githubRepo}/pulls/${prNumber}`,
      { headers: { 'Authorization': `Bearer ${project.githubToken}`, 'Accept': 'application/vnd.github.v3+json' } },
      'get_pr_for_merge'
    );
    if (!getRes.ok) return { status: 'failed', reason: `GitHub ${getRes.status}` };

    const pr = await getRes.json();
    if (pr.merged) return { status: 'skipped', reason: 'Already merged' };
    if (pr.state === 'closed') return { status: 'skipped', reason: 'PR closed' };
    if (pr.draft) return { status: 'failed', reason: 'Draft PR' };
    if (pr.mergeable === false) return { status: 'failed', reason: `Merge conflicts (${pr.mergeable_state || 'dirty'})` };
    if (pr.mergeable_state === 'blocked') return { status: 'failed', reason: 'Blocked by branch protection' };

    for (const method of ['merge', 'squash']) {
      const r = await githubRequest(project,
        `https://api.github.com/repos/${project.githubRepo}/pulls/${prNumber}/merge`,
        {
          method: 'PUT',
          headers: { 'Authorization': `Bearer ${project.githubToken}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ merge_method: method })
        },
        'merge_pr_result'
      );
      if (r.ok) return { status: 'merged' };
      if (r.status !== 405) {
        let detail = '';
        try { detail = await r.text(); } catch (_) {}
        return { status: 'failed', reason: `${r.status}: ${detail.substring(0, 120)}` };
      }
    }
    return { status: 'failed', reason: 'Merge method not allowed' };
  } catch (e) {
    return { status: 'failed', reason: e.message };
  }
}

export async function mergeOpenPRs(project) {
  try {
    const res = await githubRequest(project, `https://api.github.com/repos/${project.githubRepo}/pulls?state=open&sort=created&direction=asc`, {
      headers: {
        'Authorization': `Bearer ${project.githubToken}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    }, 'list_open_prs');
    if (!res.ok) {
        const errorText = await res.text();
        log("error", `[${project.id} - GitHub] API Error fetching open PRs: ${res.status} ${res.statusText} - ${errorText}`);
        return;
    }
    const prs = await res.json();
    if (prs.length === 0) {
      return;
    }

    // Parallelize PR merging to improve performance
    await Promise.all(prs.map(async (pr) => {
      if (pr.title && pr.title.toLowerCase().includes('bump')) {
        return;
      }
      // Delegate to checkAndMergePR which handles polling and safety checks
      await checkAndMergePR(project, pr.number);
    }));
  } catch (error) {
    log("error", `[${project.id} - PR] Erreur critique lors de mergeOpenPRs :`, error);
  }
}
