import { executeWithRetry } from '../db/core.js';
import { log } from '../utils/logger.js';

const POLL_INTERVAL_MS = 15 * 60 * 1000; // every 15 minutes
const MAX_PR_AGE_DAYS = 14;              // stop polling PRs older than 14 days
const BATCH_SIZE = 20;                   // max PRs to check per cycle

/**
 * Fetches the current state of a PR from the GitHub API.
 * Returns 'merged' | 'closed' | 'open' | null on error.
 */
async function fetchPROutcome(repo, prNumber, token) {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/pulls/${prNumber}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' } }
    );
    if (!res.ok) return null;
    const pr = await res.json();
    if (pr.merged) return 'merged';
    if (pr.state === 'closed') return 'closed';
    return 'open';
  } catch {
    return null;
  }
}

/**
 * One polling cycle: find journal entries with a pr_url but no pr_status,
 * check GitHub, and record the outcome.
 *
 * @param {Map<string, object>} projectById - project runtime map from ControlCenter
 */
export async function runPROutcomeCycle(projectById) {
  const cutoff = Date.now() - MAX_PR_AGE_DAYS * 24 * 60 * 60 * 1000;

  // Find journal rows with a PR URL not yet resolved
  const rs = await executeWithRetry({
    sql: `SELECT id, project_id, pr_url, pr_status
          FROM journal
          WHERE pr_url IS NOT NULL
            AND (pr_status IS NULL OR pr_status = 'open')
            AND ended_at > ?
          ORDER BY ended_at DESC
          LIMIT ?`,
    args: [cutoff, BATCH_SIZE],
  });

  if (rs.rows.length === 0) return;

  const masterToken = projectById.get('Jules-Orchestrator')?.githubToken || process.env.GITHUB_TOKEN;

  let updated = 0;
  for (const row of rs.rows) {
    const match = row.pr_url.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
    if (!match) continue;

    const [, repo, prNumberStr] = match;
    const prNumber = parseInt(prNumberStr, 10);

    // Find the right project token, fall back to master token
    const project = [...projectById.values()].find(p => p.githubRepo === repo);
    const token = project?.githubToken || masterToken;

    const outcome = await fetchPROutcome(repo, prNumber, token);
    if (outcome === null) continue; // GitHub error, skip this cycle

    if (outcome !== row.pr_status) {
      await executeWithRetry({
        sql: `UPDATE journal SET pr_status = ? WHERE id = ?`,
        args: [outcome, row.id],
      });
      updated++;
      if (outcome !== 'open') {
        log('info', `[PROutcome] #${prNumber} on ${repo} → ${outcome}`);
      }
    }
  }

  if (updated > 0) {
    log('info', `[PROutcome] Updated ${updated} PR outcome(s) this cycle`);
  }
}

/**
 * Starts the PR outcome poller as a recurring interval.
 * Returns the interval handle (pass to clearInterval to stop).
 */
export function startPROutcomePoller(projectById) {
  // Run immediately on startup, then on interval
  runPROutcomeCycle(projectById).catch(err =>
    log('error', `[PROutcome] Initial cycle failed: ${err.message}`)
  );
  return setInterval(() => {
    runPROutcomeCycle(projectById).catch(err =>
      log('error', `[PROutcome] Cycle failed: ${err.message}`)
    );
  }, POLL_INTERVAL_MS);
}
