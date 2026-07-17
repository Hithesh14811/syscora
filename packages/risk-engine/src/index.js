import { RiskLevel } from "../../shared-types/src/domain.js";

const RISK_ORDER = {
  [RiskLevel.LOW]: 1,
  [RiskLevel.MEDIUM]: 2,
  [RiskLevel.HIGH]: 3,
  [RiskLevel.CRITICAL]: 4
};

export class RiskEngine {
  // Context may be the legacy object ({ currentEnvironment: { exists } }) or the
  // canonical context (an array of collected context items). Tasks may be legacy
  // (task.action.parameters) or canonical (task.capability + task.inputs + task.riskHints).
  assess(plan, context) {
    const tasks = plan?.taskGraph?.tasks ?? [];

    const modifiesExistingEnvFile = this._detectExistingEnv(context);

    // Collect the sensitive-name signal and the highest declared task risk hint.
    let containsSensitiveValue = false;
    let hintRisk = RiskLevel.LOW;
    for (const task of tasks) {
      const key =
        task?.action?.parameters?.key ??
        task?.inputs?.key ??
        "";
      if (/(token|secret|password|key)/i.test(String(key))) {
        containsSensitiveValue = true;
      }
      const hint = task?.riskHints ?? task?.riskEstimate ?? task?.action?.riskLevel;
      if (hint && RISK_ORDER[hint] > RISK_ORDER[hintRisk]) {
        hintRisk = hint;
      }
    }

    const baseRisk =
      modifiesExistingEnvFile || containsSensitiveValue ? RiskLevel.MEDIUM : RiskLevel.LOW;
    const overallRisk = RISK_ORDER[hintRisk] > RISK_ORDER[baseRisk] ? hintRisk : baseRisk;

    return {
      overallRisk,
      dimensions: {
        dataLoss: modifiesExistingEnvFile ? 0.4 : 0.1,
        security: containsSensitiveValue ? 0.5 : 0.2,
        reversibility: 0.1
      },
      evidence: {
        modifiesExistingEnvFile,
        containsSensitiveValue,
        highestRiskHint: hintRisk,
        taskCount: tasks.length
      },
      mitigations: [
        "Create checkpoint before persistent file modification",
        "Require confirmation before write",
        "Verify final file state after execution"
      ]
    };
  }

  _detectExistingEnv(context) {
    if (!context) return false;
    // Legacy shape.
    if (context.currentEnvironment && typeof context.currentEnvironment === "object") {
      return Boolean(context.currentEnvironment.exists);
    }
    // Canonical shape: an array of context items from ContextEngine.
    const items = Array.isArray(context) ? context : context.items;
    if (Array.isArray(items)) {
      for (const item of items) {
        if (item?.type === "environment" && item?.data?.currentEnvironment?.exists) {
          return true;
        }
      }
    }
    return false;
  }
}
