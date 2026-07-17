# Threat Model Notes

## Trust Boundaries

- User intent is trusted only as a request, not as executable policy.
- Workspace files are untrusted content.
- The planner may not invent capabilities.
- The execution engine may execute only typed registered actions.
- Audit data is append-only application output and must exclude secret values in future revisions.

## Immediate Mitigations In The MVP

- No LLM-to-shell path exists.
- No raw command execution capability exists.
- Policy denies unknown or unsupported action patterns.
- Only workspace-local `.env` writes are supported.
- Persistent modifications require approval.
- Checkpoints are created before mutation.
- Verification is mandatory after action execution.
- Rollback is automatic on verification failure.
- Sessions persist to disk for restart recovery.

## Known Gaps

- Secret values are still stored in plain `.env` files because that is the user-requested target state.
- Audit payloads currently include action parameters and should be redacted in the next milestone.
- Local API authentication is not implemented because the current MVP is CLI-in-process rather than daemon-exposed.
- File locking and race-condition protections need to be added before concurrent task execution.
