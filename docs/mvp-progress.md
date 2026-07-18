# SYSCORA MVP Progress

## Current Runtime State

The canonical runtime owns the request lifecycle from intent classification through context, TaskGraph planning/validation, policy approval, scheduler execution, observation, verification, recovery, rollback, goal verification, semantic-state snapshotting, memory, session persistence, and audit.

Perception is the only SemanticState writer. The planner and recovery paths consume the relevant semantic subgraph and redacted memory. Rollback is capability-driven: every `ROLLBACK_SUPPORTED` capability captures its own pre-state and restores in reverse TaskGraph dependency order.

The local daemon is token authenticated, and the Electron desktop shell starts and embeds it. Model providers are optional; failures return to deterministic intent/planning behavior. DPAPI secrets are resolved only immediately before capability execution and scrubbed before session persistence.

## Known Limitations

- Scheduler execution is sequential even when the graph has independent tasks.
- The privileged helper is scoped and approval-bound but is not a general UAC elevation service.
- Browser and Notepad workflows dispatch actions but do not provide browser or UI automation.
- There is no installer or packaging workflow.
