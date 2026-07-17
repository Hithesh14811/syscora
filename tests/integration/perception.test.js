// Windows Perception Layer — deterministic tests.
//
// These exercise the perception subsystem end-to-end against a real (temp)
// SemanticState and a fake, read-only adapter that returns fixtures. No live
// system access, no cloud models. They prove: provider normalization, entity
// reconciliation (no duplicates), relationship creation, observation ingestion,
// snapshots + diffing, action-effect recording, relevance queries and context
// budgeting.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { SemanticState } from "../../packages/semantic-state/src/index.js";
import { PerceptionEngine, PerceptionEvent } from "../../packages/perception/src/index.js";
import {
  SystemProvider,
  ProcessProvider,
  ServiceProvider,
  EnvironmentProvider,
  DeveloperProvider
} from "../../packages/perception/src/providers.js";
import { EntityType, RelationshipType, canonicalKey } from "../../packages/perception/src/entities.js";

// ---------------------------------------------------------------------------
// Fixtures + fake adapter (read-only).
// ---------------------------------------------------------------------------

const SYSTEM_FIXTURE = {
  platform: "win32",
  release: "10.0.26200",
  hostname: "TEST-PC",
  username: "tester",
  architecture: "AMD64",
  totalMemory: 34359738368,
  freeMemory: 8000000000,
  cpus: 16,
  windowsDetails: { caption: "Windows 11", version: "10.0.26200", build: "26200", cpuName: "Test CPU", cpuCores: 8, cpuLogical: 16 }
};

function makeAdapter(overrides = {}) {
  return {
    async getSystemInformation() { return overrides.system ?? SYSTEM_FIXTURE; },
    async listProcesses() { return overrides.processes ?? []; },
    async listServices() { return overrides.services ?? []; },
    async getUserPath() { return overrides.userPath ?? { scope: "User", value: "" }; },
    async verifyDirectoryExists(dir) { return { exists: true, directoryPath: dir }; },
    ...overrides.extra
  };
}

async function buildEngine(adapterOverrides = {}, developerIntelligence = null) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "syscora-perception-"));
  const semanticState = new SemanticState(dir);
  const adapter = makeAdapter(adapterOverrides);
  const events = [];
  const engine = PerceptionEngine.withDefaultProviders({
    semanticState,
    adapter,
    developerIntelligence,
    onEvent: (e) => events.push(e)
  });
  return { engine, semanticState, events, dir };
}

// ---------------------------------------------------------------------------
// Provider normalization (pure, fixture-driven).
// ---------------------------------------------------------------------------

test("SystemProvider normalizes computer/os/cpu/memory/user with relationships", () => {
  const p = new SystemProvider(makeAdapter());
  const { entities, relationships } = p.normalize(SYSTEM_FIXTURE, { now: "2026-07-16T00:00:00Z" });
  const types = entities.map((e) => e.type);
  assert.ok(types.includes(EntityType.Computer));
  assert.ok(types.includes(EntityType.OperatingSystem));
  assert.ok(types.includes(EntityType.CPU));
  assert.ok(types.includes(EntityType.Memory));
  assert.ok(types.includes(EntityType.User));
  // Computer RUNS OperatingSystem
  assert.ok(relationships.some((r) => r.type === RelationshipType.RUNS));
  // deterministic id
  assert.equal(entities.find((e) => e.type === EntityType.Computer).id, canonicalKey(EntityType.Computer, ["TEST-PC"]));
});

test("ProcessProvider reuses one Executable across PID churn (reconciliation)", () => {
  const p = new ProcessProvider(makeAdapter());
  const first = p.normalize([{ Id: 100, ProcessName: "node", Path: "C:\\Program Files\\node\\node.exe" }], { now: "t1" });
  const second = p.normalize([{ Id: 200, ProcessName: "node", Path: "C:\\Program Files\\node\\node.exe" }], { now: "t2" });
  const exe1 = first.entities.find((e) => e.type === EntityType.Executable);
  const exe2 = second.entities.find((e) => e.type === EntityType.Executable);
  assert.equal(exe1.id, exe2.id, "same executable path -> same Executable id");
  const proc1 = first.entities.find((e) => e.type === EntityType.Process);
  const proc2 = second.entities.find((e) => e.type === EntityType.Process);
  assert.notEqual(proc1.id, proc2.id, "different PID -> different Process id");
});

