# Jules-Orchestrator — Complete System Reference
**Author:** Jeremy Angulo  
**Date:** May 2026  
**Purpose:** NotebookLM source document — how the system works, what every agent does, and how to get the best out of it.

---

## 1. What Is This System?

**Jules-Orchestrator** is a self-built AI automation platform. It runs continuously on a server (Render.com) and orchestrates a fleet of AI coding agents — powered by **Jules** (Google's Gemini-based AI coding agent, `jules.googleapis.com`) — that work autonomously on GitHub repositories, 24 hours a day.

The system acts like an engineering team manager. It holds a roster of specialized "agents" (each with a name, a role, and a detailed prompt), assigns them to projects, and makes sure they loop continuously, pick up new tasks, create Pull Requests, and merge approved code — all without human intervention.

Think of it this way: instead of a human developer sitting down, choosing what to work on, writing code, creating a PR, and merging it — the orchestrator does that entire cycle automatically, for multiple agents in parallel, indefinitely.

---

## 2. Core Architecture

### 2.1 The Stack

| Component | Technology |
|---|---|
| Orchestrator backend | Node.js 20, ESM modules, Express 5 |
| Database | Turso (cloud SQLite via libSQL) |
| Hosting | Render.com (always-on server) |
| AI coding agent | Jules by Google (Gemini-based) |
| Version control | GitHub (GitHub API + `gh` CLI) |
| Conflict resolution | Custom mechanical merge logic |

### 2.2 Key Concepts

**Agent** — A reusable persona with a name, description, color, and a detailed instruction prompt. An agent is not tied to any specific project; it's a template for a role. Examples: "🛡️ Sentinel" (security), "i18n-guardian" (translations), "Health Loop" (architecture cleanup).

**Project** — A GitHub repository registered in the system. There are currently 3 active projects:
- `HomeFreeWorld` → `jeremy-angulo/HomeFreeWorld` (branch: `dev`)
- `Trefle-ai-IHM` → `jeremy-angulo/0-Trefle-ai-IHM` (branch: `dev`)
- `Jules-Orchestrator` → `jeremy-angulo/Jules-Orchestrator` (branch: `main`)

**Assignment** — The link between an Agent and a Project. It defines: how the agent loops (interval, concurrency, whether it waits for PRs to merge before restarting), and whether it's enabled. An assignment is the "job contract" that keeps an agent running on a project indefinitely.

**Runner** — An in-memory object inside the orchestrator process that represents a running or scheduled agent loop. It tracks state, starts Jules sessions, monitors them, and restarts the loop after completion.

**Jules Session** — A single invocation of the Jules AI coding agent. The orchestrator sends a prompt (the agent's instruction) to the Jules API, which clones the repo, runs the task, and pushes code / opens a PR. A session typically takes 15–60 minutes. The orchestrator polls Jules until the session completes or fails.

**Journal** — Every Jules session is recorded in the `journal` DB table with: which agent ran, on which project, what the intent was, what the summary was, whether a PR was created, and when it started/ended. This is the system's memory of what has been done.

---

## 3. How a Session Flows (Step by Step)

Here is exactly what happens from the moment an assignment fires to a PR being merged:

```
1. ASSIGNMENT LOOP fires (interval elapsed or first start)
   ↓
2. ControlCenter checks: is the project locked? are concurrent slots available?
   ↓
3. If wait_for_pr_merge=true: wait until all open PRs from this agent are merged
   ↓
4. TOKEN ROTATION picks the best available Jules API key
   (Primary key: 100 calls/24h; Secondary keys: 15 calls/24h each; 14 keys total)
   ↓
5. Jules API is called: POST /v1alpha/sessions with the agent's prompt + repo info
   ↓
6. Jules clones the GitHub repo, reads the codebase, works autonomously:
   - Analyzes the codebase
   - Makes targeted changes (files edited, created, deleted)
   - Runs build/lint/type checks
   - Commits and opens a Pull Request on GitHub
   ↓
7. Orchestrator polls Jules every 60s until session status = DONE or FAILED
   ↓
8. Session result is written to the journal table
   ↓
9. If auto-merge is enabled: the PR merge pipeline runs
   (checks if mergeable, resolves .md/.json conflicts mechanically if needed, merges)
   ↓
10. Loop restarts after the configured pause (e.g., 5 min, 30 min)
```

---

## 4. Token Management

Jules API keys are rate-limited. The system manages 14 API keys:

| Key | Type | Limit |
|---|---|---|
| Key 1 (primary) | `JULES_MAIN_TOKEN` | 100 calls / 24 hours |
| Keys 2–14 | `JULES_SECONDARY_TOKENS` | 15 calls / 24 hours each |

**Total theoretical capacity:** 100 + (13 × 15) = **295 Jules sessions per 24-hour window.**

The `tokenRotation.js` module tracks usage per key in the database and always picks the key with the most remaining calls. When a key is exhausted, it's skipped automatically.

Each email corresponds to a Google account that has a Jules API access token. The system can display token usage per account in the dashboard.

---

## 5. The 3 Projects in Detail

### 5.1 HomeFreeWorld

**Repo:** `jeremy-angulo/HomeFreeWorld`  
**Branch:** `dev`  
**Stack:** Next.js 14, TypeScript, Tailwind CSS, Prisma ORM, PostgreSQL  
**What it is:** A social home-exchange platform mixing Facebook's trust model with Airbnb's mechanics. Users are hosts and guests simultaneously. Features: listings, bookings, reviews, messaging, internationalization (FR/EN), authentication.

**Active agents on this project (6):**
1. i18n-guardian (concurrency 2)
2. ✨ Code Simplifier (concurrency 1, waits for PR merge)
3. 🛡️ Sentinel (concurrency 1)
4. lead-product-engineer (concurrency 1, waits for PR merge)
5. Health Loop (concurrency 5)
6. TS-Global (concurrency 3)

**Features enabled:** Conflict resolver (auto-merges `.md`/`.json` conflicts at 18:00 daily)

**Site pages table:** 175 URLs tracked for visual/health checking (115 queued for analysis, 60 validated OK).

### 5.2 Trefle-ai-IHM

**Repo:** `jeremy-angulo/0-Trefle-ai-IHM`  
**Branch:** `dev` → merges to `master`  
**Stack:** Next.js, Prisma  
**What it is:** An AI-powered front-end application.

**Features enabled:**
- Build pipeline (daily at 05:00): Jules validates the `dev` branch (Prisma, build, tests), fixes errors autonomously, then the orchestrator creates and merges a PR to `master`.
- The pipeline prompt acts as a Release Manager: it ensures `dev` is stable before production promotion.

### 5.3 Jules-Orchestrator (self-hosted)

**Repo:** `jeremy-angulo/Jules-Orchestrator`  
**Branch:** `main`  
**What it is:** The orchestrator itself. The system monitors and improves its own codebase.

**Features enabled:** Conflict resolver (auto-merges `.md`/`.json` conflicts daily at 18:00).

---

## 6. The Complete Agent Roster (15 Agents)

### 6.1 🛡️ Sentinel — Security Guardian

**Mission:** Find and fix ONE security vulnerability per session. Never works on anything else.

**Priority order:**
1. Critical: hardcoded secrets, SQL injection, command injection, path traversal, missing auth
2. High: XSS, CSRF, auth bypass, missing rate limiting
3. Medium: stack traces in errors, insufficient logging, outdated deps
4. Enhancements: input sanitization, security headers, audit logging

**Boundaries:** Max 50 lines of change per session. Never exposes vulnerability details in public PRs. Maintains a `.jules/sentinel.md` journal for codebase-specific security learnings.

**Stats:** ~91 total runs, ~50 successful PRs opened.

**Key design insight:** Each session is intentionally scoped to ONE issue. This keeps PRs reviewable and avoids the context explosion that comes from trying to fix everything at once.

---

### 6.2 🎨 Palette Agent — UX Micro-Improvements

**Mission:** ONE micro-UX enhancement per session. Accessibility, interaction feedback, visual polish.

**Favorite improvements:**
- ARIA labels on icon-only buttons
- Loading spinners on async submit buttons
- Empty states with helpful call-to-action
- Keyboard focus styles
- Confirmation dialogs before destructive actions
- Inline form validation feedback

**Boundaries:** Max 50 lines. Never changes backend logic. Never does complete redesigns. Uses only existing CSS classes (no new dependencies).

**Philosophy:** "Good UX is invisible — it just works."

---

### 6.3 ⚡ Bolt — Performance Agent

**Mission:** ONE measurable performance improvement per session.

**Hunting grounds:**
- Frontend: unnecessary re-renders, missing memoization, unoptimized images, missing virtualization for long lists
- Backend: N+1 queries, missing DB indexes, expensive operations without caching, missing pagination
- General: redundant calculations, inefficient data structures, missing lazy initialization

**Boundaries:** Must comment the optimization. Never sacrifices readability for micro-optimization. Always runs tests to verify nothing broke.

---

### 6.4 translation-splitter — i18n Architecture Migration

**Mission:** Split a massive monolithic `en.json`/`fr.json` (162 top-level namespaces, ~440 KB each) into individual namespace files.

**How it works:** Each session picks the next 8 alphabetical namespaces not yet split, extracts them into `src/i18n/messages/namespaces/<namespace>/en.json` and `fr.json`, removes those keys from the root files, and updates the loader. Runs `npm run build` before opening a PR.

**Status:** This was a one-time migration task. Once all 162 namespaces are split, this agent's work is complete.

---

### 6.5 i18n-guardian — Translation Quality Keeper

**Mission:** Maintain translation quality across all namespaces, cycling through them in order forever.

**State tracking:** Maintains a `.guardian-journal.json` file in the repo that records which namespace was last processed. Each session picks the next one (`last_index + 1 mod total`).

**Per-session work:**
1. Sync FR ↔ EN: find keys present in one language but missing/empty in the other. Generate translations. (Up to 60 keys/session)
2. Coverage check: scan all `.tsx`/`.ts` files for `useTranslations('<ns>')` and `t('key')` calls. Add any missing keys to both JSON files. (Up to 20 keys/session)
3. Verify: runs `npx tsc --noEmit` then `npm run build`
4. Open PR with a clear summary of changes

**Stats:** ~108 total runs, ~89 successful PRs. One of the most productive agents.

**Concurrency:** Runs 2 instances simultaneously (different namespaces each, tracked via journal index).

---

### 6.6 qa-desktop — Desktop QA with Playwright

**Mission:** Run desktop browser screenshot tests and accessibility audits. Fix the top 3 issues per session.

**Process:**
1. Install deps (`npm ci`, Playwright + Chromium)
2. Start dev server
3. Run screenshot tests
4. Run a11y audit (WCAG A/AA violations: missing alt text, missing ARIA, contrast issues, keyboard traps, missing form labels)
5. Triage: pick 3 most impactful issues
6. Fix: targeted React component changes only
7. TypeScript check
8. Open PR

**Currently disabled** (enabled=0). Was used for initial accessibility audit pass.

---

### 6.7 qa-mobile — Mobile QA with Playwright (375×812)

**Mission:** Same as qa-desktop but at 375×812px viewport (iPhone-sized).

**Mobile-specific priorities:**
- Touch targets smaller than 44×44px
- Horizontal overflow/scroll
- Text below 12px
- Modals or dropdowns that clip the viewport
- Mobile-specific WCAG violations

**Prefers Tailwind responsive classes** (`sm:`, `md:`) rather than global changes.

**Currently disabled** (enabled=0).

---

### 6.8 code-simplifier — Refactoring Agent (Legacy)

**Mission:** Make the codebase easier to read and maintain. No feature changes.

**Rules:**
- Functions over 80 lines with distinct phases → split
- Components over 200 lines → extract sub-components or hooks
- Repeated logic (3+ occurrences) → extract shared util/hook
- Complex conditionals → early returns or lookup tables
- Remove dead imports, unused variables, `console.log`
- Resolve TODO/FIXME comments (max 3 per session)

**Invariants:** Never changes function signatures visible to other modules. Never alters API routes. Never touches test files.

**Note:** This is an older version of the Code Simplifier role, superseded by "✨ Code Simplifier" (agent 21).

---

### 6.9 lead-sdet — Lead Software Developer Engineer in Test

**Mission:** Autonomous QA cycle. Turn red tests green or cover untested blind spots.

**Priority order:**
1. Fix broken CI tests (mismatched error strings, missing env vars)
2. Cover Server Actions with no unit test in `tests/unit/`
3. Add E2E Playwright tests for critical untested user flows

**Deep technical context:**
- Knows to mock `auth()`, `prisma`, `next/cache` (`revalidatePath`)
- Knows that error messages are in French (e.g., `'Non autorisé'`), so tests must expect French strings
- Knows to mock external services: Stripe, Cloudinary, Resend, PostHog
- Uses Vitest for unit/integration, Playwright for E2E

**Philosophy:** 100% autonomous. No questions, no permission requests. Opens PR immediately after verification.

**Stats:** ~108 runs (shared assignment slot with i18n-guardian historically), runs on a 5-minute loop waiting for PR merges before restarting.

---

### 6.10 lead-product-engineer — Product Feature Agent

**Mission:** 1-hour micro-improvement cycle. Find one dead-end or mockup state in the UI and build it properly.

**Hunting grounds:**
- Buttons with empty `onClick` or `console.log`
- Hardcoded text ("Lorem Ipsum", "User Name")
- TODO/FIXME comments
- Visual elements that exist but have no logic (e.g., a "Share" button that doesn't share)

**HFW Design Philosophy it follows:**
- Trust, Human Connection, Zero Friction
- Social features → reinforce network effect
- Rental features → reassure host and guest
- Design system: blue/white "Trust & Tech" palette
- Uses Server Actions, AuthGate pattern, strict TypeScript

**Stats:** ~10 runs, all successful. Runs on 30-minute loop, waits for PR merges.

---

### 6.11 ✨ Code Simplifier — Autonomous Refactoring Agent

**Mission:** Pick ONE complex file or unit per session and refactor it for clarity, modularity, and simplicity without changing any feature, business logic, or visual appearance.

**Selection criteria:** Files over 150 lines or high cyclomatic complexity.

**Process:**
1. Select the target file
2. Map current logic and UI behavior
3. Refactor: split large functions, extract reusable hooks, simplify conditionals
4. Verify: `npm run build` + all tests (100% regression-free)
5. Open PR titled `refactor: simplified [Unit Name] for better maintenance`

**Stats:** ~88 total runs, ~76 successful PRs. Very active agent.

---

### 6.12 Health Loop — Architecture Debt Eradicator

**Mission:** Eradicate architectural debt from HomeFreeWorld, one iteration at a time. One task per session only.

**Priority ladder (auto-detected via grep):**

🔴 **Priority 1 — UI Time Bombs (White Screens)**  
Find `throw new Error` in `src/components/`. React components must never throw raw errors (it crashes the app). Replace with `return false` or local error state/toast. *(Exceptions: `form.tsx`, `FontSizeProvider.tsx`)*

🔴 **Priority 2 — False MVC (Action/Service Separation)**  
Find `import prisma from "@/lib/services/db"` in `src/app/actions/`. Over 100 Server Actions call Prisma directly. The agent picks one sub-folder, moves all Prisma logic to a `src/lib/services/` file, and makes the Action only do: auth + Zod validation + call the Service.

🟠 **Priority 3 — Prisma Type Leaks into UI**  
Find `import { ... } from "@prisma/client"` in `src/components/`. UI must not know the database. Replace with local DTO interfaces.

🟠 **Priority 4 — Ghost Crons**  
Check `src/app/api/cron/`. Vercel cron handlers that time out. Migrate logic to Inngest functions. Delete the original cron.

🟡 **Priority 5 — UI Deduplication & Security**  
- Replace Stripe dummy fallback key with a proper `throw new Error("Missing STRIPE_SECRET_KEY")`
- Merge `components/ui/` and `components/shared/ui/` (deduplication)

**Key design:** The agent starts by grepping for each priority in order. If Priority 1 is done, it moves to Priority 2, etc. Self-regulating.

**Stats:** ~85 total runs, high output. Concurrency 5 (5 simultaneous instances).

---

### 6.13 TS-Global — TypeScript Strict Mode Enforcer

**Mission:** Audit and enforce absolute TypeScript safety (strict mode) across the entire project, from DB to UI.

**Protocol:**
1. Find a data flow with weak typing (`any`, implicit types, `@ts-ignore`)
2. Eradicate: remove all `any`, `as any`, `@ts-ignore`; import or create proper interfaces from existing schemas; use `ReturnType<>`, `Awaited<>`, utility types
3. If a type is too complex: use `unknown` + a Type Guard, mark with `// FIXME(TS-Auto): Type inféré automatiquement, vérification requise`
4. For external payloads without strict types: generate a Type Guard or Zod validation
5. Run `npm run typecheck` (tsc --noEmit). Fix any errors immediately. Loop.
6. Process files in batches of 5

**Golden rules:** Zero `any`. Zero questions. Resolve conflicts autonomously by preferring `unknown + narrowing` if the real type is unknown.

**Stats:** ~7 runs so far (newer agent). Concurrency 3.

---

### 6.14 i18n Globalizer — Hardcoded String Eliminator

**Mission:** Eradicate all hardcoded strings from JSX in `src/components/`. Full i18n integration, end-to-end, autonomous.

**Protocol per file:**
1. Detect all literal strings in JSX
2. Identify if Client Component (`"use client"`) or Server Component → different import pattern
3. Generate a semantic key name from the file path + text role (e.g., `Auth.LoginForm.forgotPassword`)
4. Handle interpolation (`Bonjour {user.name}` → `Bonjour {{name}}`)
5. Add the key to both `i18n/messages/fr.json` and `i18n/messages/en.json` with a professional translation in both languages
6. Sort keys alphabetically in the JSON
7. Import the correct translation function in the component
8. Replace hardcoded string with `{t('key')}`
9. Validate JSON integrity after each change

**Never touches:** `console.log`, `alt` attributes (unless visually displayed text), `aria-label`, Tailwind `className`, `id`, technical object keys.

---

### 6.15 lead-sdet (Legacy / Prompt file version)

The disk-based version of the SDET prompt (under `prompts/HomeFreeWorld/lead-sdet.md`) pre-dates the Agent Library. It is seeded into the DB on boot but superseded by the agent library version. Same role and methodology.

---

## 7. The Assignment System in Detail

Every active agent on a project is controlled by an **assignment**. Here is the current state for HomeFreeWorld:

| Agent | Concurrency | Loop Pause | Waits for PR Merge | Status |
|---|---|---|---|---|
| 🛡️ Sentinel | 1 | 5 min | No | Enabled |
| i18n-guardian | 2 | 5 min | Yes | Enabled |
| ✨ Code Simplifier | 1 | 5 min | Yes | Enabled |
| lead-product-engineer | 1 | 30 min | Yes | Enabled |
| Health Loop | 5 | 2 min | No | Enabled |
| TS-Global | 3 | 5 min | No | Enabled |
| qa-desktop | 1 | 30 min | No | Disabled |
| qa-mobile | 1 | 30 min | No | Disabled |

**Concurrency** means multiple Jules sessions run simultaneously for the same agent. For example, Health Loop with concurrency=5 means 5 instances of Jules are running in parallel, each independently working on architecture debt.

**wait_for_pr_merge=true** means the next loop iteration will not start until all open PRs from the previous session are merged. This prevents agents from creating conflicting PRs on top of unreviewed work.

---

## 8. Automated Pipelines

### 8.1 Build & Merge Pipeline (Trefle-ai-IHM)

**Schedule:** Daily at 05:00  
**Flow:**
1. Lock the project
2. Wait for active tasks = 0
3. Jules validates the `dev` branch (Prisma, npm build, test suite)
4. If anything fails, Jules fixes it autonomously and commits
5. Once all checks pass, orchestrator creates a PR from `dev` to `master`
6. PR is auto-merged

**Purpose:** Ensures production (`master`) is always a verified, stable build of `dev`.

### 8.2 Conflict Resolver (HomeFreeWorld + Jules-Orchestrator)

**Schedule:** Daily at 18:00  
**What it does:** For any PR with conflicts, if ALL conflicted files are `.md` or `.json`, the orchestrator resolves them mechanically:

- **Markdown conflicts:** Keep both sides (HEAD + DEV), concatenate them. Good for documentation that both agents added to independently.
- **JSON conflicts:** Deep-merge both JSON objects. Objects merge recursively. Arrays: concatenate with deduplication. Primitive scalars: HEAD (PR branch) wins.

If any conflicted file is of another type (`.ts`, `.tsx`, etc.), the mechanical merge aborts — Jules will need to resolve it.

### 8.3 Auto-Merge Service

Continuous polling for mergeable PRs across all projects. Checks PR status, CI checks, approval state. Merges automatically when all conditions are met.

---

## 9. The Site Pages Health Check System

The `site_pages` table tracks all known URLs of HomeFreeWorld for visual health monitoring.

**Status lifecycle:**
```
ANALYZE → (agent takes screenshot + analyzes) → OK or FIX
FIX → (agent fixes the issue in code) → back to ANALYZE
```

**Current state (May 2026):**
- 175 total pages tracked
- 60 pages with status `OK` (validated)
- 115 pages with status `ANALYZE` (queued for agent review)

The system uses locking (`locked_by`, `locked_at`) so multiple concurrent agents don't process the same page simultaneously.

---

## 10. Dashboard and Observability

The orchestrator exposes a web dashboard at its public URL (`https://jules-orchestrator-gpdi.onrender.com`).

**Features:**
- Live view of all running agents (runners), their status, last run time, total runs
- Assignment management: enable/disable, adjust concurrency/pause
- Agent library: create, edit, delete agent prompts
- Project configuration
- Token usage display (calls remaining per API key)
- Audit log of all dashboard actions
- Journal: full history of every Jules session

**Roles:** Admin, Operator, Viewer (session-cookie auth).

---

## 11. Productivity Analysis

### 11.1 Session Volume (as of May 2026)

| Agent | Total Runs | Completed | Failed | Success Rate |
|---|---|---|---|---|
| i18n-guardian | ~108 | 89 | 1 | 99% |
| Health Loop | ~85 | ~65 | 3 | ~96% |
| ✨ Code Simplifier | ~88 | 76 | 4 | 95% |
| 🛡️ Sentinel | ~91 | 50 | 4 | 95% |
| lead-product-engineer | ~10 | 10 | 0 | 100% |
| TS-Global | ~7 | 7 | 3 | 70% |

**Total journal entries:** 432 recorded sessions.

### 11.2 What Works Well

**Fine-grained, single-responsibility agents:** Agents that do exactly ONE thing per session (Sentinel: one security fix; i18n-guardian: one namespace; Code Simplifier: one file) are the most reliable. They stay within Jules' context window and produce clean, reviewable PRs.

**Stateful agents win:** The i18n-guardian uses a `.guardian-journal.json` file in the repo to track its position. This means it always makes progress and never duplicates work. The Health Loop uses a grep-based priority detection system that is self-correcting.

**Concurrency unlocks throughput:** Health Loop runs 5 concurrent instances. TS-Global runs 3. This multiplies output without needing more API keys.

**Wait-for-merge discipline:** Agents that set `wait_for_pr_merge=true` avoid creating work-on-top-of-work. This is especially important for i18n-guardian (editing JSON files) and Code Simplifier (editing components).

### 11.3 Known Friction Points

**Token limits:** 295 total sessions per 24-hour window across all keys. With 6 enabled assignments and varying concurrency, the system can approach this ceiling during peak activity. Monitoring token usage in the dashboard is important.

**Jules context window:** Jules has a finite context window. Agents with very large prompts (Health Loop, TS-Global) can occasionally fail if the codebase files they load are too large. The mitigation is to scope prompts tightly: "pick ONE sub-folder" or "process files in batches of 5."

**Merge conflicts:** When multiple agents edit the same files (e.g., JSON files), merge conflicts arise. The mechanical conflict resolver handles `.json` and `.md` cases automatically, but TypeScript file conflicts still require manual intervention or a Jules session to resolve.

**PR queue buildup:** If agents create PRs faster than CI checks complete and auto-merge kicks in, a backlog accumulates. The `wait_for_pr_merge` flag helps throttle this.

### 11.4 Improvement Opportunities (for NotebookLM exploration)

1. **Priority signaling:** Can the orchestrator detect from GitHub CI failures which agent's PR broke things, and temporarily pause that agent? This would reduce bad PRs compounding on top of each other.

2. **Cross-agent awareness:** Today agents are blind to each other. If i18n-guardian just added 60 translation keys to `academy/fr.json`, and the Code Simplifier also edits a component that uses the Academy namespace, there's no handshake. A shared "what did I just touch" log in the repo could reduce collisions.

3. **Dynamic token allocation:** Not all agents are equally valuable per session. Could the orchestrator prioritize token allocation? (e.g., lead-product-engineer sessions are higher-value than routine cleanup, so give them tokens first).

4. **Session quality scoring:** The journal records `summary` and whether a PR was created. Currently, "no PR created" is treated the same as "PR created" in the success count. A quality score (PRs per 10 sessions) per agent would show which agents are the most productive.

5. **Gemini CLI integration:** If 15 additional Gemini-CLI agents are operational, they could be used for tasks Jules doesn't handle well: running local dev servers, taking screenshots, running Playwright tests locally. The orchestrator could be extended to dispatch to Gemini CLI for session types that need local environment access.

6. **Site health closing the loop:** The 115 ANALYZE pages in `site_pages` represent work queued for the health-checking agents. Once agents process them and raise issues, there's no automatic assignment of the fix to the right specialized agent. A routing layer could read `site_pages.issues` and dispatch to Sentinel (if security), Palette (if UX), TS-Global (if TypeScript), etc.

---

## 12. Agent Design Principles (for Writing New Agents)

From operating this system, these principles consistently produce the most reliable agents:

**1. One thing per session.** An agent that does one focused task per session is 10× more reliable than one that tries to "scan everything and fix the top 5 issues." Jules works best with a clear, bounded goal.

**2. Start with a grep/scan.** The best agents begin by searching the codebase for their work items, then pick exactly ONE to work on. This makes the agent self-regulating and prevents repeated work.

**3. Build state into the repo.** If an agent needs to remember where it left off, store that state in a file inside the repository (e.g., `.jules/guardian-journal.json`). This persists across sessions and restarts, unlike in-memory state.

**4. Hard constraints on scope.** Specify maximum line counts, maximum file counts, maximum fixes per session. This keeps Jules within its context window and produces reviewable PRs.

**5. Verify before PR.** All agents should run `tsc --noEmit` (or equivalent) before opening a PR. Jules can write code that looks right but has type errors. This step catches ~90% of bad PRs before they reach GitHub.

**6. Never ask questions.** All prompts include "CRITICAL RULE: You are 100% autonomous." Jules is designed to make decisions; prompts that ask it to "check with the user" produce stalled sessions.

**7. Explicit PR format.** Give the agent the exact PR title format and body structure. This makes the PR queue readable at a glance and makes it easy to identify which agent created which PR.

**8. Describe what NOT to do.** The most effective agents have a clear "NEVER" section. This prevents drift into adjacent work (e.g., Sentinel fixing UX issues, Palette touching backend code).

---

## 13. System Configuration Reference

### Environment Variables

| Variable | Purpose |
|---|---|
| `JULES_MAIN_TOKEN` | Primary Jules API key (100 calls/24h) |
| `JULES_SECONDARY_TOKENS` | Comma-separated secondary Jules API keys (15 calls/24h each) |
| `JULES_TOKEN_EMAILS` | Display names / emails for each key (for the dashboard) |
| `GITHUB_TOKEN` | GitHub PAT for PR operations |
| `TURSO_DATABASE_URL` | Turso (cloud SQLite) database URL |
| `TURSO_AUTH_TOKEN` | Turso authentication token |
| `WEBSITE_HEALTH_URL` | URL to probe for uptime monitoring |
| `RENDER_EXTERNAL_URL` | Public URL of the orchestrator itself |
| `PORT` | HTTP port (default 3000) |

### Database Tables

| Table | Purpose |
|---|---|
| `agents` | Agent library: name, description, prompt, color |
| `assignments` | Agent-project links with loop config |
| `projects_config` | Project registry with all settings |
| `project_states` | Per-project locks and active task counts |
| `journal` | Full history of all Jules sessions |
| `agent_sessions` | Low-level session tracking (pruned after 7 days) |
| `audit_log` | Dashboard action log (pruned after 7 days) |
| `site_pages` | URLs tracked for visual health checking |
| `token_names` | Display name overrides for API tokens |
| `prompts` | Legacy prompt storage (seeded from disk) |
| `dashboard_users` | Dashboard user accounts |
| `dashboard_sessions` | Dashboard login sessions |

---

## 14. Glossary

| Term | Definition |
|---|---|
| Jules | Google's Gemini-based AI coding agent. Clones a repo, writes code, creates a PR. |
| Session | A single Jules invocation. One prompt → one task → (usually) one PR. |
| Assignment | A persistent configuration linking an agent to a project with loop settings. |
| Runner | The in-memory object inside the orchestrator that manages an active assignment loop. |
| Concurrency | Number of simultaneous Jules sessions for one assignment. |
| Loop pause | Time between the end of one session and the start of the next. |
| wait_for_pr_merge | Flag that prevents a new session from starting until previous PRs are merged. |
| Mechanical merge | Automatic conflict resolution for `.md` and `.json` files without Jules. |
| Token rotation | Picking the API key with the most remaining calls to distribute load. |
| Journal | DB record of every session: agent, project, summary, PR URL, timing. |
| ANALYZE | site_pages status: page is queued for agent screenshot + analysis. |
| FIX | site_pages status: agent found issues on this page and needs to fix them. |
| OK | site_pages status: page has been reviewed and validated. |
