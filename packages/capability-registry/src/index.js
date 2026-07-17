import { RiskLevel } from "../../shared-types/src/domain.js";
import crypto from "crypto";
const createId = () => crypto.randomBytes(16).toString("hex");

export const LifecycleStatus = {
  IMPLEMENTED: "IMPLEMENTED",
  VERIFIED: "VERIFIED",
  EXPERIMENTAL: "EXPERIMENTAL",
  UNAVAILABLE: "UNAVAILABLE"
};

export class CapabilityRegistry {
  constructor(capabilities = []) {
    this.capabilities = new Map(capabilities.map((capability) => [capability.name, capability]));
  }

  register(capability) {
    // Default to UNAVAILABLE if no status provided
    if (!capability.lifecycleStatus) {
      capability.lifecycleStatus = LifecycleStatus.UNAVAILABLE;
    }
    this.capabilities.set(capability.name, capability);
  }

  get(name) {
    return this.capabilities.get(name);
  }

  has(name) {
    return this.capabilities.has(name);
  }

  list() {
    return [...this.capabilities.values()];
  }

  getAvailable() {
    return this.list().filter(
      (cap) => cap.lifecycleStatus === LifecycleStatus.IMPLEMENTED || cap.lifecycleStatus === LifecycleStatus.VERIFIED
    );
  }

  getCatalog() {
    return this.getAvailable().map(cap => ({
      name: cap.name,
      version: cap.version,
      description: cap.description,
      inputSchema: cap.inputSchema,
      riskProfile: cap.riskProfile,
      permissions: cap.permissions,
      reversibility: cap.reversibility,
      lifecycleStatus: cap.lifecycleStatus
    }));
  }
}

