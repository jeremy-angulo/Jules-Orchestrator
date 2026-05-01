
import { createClient } from '@libsql/client';
import dotenv from 'dotenv';
dotenv.config();

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function run() {
  try {
    const agents = await client.execute('SELECT name, description, prompt FROM agents');
    console.log('--- AGENTS ---');
    console.log(JSON.stringify(agents.rows, null, 2));

    const sessions = await client.execute('SELECT * FROM agent_sessions LIMIT 10');
    console.log('--- SESSIONS ---');
    console.log(JSON.stringify(sessions.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

run();
