const REQUIRED_PLUGIN_FIELDS = [
  "name", "version", "category", "description", "owner", "inputSchema", "outputSchema",
  "requirements", "risk", "security", "stateMutations", "preconditions", "execute", "observe",
  "verify", "failureClassifications", "recoveryHints", "semanticUpdates", "memoryUpdates",
  "auditEvents", "performance", "retryPolicy", "health", "documentation", "packaging"
];

export function validatePluginManifest(manifest) {
  const errors = [];
  for (const field of ["manifestVersion", "pluginId", "version", "runtimeVersion", "entry"]) {
    if (!manifest?.[field]) errors.push(`manifest.${field} is required`);
  }
  if (!Array.isArray(manifest?.capabilities)) errors.push("manifest.capabilities must be an array");
  if (!Array.isArray(manifest?.dependencies ?? [])) errors.push("manifest.dependencies must be an array");
  return { valid: errors.length === 0, errors };
}

export function validatePluginCapabilityDefinition(capability) {
  const errors = REQUIRED_PLUGIN_FIELDS.filter((field) => capability?.[field] === undefined)
    .map((field) => `capability.${field} is required for plugins`);
  if (!Array.isArray(capability?.requirements?.permissions)) errors.push("capability.requirements.permissions must be an array");
  if (!Array.isArray(capability?.packaging?.tests) || capability.packaging.tests.length === 0) {
    errors.push("capability.packaging.tests must declare package tests");
  }
  return { valid: errors.length === 0, errors };
}

export function validateCapabilityPackage({ manifest, capabilities = [] }) {
  const errors = [...validatePluginManifest(manifest).errors];
  const manifestIds = new Set(manifest?.capabilities ?? []);
  const seen = new Set();
  for (const capability of capabilities) {
    const validation = validatePluginCapabilityDefinition(capability);
    errors.push(...validation.errors.map((error) => `${capability?.name ?? "unknown"}: ${error}`));
    if (seen.has(capability?.name)) errors.push(`duplicate capability ID: ${capability?.name}`);
    seen.add(capability?.name);
    if (!manifestIds.has(capability?.name)) errors.push(`${capability?.name} is not declared in manifest.capabilities`);
  }
  return { valid: errors.length === 0, errors };
}
