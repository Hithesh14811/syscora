# Threat Model Notes

## Trust Boundaries

- User intent is a request, never executable policy.
- Workspace files and model output are untrusted.
- Only registered, schema-validated capabilities may execute.
- The local daemon requires its `x-syscora-token` (timing-safe comparison) for API routes other than health.
- Secrets are DPAPI-protected at rest and enter only the transient capability inputs that require them. Plaintext is never placed on a command line; it is passed to the DPAPI helper via a child-process environment variable.

## Current Mitigations

- The planner normalizes and validates every TaskGraph against capability schemas and limits.
- Policy and permission gates run before mutations. Capability permissions are deny-by-default: a capability executes only with an active, unexpired, non-revoked grant (scope + type + lifetime + reuse policy) issued for the session; single-use grants are consumed on use.
- Perception is the only SemanticState writer, enforced by a writer-token guard (unauthorized mutations throw); session, memory, and audit stores redact sensitive fields.
- The audit log is a SHA-256 hash chain with a monotonic sequence; `verifyChain()` detects payload tampering, broken links, gaps, and reordering.
- Capability execution is bounded by a hard wall-clock timeout with cancellation, so a hung capability cannot block the scheduler.
- The daemon caps request-body size (413) to bound memory use, and treats missing static files as 404.
- Rollback-capable tasks checkpoint capability-specific pre-state and roll back in reverse dependency order.
- Recovery and replanning use bounded budgets and termination conditions.
- Optional capability plugins load only when explicitly enabled and must carry a signature from a configured trusted key (fail-closed when no keys are configured).

## Known Gaps

- Secret values can exist in user-requested target files such as `.env`.
- File locking and concurrency control are not implemented because the scheduler is sequential.
- The privileged helper is bounded but does not provide Windows UAC elevation.
