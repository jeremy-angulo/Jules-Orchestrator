/**
 * Extracts HEAD and DEV sections from a conflict-marked JSON string.
 * Returns { head, dev } as raw strings, or null if no markers found.
 */
function extractConflictSections(content) {
  const headMatch = content.match(/^<{7}.*\n([\s\S]*?)^={7}$/m);
  const devMatch = content.match(/^={7}\n([\s\S]*?)^>{7}/m);
  if (!headMatch || !devMatch) return null;
  return { head: headMatch[1], dev: devMatch[1] };
}

/**
 * Deep-merges two parsed JSON values.
 * - Objects: merged recursively; HEAD wins on scalar conflicts.
 * - Arrays: concatenated with primitive deduplication.
 * - Primitives: HEAD wins.
 */
function deepMerge(head, dev) {
  if (head === null || head === undefined) return dev;
  if (dev === null || dev === undefined) return head;

  if (Array.isArray(head) && Array.isArray(dev)) {
    const combined = [...head];
    for (const item of dev) {
      const isPrimitive = typeof item !== 'object' || item === null;
      if (isPrimitive) {
        if (!combined.includes(item)) combined.push(item);
      } else {
        combined.push(item);
      }
    }
    return combined;
  }

  if (typeof head === 'object' && typeof dev === 'object' && !Array.isArray(head) && !Array.isArray(dev)) {
    const result = { ...dev };
    for (const key of Object.keys(head)) {
      if (key in result) {
        result[key] = deepMerge(head[key], result[key]);
      } else {
        result[key] = head[key];
      }
    }
    return result;
  }

  // Scalar conflict: HEAD (PR branch) wins
  return head;
}

/**
 * Resolves conflicts in a JSON file by deep-merging both sides.
 * Returns the resolved JSON string, or throws if parsing fails.
 *
 * @param {string} content - File content with git conflict markers.
 * @returns {string} Resolved JSON string.
 */
export function resolveJsonConflict(content) {
  // Handle files with no conflict markers (already clean)
  if (!content.includes('<<<<<<<')) return content;

  // Split into segments so we can handle multiple conflict blocks
  const lines = content.split('\n');
  const resultLines = [];
  let headLines = [];
  let devLines = [];
  let section = null; // null | 'head' | 'dev'

  for (const line of lines) {
    if (line.startsWith('<<<<<<<')) {
      section = 'head';
      continue;
    }
    if (line.startsWith('=======')) {
      section = 'dev';
      continue;
    }
    if (line.startsWith('>>>>>>>')) {
      // We have a conflict block — collect and defer to full-file merge below
      section = null;
      continue;
    }
    if (section === 'head') headLines.push(line);
    else if (section === 'dev') devLines.push(line);
    else resultLines.push(line);
  }

  // If there were no conflict markers, return as-is
  if (headLines.length === 0 && devLines.length === 0) {
    return content;
  }

  // Rebuild full JSON from each side by inserting conflict lines back into context
  // The non-conflicting resultLines contain the outer structure; the conflict was inside it.
  // Simplest robust approach: reconstruct each side as a full JSON document.
  const nonConflictText = resultLines.join('\n');

  // Find the insertion point (where conflict started) — use a placeholder approach
  // Re-parse using the raw section strings to build two complete JSON candidates
  const headText = rebuildFullJson(content, 'head');
  const devText = rebuildFullJson(content, 'dev');

  const headJson = JSON.parse(headText);
  const devJson = JSON.parse(devText);

  const merged = deepMerge(headJson, devJson);
  return JSON.stringify(merged, null, 2) + '\n';
}

/**
 * Reconstructs a complete JSON string by choosing one side of each conflict block.
 */
function rebuildFullJson(content, side) {
  const lines = content.split('\n');
  const result = [];
  let section = null;

  for (const line of lines) {
    if (line.startsWith('<<<<<<<')) { section = 'head'; continue; }
    if (line.startsWith('=======')) { section = 'dev'; continue; }
    if (line.startsWith('>>>>>>>')) { section = null; continue; }

    if (section === null) result.push(line);
    else if (section === side) result.push(line);
  }

  return result.join('\n');
}
