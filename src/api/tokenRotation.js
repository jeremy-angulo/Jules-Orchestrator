import { GLOBAL_CONFIG } from '../config.js';
import { getTokenName } from '../db/database.js';
import { getTokenUsage24h } from '../services/metricsStore.js';

function maskToken(token) {
  if (!token) return 'not-configured';
  if (token.length <= 8) return '****';
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

export async function getTokenInventory() {
  const allTokens = [GLOBAL_CONFIG.JULES_MAIN_TOKEN, ...(GLOBAL_CONFIG.JULES_SECONDARY_TOKENS || [])]
    .map((token) => (token || '').trim())
    .filter(Boolean);

  return await Promise.all(allTokens.map(async (token, index) => {
    const id = `key-${index + 1}`;
    const isPrimary = index === 0;
    
    const customName = await getTokenName(index);
    const label = customName || `Token ${index + 1}`;
    const usage = await getTokenUsage24h(token);
    
    return {
      id,
      index,
      label,
      isPrimary,
      configured: true,
      maskedToken: maskToken(token),
      usage24h: usage,
      limit24h: isPrimary ? 100 : 15,
      token
    };
  }));
}

export async function getTokenStatusSummary() {
  const inventory = await getTokenInventory();
  if (inventory.length === 0) {
    return {
      configured: false,
      keys: [],
      totalUsage24h: 0,
      healthy: false,
      message: 'No Jules API key configured.'
    };
  }

  const totalUsage24h = inventory.reduce((sum, key) => sum + key.usage24h, 0);
  return {
    configured: true,
    keys: inventory.map(({ token, ...publicKey }) => publicKey),
    totalUsage24h,
    healthy: true,
    message: `${inventory.length} key(s) configured.`
  };
}

export async function getAvailableToken(agentName, options = {}) {
  const inventory = await getTokenInventory();

  if (inventory.length === 0) {
    throw new Error('JULES_MAIN_TOKEN is not configured.');
  }

  const preferredTokenId = options.preferredTokenId ? String(options.preferredTokenId) : null;
  if (preferredTokenId) {
    const preferred = inventory.find((entry) => entry.id === preferredTokenId || String(entry.index) === preferredTokenId);
    if (preferred) {
      return preferred;
    }
  }

  // Pick the token with the lowest utilization (usage / limit)
  let bestToken = null;
  let minUtilization = Infinity;

  // 1. Try to find a token below its limit first
  for (const entry of inventory) {
    if (entry.usage24h < entry.limit24h) {
      const utilization = entry.usage24h / entry.limit24h;
      if (utilization < minUtilization) {
        minUtilization = utilization;
        bestToken = entry;
      }
    }
  }

  // 2. If all tokens are at/above limit, pick the one with the lowest utilization overall
  if (!bestToken) {
    minUtilization = Infinity;
    for (const entry of inventory) {
      const utilization = entry.usage24h / entry.limit24h;
      if (utilization < minUtilization) {
        minUtilization = utilization;
        bestToken = entry;
      }
    }
  }

  return bestToken || inventory[0];
}
