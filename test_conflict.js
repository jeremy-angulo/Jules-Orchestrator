import { getProjectConfig, upsertProjectConfig, listProjectsConfig } from './src/db/projects.js';

async function test() {
  const p = await getProjectConfig('Trefle-AI');
  console.log('Before:', p.conflict_resolver_enabled);
  await upsertProjectConfig({
    ...p,
    conflict_resolver_enabled: 1
  });
  const p2 = await getProjectConfig('Trefle-AI');
  console.log('After:', p2.conflict_resolver_enabled);
}

test();
