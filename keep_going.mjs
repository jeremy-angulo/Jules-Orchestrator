import 'dotenv/config';
import { execSync } from 'child_process';

const TOKEN = process.env.JULES_MAIN_TOKEN;
const JULES_API_BASE = "https://jules.googleapis.com/v1alpha";

async function julesGet(sessionId) {
  const safeId = sessionId.startsWith('sessions/') ? sessionId : `sessions/${sessionId}`;
  const res = await fetch(`${JULES_API_BASE}/${safeId}`, {
    headers: { 'X-Goog-Api-Key': TOKEN }
  });
  if (!res.ok) return null;
  return res.json();
}

async function juleSendMessage(sessionId, message) {
  const safeId = sessionId.startsWith('sessions/') ? sessionId : `sessions/${sessionId}`;
  const res = await fetch(`${JULES_API_BASE}/${safeId}:sendMessage`, {
    method: 'POST',
    headers: { 'X-Goog-Api-Key': TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: message })
  });
  return res.ok;
}

function parseSessions(output) {
  return output.split('\n')
    .filter(l => l.trim() && !l.includes('ID') && !l.includes('---'))
    .map(line => {
      const parts = line.trim().split(/\s{2,}/);
      if (parts.length < 2) return null;
      return { id: parts[0].trim(), status: (parts[4] || '').trim() };
    })
    .filter(Boolean);
}

async function main() {
  console.log('Listing Jules sessions...');
  const output = execSync('jules remote list --session', { encoding: 'utf8' });
  const sessions = parseSessions(output);

  const waiting = sessions.filter(s => s.status.includes('Awaiting User'));
  console.log(`Found ${waiting.length} session(s) in "Awaiting User" state.\n`);

  for (const s of waiting) {
    console.log(`[${s.id}] Checking state via API...`);
    const state = await julesGet(s.id);
    if (!state) {
      console.log(`  -> Could not fetch session state. Skipping.`);
      continue;
    }
    console.log(`  -> API state: ${state.state}`);
    if (state.state === 'AWAITING_USER_FEEDBACK') {
      const ok = await juleSendMessage(s.id, 'keep going');
      console.log(`  -> Sent "keep going": ${ok ? 'OK' : 'FAILED'}`);
    } else {
      console.log(`  -> State not AWAITING_USER_FEEDBACK, skipping.`);
    }
  }

  console.log('\nDone.');
}

main().catch(console.error);
