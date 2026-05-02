/**
 * siteCheckService.js
 *
 * Pipeline par page :
 *
 *  [Orchestrateur — Node.js local]
 *    1. Pick page, oldest first
 *    2. Lock la page (locked_by = 'site-check-runner')
 *    3. Lance l'agent Jules — analyse

 *  [Jules — agent analyse]
 *    4. Reçoit les instructions + prompt d'analyse structuré
 *    5. Lance Playwright → 4 screenshots :
 *         mobile 375×812 · ipad-portrait 768×1024
 *         ipad-landscape 1024×768 · desktop 1440×900
 *    6. Analyse les 4 images
 *    7. Écrit agent-screenshots/<locale>/<page>/analysis.md
 *    8. Ouvre PR "[Site Check] Analyse /<locale>/<page>"
 *
 *  [Orchestrateur]
 *    9.  Merge PR (3× retry, 30s entre chaque)
 *    10. Si merge → status ANALYZED → lance agent fix
 *    10b.Si échec merge → status ANALYZE (remis en file)
 *
 *  [Jules — agent fix]
 *   11. Reçoit page + chemins analysis.md + screenshots
 *   12. Lit l'analyse, corrige le code
 *   13. Ouvre PR "[Site Check] Fix /<locale>/<page>"
 *
 *  [Orchestrateur]
 *   14. status → FIX
 */

import {
  pickAndLockSitePage,
  unlockSitePage,
  updateSitePageResult,
  releaseStaleSitePageLocks,
} from '../db/database.js';
import { startAndMonitorSession } from '../api/julesClient.js';
import { mergePRWithResult } from '../api/githubClient.js';
import { log } from '../utils/logger.js';

const AGENT_ID    = 'site-check-runner';
const MERGE_TRIES = 3;
const MERGE_WAIT  = 30_000;   // 30s entre chaque tentative
const FIX_DELAY   = 120_000;  // 2 min avant de lancer le fix

// /admin/users + 'fr' → agent-screenshots/fr/admin/users
function pageToFolder(pageUrl, locale) {
  return `agent-screenshots/${locale}${pageUrl}`;
}

// ── Merge avec retry ──────────────────────────────────────────────────────────

async function mergeWithRetry(project, prNumber) {
  for (let i = 1; i <= MERGE_TRIES; i++) {
    try {
      const result = await mergePRWithResult(project, prNumber);
      if (result?.status === 'merged' || result?.status === 'skipped') {
        log('info', `[SiteCheck] PR #${prNumber} mergée (tentative ${i})`);
        return true;
      }
      log('warn', `[SiteCheck] PR #${prNumber} non mergeable (${i}/${MERGE_TRIES}) — ${result?.reason || ''}`);
    } catch (err) {
      log('warn', `[SiteCheck] Merge PR #${prNumber} erreur (${i}/${MERGE_TRIES}): ${err.message}`);
    }
    if (i < MERGE_TRIES) await new Promise(r => setTimeout(r, MERGE_WAIT));
  }
  log('error', `[SiteCheck] PR #${prNumber} impossible à merger après ${MERGE_TRIES} tentatives`);
  return false;
}

// ── Prompt d'analyse (Jules prend les screenshots) ────────────────────────────

function buildAnalysisPrompt(page, folder, fullUrl, baseUrl) {
  const authLevel  = page.requires_admin ? 'admin' : page.requires_auth ? 'user' : 'none';
  const localePath = page.url; // Relative path from base URL

  return `# Mission : Analyse visuelle et technique — \`${page.url}\`

Tu es un agent d'assurance qualité. Ta mission est de lancer le projet en local, de capturer l'état visuel et technique de cette page, d'analyser les résultats et de rapporter les problèmes.

---

## Étape 1 — Lancer le serveur localement

1. **Setup** : \`npm install\` + s'assurer que les variables d'environnement sont prêtes (\`.env.test\` recommandé).
2. **Start** : Lance le serveur avec le flag E2E actif :
   \`\`\`bash
   IS_E2E=true npm run dev
   \`\`\`
   Attends que le serveur soit prêt sur \`http://localhost:3000\`.

---

## Étape 2 — Capturer les screenshots

Utilise le script déjà présent dans le repository :

\`\`\`bash
node scripts/site-check-screenshot.mjs \\
  --url ${localePath} \\
  --out ${folder} \\
  --base-url http://localhost:3000 \\
  --auth ${authLevel} \\
  --wait-ms 3000
\`\`\`

Vérifie que les 4 viewports ont été capturés dans \`${folder}/\`.

---

## Étape 3 — Analyse & Rapport

1. **Visuel** : Ouvre les PNG et cherche les régressions, débordements, textes coupés ou erreurs de design.
2. **Technique** : Regarde tes propres logs terminal de l'étape 2. Si le script signale des erreurs de chargement, des 404 sur des assets ou des redirections inattendues, note-les.
3. **Rédaction** : Produis un rapport \`${folder}/analysis.md\` complet.
4. **Livraison** : Ouvre une Pull Request contenant uniquement les screenshots et ton rapport d'analyse.

**Titre de la PR :** \`[Site Check] Analyse ${page.url}\``;
}

// ── Prompt fix ────────────────────────────────────────────────────────────────

