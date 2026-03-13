<<<<<<< SEARCH
  // Token rotation logic
  const mainUsage = getTokenUsageToday(mainToken);

  if (mainUsage < LIMITS.MAIN_TOKEN) {
    return mainToken;
  }

  // If main token is exhausted (80 or more), check secondary tokens
  for (const token of secondaryTokens) {
    const usage = getTokenUsageToday(token);
    if (usage < LIMITS.SECONDARY_TOKEN) {
      return token;
    }
  }

  throw new QuotaExceededError('All available tokens have exhausted their daily quota.');
}
=======
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
>>>>>>> REPLACE
