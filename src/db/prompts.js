import { executeWithRetry } from './core.js';
import { projectPromptsCache } from './cache.js';

export async function listPromptsByProject(pid) {
  if (projectPromptsCache.has(pid)) return projectPromptsCache.get(pid);
  const rs = await executeWithRetry({ sql: 'SELECT * FROM prompts WHERE project_id = ?', args: [pid] });
  projectPromptsCache.set(pid, rs.rows);
  return rs.rows;
}

export async function getPrompt(pid, name) {
  const prompts = await listPromptsByProject(pid);
  return prompts.find(p => p.name === name);
}

export async function upsertPrompt(pid, name, content, { source = 'manual', isInitial = false } = {}) {
  await executeWithRetry({ sql: 'INSERT INTO prompts (project_id, name, content, source, is_initial, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(project_id, name) DO UPDATE SET content=excluded.content, source=excluded.source, updated_at=excluded.updated_at', args: [pid, name, content, source, isInitial ? 1 : 0, Date.now(), Date.now()] });
  projectPromptsCache.delete(pid);
}
