// Privileged convergence integration tests.
//
// These prove that privileged operations (service.restart, package.install) have
// NO separate execution route: they flow through the exact same canonical runtime
// pipeline as every other capability — intent -> plan -> risk -> policy ->
// permission (grant) -> schedule -> execute (token-gated helper) -> observe ->
// verify -> audit. The privileged helper is wired in-process (no subprocess), and
// the single-use approval token is the authoritative enforcement: without a valid
// token the capability refuses to act, even though the session was approved.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";

import { AgentRuntime } from "../../packages/agent-runtime/src/index.js";
import { createDefaultCapabilityRegistry } from "../../packages/capability-registry/src/index.js";
import { SessionStore } from "../../packages/agent-runtime/src/session-store.js";
import { AuditRepository } from "../../packages/audit/src/index.js";
import { RiskEngine } from "../../packages/risk-engine/src/index.js";
import { PolicyEngine } from "../../packages/policy-engine/src/index.js";
import { PermissionBroker } from "../../packages/permission-broker/src/index.js";
import { ApprovalTokenStore } from "../../packages/permission-broker/src/approval-token-store.js";
import { CapabilityGrantStore } from "../../packages/permission-broker/src/capability-grant-store.js";
import { PrivilegedOperationHelper } from "../../packages/privileged-helpers/src/index.js";
import { RecoveryEngine } from "../../packages/recovery-engine/src/index.js";
import { TroubleshootingEngine } from "../../packages/troubleshooting-engine/src/index.js";
import { Memory } from "../../packages/memory/src/index.js";
import { SemanticState } from "../../packages/semantic-state/src/index.js";
import { IntentEngine } from "../../packages/intent-engine/src/index.js";
import { ContextEngine } from "../../packages/context-engine/src/index.js";
import { MockModelProvider } from "../../packages/model-providers/src/index.js";

// A minimal adapter whose privileged surface is deterministic: the target
// service always "exists" so VALIDATE mode reports eligibility without touching
// the real machine.
const stubAdapter = {
  async serviceExists() { return { exists: true }; },
  async wingetList() { return { exitCode: 0, stdout: "" }; }
};

async function buildPrivilegedRuntime() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "syscora-priv-conv-"));
  const stateRoot = path.join(tempRoot, ".syscora");
  const auditRepository = new AuditRepository(path.join(stateRoot, "audit"));
  const approvalTokenStore = new ApprovalTokenStore(path.join(stateRoot, "permission-broker"));
  const capabilityGrantStore = new CapabilityGrantStore(path.join(stateRoot, "grants"));
  const permissionBroker = new PermissionBroker({
    approvalTokenStore,
    auditRepository,
    capabilityGrantStore
  });
  const privilegedHelper = new PrivilegedOperationHelper({ permissionBroker, adapter: stubAdapter });
  const capabilityRegistry = createDefaultCapabilityRegistry(stubAdapter, { privilegedHelper });

  const modelProvider = new MockModelProvider();
  const runtime = new AgentRuntime({
    sessionStore: new SessionStore(path.join(tempRoot, "sessions")),
    auditRepository,
    capabilityRegistry,
    riskEngine: new RiskEngine(),
    policyEngine: new PolicyEngine(),
    permissionBroker,
    recoveryEngine: new RecoveryEngine(),
    troubleshootingEngine: new TroubleshootingEngine(),
    adapter: stubAdapter,
    modelProvider,
    intentEngine: new IntentEngine(modelProvider),
    contextEngine: new ContextEngine([]),
    semanticState: new SemanticState(path.join(tempRoot, "semantic.sqlite")),
    memory: new Memory(path.join(tempRoot, "memory.sqlite"))
  });

  return { runtime, permissionBroker, auditRepository, tempRoot };
}

function submitPrivileged(runtime, { operation, scope, token, mode = "VALIDATE", sessionId = "priv_conv" }) {
  return runtime.submitIntent(`Privileged operation ${operation} on ${scope}`, {
    operation,
    category: "SYSTEM",
    normalizedGoal: `Privileged ${operation}`,
    entities: { scope, token, mode, sessionId },
    autoApprove: true
  });
}

