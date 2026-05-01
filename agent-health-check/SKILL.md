---
name: agent-health-check
description: Audit and heal agent assignment sessions. Use to verify that the number of active assignment sessions matches configured concurrency, identify deadlocked or hung runners, and restart stalled or timed-out assignments.
---

# Agent Health Check

Use this skill to audit the current state of your agent assignments and runners. It performs a "no-trust" audit by checking the `ControlCenter` registry directly, independent of the database status.

## Workflow

1. **Audit**: Run the audit to compare actual active sessions against configured concurrency limits.
2. **Identify**: Detect hung or deadlocked sessions, or sessions that should be running but are missing.
3. **Heal**: Initiate repair actions to stop orphaned sessions and restart stalled assignments.

## Audit Command

```bash
# Verify health of all assignments
node agent-health-check/scripts/audit_health.cjs
```

## Healing Command

```bash
# Force heal the system
node agent-health-check/scripts/heal_health.cjs
```

## References

- [SCHEMA.md](references/schema.md) - Reference for assignment and session states.
- [TROUBLESHOOTING.md](references/troubleshooting.md) - Common causes for deadlocks and how to interpret health reports.
