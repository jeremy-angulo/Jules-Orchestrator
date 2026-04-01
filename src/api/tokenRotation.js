import { GLOBAL_CONFIG } from '../config.js';
import { getTokenUsage24h } from '../db/database.js';

export function getAvailableToken(agentName) {
  const mainToken = GLOBAL_CONFIG.JULES_API_TOKEN;
  const secondaryTokens = GLOBAL_CONFIG.JULES_SECONDARY_TOKENS;

  if (!mainToken) {
    throw new Error("JULES_API_TOKEN is not configured.");
  }

  // Token rotation logic without limits
  const allTokens = [mainToken, ...secondaryTokens];

  let bestToken = mainToken;
  let minUsage = Infinity;

  for (const token of allTokens) {
    const usage = getTokenUsage24h(token);
    if (usage < minUsage) {
      minUsage = usage;
      bestToken = token;
    }
  }

  return bestToken;
}
