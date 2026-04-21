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
  MOCK_MODE: parseBooleanEnv(process.env.DASHBOARD_MOCK_MODE || process.env.MOCK_MODE),
  POLLING_INTERVAL: 15000, // Vérifie l'état de Jules toutes les 15 secondes
};

// Configuration de tes Repositories
export const PROJECTS = [
  {
    id: "HomeFreeWorld",
    githubRepo:"jeremy-angulo/HomeFreeWorld",
    githubBranch: "dev",
    githubToken: process.env.GITHUB_TOKEN,
    backgroundPrompts: [
      loadPrompt("HomeFreeWorld", "lead-sdet"),
      loadPrompt("HomeFreeWorld", "lead-product-engineer"),
      // Add other prompts as files in prompts/HomeFreeWorld/
    ],
    buildAndMergePipeline: {
      cronSchedule: "0 5 * * *",
      sourceBranch: "dev",
      targetBranch: "preview",
      prompt: loadPrompt("HomeFreeWorld", "pipeline-release-manager")
    }
  },
  {
    id: "TrefleAI_IHM",
    githubRepo: "jeremy-angulo/TrefleAI_IHM",
    githubBranch: "dev",
    githubToken: process.env.GITHUB_TOKEN,
    backgroundPrompts: [
        loadPrompt("TrefleAI_IHM", "autonomous-sdet"),
        loadPrompt("TrefleAI_IHM", "lead-product-ux")
    ],
    buildAndMergePipeline: {
      cronSchedule: "0 5 * * *",
      sourceBranch: "dev",
      targetBranch: "preview",
      prompt: loadPrompt("TrefleAI_IHM", "night-watch-qa")
    }
  },
  {
    id: "Pipeline-CAC40",
    githubRepo: "jeremy-angulo/Pipeline-CAC40",
    githubBranch: "master",
    githubToken: process.env.GITHUB_TOKEN,
    backgroundPrompts: [
        loadPrompt("Pipeline-CAC40", "senior-software-engineer")
    ]
  }
];
