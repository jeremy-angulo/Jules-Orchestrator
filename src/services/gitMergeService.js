import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { resolveMarkdownConflict } from '../utils/mdConflictResolver.js';
import { resolveJsonConflict } from '../utils/jsonConflictResolver.js';
import { log } from '../utils/logger.js';

const execAsync = promisify(exec);

/**
 * Attempts to resolve conflicts in a PR automatically if they are only in Markdown files.
 * This is a "mechanical" resolver that doesn't use AI.
 * 
 * @param {Object} project - The project config.
 * @param {number} prNumber - The PR number.
 * @returns {Promise<boolean>} True if successfully merged, false otherwise.
 */
export async function attemptMechanicalMerge(project, prNumber) {
  let tempDir;
  try {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `jules-merge-${project.id}-${prNumber}-`));
    log('info', `[MechanicalMerge] 🛠️ Attempting mechanical resolution for PR #${prNumber} in ${tempDir}`);

    const repoUrl = `https://x-access-token:${project.githubToken}@github.com/${project.githubRepo}.git`;
    
    // 1. Clone
    await execAsync(`git clone ${repoUrl} .`, { cwd: tempDir });

    // 2. Fetch PR
    await execAsync(`gh pr checkout ${prNumber}`, { cwd: tempDir, env: { ...process.env, GITHUB_TOKEN: project.githubToken } });

    // 3. Get PR info
    const { stdout: prInfoJson } = await execAsync(`gh pr view ${prNumber} --json baseRefName`, { cwd: tempDir, env: { ...process.env, GITHUB_TOKEN: project.githubToken } });
    const { baseRefName } = JSON.parse(prInfoJson);

    // 4. Attempt merge
    try {
      await execAsync(`git merge origin/${baseRefName}`, { cwd: tempDir });
      log('info', `[MechanicalMerge] 🟢 No conflicts found during local merge for PR #${prNumber}. Proceeding to push.`);
    } catch (mergeError) {
      log('info', `[MechanicalMerge] ⚠️ Conflicts detected. Checking if they can be mechanically resolved.`);
      
      const { stdout: conflictFiles } = await execAsync(`git diff --name-only --diff-filter=U`, { cwd: tempDir });
      const files = conflictFiles.split('\n').filter(Boolean);
      
      const unsupportedFiles = files.filter(f => !f.endsWith('.md') && !f.endsWith('.json'));
      if (unsupportedFiles.length > 0) {
        log('info', `[MechanicalMerge] ❌ Unsupported conflict files: ${unsupportedFiles.join(', ')}. Aborting mechanical merge.`);
        return false;
      }

      // 5. Resolve MD and JSON files
      for (const file of files) {
        const filePath = path.join(tempDir, file);
        const content = await fs.readFile(filePath, 'utf8');
        let resolvedContent;
        if (file.endsWith('.json')) {
          resolvedContent = resolveJsonConflict(content);
        } else {
          resolvedContent = resolveMarkdownConflict(content);
        }
        await fs.writeFile(filePath, resolvedContent, 'utf8');
        await execAsync(`git add ${file}`, { cwd: tempDir });
      }

      await execAsync(`git commit -m "chore: auto-resolve markdown and json conflicts"`, { cwd: tempDir });
    }

    // 6. Push
    await execAsync(`git push origin HEAD`, { cwd: tempDir });

    // 7. Merge via GH CLI
    await execAsync(`gh pr merge ${prNumber} --merge`, { cwd: tempDir, env: { ...process.env, GITHUB_TOKEN: project.githubToken } });

    log('info', `[MechanicalMerge] ✅ Successfully resolved and merged PR #${prNumber} mechanically.`);
    return true;

  } catch (error) {
    log('error', `[MechanicalMerge] ❌ Failed during mechanical merge for PR #${prNumber}:`, error.message);
    return false;
  } finally {
    if (tempDir) {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (e) {
        // ignore
      }
    }
  }
}
