# Jules Orchestrator - Project Context

This project is a **Jules AI Orchestrator**, a Node.js service (ESM, Express 5) that automates development workflows on GitHub repositories by dispatching tasks to [Jules](https://jules.googleapis.com), Google's AI coding agent.

## Project Overview

The orchestrator manages long-running "runners" that perform various automated tasks:
- **Background Agents**: Continuous looping sessions driven by specific prompts.
- **Issue Resolution**: Polls GitHub for open issues, dispatches Jules to resolve them, and closes the issue.
- **Build & Merge Pipelines**: Validates builds on source branches, creates PRs, and handles merges.
- **Agent Library**: Reusable named agents (name, description, prompt) that can be assigned to projects.

### Core Technologies
- **Runtime**: Node.js (ESM)
- **Framework**: Express 5
- **Database**: SQLite (via `better-sqlite3`)
- **Scheduling**: `node-cron`
- **Testing**: Node.js built-in `node:test`, `esmock`, `playwright`

## Architecture

- **ControlCenter (`src/controlCenter.js`)**: The central singleton managing all active runners and system-wide schedulers.
- **Runners**: In-memory objects tracking async loops for background tasks, issue polling, or manual one-shots.
- **Database (`src/db/database.js`)**: Single SQLite file storing project states, agent definitions, assignments, API usage logs, and audit trails.
- **Token Rotation (`src/api/tokenRotation.js`)**: Manages multiple Jules API keys with per-key 24h usage tracking to stay within rate limits.
- **Dashboard (`public/`, `src/app.js`)**: A web interface for monitoring runners, managing agents, and viewing project health.

## Building and Running

### Commands
- `npm start`: Starts the Express server and initializes the ControlCenter.
- `npm test`: Runs the test suite using Node's built-in test runner.
- `npm run test:screenshots`: Runs UI/screenshot tests (requires the server to be running).

### Environment Variables
Key variables required in `.env`:
- `JULES_MAIN_TOKEN`: Primary Jules API key.
- `GITHUB_TOKEN`: GitHub PAT for repository operations.
- `ORCHESTRATOR_DB_PATH`: Path to the SQLite database (default: `orchestrator.db`).
- `PORT`: HTTP port for the dashboard (default: 3000).

## Development Conventions

- **Module System**: Strictly uses **ESM** (`import`/`export`).
- **Testing**:
    - Use `node:test` and `node:assert`.
    - Mocking is done via `t.mock.method` or `esmock` for module-level overrides.
    - Configuration is typically mutated directly in tests (`GLOBAL_CONFIG`) to inject test tokens.
- **Database**:
    - Synchronous SQLite operations via `better-sqlite3`.
    - WAL mode is enabled for better concurrency.
    - Project states are cached in-memory (`projectCache`) to minimize blocking.
- **Logging**:
    - Centralized logging via `controlCenter.log`.
    - All mutating dashboard API calls are recorded in the `audit_log`.
- **Project Configuration**:
    - Initial projects are seeded from `src/config.js` into the database on boot.
    - Runtime modifications to projects and assignments are persisted in the DB.
