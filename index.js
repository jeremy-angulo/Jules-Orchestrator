import cron from 'node-cron';
import { GLOBAL_CONFIG, PROJECTS } from './config.js';

const JULES_API_BASE = "https://jules.googleapis.com/v1alpha";

// --- UTILITAIRE ---
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ============================================================================
// 1. HELPERS API (Jules & GitHub)
// ============================================================================

async function julesAPI(endpoint, method = 'GET', body = null) {
  const options = { 
    method, 
    headers: { 'Authorization': `Bearer ${GLOBAL_CONFIG.JULES_API_TOKEN}`, 'Content-Type': 'application/json' } 
  };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(`${JULES_API_BASE}${endpoint}`, options);
  return res.json();
}

async function getNextGitHubIssue(project) {
  const res = await fetch(`https://api.github.com/repos/${project.githubRepo}/issues?state=open&sort=created&direction=asc`, {
    headers: { 'Authorization': `Bearer ${project.githubToken}`, 'Accept': 'application/vnd.github.v3+json' }
  });
  if (!res.ok) return null;
  const issues = await res.json();
  return issues.find(i => !i.pull_request) || null;
}

async function closeGitHubIssue(project, issueNumber) {
  await fetch(`https://api.github.com/repos/${project.githubRepo}/issues/${issueNumber}`, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${project.githubToken}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: 'closed' })
  });
}

// ============================================================================
// 2. LE SUPERVISEUR (La boucle de robustesse absolue)
// ============================================================================

async function startAndMonitorSession(instruction, agentName, project) {
  // On force le contexte du repository pour que Jules ne se perde pas
  const contextualizedInstruction = `[CONTEXTE: Tu dois travailler UNIQUEMENT sur le repository GitHub "${project.githubRepo}"]\n\n${instruction}`;
  console.log(`\n[${project.id} - ${agentName}] 🟢 Lancement de la session Jules...`);
  
  try {
    const session = await julesAPI('/sessions', 'POST', { instruction: contextualizedInstruction });
    if (!session || !session.name) {
      console.error(`[${project.id} - ${agentName}] ❌ Erreur de création de session.`);
      return false;
    }
    
    let sessionName = session.name;

    // Boucle de surveillance infinie jusqu'à complétion ou échec
    while (true) {
      const state = await julesAPI(`/${sessionName}`);
      
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

// ============================================================================
// 3. GITHUB PR MANAGER (Création et Auto-Merge pour le Pipeline)
// ============================================================================

async function createAndMergePR(project, sourceBranch, targetBranch) {
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

// ============================================================================
// 4. LES 3 CERVEAUX (Agents)
// ============================================================================

// A. Les Tâches de Fond (tournent en boucle sur les prompts de configuration)
async function runBackgroundAgent(project) {
  let index = 0;
  while (true) {
    // Vérification du verrouillage : Si le Pipeline quotidien se prépare, on attend.
    if (project.state.isLockedForDaily) {
      console.log(`[${project.id}] 🛑 Background Agent en pause (Le Pipeline quotidien arrive)...`);
      await sleep(60000); 
      continue;
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

// B. L'Agent On-Demand (surveille les Issues GitHub / WhatsApp)
async function runWhatsAppAgent(project) {
  while (true) {
    if (project.state.isLockedForDaily) {
      await sleep(30000);
      continue;
    }

    const issue = await getNextGitHubIssue(project);
    if (issue) {
      project.state.activeTasks++;
      console.log(`\n[${project.id} - WhatsApp] 📥 Issue #${issue.number} reçue : ${issue.title}`);
      
      const instruction = `${issue.title}\n\n${issue.body || ""}`;
      const success = await startAndMonitorSession(instruction, "WhatsApp Agent", project);
      
      // On ferme l'Issue uniquement si Jules a réussi sa tâche
      if (success) {
        console.log(`[${project.id} - WhatsApp] 🔒 Tâche terminée, fermeture de l'Issue #${issue.number}.`);
        await closeGitHubIssue(project, issue.number);
      }
      project.state.activeTasks--;
    }
    
    // Vérification toutes les 30 secondes
    await sleep(30000);
  }
}

// C. Le Pipeline Build & Merge (S'exécute à l'heure pile via Cron)
function scheduleBuildAndMergePipeline(project) {
  if (!project.buildAndMergePipeline) return;
  
  cron.schedule(project.buildAndMergePipeline.cronSchedule, async () => {
    console.log(`\n[${project.id} - Pipeline] ⏰ Verrouillage du repo pour le Build & Merge...`);
    
    // 1. Lever le drapeau rouge
    project.state.isLockedForDaily = true;
    
    // 2. Attendre que les agents en cours finissent leur travail proprement
    while (project.state.activeTasks > 0) {
      console.log(`[${project.id} - Pipeline] ⏳ Attente de la fin de ${project.state.activeTasks} tâche(s) en cours...`);
      await sleep(15000);
    }
    
    console.log(`[${project.id} - Pipeline] 🚀 Repo libre ! Jules vérifie le build sur la branche ${project.buildAndMergePipeline.sourceBranch}.`);
    
    const pipeline = project.buildAndMergePipeline;
    const prompt = pipeline.prompt
      .replace(/{sourceBranch}/g, pipeline.sourceBranch)
      .replace(/{targetBranch}/g, pipeline.targetBranch);
      
    project.state.activeTasks++;
    
    // 3. Jules valide, nettoie et commit sur dev
    const success = await startAndMonitorSession(prompt, "Build & Merge Agent", project);
    
    // 4. Si Jules a réussi à stabiliser le build, Node.js crée la PR et la fusionne
    if (success) {
      await createAndMergePR(project, pipeline.sourceBranch, pipeline.targetBranch);
    } else {
      console.log(`[${project.id} - Pipeline] ⚠️ Jules a échoué à réparer le build. L'auto-merge est annulé par sécurité.`);
    }
    
    project.state.activeTasks--;

    // 5. Baisse du drapeau rouge, les agents de fond reprennent
    console.log(`[${project.id} - Pipeline] 🔓 Pipeline terminé ! Déverrouillage du repo.`);
    project.state.isLockedForDaily = false;
  });
  
  console.log(`[${project.id}] 🗓️ Pipeline planifié avec le cron : ${project.buildAndMergePipeline.cronSchedule}`);
}

// ============================================================================
// 5. INITIALISATION DE L'USINE
// ============================================================================

console.log("🚀 Démarrage du Super-Orchestrateur Multi-Projets...");

PROJECTS.forEach(project => {
  if (project.githubRepo) {
    // Initialisation de l'état en mémoire pour sécuriser les conflits Git
    project.state = {
      isLockedForDaily: false,
      activeTasks: 0
    };
    
    console.log(`⚙️  Initialisation du projet : ${project.id}`);
    
    // Lancement asynchrone des 3 cerveaux pour ce projet
    runBackgroundAgent(project);
    runWhatsAppAgent(project);
    scheduleBuildAndMergePipeline(project);
  }
});

