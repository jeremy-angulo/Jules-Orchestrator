# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Run the server
npm start

# Run all tests
npm test

# Run a single test file
node --test tests/agents.test.js

# Run screenshot/UI tests (requires running server + Playwright)
npm run test:screenshots
```

## Environment Variables

Copy `.env` and populate before starting:

| Variable | Purpose |
|---|---|
| `JULES_MAIN_TOKEN` | Primary Jules API key (limit: 100 calls/24h) |
| `JULES_SECONDARY_TOKENS` | Comma-separated secondary Jules API keys (limit: 15 calls/24h each) |
| `JULES_TOKEN_EMAILS` | Emails associated with tokens (for display) |
| `GITHUB_TOKEN` | GitHub PAT for PR/issue operations |
| `ALERT_WEBHOOK_URL` | Optional webhook for ops alerts (runner failures) |
| `ORCHESTRATOR_DB_PATH` | SQLite DB path (default: `orchestrator.db`) |
| `WEBSITE_HEALTH_URL` | URL to probe for uptime monitoring |
| `PORT` | HTTP port (default: 3000) |

## Key Concepts (the new model)

| Concept | What it is |
|---|---|
| **Agent** | A reusable named entity (name, description, prompt, color) stored in DB — completely independent of any project |
| **Project** | A GitHub repo entry stored in `projects_config` DB table (seeded from config.js on boot) |
| **Assignment** | A persistent link between an Agent and a Project, with a run mode: `loop` (restarts after each session + pause) or `scheduled` (cron expression). Managed by ControlCenter runners. |
| **Ad-hoc run** | Fire an agent once on a project from the UI without creating a persistent assignment |

## Architecture

This is a **Jules AI orchestrator** — a Node.js service (ESM, Express 5) that automates development workflows on GitHub repositories by dispatching tasks to [Jules](https://jules.googleapis.com), Google's AI coding agent.

### Core Abstractions

**`ControlCenter`** (`src/controlCenter.js`) — Central singleton that manages all long-running agents ("runners"). It owns the runner registry and exposes methods like `startConfiguredBackground`, `startIssueLoop`, `runPipelineNow`, `startCustomLoop`. The server always boots in suspended mode (`controlCenter.init()` only — no runners auto-start).

**Runners** — In-memory objects tracking async loops. Types:
- `background` — looping Jules sessions driven by prompts from `PROJECTS[].backgroundPrompts`
- `issue` — polls GitHub for open issues, dispatches Jules to resolve them, then closes the issue
- `manual-pipeline` / `manual-background` / `manual-issue` — one-shot runners, kept in registry after stop for status visibility
- `custom-loop` — arbitrary prompt loop started via the dashboard

**Projects** (`src/config.js`) — Defined in `PROJECTS[]`. Each project has a `githubRepo`, `githubBranch`, `backgroundPrompts[]`, and an optional `buildAndMergePipeline` config with a cron schedule and prompts for source→target branch merging.

**Jules API client** (`src/api/julesClient.js`) — Wraps the Jules REST API (`https://jules.googleapis.com/v1alpha`). `startAndMonitorSession` creates a session and polls until completion. Token selection is delegated to `tokenRotation.js`.

**Token rotation** (`src/api/tokenRotation.js`) — Manages multiple Jules API keys with per-key 24h usage tracking stored in SQLite. Primary key has a 100 call/24h limit; secondary keys are limited to 15.

**Pipeline agents** (`src/agents/pipeline.js`) — Three schedulers (via `node-cron`):
1. Per-project build & merge pipeline (validates build on source branch, creates PR, merges)
2. Global daily PR merge (merges all open approved PRs across all projects)
3. Auto-merge service (continuous polling for mergeable PRs)

**Database** (`src/db/database.js`) — Single SQLite file via `better-sqlite3`. Stores: project states (lock/task counters), API call logs, audit log, dashboard metrics, prompt content, service health checks, service errors, token display names.

**Prompts** (`src/utils/promptLoader.js`, `prompts/`) — Legacy: project-specific agent instructions as Markdown files under `prompts/<projectId>/<name>.md`. Seeded into `prompts` DB table on first load. New approach: use the Agent Library instead.

**Agent Library** (`src/db/database.js` — `agents` table) — Reusable agents with prompts. CRUD via `GET/POST/PUT/DELETE /api/agents`. Created in the dashboard Agents tab.

**Assignments** (`src/db/database.js` — `assignments` table) — Links agents to projects with a run mode. Loop assignments restart automatically after each Jules session. Scheduled assignments fire on cron. Managed by `ControlCenter.startAssignment()` which creates in-memory runners. New REST API: `GET/POST /api/projects/:id/assignments`, `PUT/DELETE/POST-run/stop/toggle /api/assignments/:id`.

**Projects Config** (`src/db/database.js` — `projects_config` table) — Full project config in DB. Config.js `PROJECTS` are seeded on boot via `syncConfigProjectsToDB`. New projects added via `POST /api/projects-config`.

**Dashboard** (`src/app.js`, `public/`) — Express app serving a single-page dashboard at `/`. Auth uses session cookies with roles: `admin`, `operator`, `viewer` (see `src/auth/permissions.js`). First-run creates the initial admin via `/api/setup`. All mutating dashboard API calls are audited to `audit_log`.

**Health monitor** (`src/services/healthMonitor.js`) — Periodically probes the website URL and records results in `service_checks`.

### Key Data Flows

1. **Issue resolution**: `startIssueLoop` → `getNextGitHubIssue` → lock project → wait for active tasks = 0 → `mergeOpenPRs` → `startAndMonitorSession` → `closeGitHubIssue` → unlock
2. **Pipeline**: cron fires → lock project → wait for active tasks → Jules validates/fixes build → `createAndMergePR` → unlock
3. **Background agents**: loop indefinitely — if project locked, wait; else `startAndMonitorSession` with the configured prompt, then sleep 5 minutes

### Testing Approach

Tests use Node.js built-in `node:test` with `node:assert`. Mocking uses `t.mock.method` for inline mocking and `esmock` for module-level mocking in ESM. Tests mutate `GLOBAL_CONFIG` directly at the top of each file to inject test tokens before any imports run.

Run a single test: `node --test tests/<file>.test.js`
