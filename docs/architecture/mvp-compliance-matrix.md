# SYSCORA MVP Compliance Matrix

This matrix evaluates the current repository against the 17 MVP completion criteria in the SYSCORA product directive.

Status legend:
- MET: implemented and demo-visible in current repo
- PARTIAL: implemented in limited scope or without full hardening
- MISSING: not implemented

## Criteria

1. Desktop client communicates securely with persistent local daemon  
Status: MET  
Notes: desktop UI talks to daemon API using local token authentication; daemon state persists in local SQLite repositories.

2. User can express system-management or developer objective in natural language  
Status: PARTIAL  
Notes: natural language is supported for set-env objective only.

3. System converts objective into validated task graph  
Status: MET  
Notes: planner emits task graph and validates shape.

4. Planner can only select registered capabilities  
Status: MET  
Notes: planner checks capability registry before plan creation.

5. System inspects relevant machine state before acting  
Status: MET  
Notes: runtime inspects current project `.env` before write/checkpoint.

6. Every action passes deterministic policy evaluation  
Status: MET  
Notes: risk + deterministic policy enforced before execution.

7. Elevated actions use controlled privilege escalation  
Status: MISSING  
Notes: no privileged action framework or permission broker yet.

8. Risky actions request approval  
Status: MET  
Notes: persistent env write requires explicit confirmation path.

9. Actions executed through typed capability handlers  
Status: MET  
Notes: execution dispatches typed action only.

10. Execution results produce structured observations  
Status: MET  
Notes: observation engine now records structured observation per action.

11. Meaningful actions are verified  
Status: MET  
Notes: verification engine checks persisted value after execution.

12. Failures trigger bounded recovery or replanning  
Status: PARTIAL  
Notes: rollback on failure exists; no generalized recovery/replanning policy yet.

13. Reversible changes can be rolled back  
Status: MET  
Notes: automatic rollback on verification failure and manual rollback endpoint.

14. State and execution history persist across daemon restarts  
Status: MET  
Notes: sessions + audit events persisted in SQLite.

15. User can inspect what SYSCORA did  
Status: MET  
Notes: frontend displays summary and session/event records.

16. Developer workflows can detect/configure/run/troubleshoot/verify real projects  
Status: PARTIAL  
Notes: Node project workflow added (detect + conditional install + run + verification + fallback recovery). Broader stacks and deep troubleshooting remain pending.

17. External content cannot grant permissions or redefine policy  
Status: PARTIAL  
Notes: deterministic policy and typed execution boundary exist; broader untrusted content model not yet implemented.

## Current MVP Scope Statement

Current MVP scope is a secure closed-loop implementation for a single vertical slice:
- "Set an environment variable for my current project"

This is the foundation for expanding capabilities while preserving:
- typed execution boundaries,
- deterministic policy controls,
- auditability,
- verification,
- rollback.
