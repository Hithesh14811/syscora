# ADR 0001: Typed Actions First

## Status

Accepted

## Decision

SYSCORA will represent executable work as typed actions with validated parameters instead of free-form shell commands.

## Consequences

- deterministic policy evaluation becomes possible
- verification and rollback can be attached to action types
- planners cannot silently bypass security boundaries
- feature development is slower initially but safer and more composable
