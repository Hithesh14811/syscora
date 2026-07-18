import test from "node:test";
import assert from "node:assert/strict";
import { CapabilityRegistry, createDefaultCapabilityRegistry } from "../../packages/capability-registry/src/index.js";
import { RollbackManager } from "../../packages/agent-runtime/src/rollback-manager.js";
import { GeneralPlanner, PlanValidator } from "../../packages/planner/src/index.js";
import { WorkspaceContextProvider } from "../../packages/context-engine/src/index.js";
import { OpenAIModelProvider } from "../../packages/model-providers/src/index.js";

function rollbackCapability(name, calls) {
  return {
    name,
    reversibility: "ROLLBACK_SUPPORTED",
    createCheckpoint: async () => ({ before: name }),
    rollback: async () => { calls.push(name); }
  };
}

test("capability registry rejects duplicate canonical registrations", () => {
  const registry = new CapabilityRegistry();
  const cap = { name: "unique.capability", reversibility: "NOT_REQUIRED" };
  registry.register(cap);
  assert.throws(() => registry.register(cap), /Duplicate capability registration/);
});

test("rollback manager restores dependents before their dependencies", async () => {
  const calls = [];
  const registry = new CapabilityRegistry([
    rollbackCapability("change.a", calls),
    rollbackCapability("change.b", calls)
  ]);
  const manager = new RollbackManager(registry);
  const a = await manager.capture({ taskId: "a", capability: "change.a", inputs: {}, dependencies: [] });
  const b = await manager.capture({ taskId: "b", capability: "change.b", inputs: {}, dependencies: ["a"] });
  const result = await manager.rollback([a, b]);
  assert.equal(result.rolledBack, true);
  assert.deepEqual(calls, ["change.b", "change.a"]);
});

test("operation planner emits a validator-accepted WinGet install graph", async () => {
  const registry = createDefaultCapabilityRegistry({});
  const planner = new GeneralPlanner(null, registry);
  const plan = await planner.generatePlan({
    operation: "package.winget.install",
    normalizedGoal: "Install package",
    entities: { id: "Contoso.App" },
    successCriteria: ["installed"]
  }, []);
  assert.equal(plan.taskGraph.tasks[0].timeout, 600000);
  assert.deepEqual(new PlanValidator(registry).validatePlan(plan.taskGraph), { valid: true, errors: [] });
});

test("workspace context awaits the developer intelligence contract", async () => {
  const provider = new WorkspaceContextProvider({}, {
    async inspectProject(workspacePath) { return { workspacePath, projectType: "node" }; }
  });
  const context = await provider.collect({ workspacePath: "C:\\workspace" });
  assert.deepEqual(context.data.inspection, { workspacePath: "C:\\workspace", projectType: "node" });
});

test("OpenAI retries with a fresh AbortController per attempt", async () => {
  const originalFetch = globalThis.fetch;
  const signals = [];
  let attempts = 0;
  globalThis.fetch = async (_url, options) => {
    signals.push(options.signal);
    attempts += 1;
    if (attempts === 1) return new Response("unavailable", { status: 503 });
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }], usage: {} }), { status: 200 });
  };
  try {
    const provider = new OpenAIModelProvider({ apiKey: "test-key" });
    const result = await provider.generateStructured("test", { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] }, { maxRetries: 2 });
    assert.deepEqual(result, { ok: true });
    assert.equal(signals.length, 2);
    assert.notEqual(signals[0], signals[1]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
