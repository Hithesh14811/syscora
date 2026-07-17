import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import {
  createDefaultCapabilityRegistry,
} from "../../packages/capability-registry/src/index.js";
import { WindowsAdapter } from "../../os-adapters/windows/src/windows-adapter.js";
import { AgentRuntime } from "../../packages/agent-runtime/src/index.js";
import { Memory } from "../../packages/memory/src/index.js";
import { SemanticState } from "../../packages/semantic-state/src/index.js";
import { IntentEngine } from "../../packages/intent-engine/src/index.js";
import { ContextEngine, SystemContextProvider } from "../../packages/context-engine/src/index.js";
import { GeneralPlanner, PlanValidator } from "../../packages/planner/src/index.js";
import { MockModelProvider } from "../../packages/model-providers/src/index.js";
import { SessionStore } from "../../packages/agent-runtime/src/session-store.js";
import { AuditRepository } from "../../packages/audit/src/index.js";
import { RiskEngine } from "../../packages/risk-engine/src/index.js";
import { PolicyEngine } from "../../packages/policy-engine/src/index.js";
import { PermissionBroker } from "../../packages/permission-broker/src/index.js";

describe("TaskGraphScheduler Integration Tests", () => {
  let tempRoot;
  let agentRuntime;

  before(async () => {
    tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "syscora-test-"));
    const sessionsDir = path.join(tempRoot, "sessions");
    const auditDir = path.join(tempRoot, "audit");
    const memoryDir = path.join(tempRoot, "memory");
    const semanticDir = path.join(tempRoot, "semantic");
    const windowsAdapter = new WindowsAdapter();
    const sessionStore = new SessionStore(sessionsDir);
    const auditRepository = new AuditRepository(auditDir);
    const capabilityRegistry = createDefaultCapabilityRegistry(windowsAdapter);
    const modelProvider = new MockModelProvider();

    agentRuntime = new AgentRuntime({
      sessionStore,
      auditRepository,
      capabilityRegistry,
      riskEngine: new RiskEngine(),
      policyEngine: new PolicyEngine(),
      permissionBroker: new PermissionBroker(),
      executionEngine: null,
      recoveryEngine: null,
      troubleshootingEngine: null,
      observationEngine: null,
      verificationEngine: null,
      adapter: windowsAdapter,
      modelProvider,
      intentEngine: new IntentEngine(modelProvider),
      contextEngine: new ContextEngine([new SystemContextProvider(windowsAdapter)]),
      semanticState: new SemanticState(path.join(semanticDir, "semantic.sqlite")),
      memory: new Memory(path.join(memoryDir, "memory.sqlite")),
    });
  });

  it("should create an AgentRuntime instance", () => {
    assert.ok(agentRuntime);
  });

  it("should execute system inspect intent", async () => {
    const result = await agentRuntime.submitIntent("inspect system", { autoApprove: true });
    assert.equal(result.currentState, "COMPLETED");
  });

  // Convergence guarantees: every workflow runs through the single canonical
  // pipeline (submitIntent -> planner -> capability task graph -> scheduler).
  it("routes the project-env wrapper through a canonical capability plan", async () => {
    const workspace = await fs.promises.mkdtemp(path.join(tempRoot, "ws-"));
    const session = await agentRuntime.runSetProjectEnvVariable(
      {
        rawText: "Set API_KEY for the current project",
        entities: { workspacePath: workspace, key: "API_KEY", value: "abc123" }
      },
      { autoApprove: true }
    );

    // The plan is a canonical task graph whose tasks name capabilities.
    assert.ok(session.plan?.taskGraph?.tasks?.length > 0);
    for (const task of session.plan.taskGraph.tasks) {
      assert.equal(typeof task.capability, "string");
      assert.ok(agentRuntime.capabilityRegistry.has(task.capability));
    }
    // Execution flowed through the scheduler: canonical events are present.
    const eventTypes = session.events.map((e) => e.eventType);
    assert.ok(eventTypes.includes("TASK_EXECUTED"));
    assert.ok(eventTypes.includes("VERIFICATION_COMPLETED"));
    assert.equal(session.currentState, "COMPLETED");

    // The mutating capability actually wrote the .env file.
    const envContents = await fs.promises.readFile(path.join(workspace, ".env"), "utf8");
    assert.ok(envContents.includes("API_KEY=abc123"));
  });

  it("routes the read-only port wrapper through the pipeline and returns a summary", async () => {
    const summary = await agentRuntime.inspectPortIntent({
      rawText: "What is using port 3000?",
      entities: { workspacePath: tempRoot, value: 3000 }
    });
    // Wrapper returns the capability's execution result (port summary shape).
    assert.equal(typeof summary, "object");
    assert.equal(summary.port, 3000);
  });
});
