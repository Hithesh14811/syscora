import path from "node:path";
import { CapabilityRegistry, createDefaultCapabilityRegistry } from "../../../packages/capability-registry/src/index.js";
import { PolicyEngine } from "../../../packages/policy-engine/src/index.js";
import { RiskEngine } from "../../../packages/risk-engine/src/index.js";
import { AuditRepository } from "../../../packages/audit/src/index.js";
import { RecoveryEngine } from "../../../packages/recovery-engine/src/index.js";
import { TroubleshootingEngine } from "../../../packages/troubleshooting-engine/src/index.js";
import { AgentRuntime } from "../../../packages/agent-runtime/src/index.js";
import { SessionStore } from "../../../packages/agent-runtime/src/session-store.js";
import { PermissionBroker } from "../../../packages/permission-broker/src/index.js";
import { ApprovalTokenStore } from "../../../packages/permission-broker/src/approval-token-store.js";
import { DeveloperIntelligenceEngine } from "../../../packages/developer-intelligence/src/index.js";
import { WindowsAdapter } from "../../../os-adapters/windows/src/windows-adapter.js";
import { SemanticState } from "../../../packages/semantic-state/src/index.js";
import { Memory } from "../../../packages/memory/src/index.js";

export function createRuntime(basePath = process.cwd()) {
  const stateDirectory = path.join(basePath, ".syscora");
  const auditRepository = new AuditRepository(path.join(stateDirectory, "audit"));
  const sessionStore = new SessionStore(path.join(stateDirectory, "sessions"));
  const approvalTokenStore = new ApprovalTokenStore(path.join(stateDirectory, "permission-broker"));
  const semanticState = new SemanticState(path.join(stateDirectory, "semantic-state"));
  const memory = new Memory(path.join(stateDirectory, "memory"));
  const adapter = new WindowsAdapter();
  const capabilityRegistry = createDefaultCapabilityRegistry(adapter);
  const recoveryEngine = new RecoveryEngine();
  const troubleshootingEngine = new TroubleshootingEngine();

  const runtime = new AgentRuntime({
    sessionStore,
    auditRepository,
    capabilityRegistry,
    riskEngine: new RiskEngine(),
    policyEngine: new PolicyEngine(),
    permissionBroker: new PermissionBroker({
      approvalTokenStore,
      auditRepository
    }),
    recoveryEngine,
    troubleshootingEngine,
    adapter,
    semanticState,
    memory
  });
  runtime.setDeveloperIntelligence(new DeveloperIntelligenceEngine());
  return runtime;
}