function buildFixPrompt(page, folder, fullUrl, baseUrl) {
  const localePath = page.url;

  return `# Mission : Correction visuelle et technique — \`${page.url}\`

Tu es un agent de correction. Ta mission est de lire l'analyse précédente (mergée sur dev), de reproduire les problèmes identifiés en local, de les corriger proprement dans le code, et de valider tes changements.

---

## Étape 1 — Correction

1. **Analyse** : Lis \`${folder}/analysis.md\` et regarde les screenshots.
2. **Fix** : Identifie les composants responsables et applique les corrections (Tailwind, i18n, etc.).
3. **Vérification technique** : Assure-toi que \`npm run lint\` et \`npm run typecheck\` passent.

---

## Étape 2 — Validation visuelle

Relance le script de capture en local pour confirmer le fix :

\`\`\`bash
node scripts/site-check-screenshot.mjs \\
  --url ${localePath} \\
  --out ${folder}/validation \\
  --base-url http://localhost:3000 \\
  --auth ${page.requires_admin ? 'admin' : page.requires_auth ? 'user' : 'none'}
\`\`\`

Compare \`${folder}/validation/\` avec les images de référence de l'analyse.

---

## Étape 3 — Livraison

Ouvre une Pull Request avec tes modifications de code.
**Titre de la PR :** \`[Site Check] Fix ${page.url}\``;
}

// ── processPage ───────────────────────────────────────────────────────────────

export async function processPage(page, project, locale = 'fr', siteCheckAuth = null) {
  const localePath = `/${locale}${page.url === '/' ? '' : page.url}`;
  const fullUrl    = `${project.siteCheckBaseUrl}${localePath}`;
  const folder     = pageToFolder(page.url, locale);
  const screenshotPath = `${folder}/desktop.png`;

  log('info', `[SiteCheck][${project.id}] → ${localePath}`);

  // 1. Lance Jules — analyse (Jules prend les screenshots et ouvre la PR)
  let capturedPR = null;
  await updateSitePageResult(page.id, { status: 'ANALYZE', screenshotPath, issues: null });

  const hasPR = await startAndMonitorSession(
    buildAnalysisPrompt(page, folder, fullUrl, project.siteCheckBaseUrl),
    'Site-Check-Analysis',
    project,
    {
      onPRCreated: ({ prUrl, prNumber }) => { capturedPR = { prUrl, prNumber }; },
    }
  );

  if (!hasPR || !capturedPR) {
    // Jules n'a pas créé de PR → aucun problème détecté
    log('info', `[SiteCheck][${project.id}] ✓ ${localePath} — aucun problème`);
    await updateSitePageResult(page.id, { status: 'OK', screenshotPath, issues: null });
    return;
  }

  // 2. Merge de la PR d'analyse (3× retry, 30s entre chaque)
  log('info', `[SiteCheck] Merge PR #${capturedPR.prNumber} pour ${localePath}`);
  const merged = await mergeWithRetry(project, capturedPR.prNumber);

  if (!merged) {
    // Conflit ou merge impossible → remet la page en file
    log('warn', `[SiteCheck][${project.id}] Merge échoué — ${localePath} remis en ANALYZE`);
    await updateSitePageResult(page.id, { status: 'ANALYZE', screenshotPath: null, issues: null });
    return;
  }

  // 3. Merge OK → statut ANALYZED, attente 2 min, puis fix
  await updateSitePageResult(page.id, { status: 'ANALYZED', screenshotPath, issues: null });

  log('info', `[SiteCheck][${project.id}] Attente ${FIX_DELAY / 1000}s avant fix`);
  await new Promise(r => setTimeout(r, FIX_DELAY));

  log('info', `[SiteCheck][${project.id}] Lancement agent fix — ${localePath}`);
  await updateSitePageResult(page.id, { status: 'FIX', screenshotPath, issues: null });
  await startAndMonitorSession(buildFixPrompt(page, folder, fullUrl, project.siteCheckBaseUrl), 'Site-Check-Fix', project, {});

  log('info', `[SiteCheck][${project.id}] ✓ Cycle complet pour ${localePath}`);
}

// ── Runner loop ───────────────────────────────────────────────────────────────

export async function runSiteCheckCycle(project, { shouldStop, pauseMs = 5000, locale = 'fr', siteCheckAuth = null } = {}) {
  await releaseStaleSitePageLocks(30);

  while (true) {
    if (shouldStop?.()) break;

    // Atomic pick+lock: safe for 15 concurrent runners on the same project
    const page = await pickAndLockSitePage(project.id, AGENT_ID);
    if (!page) {
      log('info', `[SiteCheck][${project.id}] Cycle complet (locale=${locale}) — reprise dans 60s`);
      await new Promise(r => setTimeout(r, 60_000));
      continue;
    }

    try {
      await processPage(page, project, locale, siteCheckAuth);
    } catch (err) {
      log('error', `[SiteCheck][${project.id}] Erreur sur ${page.url}: ${err.message}`);
      await unlockSitePage(page.id);
    }

    if (pauseMs > 0) await new Promise(r => setTimeout(r, pauseMs));
  }

  log('info', `[SiteCheck][${project.id}] Runner arrêté`);
}
