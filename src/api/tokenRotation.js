import { GLOBAL_CONFIG } from '../config.js';
import { getTokenUsageToday, getAgentUsageToday, getTotalUsageToday } from '../db/database.js';

export class QuotaExceededError extends Error {
  constructor(message) {
    super(message);
    this.name = 'QuotaExceededError';
  }
}

const LIMITS = {
  MAIN_TOKEN: 500,
  SECONDARY_TOKEN: 100,
  BACKGROUND_AGENT_PER_PROMPT: 250,
  GLOBAL_RESERVED: 50
};

export function getAvailableToken(agentName) {
  const mainToken = GLOBAL_CONFIG.JULES_MAIN_TOKEN;
  const secondaryTokens = GLOBAL_CONFIG.JULES_SECONDARY_TOKENS;

  if (!mainToken) {
    throw new Error("JULES_MAIN_TOKEN is not configured.");
  }

  // Calculate total capacity
  const totalCapacity = LIMITS.MAIN_TOKEN + (secondaryTokens.length * LIMITS.SECONDARY_TOKEN);
  const totalUsage = getTotalUsageToday();
  const globalRemaining = totalCapacity - totalUsage;

  const isBackgroundAgent = agentName.includes('Background Agent');

  // Strict check: if 20 or less calls left, reserve them exclusively for other agents
  if (isBackgroundAgent && globalRemaining <= LIMITS.GLOBAL_RESERVED) {
    throw new QuotaExceededError(`Global reserved capacity reached (${LIMITS.GLOBAL_RESERVED} calls remaining). Skipping background agent task.`);
  }

  // Fair use limits per specific agent
  if (isBackgroundAgent) {
    const agentUsage = getAgentUsageToday(agentName);
    if (agentUsage >= LIMITS.BACKGROUND_AGENT_PER_PROMPT) {
      throw new QuotaExceededError(`Agent '${agentName}' has exceeded its daily limit of ${LIMITS.BACKGROUND_AGENT_PER_PROMPT} calls.`);
    }
  }

  // Token rotation logic
  const allTokens = [
    { token: mainToken, limit: LIMITS.MAIN_TOKEN },
    ...secondaryTokens.map(t => ({ token: t, limit: LIMITS.SECONDARY_TOKEN }))
  ];

  let bestToken = null;
  let bestRatio = Infinity;

  for (const { token, limit } of allTokens) {
    const usage = getTokenUsageToday(token);
    if (usage < limit) {
      const ratio = usage / limit;
      if (ratio < bestRatio) {
        bestRatio = ratio;
        bestToken = token;
      }
    }
  }

  if (bestToken) {
    return bestToken;
  }

  throw new QuotaExceededError('All available tokens have exhausted their daily quota.');
}
