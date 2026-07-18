import { RiskLevel } from "../../shared-types/src/domain.js";

export const CAPABILITY_CONTRACT_VERSION = "2.0.0";
export const CAPABILITY_RUNTIME_VERSION = "0.1.0";

export const CapabilityHealth = Object.freeze({
  INSTALLED: "INSTALLED",
  AVAILABLE: "AVAILABLE",
  HEALTHY: "HEALTHY",
  DISABLED: "DISABLED",
  DEPRECATED: "DEPRECATED",
  UNSUPPORTED: "UNSUPPORTED",
  UNAVAILABLE: "UNAVAILABLE"
});

const ACTIVE_HEALTH = new Set([
  CapabilityHealth.INSTALLED,
  CapabilityHealth.AVAILABLE,
  CapabilityHealth.HEALTHY,
  CapabilityHealth.DEPRECATED
]);

const VALID_RISK_LEVELS = new Set(Object.values(RiskLevel));

export function compareVersions(actual, required) {
  const parse = (value) => String(value ?? "0.0.0").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const [a1, a2, a3] = parse(actual);
  const [b1, b2, b3] = parse(required);
  if (a1 !== b1) return a1 - b1;
  if (a2 !== b2) return a2 - b2;
  return a3 - b3;
}

export function satisfiesVersion(actual, range = "*") {
  if (!range || range === "*") return true;
  if (range.startsWith(">=")) return compareVersions(actual, range.slice(2)) >= 0;
  if (range.startsWith("^")) {
    const required = range.slice(1);
    return compareVersions(actual, required) >= 0 && String(actual).split(".")[0] === required.split(".")[0];
  }
  return compareVersions(actual, range) === 0;
}

export function isCapabilityHealthy(capability, context = {}) {
  if (!capability || !ACTIVE_HEALTH.has(capability.health?.status)) return false;
  if (capability.health?.status === CapabilityHealth.DEPRECATED && context.includeDeprecated !== true) return false;
  if (typeof capability.health?.check === "function") {
    try { return capability.health.check(context) !== false; } catch { return false; }
  }
  return true;
}

