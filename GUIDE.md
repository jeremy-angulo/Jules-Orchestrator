# Jules Orchestrator Management Guide

This guide explains how to manage agents and assignments in the Jules Orchestrator.

## Initial Setup / Seeding

If the `orchestrator.db` is empty or needs to be reset:
1. Ensure `bootstrap.json` contains the base agents and projects.
2. Run the `seed_sdet.mjs` script to populate the database and add the `lead-sdet` agent.

```bash
node seed_sdet.mjs
```

## Inspecting the Database

Use the `inspect.mjs` script to view current projects, agents, and assignments.

```bash
node inspect.mjs
```

## Launching an Agent Session

To launch an agent manually (e.g., if it's not in loop mode or you want to trigger it), use the `jules.sh` script in the `HomeFreeWorld` repository:

```bash
./scripts/jules.sh launch <agent-name> <repo> [task]
```

Example:
```bash
./scripts/jules.sh launch lead-sdet jeremy-angulo/HomeFreeWorld "Fix i18n test regressions"
```

## Troubleshooting

- If the database is locked, ensure no other process is holding a write lock.
- Check `orchestrator.log` for execution errors.
- Verify environment variables in `.env` (JULES_MAIN_TOKEN, GITHUB_TOKEN).

## Creating New Agents

To add a new agent, you can modify `seed_sdet.mjs` or create a new script using the `createAgent` and `createAssignment` functions from `./src/db/database.js`.
