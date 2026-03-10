export async function getNextGitHubIssue(project) {
  const res = await fetch(`https://api.github.com/repos/${project.githubRepo}/issues?state=open&sort=created&direction=asc`, {
    headers: { 'Authorization': `Bearer ${project.githubToken}`, 'Accept': 'application/vnd.github.v3+json' }
  });
  if (!res.ok) return null;
  const issues = await res.json();
  return issues.find(i => !i.pull_request) || null;
}

export async function closeGitHubIssue(project, issueNumber) {
  await fetch(`https://api.github.com/repos/${project.githubRepo}/issues/${issueNumber}`, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${project.githubToken}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: 'closed' })
  });
}

export async function createAndMergePR(project, sourceBranch, targetBranch) {
  try {
    console.log(`\n[${project.id} - Pipeline] 📦 Création de la PR de ${sourceBranch} vers ${targetBranch}...`);

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
      const err = await createRes.json();
      // On gère gracieusement le fait qu'il n'y ait pas de nouveau code à fusionner aujourd'hui
      if (err.errors && err.errors[0].message.includes('No commits between')) {
        console.log(`[${project.id} - Pipeline] ℹ️ Le code de ${sourceBranch} et ${targetBranch} est déjà identique. Pas de PR nécessaire.`);
        return;
      }
      throw new Error(`Erreur API GitHub lors de la création PR: ${JSON.stringify(err)}`);
    }

    const pr = await createRes.json();
    console.log(`[${project.id} - Pipeline] ✅ PR #${pr.number} créée avec succès. Auto-Merge en cours...`);

    // Étape B : Fusionner la PR automatiquement
    const mergeRes = await fetch(`https://api.github.com/repos/${project.githubRepo}/pulls/${pr.number}/merge`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${project.githubToken}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ merge_method: 'merge' })
    });

    if (mergeRes.ok) {
      console.log(`[${project.id} - Pipeline] 🟢 SUCCÈS : PR #${pr.number} fusionnée sur ${targetBranch} !`);
    } else {
      console.error(`[${project.id} - Pipeline] 🔴 ÉCHEC de l'auto-merge de la PR #${pr.number}.`);
    }
  } catch (error) {
    console.error(`[${project.id} - Pipeline] Erreur critique lors de la gestion de la PR :`, error);
  }
}
