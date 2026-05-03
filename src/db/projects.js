import { executeWithRetry } from './core.js';
import { projectStateCache, projectConfigCache, invalidateProjectStateCache, invalidateProjectConfigCache } from './cache.js';

export async function initProjectState(projectId) {
  await executeWithRetry({ sql: 'INSERT OR IGNORE INTO project_states (project_id) VALUES (?)', args: [projectId] });
  invalidateProjectStateCache(projectId);
}

export async function lockProject(projectId, reason = 'manual') {
  await executeWithRetry({ sql: 'UPDATE project_states SET is_locked_for_daily = 1, locked_at = ?, lock_reason = ? WHERE project_id = ?', args: [Date.now(), reason, projectId] });
  invalidateProjectStateCache(projectId);
}

export async function unlockProject(projectId) {
  await executeWithRetry({ sql: 'UPDATE project_states SET is_locked_for_daily = 0, locked_at = NULL, lock_reason = NULL WHERE project_id = ?', args: [projectId] });
  invalidateProjectStateCache(projectId);
}

export async function incrementTasks(projectId) {
  await executeWithRetry({ sql: 'UPDATE project_states SET active_tasks = active_tasks + 1 WHERE project_id = ?', args: [projectId] });
  invalidateProjectStateCache(projectId);
}

export async function decrementTasks(projectId) {
  await executeWithRetry({ sql: 'UPDATE project_states SET active_tasks = MAX(0, active_tasks - 1) WHERE project_id = ?', args: [projectId] });
  invalidateProjectStateCache(projectId);
}

export async function setActiveTasks(projectId, taskCount) {
  await executeWithRetry({ sql: 'UPDATE project_states SET active_tasks = ? WHERE project_id = ?', args: [taskCount, projectId] });
  invalidateProjectStateCache(projectId);
}

export async function isProjectLocked(projectId) {
  const cached = projectStateCache.get(projectId);
  if (cached) return cached.is_locked_for_daily === 1;

  const rs = await executeWithRetry({ sql: 'SELECT * FROM project_states WHERE project_id = ?', args: [projectId] });
  const row = rs.rows[0];
  if (row) projectStateCache.set(projectId, row);
  return row?.is_locked_for_daily === 1;
}

export async function getActiveTasks(projectId) {
  const cached = projectStateCache.get(projectId);
  if (cached) return Number(cached.active_tasks || 0);

  const rs = await executeWithRetry({ sql: 'SELECT * FROM project_states WHERE project_id = ?', args: [projectId] });
  const row = rs.rows[0];
  if (row) projectStateCache.set(projectId, row);
  return Number(row?.active_tasks || 0);
}

export async function getAllProjectStates() {
  const rs = await executeWithRetry('SELECT * FROM project_states');
  const states = rs.rows.map(r => {
    projectStateCache.set(r.project_id, r);
    return { 
      projectId: r.project_id, 
      is_locked_for_daily: !!r.is_locked_for_daily, 
      active_tasks: Number(r.active_tasks),
      lockedAt: r.locked_at,
      lockReason: r.lock_reason
    };
  });
  return states;
}

export async function listProjectsConfig() {
  const rs = await executeWithRetry('SELECT * FROM projects_config ORDER BY id ASC');
  return rs.rows;
}

export async function getProjectConfig(id) {
  if (projectConfigCache.has(id)) return projectConfigCache.get(id);
  const rs = await executeWithRetry({ sql: 'SELECT * FROM projects_config WHERE id = ?', args: [id] });
  if (rs.rows[0]) projectConfigCache.set(id, rs.rows[0]);
  return rs.rows[0];
}

export async function upsertProjectConfig(p) {
  await executeWithRetry({
    sql: `INSERT INTO projects_config (
            id, github_repo, github_branch, github_token, pipeline_cron,
            pipeline_source_branch, pipeline_target_branch, pipeline_prompt,
            build_pipeline_enabled, conflict_resolver_enabled, conflict_resolver_cron,
            site_check_enabled, site_check_base_url, site_check_pause_ms,
            site_check_locale, site_check_concurrency,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            github_repo=excluded.github_repo,
            github_branch=excluded.github_branch,
            github_token=excluded.github_token,
            pipeline_cron=excluded.pipeline_cron,
            pipeline_source_branch=excluded.pipeline_source_branch,
            pipeline_target_branch=excluded.pipeline_target_branch,
            pipeline_prompt=excluded.pipeline_prompt,
            build_pipeline_enabled=excluded.build_pipeline_enabled,
            conflict_resolver_enabled=excluded.conflict_resolver_enabled,
            conflict_resolver_cron=excluded.conflict_resolver_cron,
            site_check_enabled=excluded.site_check_enabled,
            site_check_base_url=excluded.site_check_base_url,
            site_check_pause_ms=excluded.site_check_pause_ms,
            site_check_locale=excluded.site_check_locale,
            site_check_concurrency=excluded.site_check_concurrency,
            updated_at=excluded.updated_at`,
    args: [
      p.id, p.github_repo, p.github_branch || 'main', p.github_token, p.pipeline_cron,
      p.pipeline_source_branch, p.pipeline_target_branch, p.pipeline_prompt,
      p.build_pipeline_enabled ? 1 : 0, p.conflict_resolver_enabled ? 1 : 0, p.conflict_resolver_cron || '0 18 * * *',
      p.site_check_enabled ? 1 : 0, p.site_check_base_url || null, p.site_check_pause_ms || 5000,
      p.site_check_locale || 'fr', p.site_check_concurrency || 1,
      p.created_at || Date.now(), Date.now()
    ]
  });
  invalidateProjectConfigCache(p.id);
}

export async function updateProjectAutomation(projectId, { 
  buildPipelineEnabled, pipelineCron, pipelinePrompt,
  conflictResolverEnabled, conflictResolverCron
}) {
  await executeWithRetry({
    sql: `UPDATE projects_config
          SET build_pipeline_enabled = COALESCE(?, build_pipeline_enabled),
              pipeline_cron = COALESCE(?, pipeline_cron),
              pipeline_prompt = COALESCE(?, pipeline_prompt),
              conflict_resolver_enabled = COALESCE(?, conflict_resolver_enabled),
              conflict_resolver_cron = COALESCE(?, conflict_resolver_cron),
              updated_at = ?
          WHERE id = ?`,
    args: [
      buildPipelineEnabled !== undefined ? (buildPipelineEnabled ? 1 : 0) : null,
      pipelineCron !== undefined ? pipelineCron : null,
      pipelinePrompt !== undefined ? pipelinePrompt : null,
      conflictResolverEnabled !== undefined ? (conflictResolverEnabled ? 1 : 0) : null,
      conflictResolverCron !== undefined ? conflictResolverCron : null,
      Date.now(),
      projectId
    ],
  });
  invalidateProjectConfigCache(projectId);
}

export async function deleteProjectConfig(id) {
  await executeWithRetry({ sql: 'DELETE FROM projects_config WHERE id = ?', args: [id] });
  invalidateProjectConfigCache(id);
}
