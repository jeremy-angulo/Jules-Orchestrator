import { loadPrompt } from './utils/promptLoader.js';

function parseBooleanEnv(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

// Configuration globale de l'API
export const GLOBAL_CONFIG = {
  JULES_MAIN_TOKEN: process.env.JULES_MAIN_TOKEN,
  JULES_SECONDARY_TOKENS: process.env.JULES_SECONDARY_TOKENS ? process.env.JULES_SECONDARY_TOKENS.split(',').map(t => t.trim()) : [],
  JULES_TOKEN_EMAILS: process.env.JULES_TOKEN_EMAILS ? process.env.JULES_TOKEN_EMAILS.split(',').map(t => t.trim()) : [],
  POLLING_INTERVAL: 15000, // Vérifie l'état de Jules toutes les 15 secondes
};

// Configuration de tes Repositories
const PROJECT_PROMPT_KEYS = {
  HomeFreeWorld: {
    background: ['lead-sdet', 'lead-product-engineer'],
    pipeline: 'pipeline-release-manager'
  }
};

function getProjectPrompt(projectId, promptName) {
  if (!promptName) return '';
  return loadPrompt(projectId, promptName);
}

export function getProjectBackgroundPrompts(projectId) {
  const names = PROJECT_PROMPT_KEYS[projectId]?.background || [];
  return names.map((name) => getProjectPrompt(projectId, name));
}
