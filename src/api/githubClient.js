import { sleep } from '../utils/helpers.js';
export async function getNextGitHubIssue(project) {
  try {
    const res = await fetch(`https://api.github.com/repos/${project.githubRepo}/issues?state=open&sort=created&direction=asc`, {
      headers: { 'Authorization': `Bearer ${project.githubToken}`, 'Accept': 'application/vnd.github.v3+json' }
    });
    if (!res.ok) {
        const errorText = await res.text();
        console.error(`[${project.id} - GitHub] API Error fetching issues: ${res.status} ${res.statusText} - ${errorText}`);
        return null;
    }
    const issues = await res.json();
    return issues.find(i => !i.pull_request) || null;
  } catch (error) {
    console.error(`[${project.id} - GitHub] Network Error fetching issues:`, error);
    return null;
  }
}
export async function closeGitHubIssue(project, issueNumber) {
    try {
        const res = await fetch(`https://api.github.com/repos/${project.githubRepo}/issues/${issueNumber}`, {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${project.githubToken}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ state: 'closed' })
        });
        if (!res.ok) {
             console.error(`[${project.id} - GitHub] API Error closing issue #${issueNumber}: ${res.status} ${res.statusText}`);
        }
    } catch (error) {
        console.error(`[${project.id} - GitHub] Network Error closing issue #${issueNumber}:`, error);
    }
}
export async function createAndMergePR(project, sourceBranch, targetBranch) {
  try {
    // Étape A : Créer la PR
    const createRes = await fetch(`https://api.github.com/repos/${project.githubRepo}/pulls`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${project.githubToken}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title: `🚀 Auto-Release: ${sourceBranch} to ${targetBranch}`,
        head: sourceBranch,
        base: targetBranch,
        body: "Automated PR created by Jules Orchestrator after successful build and tests."
      })
    });
    if (!createRes.ok) {
      let err;
      try {
          err = await createRes.json();
      } catch (e) {
          throw new Error(`Erreur API GitHub lors de la création PR (non-JSON): ${createRes.status} ${createRes.statusText}`);
      }
      // On gère gracieusement le fait qu'il n'y ait pas de nouveau code à fusionner aujourd'hui
      if (err.errors && err.errors[0] && err.errors[0].message && err.errors[0].message.includes('No commits between')) {
        return;
      }
      throw new Error(`Erreur API GitHub lors de la création PR: ${JSON.stringify(err)}`);
    }
    const pr = await createRes.json();
    console.log(`[${project.id} - Pipeline] ✅ PR #${pr.number} créée avec succès. Auto-Merge en cours...`);
    // Étape B : Déléguer à checkAndMergePR pour polling du mergeable_state
    await checkAndMergePR(project, pr.number);
  } catch (error) {
    console.error(`[${project.id} - Pipeline] Erreur critique lors de la gestion de la PR :`, error);
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
      const getRes = await fetch(`https://api.github.com/repos/${project.githubRepo}/pulls/${prNumber}`, {
        headers: {
          'Authorization': `Bearer ${project.githubToken}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });
      if (!getRes.ok) {
        console.error(`[${project.id} - PR] ❌ Erreur API GitHub lors de la récupération de la PR #${prNumber}: ${getRes.status} ${getRes.statusText}`);
        return;
      }
      pr = await getRes.json();

      if (pr.merged) {
         console.log(`[${project.id} - PR] ℹ️ PR #${prNumber} est déjà fusionnée.`);
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

      console.log(`[${project.id} - PR] ⏳ PR #${prNumber} 'mergeable' est en cours d'évaluation par GitHub... Attente 15s (${retries+1}/${maxRetries})`);
      await sleep(15000);
      retries++;
    }

    if (mergeable === null) {
       console.log(`[${project.id} - PR] ⚠️ Impossible de déterminer si la PR #${prNumber} est mergeable après plusieurs tentatives. On passe.`);
       return;
    }

    if (mergeable === false || pr.mergeable_state === 'blocked') {
       console.log(`[${project.id} - PR] ⚠️ PR #${prNumber} ne peut pas être mergée. État: ${pr.mergeable_state}. Cela peut être dû à des règles de protection de branche (ex: reviews requises manquantes, checks CI en échec ou en cours, etc).`);
       return;
    }

    // 2. Si mergeable et prête, on merge
    let mergeRes = await fetch(`https://api.github.com/repos/${project.githubRepo}/pulls/${prNumber}/merge`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${project.githubToken}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ merge_method: 'merge' })
    });

    if (!mergeRes.ok && mergeRes.status === 405) {
      console.log(`[${project.id} - PR] ⚠️ La méthode 'merge' classique n'est pas autorisée (405). Tentative avec 'squash'...`);
      mergeRes = await fetch(`https://api.github.com/repos/${project.githubRepo}/pulls/${prNumber}/merge`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${project.githubToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ merge_method: 'squash' })
      });
    }

    if (mergeRes.ok) {
      console.log(`[${project.id} - PR] 🟢 SUCCÈS : PR #${prNumber} fusionnée automatiquement !`);
    } else {
      console.error(`[${project.id} - PR] 🔴 ÉCHEC de l'auto-merge de la PR #${prNumber}. Status: ${mergeRes.status} ${mergeRes.statusText}`);
      let errText = '';
      try { errText = await mergeRes.text(); } catch(e) {}
      if (errText) console.error(`Détails: ${errText}`);
    }
  } catch (error) {
    console.error(`[${project.id} - PR] Erreur critique lors de checkAndMergePR :`, error);
  }
}
export async function mergeOpenPRs(project) {
  try {
    const res = await fetch(`https://api.github.com/repos/${project.githubRepo}/pulls?state=open&sort=created&direction=asc`, {
      headers: {
        'Authorization': `Bearer ${project.githubToken}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    if (!res.ok) {
        const errorText = await res.text();
        console.error(`[${project.id} - GitHub] API Error fetching open PRs: ${res.status} ${res.statusText} - ${errorText}`);
        return;
    }
    const prs = await res.json();
    if (prs.length === 0) {
      return;
    }
    for (const pr of prs) {
      if (pr.title && pr.title.toLowerCase().includes('bump')) {
        continue;
      }
      // Delegate to checkAndMergePR which handles polling and safety checks
      await checkAndMergePR(project, pr.number);
    }
  } catch (error) {
    console.error(`[${project.id} - PR] Erreur critique lors de mergeOpenPRs :`, error);
  }
}
