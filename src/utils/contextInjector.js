import { executeWithRetry } from '../db/core.js';
import { getTokenStatusSummary } from '../api/tokenRotation.js';

const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function getAlphaRange(index, total) {
  const size = Math.ceil(26 / total);
  const start = ALPHA[Math.min(index * size, 25)];
  const end = ALPHA[Math.min((index + 1) * size - 1, 25)];
  return start === end ? start : `${start}–${end}`;
}

/**
 * Builds a live context block to prepend to an agent prompt before sending to Jules.
 * Gives each session situational awareness: what was recently done, token budget,
 * and which file partition to focus on when running as one of many concurrent instances.
 *
 * @param {object} opts
 * @param {string} opts.projectId
 * @param {string} opts.agentName
 * @param {number} [opts.instanceIndex=0]  - 0-based index of this concurrent runner
 * @param {number} [opts.totalInstances=1] - total concurrent runners for this assignment
 */
export async function buildContextBlock({ projectId, agentName, instanceIndex = 0, totalInstances = 1 }) {
  const lines = [];

  lines.push('---');
  lines.push('## Orchestrator Live Context (auto-injected — do not reference this block in your PR title, description, or commit messages)');
  lines.push(`- **Today's date:** ${new Date().toISOString().slice(0, 10)}`);

  // Instance partitioning: tell concurrent runners which file range to own
  if (totalInstances > 1) {
    const range = getAlphaRange(instanceIndex, totalInstances);
    lines.push(
      `- **Parallel slot:** ${instanceIndex + 1} of ${totalInstances} — ` +
      `prioritize files and directories whose names start with **${range}** ` +
      `to avoid conflicts with the other running instances of this agent`
    );
  }

  // Recent sessions for this specific agent
  try {
    const cutoff = Date.now() - 48 * 60 * 60 * 1000; // last 48h
    const rs = await executeWithRetry({
      sql: `SELECT summary, pr_url, ended_at FROM journal
            WHERE project_id = ? AND agent_name = ? AND status = 'completed'
              AND ended_at > ? AND summary IS NOT NULL
            ORDER BY ended_at DESC LIMIT 3`,
      args: [projectId, agentName, cutoff],
    });
    if (rs.rows.length > 0) {
      lines.push('- **Your last sessions (avoid duplicating this work):**');
      for (const r of rs.rows) {
        const agoMin = Math.round((Date.now() - r.ended_at) / 60000);
        const pr = r.pr_url ? ` → ${r.pr_url}` : '';
        lines.push(`  - ${agoMin}m ago: ${r.summary}${pr}`);
      }
    }
  } catch {
    // Non-fatal: missing context is better than a blocked session
  }

  // Remaining token budget for the day
  try {
    const status = await getTokenStatusSummary();
    const totalLimit = status.keys?.reduce((s, k) => s + (k.limit24h ?? 0), 0) ?? 295;
    const remaining = Math.max(0, totalLimit - (status.totalUsage24h ?? 0));
    lines.push(`- **API budget remaining today:** ${remaining} sessions`);
  } catch {
    // Non-fatal
  }

  lines.push('---');
  lines.push('');

  return lines.join('\n') + '\n';
}
