import { PolicyEffect, RiskLevel } from "../../shared-types/src/domain.js";

export class PolicyEngine {
  decide(riskAssessment, plan) {
    const tasks = plan?.taskGraph?.tasks ?? [];
    // A task is supported if it either carries a recognized legacy typed action
    // or names a capability (canonical shape). Capabilities are already validated
    // against the registry by PlanValidator before this point.
    const hasSupportedAction = tasks.some((task) =>
      Boolean(task.capability) ||
      Boolean(task.selectedCapability) ||
      ["EnvironmentVariableSetAction", "CommandExecutionAction", "ProcessStartAction"].includes(
        task.action?.actionType
      )
    );
    if (tasks.length === 0 || !hasSupportedAction) {
      return {
        effect: PolicyEffect.DENY,
        reason: "Plan does not contain a recognized supported action or capability."
      };
    }

    if (riskAssessment.overallRisk === RiskLevel.HIGH || riskAssessment.overallRisk === RiskLevel.CRITICAL) {
      return {
        effect: PolicyEffect.DENY,
        reason: "High-risk actions are not enabled in this MVP."
      };
    }

    // Risk-tiered decision: LOW-risk (read-only inspections) run without
    // confirmation; MEDIUM-risk (persistent/mutating changes) require explicit
    // confirmation before execution.
    if (riskAssessment.overallRisk === RiskLevel.LOW) {
      return {
        effect: PolicyEffect.ALLOW,
        reason: "Low-risk read-only operation permitted without confirmation."
      };
    }

    return {
      effect: PolicyEffect.CONFIRM,
      reason: "Persistent workspace configuration changes require explicit confirmation."
    };
  }
}
