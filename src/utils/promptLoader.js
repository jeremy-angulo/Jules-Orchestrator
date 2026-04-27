import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPrompt, upsertPrompt } from '../db/database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function loadPrompt(project, name) {
    const filePath = path.join(__dirname, '../../prompts', project, `${name}.md`);
    const promptFromDb = getPrompt(project, name);
    if (promptFromDb && promptFromDb.content) {
        return promptFromDb.content;
    }

    if (!fs.existsSync(filePath)) {
        return '';
    }

    try {
        const markdownPrompt = fs.readFileSync(filePath, 'utf8');
        upsertPrompt(project, name, markdownPrompt, { source: 'markdown', isInitial: true });
        return markdownPrompt;
    } catch (err) {
        console.error(`Error loading prompt ${name} for project ${project}:`, err.message);
        return '';
    }
}

export function savePrompt(project, name, content, source = 'manual') {
    return upsertPrompt(project, name, String(content || ''), {
        source,
        isInitial: source === 'markdown'
    });
}