describe("privileged convergence", () => {
  it("registers privileged capabilities as available only when a helper is wired", () => {
    const withHelper = createDefaultCapabilityRegistry(stubAdapter, {
      privilegedHelper: new PrivilegedOperationHelper({ adapter: stubAdapter })
    });
    assert.equal(withHelper.isAvailable("service.restart", { platform: "win32" }), true);
    assert.equal(withHelper.isAvailable("package.install", { platform: "win32" }), true);

    // Without a helper the capabilities still register (so the contract is
    // discoverable) but are UNAVAILABLE, so the planner/validator never select
    // an executable privileged surface in a lightweight runtime.
    const withoutHelper = createDefaultCapabilityRegistry(stubAdapter);
    assert.equal(withoutHelper.has("service.restart"), true);
    assert.equal(withoutHelper.isAvailable("service.restart", { platform: "win32" }), false);
    assert.equal(withoutHelper.isAvailable("package.install", { platform: "win32" }), false);
  });

  it("runs a privileged operation through the single canonical pipeline with a valid token", async () => {
    const { runtime, permissionBroker, auditRepository, tempRoot } = await buildPrivilegedRuntime();
    try {
      const approval = await permissionBroker.issuePrivilegeToken({
        sessionId: "priv_conv",
        operation: "service.restart",
        scope: "demo-service",
        approved: true
      });
      assert.equal(approval.approved, true);

      const session = await submitPrivileged(runtime, {
        operation: "service.restart",
        scope: "demo-service",
        token: approval.token
      });

      // The operation flowed through the canonical pipeline: plan -> policy ->
      // capability grant -> execute. These events are emitted by the runtime, not
      // by any privileged-specific route.
      const types = session.events.map((e) => e.eventType);
      assert.ok(types.includes("PLAN_GENERATED"), "expected PLAN_GENERATED");
      assert.ok(types.includes("POLICY_DECIDED"), "expected POLICY_DECIDED");

      // The plan mapped the operation 1:1 to the privileged capability.
      const capabilities = session.plan.taskGraph.tasks.map((t) => t.capability);
      assert.deepEqual(capabilities, ["service.restart"]);

      // A capability grant was issued for the plan and the single-use token was
      // consumed inside the pipeline (not by a separate execute endpoint). The
      // audit trail records the grant, plus token issuance and consumption.
      const audit = await auditRepository.readAll();
      const auditTypes = audit.map((e) => e.eventType);
      assert.ok(auditTypes.includes("CAPABILITY_GRANT_ISSUED"), "expected CAPABILITY_GRANT_ISSUED");
      assert.ok(auditTypes.includes("PRIVILEGED_TOKEN_ISSUED"), "expected token issuance");
      assert.ok(auditTypes.includes("PRIVILEGED_TOKEN_CONSUMED"), "expected token consumption");

      // The capability ran in the safe default (VALIDATE) mode — an approved
      // token alone never mutates.
      const result = session.taskResults[0]?.executionResult;
      assert.equal(result.operation, "service.restart");
      assert.equal(result.mode, "VALIDATE");
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("refuses a privileged operation inside the runtime when the token is missing or invalid", async () => {
    const { runtime, auditRepository, tempRoot } = await buildPrivilegedRuntime();
    try {
      // No token issued: the session is approved by policy (autoApprove) and a
      // grant is issued, but the capability's execute() consumes an invalid token
      // through the broker and refuses to act. Enforcement lives in the canonical
      // path, not in a separate gate.
      const session = await submitPrivileged(runtime, {
        operation: "service.restart",
        scope: "demo-service",
        token: "not-a-real-token"
      });

      const result = session.taskResults[0]?.executionResult;
      assert.equal(result.success, false);
      assert.equal(result.requiresApproval, true);

      // Verification reflects the refusal, and the audit trail records a rejected
      // token consumption rather than a mutation.
      const audit = await auditRepository.readAll();
      const auditTypes = audit.map((e) => e.eventType);
      assert.ok(auditTypes.includes("PRIVILEGED_TOKEN_REJECTED"), "expected token rejection");
      assert.ok(!auditTypes.includes("PRIVILEGED_TOKEN_CONSUMED"), "no token should be consumed");
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("binds the token to the operation and scope it was issued for", async () => {
    const { runtime, permissionBroker, tempRoot } = await buildPrivilegedRuntime();
    try {
      // Token issued for a DIFFERENT scope than the one executed.
      const approval = await permissionBroker.issuePrivilegeToken({
        sessionId: "priv_conv",
        operation: "service.restart",
        scope: "some-other-service",
        approved: true
      });
      assert.equal(approval.approved, true);

      const session = await submitPrivileged(runtime, {
        operation: "service.restart",
        scope: "demo-service",
        token: approval.token
      });

      const result = session.taskResults[0]?.executionResult;
      assert.equal(result.success, false);
      assert.equal(result.requiresApproval, true);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
});
