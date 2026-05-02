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
  const localePath = fullUrl.replace(baseUrl, '');

  return `# Mission : Analyse visuelle — \`${fullUrl}\`

Tu es un agent d'assurance qualité visuelle. Ta mission est de documenter l'état visuel exact de cette page sur 4 formats d'écran, sans interpréter ni corriger — uniquement observer et rapporter avec précision.

---

## Contexte technique du projet

- **Framework** : Next.js 15 App Router — routes dans \`app/[locale]/\` (locales : \`fr\` défaut, \`en\`)
- **Style** : Tailwind CSS + \`class-variance-authority\` (CVA) pour les variants de composants
- **UI** : Radix UI primitives, Lucide React pour les icônes, Framer Motion pour les animations
- **Couleurs** : centralisées dans \`lib/theme/colors.ts\` — ne jamais coder une couleur en dur
- **i18n** : \`next-intl\`, toutes les chaînes dans \`i18n/messages/{locale}.json\`
- **Auth** : NextAuth v5, rôles \`USER / ADMIN / MANDATARY\`

---

## Étape 1 — Générer les screenshots

Lance le script dédié (le serveur doit tourner avec \`IS_E2E=true\`) :

\`\`\`bash
node scripts/site-check-screenshot.mjs \\
  --url ${localePath} \\
  --out ${folder} \\
  --base-url ${baseUrl} \\
  --auth ${authLevel}
\`\`\`

**Niveau d'auth : \`${authLevel}\`**${
    authLevel === 'admin' ? ' — cookie ADMIN injecté automatiquement (page réservée aux admins)' :
    authLevel === 'user'  ? ' — cookie USER injecté automatiquement (page nécessite une connexion)' :
                            ' — page publique, aucune auth requise'
  }

Si le script signale une redirection vers \`/sign-in\`, arrête-toi et note l'erreur dans \`${folder}/analysis.md\` — ne continue pas avec des screenshots de la page de login.

Fichiers attendus :
\`\`\`
${folder}/mobile.png          (375×812)
${folder}/ipad-portrait.png   (768×1024)
${folder}/ipad-landscape.png  (1024×768)
${folder}/desktop.png         (1440×900)
\`\`\`

Vérifie que les 4 fichiers existent et font plus de 10 Ko chacun (fichier trop petit = page vide ou erreur). Si un viewport a échoué, relance avec \`--wait-ms 3000\`.

---

## Étape 2 — Analyse exhaustive des 4 formats

Ouvre chaque PNG et examine-le indépendamment. Pour chaque format, évalue chacun de ces axes :

### Layout & Structure
- Les sections principales sont-elles visibles et bien positionnées ?
- Y a-t-il des débordements horizontaux (scrollbar inattendue, élément qui dépasse) ?
- Des éléments se chevauchent-ils de façon anormale ?
- Les grilles/colonnes sont-elles cohérentes avec le viewport ?

### Typographie
- Les textes sont-ils lisibles (taille ≥ 14px sur mobile, contraste suffisant) ?
- Des textes sont-ils tronqués ou coupés de façon inattendue ?
- La hiérarchie H1 > H2 > body est-elle claire visuellement ?

### Images & Médias
- Toutes les images se chargent-elles (pas d'icône cassée, pas de placeholder vide) ?
- Les proportions sont-elles respectées (pas de distorsion, pas de crop abusif) ?

### Navigation & UI
- Le header et le menu de navigation sont-ils complets et correctement affichés ?
- Les boutons et CTA sont-ils visibles, cliquables et bien dimensionnés (min 44×44px sur mobile) ?
- Les éléments interactifs sont-ils visuellement distinguables ?

### Contenu
- Les sections contiennent-elles du contenu réel (pas de zones vides non intentionnelles) ?
- Y a-t-il des messages d'erreur ou états vides inattendus affichés ?

### Responsive
- Le layout est-il adapté au viewport et non une version desktop réduite ?
- Les éléments masqués/affichés selon le breakpoint semblent-ils corrects ?

---

## Étape 3 — Rédiger \`${folder}/analysis.md\`

Structure exacte à respecter :

\`\`\`markdown
# Analyse visuelle — ${fullUrl}
_Générée le : {date}_

## Résumé
{2-3 phrases décrivant l'état général : globalement sain / quelques problèmes mineurs / problèmes critiques}

## Résultat par format

### Mobile (375×812)
#### Problèmes détectés
- [ ] **critical** | **major** | **minor** — {description précise, observable sur le screenshot} — Fichier(s) probable(s) : \`app/[locale]/...\` ou \`components/...\`
#### Observations positives
- {ce qui fonctionne bien}

### iPad Portrait (768×1024)
#### Problèmes détectés
- ...
#### Observations positives
- ...

### iPad Paysage (1024×768)
#### Problèmes détectés
- ...
#### Observations positives
- ...

### Desktop (1440×900)
#### Problèmes détectés
- ...
#### Observations positives
- ...

## Priorité de correction
| Priorité | Sévérité | Format(s) | Problème | Fichier(s) |
|----------|----------|-----------|----------|------------|
| 1 | critical | mobile, ipad-portrait | ... | \`src/...\` |
| 2 | major | desktop | ... | \`src/...\` |

## Verdict
- **Problèmes critical** : {n}
- **Problèmes major** : {n}
- **Problèmes minor** : {n}
- **Action requise** : OUI / NON
\`\`\`

Règles :
- Si un format n'a aucun problème → écris "Aucun problème détecté." dans sa section.
- Si la page est parfaite sur tous les formats → Résumé = "RAS — aucun problème détecté." et Verdict Action requise = NON.
- Sois précis sur les fichiers : cherche dans \`app/[locale]/\` et \`components/\` le composant responsable.
- Ne suggère pas de corrections dans ce fichier — observation pure.

---

## Étape 4 — Ouvrir la Pull Request

Crée une PR avec :

**Titre :** \`[Site Check] Analyse ${localePath}\`

**Description :**
\`\`\`markdown
## Analyse visuelle — \`${fullUrl}\`

| Sévérité | Nombre |
|----------|--------|
| 🔴 critical | {n} |
| 🟠 major | {n} |
| 🟡 minor | {n} |

### Screenshots

| Mobile | iPad Portrait |
|--------|---------------|
| ![mobile](${folder}/mobile.png) | ![ipad-portrait](${folder}/ipad-portrait.png) |

| iPad Paysage | Desktop |
|--------------|---------|
| ![ipad-landscape](${folder}/ipad-landscape.png) | ![desktop](${folder}/desktop.png) |

> Rapport complet : \`${folder}/analysis.md\`
\`\`\`

La PR doit contenir uniquement les 4 PNG et \`${folder}/analysis.md\`. Aucune modification de code.`;
}

