/**
 * Automatically resolves conflicts in Markdown files by keeping both sides.
 * It removes markers and concatenates the content.
 * 
 * @param {string} content - The content of the file with conflict markers.
 * @returns {string} The resolved content.
 */
export function resolveMarkdownConflict(content) {
  const lines = content.split('\n');
  const result = [];
  let inConflict = false;
  let headBuffer = [];
  let devBuffer = [];
  let section = null; // 'head' or 'dev'

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('<<<<<<<')) {
      inConflict = true;
      section = 'head';
      continue;
    }

    if (line.startsWith('=======')) {
      section = 'dev';
      continue;
    }

    if (line.startsWith('>>>>>>>')) {
      // Concatenate both: Head first, then Dev
      result.push(...headBuffer);
      
      // Add a small separator if both had content
      if (headBuffer.length > 0 && devBuffer.length > 0) {
        // result.push(''); // Optional: add newline between them
      }
      
      result.push(...devBuffer);
      
      // Reset
      headBuffer = [];
      devBuffer = [];
      inConflict = false;
      section = null;
      continue;
    }

    if (inConflict) {
      if (section === 'head') headBuffer.push(line);
      else if (section === 'dev') devBuffer.push(line);
    } else {
      result.push(line);
    }
  }

  return result.join('\n');
}
