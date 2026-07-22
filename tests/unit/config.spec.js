import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import esmock from 'esmock';
import { GLOBAL_CONFIG as directConfig, getProjectBackgroundPrompts as directGetPrompts } from '../../src/config.js';

describe('config.js', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('direct imports should exist', () => {
    expect(directConfig).toBeDefined();
    expect(directGetPrompts).toBeDefined();
  });

  it('should parse empty or default env variables correctly', async () => {
    delete process.env.JULES_MAIN_TOKEN;
    delete process.env.JULES_SECONDARY_TOKENS;
    delete process.env.JULES_TOKEN_EMAILS;
    process.env.NODE_ENV = 'development';

    const { GLOBAL_CONFIG } = await esmock('../../src/config.js');

    expect(GLOBAL_CONFIG.JULES_MAIN_TOKEN).toBeUndefined();
    expect(GLOBAL_CONFIG.JULES_SECONDARY_TOKENS).toEqual([]);
    expect(GLOBAL_CONFIG.JULES_TOKEN_EMAILS).toEqual([]);
    expect(GLOBAL_CONFIG.POLLING_INTERVAL).toBe(15000);
  });

  it('should parse populated env variables correctly and handle production polling interval', async () => {
    process.env.JULES_MAIN_TOKEN = 'main-tok';
    process.env.JULES_SECONDARY_TOKENS = 'sec-1, sec-2 ';
    process.env.JULES_TOKEN_EMAILS = 'a@ex.com, b@ex.com';
    process.env.NODE_ENV = 'production';

    const { GLOBAL_CONFIG } = await esmock('../../src/config.js');

    expect(GLOBAL_CONFIG.JULES_MAIN_TOKEN).toBe('main-tok');
    expect(GLOBAL_CONFIG.JULES_SECONDARY_TOKENS).toEqual(['sec-1', 'sec-2']);
    expect(GLOBAL_CONFIG.JULES_TOKEN_EMAILS).toEqual(['a@ex.com', 'b@ex.com']);
    expect(GLOBAL_CONFIG.POLLING_INTERVAL).toBe(60000);
  });

  it('getProjectBackgroundPrompts should return background prompts for valid project', async () => {
    const mockLoadPrompt = vi.fn(async (project, name) => `Content for ${project}/${name}`);

    const { getProjectBackgroundPrompts } = await esmock('../../src/config.js', {
      '../../src/utils/promptLoader.js': {
        loadPrompt: mockLoadPrompt
      }
    });

    const result = await getProjectBackgroundPrompts('HomeFreeWorld');

    expect(result).toEqual([
      'Content for HomeFreeWorld/lead-sdet',
      'Content for HomeFreeWorld/lead-product-engineer'
    ]);
    expect(mockLoadPrompt).toHaveBeenCalledTimes(2);
    expect(mockLoadPrompt).toHaveBeenNthCalledWith(1, 'HomeFreeWorld', 'lead-sdet');
    expect(mockLoadPrompt).toHaveBeenNthCalledWith(2, 'HomeFreeWorld', 'lead-product-engineer');
  });

  it('getProjectBackgroundPrompts should return empty array for unknown project', async () => {
    const mockLoadPrompt = vi.fn();

    const { getProjectBackgroundPrompts } = await esmock('../../src/config.js', {
      '../../src/utils/promptLoader.js': {
        loadPrompt: mockLoadPrompt
      }
    });

    const result = await getProjectBackgroundPrompts('UnknownProject');

    expect(result).toEqual([]);
    expect(mockLoadPrompt).not.toHaveBeenCalled();
  });
});
