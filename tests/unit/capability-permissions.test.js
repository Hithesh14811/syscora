import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PermissionBroker } from "../../packages/permission-broker/src/index.js";
import { CapabilityGrantStore } from "../../packages/permission-broker/src/capability-grant-store.js";
import { AuditRepository } from "../../packages/audit/src/index.js";
import { createDefaultCapabilityRegistry } from "../../packages/capability-registry/src/index.js";

function tempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

test("capabilities carry an authoritative permission model", () => {
  const registry = createDefaultCapabilityRegistry({});
  const setEnv = registry.get("environment.user.set");
  assert.ok(setEnv.permissionModel, "permission model is present");
  assert.ok(Array.isArray(setEnv.permissionModel.scope) && setEnv.permissionModel.scope.length > 0);
  // A mutating registry write is USER-scoped, WRITE type, single-use.
  assert.equal(setEnv.permissionModel.type, "WRITE");
  assert.equal(setEnv.permissionModel.reusePolicy, "SINGLE_USE");
  assert.ok(setEnv.permissionModel.scope.includes("USER"));
  assert.ok(setEnv.permissionModel.approvalLifetimeMs > 0);

  const inspect = registry.get("system.inspect");
  // Read-only inspection is session-reusable.
  assert.equal(inspect.permissionModel.type, "READ");
});

test("evaluateCapability denies by default when no grant exists", async () => {
  const root = await tempDir("syscora-perm-deny-");
  try {
    const grantStore = new CapabilityGrantStore(path.join(root, "grants"));
    const auditRepository = new AuditRepository(path.join(root, "audit"));
    const broker = new PermissionBroker({ capabilityGrantStore: grantStore, auditRepository });
    const registry = createDefaultCapabilityRegistry({});
    const capability = registry.get("environment.user.set");

    const decision = await broker.evaluateCapability({
      capability,
      approved: true,
      sessionId: "session_no_grant"
    });
    assert.equal(decision.approved, false, "no grant means denied even when policy approved");

    const events = await auditRepository.readAll();
    assert.ok(events.some((e) => e.eventType === "CAPABILITY_GRANT_DENIED"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("issued grant authorizes exactly its capability and is single-use when required", async () => {
  const root = await tempDir("syscora-perm-grant-");
  try {
    const grantStore = new CapabilityGrantStore(path.join(root, "grants"));
    const auditRepository = new AuditRepository(path.join(root, "audit"));
    const broker = new PermissionBroker({ capabilityGrantStore: grantStore, auditRepository });
    const registry = createDefaultCapabilityRegistry({});
    const capability = registry.get("environment.user.set");
    const sessionId = "session_grant";

    await broker.grantPlanCapabilities({ sessionId, capabilities: [capability] });

    // First use succeeds.
    const first = await broker.evaluateCapability({ capability, approved: true, sessionId });
    assert.equal(first.approved, true);

    // Single-use grant is now consumed; a second use is denied.
    const second = await broker.evaluateCapability({ capability, approved: true, sessionId });
    assert.equal(second.approved, false, "single-use grant cannot be reused");

    // A different capability the session never got a grant for is denied.
    const other = registry.get("package.winget.install");
    const otherDecision = await broker.evaluateCapability({ capability: other, approved: true, sessionId });
    assert.equal(otherDecision.approved, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("revocation immediately denies a previously-granted capability", async () => {
  const root = await tempDir("syscora-perm-revoke-");
  try {
    const grantStore = new CapabilityGrantStore(path.join(root, "grants"));
    const broker = new PermissionBroker({ capabilityGrantStore: grantStore });
    const registry = createDefaultCapabilityRegistry({});
    const capability = registry.get("system.inspect"); // read-only, session-reusable
    const sessionId = "session_revoke";

    await broker.grantPlanCapabilities({ sessionId, capabilities: [capability] });
    const before = await broker.evaluateCapability({ capability, approved: true, sessionId });
    assert.equal(before.approved, true);

    await broker.revokeSessionCapabilities(sessionId);
    const after = await broker.evaluateCapability({ capability, approved: true, sessionId });
    assert.equal(after.approved, false, "revoked grant is denied");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
