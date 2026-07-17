// Deterministic failure-diagnosis pipeline.
//
//   Failure -> Evidence -> Classification -> Root Cause -> Confidence -> Recovery
//
// The engine consumes the full evidence set available to the runtime (execution
// result, observation, verification, semantic state, memory) and produces a
// structured diagnosis with a suggested recovery action the RecoveryEngine can
// act on. It is intentionally deterministic (pattern-based) so behavior is
// reproducible without a language model.

export const FailureClass = Object.freeze({
  PERMISSION: "PERMISSION",
  DEPENDENCY: "DEPENDENCY",
  TIMEOUT: "TIMEOUT",
  VERIFICATION_FAILURE: "VERIFICATION_FAILURE",
  RESOURCE_UNAVAILABLE: "RESOURCE_UNAVAILABLE",
  APPLICATION_STATE_MISMATCH: "APPLICATION_STATE_MISMATCH",
  ENVIRONMENT: "ENVIRONMENT",
  NETWORK: "NETWORK",
  UNSUPPORTED_CAPABILITY: "UNSUPPORTED_CAPABILITY",
  UNEXPECTED: "UNEXPECTED"
});

// Recovery strategies the RecoveryEngine understands.
export const RecoveryAction = Object.freeze({
  RETRY: "RETRY",
  RETRY_WITH_BACKOFF: "RETRY_WITH_BACKOFF",
  REFRESH_CONTEXT: "REFRESH_CONTEXT",
  COLLECT_OBSERVATIONS: "COLLECT_OBSERVATIONS",
  CHANGE_PARAMETERS: "CHANGE_PARAMETERS",
  REQUEST_PERMISSION: "REQUEST_PERMISSION",
  REQUEST_CLARIFICATION: "REQUEST_CLARIFICATION",
  ROLLBACK: "ROLLBACK",
  REPLAN: "REPLAN",
  ABORT: "ABORT"
});

export class TroubleshootingEngine {
  // Legacy shallow API kept for backward compatibility (still used by some
  // callers/tests). Returns { category, summary, suggestedNextSteps }.
  analyze(actionResult) {
    const output = actionResult?.output ?? {};
    const combined = `${output.stderr ?? ""}\n${output.stdout ?? ""}`;
    const match = this._matchText(combined);
    return {
      category: match.legacyCategory,
      summary: match.summary,
      suggestedNextSteps: match.nextSteps
    };
  }

  // Full diagnosis pipeline. Input:
  //   { task, capability, executionResult, observation, verification,
  //     semanticState, memory, attempt, recoveryBudgetRemaining }
  // Output: a structured diagnosis object.
  diagnose(input = {}) {
    const {
      task = null,
      capability = null,
      executionResult = null,
      observation = null,
      verification = null,
      attempt = 0,
      recoveryBudgetRemaining = 0
    } = input;

    const evidence = this._collectEvidence({ executionResult, observation, verification });
    const classification = this._classify({ evidence, capability, verification, executionResult });

    // Whether a recovery action is even worth attempting depends on the class
    // and remaining budget.
    const suggestedRecovery = this._suggestRecovery(classification.failureClass, {
      attempt,
      recoveryBudgetRemaining,
      capability,
      evidence
    });

    return {
      // `category` is the canonical field the RecoveryEngine keys off; it
      // mirrors failureClass (kept for readability/back-compat).
      category: classification.failureClass,
      failureClass: classification.failureClass,
      rootCause: classification.rootCause,
      confidence: classification.confidence,
      evidence,
      suggestedRecovery,
      taskId: task?.taskId ?? null,
      capability: capability?.name ?? task?.capability ?? null,
      timestamp: new Date().toISOString()
    };
  }

  _collectEvidence({ executionResult, observation, verification }) {
    const stderr = executionResult?.stderr ?? executionResult?.error ?? "";
    const stdout = executionResult?.stdout ?? "";
    const exitCode = executionResult?.exitCode;
    const timedOut = Boolean(executionResult?.timedOut);
    return {
      exitCode: exitCode ?? null,
      timedOut,
      stderr: String(stderr),
      stdout: String(stdout),
      verificationStatus: verification?.status ?? null,
      verificationMessage: verification?.message ?? null,
      observedState: observation?.structuredState ?? null,
      detectedChanges: observation?.detectedChanges ?? []
    };
  }

  _classify({ evidence, capability, verification, executionResult }) {
    const combined = `${evidence.stderr}\n${evidence.stdout}\n${evidence.verificationMessage ?? ""}`;

    // 1. Timeout is unambiguous.
    if (evidence.timedOut) {
      return {
        failureClass: FailureClass.TIMEOUT,
        rootCause: "The operation exceeded its allotted time and was terminated.",
        confidence: 0.9
      };
    }

    // 2. Unsupported capability (not registered / not available).
    if (executionResult?.error && /unknown capability|not registered|unavailable/i.test(executionResult.error)) {
      return {
        failureClass: FailureClass.UNSUPPORTED_CAPABILITY,
        rootCause: "The requested capability is not available in the registry.",
        confidence: 0.95
      };
    }

    // 3. Text-pattern matching on evidence.
    const match = this._matchText(combined);
    if (match.failureClass !== FailureClass.UNEXPECTED) {
      return {
        failureClass: match.failureClass,
        rootCause: match.summary,
        confidence: match.confidence
      };
    }

    // 4. If execution "succeeded" (no error/exit) but verification failed, the
    // observed state did not match the expected outcome.
    if (verification && verification.status !== "VERIFIED" && verification.status !== "PARTIALLY_VERIFIED") {
      const nonZeroExit = typeof evidence.exitCode === "number" && evidence.exitCode !== 0;
      if (nonZeroExit) {
        return {
          failureClass: FailureClass.APPLICATION_STATE_MISMATCH,
          rootCause: `The command exited with code ${evidence.exitCode} and the expected state was not reached.`,
          confidence: 0.7
        };
      }
      return {
        failureClass: FailureClass.VERIFICATION_FAILURE,
        rootCause: verification.message
          ? `Verification failed: ${verification.message}`
          : "Execution reported success but observation did not match the expected state.",
        confidence: 0.75
      };
    }

    return {
      failureClass: FailureClass.UNEXPECTED,
      rootCause: "No specific failure pattern matched the available evidence.",
      confidence: 0.3
    };
  }

