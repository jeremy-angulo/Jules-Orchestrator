/**
 * seed-site-pages.mjs
 *
 * Peuple la table `site_pages` depuis un fichier routes-map.json.
 * Les URLs sont stockées SANS préfixe de locale (ex: /admin/users).
 * La locale est ajoutée à l'exécution par le runner.
 *
 * Usage:
 *   node --env-file=.env scripts/db/seed-site-pages.mjs \
 *     --project HomeFreeWorld \
 *     --routes /path/to/routes-map.json \
 *     [--dry-run]
 *
 * La table est créée si elle n'existe pas encore.
 * Les lignes existantes pour ce project_id sont supprimées avant re-seed.
 */

import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const get = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };

const PROJECT_ID  = get('--project');
const ROUTES_FILE = get('--routes');
const DRY_RUN     = args.includes('--dry-run');

if (!PROJECT_ID || !ROUTES_FILE) {
  console.error('Usage: node --env-file=.env scripts/db/seed-site-pages.mjs --project <id> --routes <path> [--dry-run]');
  process.exit(1);
}

// ── DB ────────────────────────────────────────────────────────────────────────

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// ── Schema ────────────────────────────────────────────────────────────────────

async function ensureSchema() {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS site_pages (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id         TEXT    NOT NULL REFERENCES projects_config(id) ON DELETE CASCADE,
      url                TEXT    NOT NULL,
      group_name         TEXT    NOT NULL,
      requires_auth      BOOLEAN NOT NULL DEFAULT 0,
      requires_admin     BOOLEAN NOT NULL DEFAULT 0,
      is_wizard          BOOLEAN NOT NULL DEFAULT 0,
      type               TEXT    NOT NULL DEFAULT 'static',
      script             JSON,
      script_validated   BOOLEAN NOT NULL DEFAULT 0,
      last_screenshot_at TEXT,
      last_analysis_at   TEXT,
      last_correction_at TEXT,
      status             TEXT    NOT NULL DEFAULT 'ANALYZE',
      locked_by          TEXT,
      locked_at          TEXT,
      priority           INTEGER NOT NULL DEFAULT 5,
      screenshot_path    TEXT,
      issues             JSON,
      UNIQUE (project_id, url)
    )
  `);
}

// ── Seed ──────────────────────────────────────────────────────────────────────

const PRIORITY = { wizard: 4, platform: 5, marketing: 6, root: 6, admin: 8 };
const AUTH_GROUPS = new Set(['platform', 'wizard', 'admin']);

async function seed() {
  const data = JSON.parse(readFileSync(ROUTES_FILE, 'utf8'));

  if (DRY_RUN) {
    console.log(`[dry-run] Would seed ${data.routes.length} rows for project "${PROJECT_ID}"`);
    return;
  }

  await ensureSchema();

  // Clear existing rows for this project so re-seed is idempotent
  const deleted = await client.execute({
    sql: 'DELETE FROM site_pages WHERE project_id = ?',
    args: [PROJECT_ID],
  });
  console.log(`Cleared ${deleted.rowsAffected} existing rows for "${PROJECT_ID}"`);

  let count = 0;

  for (const route of data.routes) {
    const group         = route.group || 'root';
    const requires_auth  = AUTH_GROUPS.has(group) ? 1 : 0;
    const requires_admin = group === 'admin'  ? 1 : 0;
    const is_wizard      = group === 'wizard' ? 1 : 0;
    const type           = route.type || (route.url.includes('[') ? 'dynamic' : 'static');
    const priority       = PRIORITY[group] ?? 6;

    await client.execute({
      sql: `INSERT OR IGNORE INTO site_pages
            (project_id, url, group_name, requires_auth, requires_admin, is_wizard, type, priority, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ANALYZE')`,
      args: [PROJECT_ID, route.url, group, requires_auth, requires_admin, is_wizard, type, priority],
    });
    count++;
  }

  console.log(`✓ ${count} lignes insérées pour "${PROJECT_ID}"`);

  const summary = await client.execute({
    sql: `SELECT group_name, COUNT(*) as count
          FROM site_pages WHERE project_id = ?
          GROUP BY group_name ORDER BY group_name`,
    args: [PROJECT_ID],
  });
  console.table(summary.rows);

  const total = await client.execute({
    sql: 'SELECT COUNT(*) as total FROM site_pages WHERE project_id = ?',
    args: [PROJECT_ID],
  });
  console.log('Total:', total.rows[0].total);
}

seed().catch(err => { console.error(err); process.exit(1); });
