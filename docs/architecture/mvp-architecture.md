# MVP Architecture

The current MVP implements the first trustworthy closed-loop workflow for SYSCORA:

1. accept a natural-language intent for a workspace environment variable
2. collect workspace-local context
3. create a typed plan bound to a registered capability
4. assess risk
5. apply deterministic policy
6. request explicit approval
7. checkpoint current state
8. execute a typed action through an adapter
9. verify the observed result
10. update semantic state and memory metadata
11. persist the session and append audit events
12. support rollback on failure

## Current Subsystems

- `apps/cli`: thin local client for intent submission and approval
- `apps/daemon`: runtime composition root and inspection entrypoint
- `packages/shared-types`: IDs, enums, validators, audit event factory
- `packages/protocol`: versioned response contract
- `packages/capability-registry`: authoritative capability catalogue
- `packages/risk-engine`: deterministic risk classification for the vertical slice
- `packages/policy-engine`: deterministic allow/confirm/deny decisions
- `packages/execution-engine`: typed action dispatch and rollback
- `packages/verification-engine`: post-action verification
- `packages/audit`: append-only local audit log
- `packages/agent-runtime`: stateful orchestration and session persistence
- `os-adapters/linux`: workspace `.env` adapter

## Explicit Non-Goals For This Slice

- unrestricted shell access
- system-wide environment mutation
- direct LLM provider integration
- browser or desktop automation
- autonomous privilege escalation
- untyped tool execution

## Why This Slice First

Project-local environment mutation is narrow enough to secure and broad enough to prove the architecture:

- it requires intent parsing and context gathering
- it mutates persistent state
- it needs approvals, checkpointing, verification, and rollback
- it creates reusable patterns for future filesystem, service, and package capabilities