  _matchText(combined) {
    if (/permission denied|EACCES|EPERM|access is denied|requires elevation|administrator/i.test(combined)) {
      return {
        failureClass: FailureClass.PERMISSION,
        legacyCategory: "PERMISSION_ERROR",
        summary: "The action failed because of insufficient permissions.",
        confidence: 0.85,
        nextSteps: ["Request a scoped privileged approval", "Review target permissions"]
      };
    }
    if (/Cannot find module|ModuleNotFoundError|No module named|is not recognized|command not found|ENOENT/i.test(combined)) {
      return {
        failureClass: FailureClass.DEPENDENCY,
        legacyCategory: "MISSING_DEPENDENCY",
        summary: "A required dependency, module, or executable is missing.",
        confidence: 0.8,
        nextSteps: ["Install the missing dependency", "Verify the tool is on PATH"]
      };
    }
    if (/npm ERR|pnpm ERR|yarn .*error/i.test(combined)) {
      return {
        failureClass: FailureClass.DEPENDENCY,
        legacyCategory: "PACKAGE_MANAGER_FAILURE",
        summary: "The package manager reported an install or script failure.",
        confidence: 0.7,
        nextSteps: ["Inspect package manager output", "Retry with an alternate package manager"]
      };
    }
    if (/EADDRINUSE|address already in use|port .* already in use/i.test(combined)) {
      return {
        failureClass: FailureClass.RESOURCE_UNAVAILABLE,
        legacyCategory: "PORT_CONFLICT",
        summary: "A required resource (e.g. a port) is already in use.",
        confidence: 0.85,
        nextSteps: ["Inspect processes holding the resource", "Free the resource or choose another"]
      };
    }
    if (/ETIMEDOUT|ENOTFOUND|ECONNREFUSED|ECONNRESET|network is unreachable|getaddrinfo/i.test(combined)) {
      return {
        failureClass: FailureClass.NETWORK,
        legacyCategory: "NETWORK_ERROR",
        summary: "A network operation failed (DNS, connection, or reachability).",
        confidence: 0.8,
        nextSteps: ["Check connectivity", "Retry with backoff"]
      };
    }
    if (/no space left|ENOSPC|out of memory|ENOMEM|disk full/i.test(combined)) {
      return {
        failureClass: FailureClass.RESOURCE_UNAVAILABLE,
        legacyCategory: "RESOURCE_EXHAUSTED",
        summary: "A system resource (disk or memory) was exhausted.",
        confidence: 0.8,
        nextSteps: ["Free disk/memory", "Reduce workload"]
      };
    }
    if (/environment variable|not set|undefined variable|missing env/i.test(combined)) {
      return {
        failureClass: FailureClass.ENVIRONMENT,
        legacyCategory: "ENVIRONMENT_ERROR",
        summary: "The environment is not configured as expected.",
        confidence: 0.6,
        nextSteps: ["Inspect environment", "Set the required variable"]
      };
    }
    return {
      failureClass: FailureClass.UNEXPECTED,
      legacyCategory: "UNKNOWN_FAILURE",
      summary: "No specific root cause pattern matched the output.",
      confidence: 0.3,
      nextSteps: ["Inspect stderr/stdout", "Refresh context", "Retry with bounded recovery"]
    };
  }

  _suggestRecovery(failureClass, { attempt, recoveryBudgetRemaining, capability }) {
    if (recoveryBudgetRemaining <= 0) {
      return { action: RecoveryAction.ABORT, reason: "Recovery budget exhausted." };
    }
    switch (failureClass) {
      case FailureClass.TIMEOUT:
      case FailureClass.NETWORK:
        return { action: RecoveryAction.RETRY_WITH_BACKOFF, reason: "Transient failure; retry with backoff." };
      case FailureClass.RESOURCE_UNAVAILABLE:
        return { action: RecoveryAction.REPLAN, reason: "Resource conflict; replan to free or avoid the resource." };
      case FailureClass.PERMISSION:
        return { action: RecoveryAction.REQUEST_PERMISSION, reason: "Insufficient privileges; explicit approval required." };
      case FailureClass.DEPENDENCY:
      case FailureClass.ENVIRONMENT:
        return { action: RecoveryAction.REPLAN, reason: "Missing prerequisite; replan to satisfy it first." };
      case FailureClass.VERIFICATION_FAILURE:
        return { action: RecoveryAction.COLLECT_OBSERVATIONS, reason: "Re-observe to confirm actual state before deciding." };
      case FailureClass.APPLICATION_STATE_MISMATCH:
        return { action: RecoveryAction.REPLAN, reason: "Observed state diverged from expectation; replan." };
      case FailureClass.UNSUPPORTED_CAPABILITY:
        return { action: RecoveryAction.ABORT, reason: "No capability can satisfy this task." };
      default:
        // Unknown: one bounded retry, otherwise replan.
        return attempt < 1
          ? { action: RecoveryAction.RETRY, reason: "Unclassified failure; single bounded retry." }
          : { action: RecoveryAction.REPLAN, reason: "Unclassified failure persisted; replan." };
    }
  }
}