function required(value, field, errors) {
  if (value === undefined || value === null || value === "") errors.push(`${field} is required`);
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

// Default approval lifetime for a capability grant. WRITE/EXECUTE grants are
// short-lived; READ grants may live for the whole session.
export const DEFAULT_WRITE_GRANT_TTL_MS = 5 * 60 * 1000;
export const DEFAULT_READ_GRANT_TTL_MS = 30 * 60 * 1000;

export const PermissionScope = Object.freeze({
  SESSION: "SESSION",
  WORKSPACE: "WORKSPACE",
  USER: "USER",
  SYSTEM: "SYSTEM",
  NETWORK: "NETWORK"
});

export const PermissionType = Object.freeze({
  READ: "READ",
  WRITE: "WRITE",
  EXECUTE: "EXECUTE",
  NETWORK: "NETWORK"
});

export const ApprovalReusePolicy = Object.freeze({
  SINGLE_USE: "SINGLE_USE",
  SESSION_REUSABLE: "SESSION_REUSABLE"
});

// Derive an authoritative permission model from a capability's declared
// permissions, security surface, and mutation profile. This is what the
// PermissionBroker enforces: scope + type + approval lifetime + reuse policy.
function derivePermissionModel(name, permissions, security, mutates, capability) {
  const explicit = capability?.permissionModel ?? {};
  const perms = Array.isArray(permissions) ? permissions : [];
  const scopes = new Set();
  for (const permission of perms) {
    const p = String(permission).toLowerCase();
    if (p.startsWith("filesystem") || p.startsWith("workspace")) scopes.add(PermissionScope.WORKSPACE);
    else if (p.startsWith("environment.user") || p.startsWith("environment:user")) scopes.add(PermissionScope.USER);
    else if (p.startsWith("environment")) scopes.add(PermissionScope.WORKSPACE);
    else if (p.startsWith("network") || p.startsWith("browser")) scopes.add(PermissionScope.NETWORK);
    else if (p.startsWith("system") || p.startsWith("process") || p.startsWith("package")) scopes.add(PermissionScope.SYSTEM);
    else scopes.add(PermissionScope.SESSION);
  }
  // Registry writes to the user hive are USER-scoped even when derived above.
  if ((security?.registry ?? "NONE") !== "NONE" && /environment\.user/.test(name ?? "")) scopes.add(PermissionScope.USER);
  if (scopes.size === 0) scopes.add(PermissionScope.SESSION);

  const elevated = (capability?.requirements?.elevation ?? capability?.requiredElevation ?? "NONE") !== "NONE";
  const isNetwork = (security?.network ?? "NONE") !== "NONE" || (security?.browser ?? "NONE") !== "NONE";
  const type = mutates
    ? (isNetwork ? PermissionType.NETWORK : ((security?.externalProcesses ?? "NONE") !== "NONE" || elevated ? PermissionType.EXECUTE : PermissionType.WRITE))
    : (isNetwork ? PermissionType.NETWORK : PermissionType.READ);

  const isWriteLike = type === PermissionType.WRITE || type === PermissionType.EXECUTE;
  return {
    scope: explicit.scope ?? [...scopes],
    type: explicit.type ?? type,
    // A grant for a mutating/elevated capability is short-lived and single-use;
    // read-only grants are reusable for the whole session.
    approvalLifetimeMs: Number(
      explicit.approvalLifetimeMs ?? (isWriteLike ? DEFAULT_WRITE_GRANT_TTL_MS : DEFAULT_READ_GRANT_TTL_MS)
    ),
    approvalExpiration: explicit.approvalExpiration ?? "RELATIVE",
    reusePolicy: explicit.reusePolicy ?? (isWriteLike || elevated
      ? ApprovalReusePolicy.SINGLE_USE
      : ApprovalReusePolicy.SESSION_REUSABLE),
    requiresElevation: elevated
  };
}

function builtinDeclarations(name, capability) {
  const isFilesystem = /^(filesystem|environment\.project|application\.notepad)/.test(name ?? "");
  const isRegistry = /^environment\.user/.test(name ?? "");
  const isNetwork = /^browser\./.test(name ?? "");
  const isExternalProcess = /^(process|package|application|git|docker|developer|system\.services)/.test(name ?? "");
  const mutates = capability?.riskMetadata?.level === RiskLevel.MEDIUM || capability?.reversibility === "ROLLBACK_SUPPORTED";
  return {
    permissions: [
      ...(isFilesystem ? [mutates ? "filesystem.write" : "filesystem.read"] : []),
      ...(isRegistry ? [mutates ? "environment.write" : "environment.read"] : []),
      ...(isNetwork ? ["network.access"] : []),
      ...(isExternalProcess ? ["process.execute"] : [])
    ],
    security: {
      filesystem: isFilesystem ? (mutates ? "WRITE" : "READ") : "NONE",
      registry: isRegistry ? (mutates ? "WRITE" : "READ") : "NONE",
      network: isNetwork ? "OUTBOUND" : "NONE",
      browser: isNetwork ? "LAUNCH" : "NONE",
      clipboard: "NONE",
      windowAutomation: "NONE",
      externalProcesses: isExternalProcess ? "CONTROLLED" : "NONE"
    },
    stateMutations: mutates ? [name] : [],
    semanticUpdates: [{ type: "observation", entityType: name?.split(".")[0] ?? "system" }],
    auditEvents: ["CAPABILITY_EXECUTED", "CAPABILITY_VERIFIED"],
    documentation: { examples: [`Use ${name} through a validated task graph.`] },
    packaging: { migration: { from: "legacy-registry", version: "1.0.0" }, versionHistory: [capability?.version ?? "0.0.0"] }
  };
}

// Legacy built-ins retain their execution behavior. This adapter supplies the
// V2 declarations that let the runtime treat old and plugin capabilities alike.
export function normalizeCapability(capability, options = {}) {
  const name = capability?.capabilityId ?? capability?.name;
  const lifecycleStatus = capability?.lifecycleStatus ?? "UNAVAILABLE";
  const healthyByLifecycle = lifecycleStatus === "IMPLEMENTED" || lifecycleStatus === "VERIFIED";
  const source = options.source ?? capability?.packaging?.source ?? "builtin";
  const builtin = source === "builtin" ? builtinDeclarations(name, capability) : {};
  const security = capability?.security ?? {};
  return {
    ...capability,
    name,
    capabilityId: name,
    lifecycleStatus,
    version: capability?.version ?? "0.0.0",
    description: capability?.description ?? `Legacy capability placeholder: ${name ?? "unknown"}`,
    inputSchema: capability?.inputSchema ?? { type: "object", properties: {} },
    outputSchema: capability?.outputSchema ?? { type: "object" },
    preconditions: capability?.preconditions ?? (() => false),
    execute: capability?.execute ?? (async () => { throw new Error(`Capability ${name} has no execution handler`); }),
    observe: capability?.observe ?? (async (result) => ({ structuredState: result })),
    verify: capability?.verify ?? (async () => ({ status: "FAILED", message: `Capability ${name} has no verification handler` })),
    contractVersion: capability?.contractVersion ?? CAPABILITY_CONTRACT_VERSION,
    category: capability?.category ?? name?.split(".")[0] ?? "general",
    owner: capability?.owner ?? "SYSCORA",
    lifecycle: capability?.lifecycle ?? {
      status: lifecycleStatus,
      introducedIn: capability?.version ?? "0.1.0",
      deprecated: false
    },
    requirements: {
      permissions: list(capability?.requirements?.permissions ?? capability?.permissions ?? builtin.permissions),
      elevation: capability?.requirements?.elevation ?? capability?.requiredElevation ?? "NONE",
      operatingSystems: list(capability?.requirements?.operatingSystems ?? capability?.requiredOsSupport ?? ["win32"]),
      software: list(capability?.requirements?.software ?? capability?.requiredSoftware),
      capabilities: list(capability?.requirements?.capabilities ?? capability?.requiredCapabilities),
      optionalCapabilities: list(capability?.requirements?.optionalCapabilities),
      alternativeCapabilities: list(capability?.requirements?.alternativeCapabilities),
      conflicts: list(capability?.requirements?.conflicts),
      executionModes: list(capability?.requirements?.executionModes ?? capability?.supportedExecutionModes ?? ["runtime"])
    },
    risk: {
      level: capability?.risk?.level ?? capability?.riskMetadata?.level ?? RiskLevel.MEDIUM,
      policyRequirements: list(capability?.risk?.policyRequirements ?? capability?.policyRequirements),
      ...capability?.risk
    },
    security: {
      filesystem: security.filesystem ?? builtin.security?.filesystem ?? "NONE",
      registry: security.registry ?? builtin.security?.registry ?? "NONE",
      network: security.network ?? builtin.security?.network ?? "NONE",
      browser: security.browser ?? builtin.security?.browser ?? "NONE",
      clipboard: security.clipboard ?? builtin.security?.clipboard ?? "NONE",
      windowAutomation: security.windowAutomation ?? builtin.security?.windowAutomation ?? "NONE",
      externalProcesses: security.externalProcesses ?? builtin.security?.externalProcesses ?? "NONE",
      ...security
    },
    permissionModel: derivePermissionModel(
      name,
      list(capability?.requirements?.permissions ?? capability?.permissions ?? builtin.permissions),
      capability?.security ?? builtin.security ?? {},
      capability?.riskMetadata?.level === RiskLevel.MEDIUM ||
        capability?.riskMetadata?.level === RiskLevel.HIGH ||
        capability?.riskMetadata?.level === RiskLevel.CRITICAL ||
        capability?.reversibility === "ROLLBACK_SUPPORTED",
      capability
    ),
    stateMutations: list(capability?.stateMutations ?? capability?.mutations ?? builtin.stateMutations),
    failureClassifications: list(capability?.failureClassifications),
    recoveryHints: list(capability?.recoveryHints),
    semanticUpdates: list(capability?.semanticUpdates ?? builtin.semanticUpdates),
    memoryUpdates: list(capability?.memoryUpdates),
    auditEvents: list(capability?.auditEvents ?? builtin.auditEvents),
    performance: {
      timeoutMs: Number(capability?.performance?.timeoutMs ?? capability?.timeout ?? 15000),
      cancellation: capability?.performance?.cancellation ?? true,
      resourceLimits: capability?.performance?.resourceLimits ?? {},
      temporaryWorkspace: capability?.performance?.temporaryWorkspace ?? true
    },
    retryPolicy: { maxAttempts: 1, backoffMs: 0, ...capability?.retryPolicy },
    rollbackSupport: capability?.rollbackSupport ?? capability?.reversibility ?? "NOT_REQUIRED",
    health: {
      status: capability?.health?.status ?? (healthyByLifecycle ? CapabilityHealth.HEALTHY : CapabilityHealth.UNAVAILABLE),
      check: capability?.health?.check ?? (() => true),
      ...capability?.health
    },
    documentation: {
      summary: capability?.documentation?.summary ?? capability?.description ?? "",
      examples: list(capability?.documentation?.examples ?? builtin.documentation?.examples),
      url: capability?.documentation?.url ?? null,
      ...capability?.documentation
    },
    deprecation: {
      deprecated: capability?.deprecation?.deprecated ?? false,
      replacement: capability?.deprecation?.replacement ?? null,
      ...capability?.deprecation
    },
    packaging: {
      runtimeVersion: capability?.packaging?.runtimeVersion ?? `>=${CAPABILITY_RUNTIME_VERSION}`,
      manifestVersion: capability?.packaging?.manifestVersion ?? "1",
      tests: capability?.packaging?.tests ?? [],
      migration: capability?.packaging?.migration ?? builtin.packaging?.migration ?? null,
      versionHistory: capability?.packaging?.versionHistory ?? builtin.packaging?.versionHistory ?? [],
      ...capability?.packaging,
      source
    }
  };
}

export function validateCapabilityContract(capability, { strict = false } = {}) {
  const errors = [];
  required(capability?.name, "capabilityId", errors);
  required(capability?.version, "version", errors);
  required(capability?.description, "description", errors);
  required(capability?.category, "category", errors);
  required(capability?.owner, "owner", errors);
  if (!capability?.inputSchema || !capability?.outputSchema) errors.push("inputSchema and outputSchema are required");
  for (const handler of ["preconditions", "execute", "observe", "verify"]) {
    if (typeof capability?.[handler] !== "function") errors.push(`${handler} handler is required`);
  }
  if (!VALID_RISK_LEVELS.has(capability?.risk?.level)) errors.push("risk.level is invalid");
  if (!Array.isArray(capability?.requirements?.permissions)) errors.push("requirements.permissions must be an array");
  if (!capability?.health?.status || !Object.values(CapabilityHealth).includes(capability.health.status)) errors.push("health.status is invalid");
  if (capability?.rollbackSupport === "ROLLBACK_SUPPORTED" &&
      (typeof capability.createCheckpoint !== "function" || typeof capability.rollback !== "function")) {
    errors.push("rollback-capable capability requires createCheckpoint and rollback handlers");
  }
  if (strict) {
    if (!capability?.documentation?.summary) errors.push("documentation.summary is required for packaged capabilities");
    if (!capability?.packaging?.tests?.length) errors.push("packaging.tests is required for packaged capabilities");
  }
  return { valid: errors.length === 0, errors };
}
