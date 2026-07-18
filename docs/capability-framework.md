# Capability Expansion Framework

Capabilities are plugins to the frozen runtime. They never call the scheduler,
policy engine, permission broker, recovery engine, perception, memory, audit,
or goal verifier directly. The runtime owns those services through the
Capability Lifecycle Pipeline.

## Contract V2

Every registered capability has a normalized V2 contract. The canonical fields
include identity (`capabilityId`, version, category, owner), schemas, lifecycle,
requirements, risk and policy declarations, security declarations, state
mutations, handlers, recovery declarations, semantic/memory/audit declarations,
performance limits, rollback support, health, deprecation, documentation, and
packaging metadata.

The handler lifecycle is always `preconditions`, `execute`, `observe`, and
`verify`; rollback-capable capabilities also provide `createCheckpoint` and
`rollback`. The registry normalizes legacy built-ins into this contract so they
remain reference implementations without changing their Windows behavior.

## Lifecycle And Health

The registry emits structured capability events for registration, loading,
execution preparation, permission checks, verification/failure, rollback
registration, health changes, disablement, removal, and plugin unloads.

Only installed, available, or healthy capabilities are offered in the catalog.
Deprecated capabilities are excluded unless explicitly requested. The planner
validates health and platform support before a task can execute. Required
capability dependencies must be available at compatible versions; cycles and
missing dependencies are rejected.

## Plugin Packages

Each plugin directory contains `syscora-capability.json` and a module entry:

```json
{
  "manifestVersion": "1",
  "pluginId": "com.example.echo",
  "version": "1.0.0",
  "runtimeVersion": ">=0.1.0",
  "entry": "index.js",
  "capabilities": ["example.echo"],
  "dependencies": [],
  "signature": "<base64 Ed25519 signature over the manifest digest>"
}
```

The `signature` is a base64 Ed25519 signature over the SHA-256 digest of the
canonical manifest (with `signature` removed). The host verifies it against the
public keys in `SYSCORA_PLUGIN_TRUSTED_KEYS`; verification is **fail-closed** —
when no trusted keys are configured, no plugin can load. Plugin loading itself is
opt-in via `SYSCORA_PLUGIN_DIR` and is wired end-to-end through
`loadCapabilityPlugins()` in the daemon runtime factory.

The entry exports a `capabilities` array or a `registerCapabilities` function.
The loader supplies a scoped registry that can only register capabilities under
the plugin's source identity. Unsigned packages, manifests signed by an untrusted
key, manifests without a configured signature verifier, incompatible runtime
versions, malformed contracts, broken dependencies, and duplicate IDs are
rejected. Unloading removes only the capabilities owned by that plugin.

## Security And Execution

Capabilities declare required permissions, elevation, filesystem, registry,
network, browser, clipboard, automation, and external-process access, plus a
derived `permissionModel` (scope, type, approval lifetime/expiration, reuse
policy). Enforcement is deny-by-default: the lifecycle pipeline calls the
permission broker, which requires an active, unexpired, non-revoked grant that
covers every declared permission before execution; single-use grants (mutating
and elevated capabilities) are consumed on use, session-reusable grants (read
only) are not. Policy approval is a precondition for issuing a grant, never a
substitute for one. Grants are issued per plan after approval and can be revoked
per session.

Execution stays in the existing scheduler, including bounded retry and recovery.
Each capability phase runs under a hard wall-clock timeout with cooperative
cancellation (a `signal` is passed to `execute`); a capability that exceeds its
declared timeout is abandoned as `TIMED_OUT` and routed into recovery, so a hung
capability never blocks the scheduler. Resource-limit and temporary-workspace
declarations are carried in the V2 performance metadata for current and future
sandbox providers.

Observations always flow through Perception, the sole Semantic State writer.
Verified capability metadata can register semantic updates, store configured
memory updates, and create audit events without plugin access to runtime
services.

## Development Workflow

Use `createCapabilityTemplate()` from `@syscora/capability-registry` to obtain a
complete capability skeleton. Implement only capability-local behavior and
declarations, add the module and manifest, then load it with
`CapabilityPluginLoader` using the host signature policy.

Run `npm run capabilities:validate` before publishing. The validation suite
checks V2 compatibility for every built-in, strict plugin package fields,
signed discovery/loading, dependency handling, health filtering, registration,
safe unloading, and the developer template. Package tests and documentation
metadata are mandatory for plugins.