export function createDefaultCapabilityRegistry(adapter) {
  const registry = new CapabilityRegistry();

  // system.inspect
  registry.register({
    name: "system.inspect",
    version: "1.0.0",
    description: "Inspect Windows system state summary",
    inputSchema: {
      type: "object",
      properties: {},
      required: []
    },
    outputSchema: { type: "object" },
    requiredContext: [],
    riskMetadata: { level: RiskLevel.LOW },
    reversibility: "NOT_REQUIRED",
    preconditions: () => true,
    execute: async () => {
      return adapter.getSystemInformation();
    },
    observe: async (result) => ({
      observationId: createId(),
      source: "system.inspect",
      timestamp: new Date().toISOString(),
      structuredState: result,
      detectedChanges: [],
      confidence: 1,
      trustLevel: "SYSTEM_TRUSTED"
    }),
    verify: async (observation) => {
      return { 
        status: "VERIFIED", 
        message: "System summary retrieved",
        evidence: observation.structuredState,
        confidence: 1
      };
    },
    rollback: null,
    timeout: 10000,
    retryPolicy: { maxAttempts: 2, backoffMs: 1000 },
    lifecycleStatus: LifecycleStatus.VERIFIED
  });

  // processes.list
  registry.register({
    name: "processes.list",
    version: "1.0.0",
    description: "List running processes",
    inputSchema: {
      type: "object",
      properties: {},
      required: []
    },
    outputSchema: { type: "array" },
    requiredContext: [],
    riskMetadata: { level: RiskLevel.LOW },
    reversibility: "NOT_REQUIRED",
    preconditions: () => true,
    execute: async () => {
      return adapter.listProcesses();
    },
    observe: async (result) => ({
      observationId: createId(),
      source: "processes.list",
      timestamp: new Date().toISOString(),
      structuredState: result,
      detectedChanges: [],
      confidence: 1,
      trustLevel: "SYSTEM_TRUSTED"
    }),
    verify: async (observation) => {
      return { 
        status: "VERIFIED", 
        message: "Processes listed",
        evidence: observation.structuredState,
        confidence: 1
      };
    },
    rollback: null,
    timeout: 15000,
    retryPolicy: { maxAttempts: 1, backoffMs: 1000 },
    lifecycleStatus: LifecycleStatus.VERIFIED
  });

  // process.port.inspect
  registry.register({
    name: "process.port.inspect",
    version: "1.0.0",
    description: "Find which process is using a specific port",
    inputSchema: {
      type: "object",
      properties: { port: { type: "number" } },
      required: ["port"]
    },
    outputSchema: { type: "object" },
    requiredContext: [],
    riskMetadata: { level: RiskLevel.LOW },
    reversibility: "NOT_REQUIRED",
    preconditions: (args) => typeof args.port === "number",
    execute: async (args) => {
      return adapter.inspectPort(args.port);
    },
    observe: async (result, args) => ({
      observationId: createId(),
      source: "process.port.inspect",
      timestamp: new Date().toISOString(),
      structuredState: result,
      relatedActionId: args?.actionId,
      detectedChanges: [],
      confidence: 1,
      trustLevel: "SYSTEM_TRUSTED"
    }),
    verify: async (observation) => {
      return { 
        status: "VERIFIED", 
        message: "Port inspection complete",
        evidence: observation.structuredState,
        confidence: 1
      };
    },
    rollback: null,
    timeout: 10000,
    retryPolicy: { maxAttempts: 2, backoffMs: 500 },
    lifecycleStatus: LifecycleStatus.VERIFIED
  });

  // environment.user.inspect
  registry.register({
    name: "environment.user.inspect",
    version: "1.0.0",
    description: "Inspect user environment variables and PATH",
    inputSchema: {
      type: "object",
      properties: { key: { type: "string" } },
      required: []
    },
    outputSchema: { type: "object" },
    requiredContext: [],
    riskMetadata: { level: RiskLevel.LOW },
    reversibility: "NOT_REQUIRED",
    preconditions: () => true,
    execute: async (args) => {
      const pathData = await adapter.getUserPath();
      const envData = args.key ? await adapter.inspectUserEnvironmentVariable(args.key) : null;
      return {
        path: pathData,
        environment: envData
      };
    },
    observe: async (result, args) => ({
      observationId: createId(),
      source: "environment.user.inspect",
      timestamp: new Date().toISOString(),
      structuredState: result,
      relatedActionId: args?.actionId,
      detectedChanges: [],
      confidence: 1,
      trustLevel: "SYSTEM_TRUSTED"
    }),
    verify: async (observation) => {
      return {
        status: "VERIFIED",
        message: "User environment inspected",
        evidence: observation.structuredState,
        confidence: 1
      };
    },
    rollback: null,
    timeout: 10000,
    retryPolicy: { maxAttempts: 2, backoffMs: 500 },
    lifecycleStatus: LifecycleStatus.VERIFIED
  });

  // environment.project.inspect
  registry.register({
    name: "environment.project.inspect",
    version: "1.0.0",
    description: "Inspect project environment file",
    inputSchema: {
      type: "object",
      properties: { workspacePath: { type: "string" } },
      required: ["workspacePath"]
    },
    outputSchema: { type: "object" },
    requiredContext: [],
    riskMetadata: { level: RiskLevel.LOW },
    reversibility: "NOT_REQUIRED",
    preconditions: (args) => !!args.workspacePath,
    execute: async (args) => {
      return adapter.inspectProjectEnvironment(args.workspacePath);
    },
    observe: async (result, args) => ({
      observationId: createId(),
      source: "environment.project.inspect",
      timestamp: new Date().toISOString(),
      structuredState: result,
      relatedActionId: args?.actionId,
      detectedChanges: [],
      confidence: 1,
      trustLevel: "SYSTEM_TRUSTED"
    }),
    verify: async (observation) => {
      return {
        status: "VERIFIED",
        message: "Project environment inspected",
        evidence: observation.structuredState,
        confidence: 1
      };
    },
    rollback: null,
    timeout: 5000,
    retryPolicy: { maxAttempts: 2, backoffMs: 500 },
    lifecycleStatus: LifecycleStatus.VERIFIED
  });

  // environment.project.set
  registry.register({
    name: "environment.project.set",
    version: "1.0.0",
    description: "Set project environment variable in .env file",
    inputSchema: {
      type: "object",
      properties: {
        workspacePath: { type: "string" },
        key: { type: "string" },
        value: { type: "string" }
      },
      required: ["workspacePath", "key", "value"]
    },
    outputSchema: { type: "object" },
    requiredContext: [],
    riskMetadata: { level: RiskLevel.MEDIUM },
    reversibility: "ROLLBACK_SUPPORTED",
    preconditions: (args) => !!args.workspacePath && !!args.key,
    execute: async (args) => {
      return adapter.setProjectEnvironmentVariable(args.workspacePath, args.key, args.value);
    },
    observe: async (result, args) => ({
      observationId: createId(),
      source: "environment.project.set",
      timestamp: new Date().toISOString(),
      structuredState: result,
      relatedActionId: args?.actionId,
      detectedChanges: ["env.file"],
      confidence: 1,
      trustLevel: "SYSTEM_TRUSTED"
    }),
    verify: async (observation, args) => {
      const verify = await adapter.verifyProjectEnvironmentVariable(args.workspacePath, args.key, args.value);
      return {
        status: verify.matches ? "VERIFIED" : "FAILED",
        message: verify.matches ? "Environment variable set correctly" : "Failed to set environment variable",
        evidence: verify,
        expectedState: { key: args.key, value: args.value },
        observedState: verify,
        confidence: verify.matches ? 1 : 0
      };
    },
    rollback: async (args, checkpoint) => {
      return adapter.rollbackProjectEnvironmentVariable(args.workspacePath, checkpoint);
    },
    timeout: 10000,
    retryPolicy: { maxAttempts: 1, backoffMs: 1000 },
    lifecycleStatus: LifecycleStatus.VERIFIED
  });

  // environment.user.path.add
  registry.register({
    name: "environment.user.path.add",
    version: "1.0.0",
    description: "Add entry to user PATH",
    inputSchema: {
      type: "object",
      properties: { entry: { type: "string" } },
      required: ["entry"]
    },
    outputSchema: { type: "object" },
    requiredContext: [],
    riskMetadata: { level: RiskLevel.MEDIUM },
    reversibility: "ROLLBACK_SUPPORTED",
    preconditions: (args) => !!args.entry,
    execute: async (args) => {
      return adapter.addUserPathEntry(args.entry);
    },
    observe: async (result, args) => ({
      observationId: createId(),
      source: "environment.user.path.add",
      timestamp: new Date().toISOString(),
      structuredState: result,
      relatedActionId: args?.actionId,
      detectedChanges: ["user.path"],
      confidence: 1,
      trustLevel: "SYSTEM_TRUSTED"
    }),
    verify: async (observation, args) => {
      const verify = await adapter.verifyUserPathEntry(args.entry);
      return {
        status: verify.present ? "VERIFIED" : "FAILED",
        message: verify.present ? "PATH entry added" : "Failed to add PATH entry",
        evidence: verify,
        expectedState: { entry: args.entry },
        observedState: verify,
        confidence: verify.present ? 1 : 0
      };
    },
    rollback: async (args, checkpoint) => {
      return adapter.rollbackUserPath(checkpoint);
    },
    timeout: 15000,
    retryPolicy: { maxAttempts: 1, backoffMs: 1000 },
    lifecycleStatus: LifecycleStatus.VERIFIED
  });

  // package.winget.search
  registry.register({
    name: "package.winget.search",
    version: "1.0.0",
    description: "Search for packages via WinGet",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"]
    },
    outputSchema: { type: "object" },
    requiredContext: [],
    riskMetadata: { level: RiskLevel.LOW },
    reversibility: "NOT_REQUIRED",
    preconditions: (args) => !!args.query,
    execute: async (args) => {
      return adapter.wingetSearch(args.query);
    },
    observe: async (result, args) => ({
      observationId: createId(),
      source: "package.winget.search",
      timestamp: new Date().toISOString(),
      structuredState: result,
      relatedActionId: args?.actionId,
      detectedChanges: [],
      confidence: 1,
      trustLevel: "SYSTEM_TRUSTED"
    }),
    verify: async (observation) => {
      return { 
        status: "VERIFIED", 
        message: "WinGet search complete",
        evidence: observation.structuredState,
        confidence: 1
      };
    },
    rollback: null,
    timeout: 30000,
    retryPolicy: { maxAttempts: 2, backoffMs: 2000 },
    lifecycleStatus: LifecycleStatus.VERIFIED
  });

  // application.notepad.launch
  registry.register({
    name: "application.notepad.launch",
    version: "1.0.0",
    description: "Open Notepad, type text, and save",
    inputSchema: {
      type: "object",
      properties: { content: { type: "string" }, filename: { type: "string" } },
      required: ["content", "filename"]
    },
    outputSchema: { type: "object" },
    requiredContext: [],
    riskMetadata: { level: RiskLevel.MEDIUM },
    reversibility: "PARTIAL",
    preconditions: (args) => !!args.content && !!args.filename,
    execute: async (args) => {
      return adapter.notepadTypeAndSave({ content: args.content, filename: args.filename });
    },
    observe: async (result, args) => ({
      observationId: createId(),
      source: "application.notepad.launch",
      timestamp: new Date().toISOString(),
      structuredState: result,
      relatedActionId: args?.actionId,
      detectedChanges: ["user.documents"],
      confidence: 0.8,
      trustLevel: "SYSTEM_TRUSTED"
    }),
    verify: async (observation) => {
      const verify = observation.structuredState?.verification;
      return {
        status: verify?.matches ? "VERIFIED" : "FAILED",
        message: verify?.message,
        evidence: verify,
        confidence: verify?.matches ? 0.8 : 0
      };
    },
    rollback: null,
    timeout: 45000,
    retryPolicy: { maxAttempts: 1, backoffMs: 5000 },
    lifecycleStatus: LifecycleStatus.VERIFIED
  });

  // filesystem.read
  registry.register({
    name: "filesystem.read",
    version: "1.0.0",
    description: "Read a text file",
    inputSchema: {
      type: "object",
      properties: { filePath: { type: "string" } },
      required: ["filePath"]
    },
    outputSchema: { type: "object" },
    requiredContext: [],
    riskMetadata: { level: RiskLevel.LOW },
    reversibility: "NOT_REQUIRED",
    preconditions: (args) => !!args.filePath,
    execute: async (args) => {
      return adapter.readTextFile(args.filePath);
    },
    observe: async (result) => ({
      observationId: createId(),
      source: "filesystem.read",
      timestamp: new Date().toISOString(),
      structuredState: result,
      detectedChanges: [],
      confidence: 1,
      trustLevel: "SYSTEM_TRUSTED"
    }),
    verify: async (observation) => {
      return { 
        status: "VERIFIED", 
        message: "File read complete",
        evidence: observation.structuredState,
        confidence: 1
      };
    },
    rollback: null,
    timeout: 10000,
    retryPolicy: { maxAttempts: 2, backoffMs: 1000 },
    lifecycleStatus: LifecycleStatus.VERIFIED
  });

  // filesystem.write
  registry.register({
    name: "filesystem.write",
    version: "1.0.0",
    description: "Write text to a file",
    inputSchema: {
      type: "object",
      properties: { filePath: { type: "string" }, content: { type: "string" } },
      required: ["filePath", "content"]
    },
    outputSchema: { type: "object" },
    requiredContext: [],
    riskMetadata: { level: RiskLevel.MEDIUM },
    reversibility: "ROLLBACK_SUPPORTED",
    preconditions: (args) => !!args.filePath && !!args.content,
    execute: async (args) => {
      return adapter.writeTextFile(args.filePath, args.content);
    },
    observe: async (result, args) => ({
      observationId: createId(),
      source: "filesystem.write",
      timestamp: new Date().toISOString(),
      structuredState: result,
      relatedActionId: args?.actionId,
      detectedChanges: ["file"],
      confidence: 1,
      trustLevel: "SYSTEM_TRUSTED"
    }),
    verify: async (observation, args) => {
      const verify = await adapter.verifyFileContains(args.filePath, args.content);
      return {
        status: verify.matches ? "VERIFIED" : "FAILED",
        message: verify.matches ? "File written correctly" : "Failed to write file",
        evidence: verify,
        expectedState: { content: args.content },
        observedState: verify,
        confidence: verify.matches ? 1 : 0
      };
    },
    rollback: async (args, checkpoint) => {
      if (checkpoint?.previousContents !== null) {
        return adapter.writeTextFile(args.filePath, checkpoint.previousContents);
      }
      return { success: true };
    },
    timeout: 10000,
    retryPolicy: { maxAttempts: 1, backoffMs: 1000 },
    lifecycleStatus: LifecycleStatus.VERIFIED
  });

  // Add compatibility capabilities for existing tests (stubs, marked UNAVAILABLE)
  registry.register({
    name: "developer.project.detect",
    version: "1.0.0",
    description: "Detect developer project type and runnable scripts",
    inputSchema: { type: "object", properties: {}, required: [] },
    outputSchema: { type: "object" },
    requiredContext: [],
    riskMetadata: { level: RiskLevel.LOW },
    permissions: ["workspace:read"],
    reversibility: "NOT_REQUIRED",
    preconditions: () => true,
    execute: async () => ({}),
    observe: async (result) => ({
      observationId: createId(),
      source: "developer.project.detect",
      timestamp: new Date().toISOString(),
      structuredState: result,
      detectedChanges: [],
      confidence: 1,
      trustLevel: "SYSTEM_TRUSTED"
    }),
    verify: async () => ({ status: "VERIFIED", message: "Detected" }),
    rollback: null,
    timeout: 10000,
    retryPolicy: { maxAttempts: 1 },
    lifecycleStatus: LifecycleStatus.UNAVAILABLE
  });

  registry.register({
    name: "developer.project.run",
    version: "1.0.0",
    description: "Install dependencies and run project",
    inputSchema: { type: "object", properties: {}, required: [] },
    outputSchema: { type: "object" },
    requiredContext: [],
    riskMetadata: { level: RiskLevel.MEDIUM },
    permissions: ["workspace:execute"],
    reversibility: "PARTIAL",
    preconditions: () => true,
    execute: async () => ({}),
    observe: async (result) => ({
      observationId: createId(),
      source: "developer.project.run",
      timestamp: new Date().toISOString(),
      structuredState: result,
      detectedChanges: [],
      confidence: 1,
      trustLevel: "SYSTEM_TRUSTED"
    }),
    verify: async () => ({ status: "VERIFIED", message: "Run initiated" }),
    rollback: null,
    timeout: 60000,
    retryPolicy: { maxAttempts: 1 },
    lifecycleStatus: LifecycleStatus.UNAVAILABLE
  });

  registry.register({
    name: "environment.project.inspect",
    version: "1.0.0",
    description: "Inspect project environment file",
    inputSchema: { type: "object", properties: {}, required: [] },
    outputSchema: { type: "object" },
    requiredContext: [],
    riskMetadata: { level: RiskLevel.LOW },
    permissions: ["workspace:read"],
    reversibility: "NOT_REQUIRED",
    preconditions: () => true,
    execute: async () => ({}),
    observe: async (result) => ({
      observationId: createId(),
      source: "environment.project.inspect",
      timestamp: new Date().toISOString(),
      structuredState: result,
      detectedChanges: [],
      confidence: 1,
      trustLevel: "SYSTEM_TRUSTED"
    }),
    verify: async () => ({ status: "VERIFIED", message: "Inspected" }),
    rollback: null,
    timeout: 10000,
    retryPolicy: { maxAttempts: 1 },
    lifecycleStatus: LifecycleStatus.UNAVAILABLE
  });

  registry.register({
    name: "environment.user.set",
    version: "1.0.0",
    description: "Set Windows user environment variable",
    inputSchema: { type: "object", properties: {}, required: [] },
    outputSchema: { type: "object" },
    requiredContext: [],
    riskMetadata: { level: RiskLevel.MEDIUM },
    permissions: ["environment:user:write"],
    reversibility: "ROLLBACK_SUPPORTED",
    preconditions: () => true,
    execute: async () => ({}),
    observe: async (result) => ({
      observationId: createId(),
      source: "environment.user.set",
      timestamp: new Date().toISOString(),
      structuredState: result,
      detectedChanges: [],
      confidence: 1,
      trustLevel: "SYSTEM_TRUSTED"
    }),
    verify: async () => ({ status: "VERIFIED", message: "Set" }),
    rollback: null,
    timeout: 10000,
    retryPolicy: { maxAttempts: 1 },
    lifecycleStatus: LifecycleStatus.UNAVAILABLE
  });

  registry.register({
    name: "package.winget.install",
    version: "1.0.0",
    description: "Install a package via WinGet",
    inputSchema: { type: "object", properties: {}, required: [] },
    outputSchema: { type: "object" },
    requiredContext: [],
    riskMetadata: { level: RiskLevel.MEDIUM },
    permissions: ["system:write"],
    reversibility: "PARTIAL",
    preconditions: () => true,
    execute: async () => ({}),
    observe: async (result) => ({
      observationId: createId(),
      source: "package.winget.install",
      timestamp: new Date().toISOString(),
      structuredState: result,
      detectedChanges: [],
      confidence: 1,
      trustLevel: "SYSTEM_TRUSTED"
    }),
    verify: async () => ({ status: "VERIFIED", message: "Installed" }),
    rollback: null,
    timeout: 600000,
    retryPolicy: { maxAttempts: 1 },
    lifecycleStatus: LifecycleStatus.UNAVAILABLE
  });

  registry.register({
    name: "system.service.inspect",
    version: "1.0.0",
    description: "Inspect Windows service state",
    inputSchema: { type: "object", properties: {}, required: [] },
    outputSchema: { type: "object" },
    requiredContext: [],
    riskMetadata: { level: RiskLevel.LOW },
    permissions: ["system:read"],
    reversibility: "NOT_REQUIRED",
    preconditions: () => true,
    execute: async () => ({}),
    observe: async (result) => ({
      observationId: createId(),
      source: "system.service.inspect",
      timestamp: new Date().toISOString(),
      structuredState: result,
      detectedChanges: [],
      confidence: 1,
      trustLevel: "SYSTEM_TRUSTED"
    }),
    verify: async () => ({ status: "VERIFIED", message: "Inspected" }),
    rollback: null,
    timeout: 10000,
    retryPolicy: { maxAttempts: 1 },
    lifecycleStatus: LifecycleStatus.UNAVAILABLE
  });

  registry.register({
    name: "package.manager.inspect",
    version: "1.0.0",
    description: "Inspect package manager availability",
    inputSchema: { type: "object", properties: {}, required: [] },
    outputSchema: { type: "object" },
    requiredContext: [],
    riskMetadata: { level: RiskLevel.LOW },
    permissions: ["system:read"],
    reversibility: "NOT_REQUIRED",
    preconditions: () => true,
    execute: async () => ({}),
    observe: async (result) => ({
      observationId: createId(),
      source: "package.manager.inspect",
      timestamp: new Date().toISOString(),
      structuredState: result,
      detectedChanges: [],
      confidence: 1,
      trustLevel: "SYSTEM_TRUSTED"
    }),
    verify: async () => ({ status: "VERIFIED", message: "Inspected" }),
    rollback: null,
    timeout: 10000,
    retryPolicy: { maxAttempts: 1 },
    lifecycleStatus: LifecycleStatus.UNAVAILABLE
  });

  registry.register({
    name: "environment.user.path.dedupe",
    version: "1.0.0",
    description: "Deduplicate user PATH entries",
    inputSchema: { type: "object", properties: {}, required: [] },
    outputSchema: { type: "object" },
    requiredContext: [],
    riskMetadata: { level: RiskLevel.MEDIUM },
    permissions: ["environment:user:write"],
    reversibility: "ROLLBACK_SUPPORTED",
    preconditions: () => true,
    execute: async () => ({}),
    observe: async (result) => ({
      observationId: createId(),
      source: "environment.user.path.dedupe",
      timestamp: new Date().toISOString(),
      structuredState: result,
      detectedChanges: [],
      confidence: 1,
      trustLevel: "SYSTEM_TRUSTED"
    }),
    verify: async () => ({ status: "VERIFIED", message: "Deduped" }),
    rollback: null,
    timeout: 10000,
    retryPolicy: { maxAttempts: 1 },
    lifecycleStatus: LifecycleStatus.UNAVAILABLE
  });

  registry.register({
    name: "git.repository.inspect",
    version: "1.0.0",
    description: "Inspect git repository state",
    inputSchema: { type: "object", properties: {}, required: [] },
    outputSchema: { type: "object" },
    requiredContext: [],
    riskMetadata: { level: RiskLevel.LOW },
    permissions: ["workspace:read"],
    reversibility: "NOT_REQUIRED",
    preconditions: () => true,
    execute: async () => ({}),
    observe: async (result) => ({
      observationId: createId(),
      source: "git.repository.inspect",
      timestamp: new Date().toISOString(),
      structuredState: result,
      detectedChanges: [],
      confidence: 1,
      trustLevel: "SYSTEM_TRUSTED"
    }),
    verify: async () => ({ status: "VERIFIED", message: "Inspected" }),
    rollback: null,
    timeout: 10000,
    retryPolicy: { maxAttempts: 1 },
    lifecycleStatus: LifecycleStatus.UNAVAILABLE
  });

  registry.register({
    name: "docker.environment.inspect",
    version: "1.0.0",
    description: "Inspect Docker environment",
    inputSchema: { type: "object", properties: {}, required: [] },
    outputSchema: { type: "object" },
    requiredContext: [],
    riskMetadata: { level: RiskLevel.LOW },
    permissions: ["workspace:read"],
    reversibility: "NOT_REQUIRED",
    preconditions: () => true,
    execute: async () => ({}),
    observe: async (result) => ({
      observationId: createId(),
      source: "docker.environment.inspect",
      timestamp: new Date().toISOString(),
      structuredState: result,
      detectedChanges: [],
      confidence: 1,
      trustLevel: "SYSTEM_TRUSTED"
    }),
    verify: async () => ({ status: "VERIFIED", message: "Inspected" }),
    rollback: null,
    timeout: 10000,
    retryPolicy: { maxAttempts: 1 },
    lifecycleStatus: LifecycleStatus.UNAVAILABLE
  });

  // ============================================================================
  // Real capabilities that wrap already-working adapter operations. These are
  // registered last so they overwrite the reserved UNAVAILABLE stubs above.
  // Only operations backed by a working adapter method are exposed.
  // ============================================================================

  // environment.user.set (real) - set a Windows user environment variable
  registry.register({
    name: "environment.user.set",
    version: "1.0.0",
    description: "Set a Windows user environment variable",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string" },
        value: { type: "string" }
      },
      required: ["key", "value"]
    },
    outputSchema: { type: "object" },
    requiredContext: [],
    riskMetadata: { level: RiskLevel.MEDIUM },
    permissions: ["environment:user:write"],
    reversibility: "ROLLBACK_SUPPORTED",
    preconditions: (args) => !!args.key,
    execute: async (args) => {
      return adapter.setUserEnvironmentVariable(args.key, args.value);
    },
    observe: async (result, args) => ({
      observationId: createId(),
      source: "environment.user.set",
      timestamp: new Date().toISOString(),
      structuredState: result,
      relatedActionId: args?.actionId,
      detectedChanges: ["user.environment"],
      confidence: 1,
      trustLevel: "SYSTEM_TRUSTED"
    }),
    verify: async (observation, args) => {
      const verify = await adapter.verifyUserEnvironmentVariable(args.key, args.value);
      return {
        status: verify.matches ? "VERIFIED" : "FAILED",
        message: verify.matches ? "User environment variable set correctly" : "Failed to set user environment variable",
        evidence: verify,
        expectedState: { key: args.key, value: args.value },
        observedState: verify,
        confidence: verify.matches ? 1 : 0
      };
    },
    rollback: async (args, checkpoint) => {
      return adapter.restoreUserEnvironmentVariable(args.key, checkpoint?.previousValue ?? null);
    },
    timeout: 15000,
    retryPolicy: { maxAttempts: 1, backoffMs: 1000 },
    lifecycleStatus: LifecycleStatus.VERIFIED
  });

  // environment.user.path.dedupe (real) - deduplicate user PATH entries
  registry.register({
    name: "environment.user.path.dedupe",
    version: "1.0.0",
    description: "Deduplicate user PATH entries",
    inputSchema: { type: "object", properties: {}, required: [] },
    outputSchema: { type: "object" },
    requiredContext: [],
    riskMetadata: { level: RiskLevel.MEDIUM },
    permissions: ["environment:user:write"],
    reversibility: "ROLLBACK_SUPPORTED",
    preconditions: () => true,
    execute: async () => {
      return adapter.dedupeUserPath();
    },
    observe: async (result, args) => ({
      observationId: createId(),
      source: "environment.user.path.dedupe",
      timestamp: new Date().toISOString(),
      structuredState: result,
      relatedActionId: args?.actionId,
      detectedChanges: ["user.path"],
      confidence: 1,
      trustLevel: "SYSTEM_TRUSTED"
    }),
    verify: async (observation) => {
      const removed = observation.structuredState?.removedCount ?? 0;
      return {
        status: "VERIFIED",
        message: `PATH deduplicated (${removed} duplicate(s) removed)`,
        evidence: observation.structuredState,
        confidence: 1
      };
    },
    rollback: async (args, checkpoint) => {
      return adapter.rollbackUserPath(checkpoint?.previousValue ?? "");
    },
    timeout: 15000,
    retryPolicy: { maxAttempts: 1, backoffMs: 1000 },
    lifecycleStatus: LifecycleStatus.VERIFIED
  });

  // package.winget.install (real) - install a package via WinGet
  registry.register({
    name: "package.winget.install",
    version: "1.0.0",
    description: "Install a package via WinGet",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"]
    },
    outputSchema: { type: "object" },
    requiredContext: [],
    riskMetadata: { level: RiskLevel.MEDIUM },
    permissions: ["system:write"],
    reversibility: "PARTIAL",
    preconditions: (args) => !!args.id,
    execute: async (args) => {
      return adapter.wingetInstall(args.id);
    },
    observe: async (result, args) => ({
      observationId: createId(),
      source: "package.winget.install",
      timestamp: new Date().toISOString(),
      structuredState: result,
      relatedActionId: args?.actionId,
      detectedChanges: ["system.packages"],
      confidence: 0.9,
      trustLevel: "SYSTEM_TRUSTED"
    }),
    verify: async (observation, args) => {
      const listAfter = await adapter.wingetList(args.id);
      const installed = listAfter.exitCode === 0 &&
        (listAfter.stdout ?? "").toLowerCase().includes(String(args.id).toLowerCase());
      return {
        status: installed ? "VERIFIED" : "FAILED",
        message: installed ? "Package installation verified" : "Failed to verify package installation",
        evidence: listAfter,
        confidence: installed ? 0.9 : 0
      };
    },
    rollback: null,
    timeout: 600000,
    retryPolicy: { maxAttempts: 1, backoffMs: 5000 },
    lifecycleStatus: LifecycleStatus.VERIFIED
  });

  // system.service.inspect (real) - inspect a Windows service
  registry.register({
    name: "system.service.inspect",
    version: "1.0.0",
    description: "Inspect a Windows service state",
    inputSchema: {
      type: "object",
      properties: { serviceName: { type: "string" } },
      required: ["serviceName"]
    },
    outputSchema: { type: "object" },
    requiredContext: [],
    riskMetadata: { level: RiskLevel.LOW },
    permissions: ["system:read"],
    reversibility: "NOT_REQUIRED",
    preconditions: (args) => !!args.serviceName,
    execute: async (args) => {
      return adapter.inspectService(args.serviceName);
    },
    observe: async (result, args) => ({
      observationId: createId(),
      source: "system.service.inspect",
      timestamp: new Date().toISOString(),
      structuredState: result,
      relatedActionId: args?.actionId,
      detectedChanges: [],
      confidence: 1,
      trustLevel: "SYSTEM_TRUSTED"
    }),
    verify: async (observation) => ({
      status: "VERIFIED",
      message: "Service inspection complete",
      evidence: observation.structuredState,
      confidence: 1
    }),
    rollback: null,
    timeout: 10000,
    retryPolicy: { maxAttempts: 1, backoffMs: 500 },
    lifecycleStatus: LifecycleStatus.VERIFIED
  });

  // git.repository.inspect (real) - inspect git repository state
  registry.register({
    name: "git.repository.inspect",
    version: "1.0.0",
    description: "Inspect git repository state",
    inputSchema: {
      type: "object",
      properties: { workspacePath: { type: "string" } },
      required: ["workspacePath"]
    },
    outputSchema: { type: "object" },
    requiredContext: [],
    riskMetadata: { level: RiskLevel.LOW },
    permissions: ["workspace:read"],
    reversibility: "NOT_REQUIRED",
    preconditions: (args) => !!args.workspacePath,
    execute: async (args) => {
      return adapter.inspectGitRepository(args.workspacePath);
    },
    observe: async (result, args) => ({
      observationId: createId(),
      source: "git.repository.inspect",
      timestamp: new Date().toISOString(),
      structuredState: result,
      relatedActionId: args?.actionId,
      detectedChanges: [],
      confidence: 1,
      trustLevel: "SYSTEM_TRUSTED"
    }),
    verify: async (observation) => ({
      status: "VERIFIED",
      message: "Git repository inspection complete",
      evidence: observation.structuredState,
      confidence: 1
    }),
    rollback: null,
    timeout: 10000,
    retryPolicy: { maxAttempts: 1, backoffMs: 500 },
    lifecycleStatus: LifecycleStatus.VERIFIED
  });

  // docker.environment.inspect (real) - inspect docker availability
  registry.register({
    name: "docker.environment.inspect",
    version: "1.0.0",
    description: "Inspect Docker environment availability",
    inputSchema: {
      type: "object",
      properties: { workspacePath: { type: "string" } },
      required: ["workspacePath"]
    },
    outputSchema: { type: "object" },
    requiredContext: [],
    riskMetadata: { level: RiskLevel.LOW },
    permissions: ["workspace:read"],
    reversibility: "NOT_REQUIRED",
    preconditions: (args) => !!args.workspacePath,
    execute: async (args) => {
      return adapter.inspectDockerEnvironment(args.workspacePath);
    },
    observe: async (result, args) => ({
      observationId: createId(),
      source: "docker.environment.inspect",
      timestamp: new Date().toISOString(),
      structuredState: result,
      relatedActionId: args?.actionId,
      detectedChanges: [],
      confidence: 1,
      trustLevel: "SYSTEM_TRUSTED"
    }),
    verify: async (observation) => ({
      status: "VERIFIED",
      message: "Docker environment inspection complete",
      evidence: observation.structuredState,
      confidence: 1
    }),
    rollback: null,
    timeout: 10000,
    retryPolicy: { maxAttempts: 1, backoffMs: 500 },
    lifecycleStatus: LifecycleStatus.VERIFIED
  });

  // package.manager.inspect (real) - inspect a package manager version
  registry.register({
    name: "package.manager.inspect",
    version: "1.0.0",
    description: "Inspect package manager availability",
    inputSchema: {
      type: "object",
      properties: { packageManager: { type: "string" } },
      required: []
    },
    outputSchema: { type: "object" },
    requiredContext: [],
    riskMetadata: { level: RiskLevel.LOW },
    permissions: ["system:read"],
    reversibility: "NOT_REQUIRED",
    preconditions: () => true,
    execute: async (args) => {
      return adapter.inspectPackageManager(args.packageManager ?? "winget");
    },
    observe: async (result, args) => ({
      observationId: createId(),
      source: "package.manager.inspect",
      timestamp: new Date().toISOString(),
      structuredState: result,
      relatedActionId: args?.actionId,
      detectedChanges: [],
      confidence: 1,
      trustLevel: "SYSTEM_TRUSTED"
    }),
    verify: async (observation) => ({
      status: "VERIFIED",
      message: "Package manager inspection complete",
      evidence: observation.structuredState,
      confidence: 1
    }),
    rollback: null,
    timeout: 10000,
    retryPolicy: { maxAttempts: 1, backoffMs: 500 },
    lifecycleStatus: LifecycleStatus.VERIFIED
  });

  // system.performance.analyze (real) - analyze system performance snapshot
  registry.register({
    name: "system.performance.analyze",
    version: "1.0.0",
    description: "Analyze system performance from a live snapshot",
    inputSchema: { type: "object", properties: {}, required: [] },
    outputSchema: { type: "object" },
    requiredContext: [],
    riskMetadata: { level: RiskLevel.LOW },
    permissions: ["system:read"],
    reversibility: "NOT_REQUIRED",
    preconditions: () => true,
    execute: async () => {
      return adapter.analyzeSystemPerformance();
    },
    observe: async (result, args) => ({
      observationId: createId(),
      source: "system.performance.analyze",
      timestamp: new Date().toISOString(),
      structuredState: result,
      relatedActionId: args?.actionId,
      detectedChanges: [],
      confidence: 1,
      trustLevel: "SYSTEM_TRUSTED"
    }),
    verify: async (observation) => ({
      status: "VERIFIED",
      message: "System performance analysis complete",
      evidence: observation.structuredState,
      confidence: 1
    }),
    rollback: null,
    timeout: 20000,
    retryPolicy: { maxAttempts: 1, backoffMs: 500 },
    lifecycleStatus: LifecycleStatus.VERIFIED
  });

  // browser.search (real) - open the default search for a query. This wraps the
  // pre-existing adapter.browserSearch operation behind the capability boundary
  // so the legacy browserSearchIntent no longer calls the adapter directly.
  registry.register({
    name: "browser.search",
    version: "1.0.0",
    description: "Open a web search for a query in the browser",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"]
    },
    outputSchema: { type: "object" },
    requiredContext: [],
    riskMetadata: { level: RiskLevel.LOW },
    permissions: ["browser:launch"],
    reversibility: "NOT_REQUIRED",
    preconditions: (args) => !!args.query,
    execute: async (args) => {
      return adapter.browserSearch(args.query);
    },
    observe: async (result, args) => ({
      observationId: createId(),
      source: "browser.search",
      timestamp: new Date().toISOString(),
      structuredState: result,
      relatedActionId: args?.actionId,
      detectedChanges: [],
      confidence: 0.8,
      trustLevel: "SYSTEM_TRUSTED"
    }),
    verify: async (observation) => {
      const launched = observation.structuredState?.launchResult?.exitCode === 0;
      return {
        status: launched ? "VERIFIED" : "PARTIALLY_VERIFIED",
        message: launched ? "Browser search launched" : "Browser search dispatched (launch unconfirmed)",
        evidence: observation.structuredState,
        confidence: launched ? 0.8 : 0.5
      };
    },
    rollback: null,
    timeout: 20000,
    retryPolicy: { maxAttempts: 1, backoffMs: 1000 },
    lifecycleStatus: LifecycleStatus.VERIFIED
  });

  // developer.command.run (real) - run a single resolved developer command
  // (e.g. dependency install or a project start check) via the adapter. The
  // planner resolves the concrete command/args from the project profile, so
  // this capability stays generic and typed.
  registry.register({
    name: "developer.command.run",
    version: "1.0.0",
    description: "Run a resolved developer command in a workspace",
    inputSchema: {
      type: "object",
      properties: {
        workspacePath: { type: "string" },
        command: { type: "string" },
        args: { type: "array" }
      },
      required: ["workspacePath", "command"]
    },
    outputSchema: { type: "object" },
    requiredContext: [],
    riskMetadata: { level: RiskLevel.MEDIUM },
    permissions: ["workspace:execute"],
    reversibility: "PARTIAL",
    preconditions: (args) => !!args.workspacePath && !!args.command,
    execute: async (args) => {
      return adapter.executeCommand(args.workspacePath, args.command, args.args ?? [], { timeoutMs: 90000 });
    },
    observe: async (result, args) => ({
      observationId: createId(),
      source: "developer.command.run",
      timestamp: new Date().toISOString(),
      structuredState: result,
      relatedActionId: args?.actionId,
      detectedChanges: ["workspace"],
      confidence: 1,
      trustLevel: "SYSTEM_TRUSTED"
    }),
    verify: async (observation) => {
      const ok = observation.structuredState?.exitCode === 0 && !observation.structuredState?.timedOut;
      return {
        status: ok ? "VERIFIED" : "FAILED",
        message: ok ? "Command completed successfully" : "Command failed or timed out",
        evidence: observation.structuredState,
        confidence: ok ? 1 : 0
      };
    },
    rollback: null,
    timeout: 95000,
    retryPolicy: { maxAttempts: 1, backoffMs: 2000 },
    lifecycleStatus: LifecycleStatus.VERIFIED
  });

  // system.services.list (real) - list Windows services
  registry.register({
    name: "system.services.list",
    version: "1.0.0",
    description: "List Windows services",
    inputSchema: { type: "object", properties: {}, required: [] },
    outputSchema: { type: "array" },
    requiredContext: [],
    riskMetadata: { level: RiskLevel.LOW },
    permissions: ["system:read"],
    reversibility: "NOT_REQUIRED",
    preconditions: () => true,
    execute: async () => {
      return adapter.listServices();
    },
    observe: async (result, args) => ({
      observationId: createId(),
      source: "system.services.list",
      timestamp: new Date().toISOString(),
      structuredState: result,
      relatedActionId: args?.actionId,
      detectedChanges: [],
      confidence: 1,
      trustLevel: "SYSTEM_TRUSTED"
    }),
    verify: async (observation) => ({
      status: "VERIFIED",
      message: "Services listed",
      evidence: observation.structuredState,
      confidence: 1
    }),
    rollback: null,
    timeout: 15000,
    retryPolicy: { maxAttempts: 1, backoffMs: 1000 },
    lifecycleStatus: LifecycleStatus.VERIFIED
  });

  return registry;
}
