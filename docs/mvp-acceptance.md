# SYSCORA MVP Acceptance

| Requirement | Status | Evidence |
|---|---|---|
| Secure local daemon with authenticated client communication | VERIFIED | Token-authenticated local API in `apps/daemon/src/server.js`; timing-safe token compare, body-size cap, and traversal guard covered by `tests/integration/daemon-security.test.js` |
| Natural-language request to structured runtime flow | IMPLEMENTED_NOT_VERIFIED | `packages/agent-runtime/src/index.js` |
| Validated task graph and registered capabilities only | VERIFIED | Unit tests and runtime validators |
| Deterministic risk/policy/permission loop | VERIFIED | Existing risk/policy/permission tests |
| Deny-by-default capability permissions (scope/type/lifetime/reuse grants) | VERIFIED | `packages/permission-broker` grant store; `tests/unit/capability-permissions.test.js`, end-to-end grant issue/consume in `tests/integration/end-to-end-runtime.test.js` |
| Semantic goal verification (COMPLETED_WITH_WARNINGS, evidence-justified) | VERIFIED | `packages/agent-runtime/src/goal-verifier.js`; `tests/unit/goal-verification.test.js` |
| Hung-capability hard timeout + cancellation | VERIFIED | `packages/task-graph-scheduler`; `tests/unit/scheduler.test.js` |
| Tamper-evident audit hash chain | VERIFIED | `packages/audit`; `tests/unit/audit-integrity.test.js`, end-to-end chain verify |
| Signed capability plugin framework (opt-in, fail-closed) | VERIFIED | `packages/capability-registry` loader + Ed25519 verifier; `tests/unit/plugin-signature.test.js` |
| Typed execution + observation + verification + rollback | VERIFIED | Existing runtime tests |
| Restart-resume for persisted in-flight sessions | VERIFIED | `mvp-security.test.js` |
| Windows system inspection | IMPLEMENTED_NOT_VERIFIED | `os-adapters/windows/src/windows-adapter.js`, `/api/system/summary` |
| Windows user environment variable set/verify/rollback | VERIFIED | `set-user-env` runtime/API path; real end-to-end write + rollback in `tests/integration/end-to-end-runtime.test.js`, PATH mutation/rollback in `tests/unit/windows-adapter-path.test.js` |
| Process/service inspection on Windows | IMPLEMENTED_NOT_VERIFIED | Windows adapter process/service collectors |
| Desktop control flow | NOT_IMPLEMENTED | N/A |
| Browser automation flow | NOT_IMPLEMENTED | N/A |
| Git integration | IMPLEMENTED_NOT_VERIFIED | Typed inspection capability only |
| Docker integration | IMPLEMENTED_NOT_VERIFIED | Typed inspection capability only |
| Developer workflow inspect/run/troubleshoot | IMPLEMENTED_NOT_VERIFIED | Node/Python workflow tests |
| Privileged helper subprocess boundary | VERIFIED | Privileged helper lifecycle tests |
| Secret broker | VERIFIED | DPAPI broker is injected only at capability execution; sessions, audit, memory, and prompts retain opaque references only. Real DPAPI round-trip (argv-safe) verified in `tests/integration/end-to-end-runtime.test.js`; secret-isolation across the pipeline in `tests/integration/llm-runtime.test.js` |
| Windows desktop shell | IMPLEMENTED_NOT_VERIFIED | Electron wrapper in `apps/desktop-shell` launches daemon + embeds UI |
| Installer/package | NOT_IMPLEMENTED | N/A |