test("EnvironmentProvider splits PATH into stable PathEntry entities", () => {
  const p = new EnvironmentProvider(makeAdapter());
  const raw = { userPath: { scope: "User", value: "C:\\a;C:\\b\\;C:\\a" } };
  const a = p.normalize(raw, { now: "t1" });
  const b = p.normalize(raw, { now: "t2" });
  const pathEntriesA = a.entities.filter((e) => e.type === EntityType.PathEntry).map((e) => e.id).sort();
  const pathEntriesB = b.entities.filter((e) => e.type === EntityType.PathEntry).map((e) => e.id).sort();
  assert.deepEqual(pathEntriesA, pathEntriesB, "same PATH -> same PathEntry ids across scans");
});

// ---------------------------------------------------------------------------
// Engine: perceive + reconciliation (no duplicates).
// ---------------------------------------------------------------------------

test("perceive populates semantic state and does not duplicate on re-scan", async () => {
  const { engine, semanticState } = await buildEngine({
    processes: [{ Id: 1, ProcessName: "node", Path: "C:\\node.exe" }],
    userPath: { scope: "User", value: "C:\\tools;C:\\bin" }
  });

  await engine.perceive();
  const computers1 = await semanticState.queryEntities({ type: EntityType.Computer });
  const paths1 = await semanticState.queryEntities({ type: EntityType.PathEntry });
  assert.equal(computers1.length, 1);
  assert.equal(paths1.length, 2);

  // Re-perceive the identical world -> counts stay the same (reconciled).
  await engine.perceive();
  const computers2 = await semanticState.queryEntities({ type: EntityType.Computer });
  const paths2 = await semanticState.queryEntities({ type: EntityType.PathEntry });
  assert.equal(computers2.length, 1, "no duplicate Computer");
  assert.equal(paths2.length, 2, "no duplicate PathEntry entities");

  await semanticState.close();
});

test("perceive emits ENTITY_CREATED first, ENTITY_UPDATED on re-scan", async () => {
  const { engine, events } = await buildEngine();
  await engine.perceive();
  const created = events.filter((e) => e.type === PerceptionEvent.ENTITY_CREATED).length;
  assert.ok(created > 0, "first scan creates entities");
  events.length = 0;
  await engine.perceive();
  const updated = events.filter((e) => e.type === PerceptionEvent.ENTITY_UPDATED).length;
  const createdAgain = events.filter((e) => e.type === PerceptionEvent.ENTITY_CREATED).length;
  assert.ok(updated > 0, "second scan updates entities");
  assert.equal(createdAgain, 0, "no new entities created on identical re-scan");
});

test("relationships are created between entities", async () => {
  const { engine, semanticState } = await buildEngine();
  await engine.perceive();
  const computerId = canonicalKey(EntityType.Computer, ["TEST-PC"]);
  const rels = await semanticState.queryRelationships({ sourceEntityId: computerId });
  assert.ok(rels.some((r) => r.type === RelationshipType.RUNS), "Computer RUNS OperatingSystem");
  assert.ok(rels.some((r) => r.type === RelationshipType.CONTAINS), "Computer CONTAINS CPU/Memory");
  await semanticState.close();
});

// ---------------------------------------------------------------------------
// Observation ingestion through perception.
// ---------------------------------------------------------------------------

test("ingestObservation records an EnvironmentVariable entity", async () => {
  const { engine, semanticState } = await buildEngine();
  await engine.ingestObservation({
    type: "environment_variable",
    environmentVariable: { key: "API_URL", value: "http://localhost", scope: "user" }
  });
  const vars = await semanticState.queryEntities({ type: EntityType.EnvironmentVariable });
  assert.equal(vars.length, 1);
  assert.equal(vars[0].properties.key, "API_URL");
  // Re-ingesting the same variable does not duplicate.
  await engine.ingestObservation({
    type: "environment_variable",
    environmentVariable: { key: "API_URL", value: "http://localhost:4000", scope: "user" }
  });
  const vars2 = await semanticState.queryEntities({ type: EntityType.EnvironmentVariable });
  assert.equal(vars2.length, 1, "same var reconciled, not duplicated");
  assert.equal(vars2[0].properties.value, "http://localhost:4000", "value updated");
  await semanticState.close();
});

