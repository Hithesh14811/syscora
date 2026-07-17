import test from "node:test";
import assert from "node:assert/strict";
import {
  CapabilityRegistry,
  createDefaultCapabilityRegistry,
  LifecycleStatus
} from "../../packages/capability-registry/src/index.js";
import { WindowsAdapter } from "../../os-adapters/windows/src/windows-adapter.js";

test("CapabilityRegistry - lifecycle status defaults to UNAVAILABLE", async () => {
  const registry = new CapabilityRegistry();

  const testCapability = {
    name: "test.capability",
    version: "1.0.0",
    description: "Test",
    inputSchema: {},
    riskMetadata: { level: "LOW" },
    reversibility: "NOT_REQUIRED",
    preconditions: () => true,
    execute: async () => {},
    observe: async () => {},
    verify: async () => ({ status: "VERIFIED" }),
    rollback: null,
    timeout: 1000,
    retryPolicy: { maxAttempts: 1 }
  };

  registry.register(testCapability);

  const all = registry.list();
  assert.equal(all.length, 1);
  assert.equal(all[0].lifecycleStatus, LifecycleStatus.UNAVAILABLE);
});

test("CapabilityRegistry - getAvailable includes IMPLEMENTED and VERIFIED", async () => {
  const registry = new CapabilityRegistry();

  const verifiedCap = {
    name: "verified.capability",
    version: "1.0.0",
    description: "Test",
    inputSchema: {},
    riskMetadata: { level: "LOW" },
    reversibility: "NOT_REQUIRED",
    preconditions: () => true,
    execute: async () => {},
    observe: async () => {},
    verify: async () => ({ status: "VERIFIED" }),
    rollback: null,
    timeout: 1000,
    retryPolicy: { maxAttempts: 1 },
    lifecycleStatus: LifecycleStatus.VERIFIED
  };

  const implementedCap = {
    name: "implemented.capability",
    version: "1.0.0",
    description: "Test",
    inputSchema: {},
    riskMetadata: { level: "LOW" },
    reversibility: "NOT_REQUIRED",
    preconditions: () => true,
    execute: async () => {},
    observe: async () => {},
    verify: async () => ({ status: "VERIFIED" }),
    rollback: null,
    timeout: 1000,
    retryPolicy: { maxAttempts: 1 },
    lifecycleStatus: LifecycleStatus.IMPLEMENTED
  };

  const unavailableCap = {
    name: "unavailable.capability",
    version: "1.0.0",
    description: "Test",
    inputSchema: {},
    riskMetadata: { level: "LOW" },
    reversibility: "NOT_REQUIRED",
    preconditions: () => true,
    execute: async () => {},
    observe: async () => {},
    verify: async () => ({ status: "VERIFIED" }),
    rollback: null,
    timeout: 1000,
    retryPolicy: { maxAttempts: 1 },
    lifecycleStatus: LifecycleStatus.UNAVAILABLE
  };

  registry.register(verifiedCap);
  registry.register(implementedCap);
  registry.register(unavailableCap);

  const available = registry.getAvailable();
  assert.equal(available.length, 2);
  assert(available.some((c) => c.name === "verified.capability"));
  assert(available.some((c) => c.name === "implemented.capability"));
  assert(!available.some((c) => c.name === "unavailable.capability"));
});

test("createDefaultCapabilityRegistry - marks real capabilities as VERIFIED", async () => {
  const adapter = new WindowsAdapter();
  const registry = createDefaultCapabilityRegistry(adapter);

  const available = registry.getAvailable();
  assert(available.length > 0);

  // Check some known working capabilities
  const systemInspect = available.find((c) => c.name === "system.inspect");
  assert(systemInspect);
  assert.equal(systemInspect.lifecycleStatus, LifecycleStatus.VERIFIED);

  const processesList = available.find((c) => c.name === "processes.list");
  assert(processesList);
  assert.equal(processesList.lifecycleStatus, LifecycleStatus.VERIFIED);

  const filesystemRead = available.find((c) => c.name === "filesystem.read");
  assert(filesystemRead);
  assert.equal(filesystemRead.lifecycleStatus, LifecycleStatus.VERIFIED);
});
