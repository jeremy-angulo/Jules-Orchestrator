import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function loadPrompt(project, name) {
    const filePath = path.join(__dirname, '../../prompts', project, `${name}.md`);
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch (err) {
        console.error(`Error loading prompt ${name} for project ${project}:`, err.message);
        return "";
    }
}
