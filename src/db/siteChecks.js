import { executeWithRetry } from './core.js';
import { siteCheckStatsCache, siteCheckPagesCache, invalidateSiteCheckCache } from './cache.js';

export async function getSiteCheckConfig(projectId) {
  const rs = await executeWithRetry({
    sql: 'SELECT site_check_enabled, site_check_base_url, site_check_pause_ms, site_check_locale, site_check_concurrency FROM projects_config WHERE id = ?',
    args: [projectId],
  });
  const row = rs.rows[0];
  if (!row) return null;
  return {
    enabled: !!row.site_check_enabled,
    baseUrl: row.site_check_base_url || '',
    pauseMs: Number(row.site_check_pause_ms || 5000),
    locale: row.site_check_locale || 'fr',
    concurrency: Number(row.site_check_concurrency || 1),
  };
}

export async function updateSiteCheckConfig(projectId, { enabled, baseUrl, pauseMs, locale, concurrency }) {
  await executeWithRetry({
    sql: `UPDATE projects_config
          SET site_check_enabled = ?, site_check_base_url = ?, site_check_pause_ms = ?,
              site_check_locale = ?, site_check_concurrency = ?, updated_at = ?
          WHERE id = ?`,
    args: [
      enabled ? 1 : 0,
      baseUrl ?? null,
      pauseMs ?? 5000,
      locale ?? 'fr',
      concurrency ?? 1,
      Date.now(),
      projectId
    ],
  });
}

// Atomic pick + lock in a single statement — safe for concurrent runners.
// Returns the locked page or null if no unlocked page is available.
export async function pickAndLockSitePage(projectId, agentId) {
  const rs = await executeWithRetry({
    sql: `UPDATE site_pages
          SET locked_by = ?, locked_at = datetime('now')
          WHERE id = (
            SELECT id FROM site_pages
            WHERE project_id = ? AND locked_by IS NULL AND status = 'ANALYZE'
            ORDER BY last_screenshot_at ASC NULLS FIRST, priority ASC
            LIMIT 1
          )
          AND locked_by IS NULL
          RETURNING *`,
    args: [agentId, projectId],
  });
  const row = rs.rows[0];
  if (!row) return null;
  invalidateSiteCheckCache(projectId);
  return { ...row, issues: row.issues ? JSON.parse(row.issues) : null };
}

// Kept for external callers; internally prefer pickAndLockSitePage.
export async function lockSitePage(pageId, agentId) {
  const rs = await executeWithRetry({
    sql: `UPDATE site_pages SET locked_by = ?, locked_at = datetime('now') WHERE id = ? AND locked_by IS NULL RETURNING project_id`,
    args: [agentId, pageId],
  });
  invalidateSiteCheckCache(rs.rows[0]?.project_id);
}

export async function unlockSitePage(pageId) {
  const rs = await executeWithRetry({
    sql: `UPDATE site_pages SET locked_by = NULL, locked_at = NULL WHERE id = ? RETURNING project_id`,
    args: [pageId],
  });
  invalidateSiteCheckCache(rs.rows[0]?.project_id);
}

export async function updateSitePageResult(pageId, { status, screenshotPath, issues }) {
  const now = new Date().toISOString();
  const rs = await executeWithRetry({
    sql: `UPDATE site_pages
          SET status = ?, screenshot_path = ?, issues = ?,
              last_screenshot_at = ?, last_analysis_at = ?,
              locked_by = NULL, locked_at = NULL
          WHERE id = ?
          RETURNING project_id`,
    args: [
      status,
      screenshotPath ?? null,
      issues ? JSON.stringify(issues) : null,
      now, now,
      pageId,
    ],
  });
  invalidateSiteCheckCache(rs.rows[0]?.project_id);
}

export async function markSitePageFixed(pageId) {
  const rs = await executeWithRetry({
    sql: `UPDATE site_pages SET status = 'OK', last_correction_at = datetime('now') WHERE id = ? RETURNING project_id`,
    args: [pageId],
  });
  invalidateSiteCheckCache(rs.rows[0]?.project_id);
}

export async function getSiteCheckStats(projectId) {
  const cached = siteCheckStatsCache.get(projectId);
  if (cached) return cached;

  const rs = await executeWithRetry({
    sql: `SELECT
            COUNT(*) as total,
            SUM(CASE WHEN status = 'OK' THEN 1 ELSE 0 END) as ok,
            SUM(CASE WHEN status = 'FIX' THEN 1 ELSE 0 END) as fix,
            SUM(CASE WHEN status = 'ANALYZE' THEN 1 ELSE 0 END) as analyze,
            SUM(CASE WHEN last_screenshot_at IS NULL THEN 1 ELSE 0 END) as never_analyzed
          FROM site_pages WHERE project_id = ?`,
    args: [projectId],
  });
  const row = rs.rows[0];
  const stats = {
    total: Number(row?.total || 0),
    ok: Number(row?.ok || 0),
    fix: Number(row?.fix || 0),
    analyze: Number(row?.analyze || 0),
    neverAnalyzed: Number(row?.never_analyzed || 0),
  };
  siteCheckStatsCache.set(projectId, stats);
  return stats;
}

export async function listSitePages(projectId, { status, group, limit = 100, offset = 0 } = {}) {
  let pages;
  const cached = siteCheckPagesCache.get(projectId);
  if (cached) {
    pages = cached;
  } else {
    const rs = await executeWithRetry({
      sql: `SELECT * FROM site_pages WHERE project_id = ?
            ORDER BY last_screenshot_at ASC NULLS FIRST, priority ASC`,
      args: [projectId],
    });
    pages = rs.rows.map(r => ({ ...r, issues: r.issues ? JSON.parse(r.issues) : null }));
    siteCheckPagesCache.set(projectId, pages);
  }

  let filtered = pages;
  if (status) filtered = filtered.filter(p => p.status === status);
  if (group) filtered = filtered.filter(p => p.group_name === group);

  return filtered.slice(offset, offset + limit);
}

export async function releaseStaleSitePageLocks(maxAgeMinutes = 30) {
  await executeWithRetry({
    sql: `UPDATE site_pages SET locked_by = NULL, locked_at = NULL
          WHERE locked_at < datetime('now', ? || ' minutes')`,
    args: [`-${maxAgeMinutes}`],
  });
  siteCheckStatsCache.clear();
  siteCheckPagesCache.clear();
}
