# Site Pages — Page Map multi-projet

La table `site_pages` centralise toutes les pages de chaque projet dans la DB Turso.  
Elle sert de source de vérité pour le pipeline **screenshot → analyse → fix → test**.

---

## Schéma

```sql
CREATE TABLE site_pages (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id         TEXT    NOT NULL REFERENCES projects_config(id) ON DELETE CASCADE,
  url                TEXT    NOT NULL,               -- /en/search, /fr/admin/users/[id]…
  locale             TEXT    NOT NULL,               -- en | fr
  group_name         TEXT    NOT NULL,               -- marketing | platform | wizard | admin | root
  requires_auth      BOOLEAN NOT NULL DEFAULT 0,
  requires_admin     BOOLEAN NOT NULL DEFAULT 0,
  is_wizard          BOOLEAN NOT NULL DEFAULT 0,
  type               TEXT    NOT NULL DEFAULT 'static',  -- static | dynamic
  script             JSON,                           -- script de navigation Playwright (null si non défini)
  script_validated   BOOLEAN NOT NULL DEFAULT 0,
  last_screenshot_at TEXT,                           -- ISO timestamp
  last_analysis_at   TEXT,
  last_correction_at TEXT,
  status             TEXT    NOT NULL DEFAULT 'ANALYZE',
  locked_by          TEXT,                           -- id de l'agent qui tient la page
  locked_at          TEXT,
  priority           INTEGER NOT NULL DEFAULT 5,     -- 1 = haute, 10 = basse
  UNIQUE (project_id, url)
);
```

### Valeurs de `status`

| Valeur | Signification |
|--------|---------------|
| `ANALYZE` | Refaire screenshots + analyser |
| `FIX` | Corriger et tester les modifications |
| `OK` | Page validée, rien à faire |

### Priorités par groupe

| Groupe | Priorité |
|--------|----------|
| wizard | 4 |
| platform | 5 |
| marketing | 6 |
| root | 6 |
| admin | 8 |

---

## Ajouter un projet

### 1. Générer le routes-map.json du projet

Lance l'agent d'extraction de routes dans le dépôt cible. Il produit un fichier `routes-map.json` à la racine.

### 2. Vérifier que le projet existe dans `projects_config`

```sql
SELECT id FROM projects_config;
```

Si le projet n'existe pas encore, l'ajouter via le dashboard ou :

```sql
INSERT INTO projects_config (id, github_repo, github_branch, created_at, updated_at)
VALUES ('Trefle-ai-IHM', 'jeremy-angulo/0-Trefle-ai-IHM', 'main', unixepoch(), unixepoch());
```

### 3. Lancer le seed

```bash
node --env-file=.env scripts/db/seed-site-pages.mjs \
  --project Trefle-ai-IHM \
  --routes /chemin/vers/routes-map.json
```

Options disponibles :

| Flag | Défaut | Description |
|------|--------|-------------|
| `--project` | — | ID du projet (requis) |
| `--routes` | — | Chemin vers routes-map.json (requis) |
| `--locales` | `en,fr` | Locales à générer, séparées par des virgules |
| `--dry-run` | — | Affiche le nombre de lignes sans écrire |

### 4. Vérifier

```bash
node --env-file=.env -e "
import('@libsql/client').then(async ({ createClient }) => {
  const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  const r = await db.execute(\"SELECT project_id, COUNT(*) as pages FROM site_pages GROUP BY project_id\");
  console.table(r.rows);
});
"
```

---

## Queries utiles pour les agents

```sql
-- Prochaine page à analyser (non lockée, par priorité)
SELECT * FROM site_pages
WHERE project_id = 'HomeFreeWorld'
  AND status = 'ANALYZE'
  AND locked_by IS NULL
ORDER BY priority ASC, id ASC
LIMIT 1;

-- Locker une page
UPDATE site_pages
SET locked_by = 'agent-screenshot-01', locked_at = datetime('now')
WHERE id = ?;

-- Déverrouiller après traitement
UPDATE site_pages
SET locked_by = NULL, locked_at = NULL,
    status = 'FIX', last_screenshot_at = datetime('now'), last_analysis_at = datetime('now')
WHERE id = ?;

-- Libérer les locks périmés (> 30 min)
UPDATE site_pages
SET locked_by = NULL, locked_at = NULL
WHERE locked_at < datetime('now', '-30 minutes');

-- Progression par projet
SELECT project_id, status, COUNT(*) as count
FROM site_pages
GROUP BY project_id, status
ORDER BY project_id, status;
```

---

## Re-seeder un projet existant

Le script supprime toutes les lignes du projet avant de re-insérer — idempotent.

```bash
node --env-file=.env scripts/db/seed-site-pages.mjs \
  --project HomeFreeWorld \
  --routes /home/jeremy/dev/HomeFreeWorld/routes-map.json
```