// ---------------------------------------------------------------------------
// Snapshots + diffing + action effects.
// ---------------------------------------------------------------------------

test("snapshot + diff detects added and changed entities", async () => {
  const { engine, semanticState } = await buildEngine({
    userPath: { scope: "User", value: "C:\\a" }
  });
  await engine.perceive();
  const before = await engine.snapshot("before");

  // A new env var appears.
  await engine.ingestObservation({
    type: "environment_variable",
    environmentVariable: { key: "NEW_VAR", value: "1", scope: "user" }
  });
  const after = await engine.snapshot("after");

  const delta = engine.diff(before, after);
  const newVarId = canonicalKey(EntityType.EnvironmentVariable, ["user", "NEW_VAR"]);
  assert.ok(delta.addedEntities.includes(newVarId), "diff detects the new env var");
  assert.equal(delta.removedEntities.length, 0);
  await semanticState.close();
});

test("recordActionEffect persists a diff-based effect and emits event", async () => {
  const { engine, semanticState, events } = await buildEngine();
  const before = await engine.snapshot("pre");
  await engine.ingestObservation({
    type: "environment_variable",
    environmentVariable: { key: "EFFECT_VAR", value: "x", scope: "user" }
  });
  const after = await engine.snapshot("post");
  const delta = await engine.recordActionEffect("task-1", before, after);
  assert.ok(delta.addedEntities.length >= 1);
  assert.ok(events.some((e) => e.type === PerceptionEvent.ACTION_EFFECT_RECORDED));
  await semanticState.close();
});

// ---------------------------------------------------------------------------
// Relevance queries + context budgeting.
// ---------------------------------------------------------------------------

test("getRelevantSubgraph returns only relevant entities within budget", async () => {
  const { engine, semanticState } = await buildEngine({
    processes: Array.from({ length: 20 }, (_, i) => ({ Id: i, ProcessName: `proc${i}`, Path: `C:\\p${i}.exe` })),
    userPath: { scope: "User", value: "C:\\python311;C:\\tools" }
  });
  await engine.perceive();
  // Add a python-flavored env var so the query has something to match.
  await engine.ingestObservation({
    type: "environment_variable",
    environmentVariable: { key: "PYTHON_HOME", value: "C:\\python311", scope: "user" }
  });

  const subgraph = await engine.getRelevantSubgraph(
    { rawText: "set up python", normalizedGoal: "python environment", category: "ENVIRONMENT", entities: {} },
    { budget: 5 }
  );
  assert.ok(subgraph.entities.length <= 5, "respects budget");
  assert.ok(subgraph.totalEntities > 5, "graph is larger than the budgeted subgraph");
  // Python-related entity should be surfaced.
  const surfaced = subgraph.entities.map((e) => `${e.canonicalKey} ${JSON.stringify(e.properties)}`.toLowerCase()).join(" ");
  assert.ok(surfaced.includes("python"), "python-related entity surfaced by relevance");
  await semanticState.close();
});

test("getRelevantSubgraph falls back to important types on a generic intent", async () => {
  const { engine, semanticState } = await buildEngine({
    userPath: { scope: "User", value: "C:\\a;C:\\b" }
  });
  await engine.perceive();
  const subgraph = await engine.getRelevantSubgraph({ rawText: "", category: "", entities: {} }, { budget: 3 });
  assert.ok(subgraph.entities.length > 0, "still returns orienting context");
  assert.ok(subgraph.entities.length <= 3);
  await semanticState.close();
});

// ---------------------------------------------------------------------------
// Developer perception (project/runtime/package manager).
// ---------------------------------------------------------------------------

test("DeveloperProvider maps a node project to Project/Runtime/PackageManager", () => {
  const p = new DeveloperProvider(makeAdapter(), {
    async detectProject() {
      return { workspacePath: "C:\\repo", projectType: "node", packageManager: "npm", startScript: "start", installRequired: false };
    }
  });
  return p.perceive({ workspacePath: "C:\\repo" }).then(({ entities, relationships }) => {
    const types = entities.map((e) => e.type);
    assert.ok(types.includes(EntityType.Workspace));
    assert.ok(types.includes(EntityType.Project));
    assert.ok(types.includes(EntityType.Runtime));
    assert.ok(types.includes(EntityType.PackageManager));
    assert.ok(relationships.some((r) => r.type === RelationshipType.USES));
  });
});
