import { GLOBAL_CONFIG } from '../config.js';
import { getTokenUsage24h } from '../db/database.js';

function maskToken(token) {
  if (!token) return 'not-configured';
  if (token.length <= 8) return '****';
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

export function getTokenInventory() {
  const allTokens = [GLOBAL_CONFIG.JULES_MAIN_TOKEN, ...(GLOBAL_CONFIG.JULES_SECONDARY_TOKENS || [])]
    .map((token) => (token || '').trim())
    .filter(Boolean);

  const labels = GLOBAL_CONFIG.JULES_TOKEN_EMAILS || [];

  return allTokens.map((token, index) => {
    const id = `key-${index + 1}`;
    const email = labels[index] || `unknown-${index + 1}@local`;
    return {
      id,
      email,
      label: email,
      isPrimary: index === 0,
      configured: true,
      maskedToken: maskToken(token),
      usage24h: getTokenUsage24h(token),
      token
    };
  });
}

export function getTokenStatusSummary() {
  const inventory = getTokenInventory();
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

export function getAvailableToken(agentName, options = {}) {
  const inventory = getTokenInventory();

  if (inventory.length === 0) {
    throw new Error('JULES_MAIN_TOKEN is not configured.');
  }

  const preferredTokenId = options.preferredTokenId ? String(options.preferredTokenId) : null;
  if (preferredTokenId) {
    const preferred = inventory.find((entry) => entry.id === preferredTokenId || entry.email === preferredTokenId);
    if (preferred) {
      return preferred.token;
    }
  }

  let bestToken = inventory[0].token;
  let minUsage = inventory[0].usage24h;

  for (const entry of inventory) {
    if (entry.usage24h < minUsage) {
      minUsage = entry.usage24h;
      bestToken = entry.token;
    }
  }

  return bestToken;
}
