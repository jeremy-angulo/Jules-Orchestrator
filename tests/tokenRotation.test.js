import test from 'node:test';
import assert from 'node:assert/strict';
import esmock from 'esmock';

test('token limits are fixed to 100 for primary and 15 for secondary', async () => {
  const { getTokenInventory } = await esmock('../src/api/tokenRotation.js', {
    '../src/config.js': {
      GLOBAL_CONFIG: {
        JULES_MAIN_TOKEN: 'primary-token',
        JULES_SECONDARY_TOKENS: ['secondary-a', 'secondary-b'],
        JULES_TOKEN_EMAILS: []
      }
    },
    '../src/db/database.js': {
      getTokenUsage24h: async () => 0,
      getTokenName: async () => null
    }
  });

  const inventory = await getTokenInventory();
  assert.equal(inventory.length, 3);
  assert.equal(inventory[0].limit24h, 100);
  assert.equal(inventory[1].limit24h, 15);
  assert.equal(inventory[2].limit24h, 15);
});

test('token labels fallback to Token N when no custom name exists', async () => {
  const { getTokenInventory } = await esmock('../src/api/tokenRotation.js', {
    '../src/config.js': {
      GLOBAL_CONFIG: {
        JULES_MAIN_TOKEN: 'primary-token',
        JULES_SECONDARY_TOKENS: ['secondary-a'],
        JULES_TOKEN_EMAILS: []
      }
    },
    '../src/db/database.js': {
      getTokenUsage24h: async () => 3,
      getTokenName: async () => null
    }
  });

  const inventory = await getTokenInventory();
  assert.equal(inventory[0].label, 'Token 1');
  assert.equal(inventory[1].label, 'Token 2');
});