// ── Prompt fix ────────────────────────────────────────────────────────────────

function buildFixPrompt(page, folder, fullUrl, baseUrl) {
  const authLevel  = page.requires_admin ? 'admin' : page.requires_auth ? 'user' : 'none';
  const localePath = fullUrl.replace(baseUrl, '');

  return `# Mission : Correction visuelle — \`${fullUrl}\`

Tu es un agent de correction visuelle. Une analyse de cette page a été réalisée et mergée. Ta mission est de lire cette analyse, de la valider visuellement, de corriger les problèmes identifiés, de tester tes corrections, puis d'ouvrir une PR propre.

---

## Contexte technique du projet

- **Framework** : Next.js 15 App Router — routes dans \`app/[locale]/\` (locales : \`fr\` défaut, \`en\`)
- **Style** : Tailwind CSS + \`class-variance-authority\` (CVA) pour les variants — pas de style inline
- **UI** : Radix UI primitives, Lucide React, Framer Motion pour les animations
- **Couleurs** : centralisées dans \`lib/theme/colors.ts\` — utilise les variables CSS, jamais de couleur codée en dur
- **i18n** : \`next-intl\`, toutes les chaînes dans \`i18n/messages/{locale}.json\` — jamais de texte UI en dur dans le code
- **Auth** : NextAuth v5, rôles \`USER / ADMIN / MANDATARY\`

### Ce que tu NE dois PAS toucher
- La logique métier (server actions, API routes, queries Prisma)
- Les clés i18n existantes dans les fichiers de messages
- Les tests existants
- Les fichiers de configuration (next.config, tailwind.config, tsconfig…)
- Les autres pages non concernées par cette analyse

---

## Ressources disponibles (déjà dans le repo, branche \`dev\`)

**Rapport d'analyse :**
\`${folder}/analysis.md\`

**Screenshots de référence :**
- \`${folder}/mobile.png\` — 375×812
- \`${folder}/ipad-portrait.png\` — 768×1024
- \`${folder}/ipad-landscape.png\` — 1024×768
- \`${folder}/desktop.png\` — 1440×900

---

## Étape 1 — Lire et valider l'analyse

1. Lis \`${folder}/analysis.md\` dans son intégralité.
2. Ouvre chaque screenshot et observe toi-même chaque problème listé.
3. Pour chaque problème dans la table "Priorité de correction" :
   - Confirme qu'il est bien visible sur le screenshot correspondant.
   - Localise le fichier source réel dans le code (ne te fie pas uniquement aux suggestions du rapport).
   - Si un problème du rapport n'est plus reproductible ou si le fichier indiqué est incorrect, note-le mais ne le corrige pas (il sera ignoré).
4. Si tu observes sur les screenshots des problèmes **critical** ou **major** qui ne sont PAS dans le rapport, ajoute-les à ta liste de travail avant de commencer — l'analyse peut avoir manqué quelque chose.

---

## Étape 2 — Corriger tous les problèmes visibles

Corrige **tous** les problèmes identifiés — critical, major et minor — dans l'ordre de priorité du rapport. Un problème minor visible sur la page est un problème à corriger au même titre que les autres.

Pour chaque problème confirmé, dans l'ordre de priorité du rapport :

1. **Identifie précisément le composant responsable** dans \`app/[locale]/\` ou \`components/\`.
2. **Applique la correction minimale** — le changement le plus petit qui résout le problème visible :
   - Préfère les classes Tailwind existantes aux nouvelles propriétés CSS.
   - Si un composant Radix est mal utilisé, corrige son usage plutôt que de le contourner.
   - Pour les problèmes responsive : utilise les breakpoints Tailwind (\`sm:\`, \`md:\`, \`lg:\`, \`xl:\`).
   - Pour les problèmes de couleur : utilise les tokens de \`lib/theme/colors.ts\`.
3. **Ne passe au problème suivant qu'une fois le précédent résolu.**

Le seul cas où tu peux ignorer un problème : si la correction risque d'introduire une régression certaine et qu'il n'existe pas d'approche sûre — documente-le explicitement dans la PR.

---

## Étape 3 — Valider visuellement les corrections

Après avoir corrigé tous les problèmes, relance les screenshots pour vérifier que les corrections sont effectives :

\`\`\`bash
node scripts/site-check-screenshot.mjs \\
  --url ${localePath} \\
  --out ${folder}/validation \\
  --base-url ${baseUrl} \\
  --auth ${authLevel}
\`\`\`

Les fichiers de validation seront dans \`${folder}/validation/\`.

Compare chaque viewport avant/après :
- Si un problème corrigé n'est plus visible → ✅
- Si un problème est toujours présent → examine pourquoi (cache ? mauvais fichier modifié ?) et corrige.
- Si une **régression** apparaît sur un autre élément → annule la correction responsable et trouve une approche différente.

---

## Étape 4 — Vérifier le build et le lint

\`\`\`bash
npm run lint
npm run build:fast
\`\`\`

Si le lint ou le build échoue à cause de tes modifications, corrige les erreurs avant de continuer. N'utilise pas \`// eslint-disable\` pour contourner.

---

## Étape 5 — Ouvrir la Pull Request

Crée une PR depuis ta branche vers \`dev\` avec :

**Titre :** \`[Site Check] Fix ${localePath}\`

**Description :**
\`\`\`markdown
## Corrections visuelles — \`${fullUrl}\`

Basé sur l'analyse : \`${folder}/analysis.md\`

### Problèmes corrigés
| Sévérité | Format(s) | Problème | Fichier modifié |
|----------|-----------|----------|-----------------|
| 🔴 critical | mobile | {description} | \`app/...\` |
| 🟠 major | desktop | {description} | \`components/...\` |

### Problèmes non corrigés (régression certaine ou non reproductible)
- {liste si applicable, sinon "Aucun"}

### Validation visuelle — avant / après

| | Mobile avant | Mobile après |
|-|---|---|
| | ![before](${folder}/mobile.png) | ![after](${folder}/validation/mobile.png) |

| | Desktop avant | Desktop après |
|-|---|---|
| | ![before](${folder}/desktop.png) | ![after](${folder}/validation/desktop.png) |

_(Ajoute les autres viewports si des changements y sont visibles)_
\`\`\``;
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
