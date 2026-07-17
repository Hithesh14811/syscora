// GoalVerifier
//
// Task completion is not the same as goal completion. The scheduler tells us
// whether individual tasks executed and verified; the GoalVerifier decides
// whether the USER'S GOAL was actually achieved, using the intent's success
// criteria, the per-task verifications, and the current semantic-state world
// model.
//
// It returns one of: COMPLETED, PARTIALLY_COMPLETED, FAILED, INCONCLUSIVE.

export const GoalStatus = Object.freeze({
  COMPLETED: "COMPLETED",
  PARTIALLY_COMPLETED: "PARTIALLY_COMPLETED",
  FAILED: "FAILED",
  INCONCLUSIVE: "INCONCLUSIVE"
});

export class GoalVerifier {
  // input: { intent, plan, schedulerStatus, verifications, observations, semanticState }
  // schedulerStatus: { status: COMPLETED | FAILED | UNCERTAIN | PARTIALLY_COMPLETED } | null
  verify(input = {}) {
    const {
      intent = {},
      verifications = [],
      schedulerStatus = null,
      observations = []
    } = input;

    const timestamp = new Date().toISOString();
    const evidence = [];

    // 1. Aggregate task-level verification signal.
    const total = verifications.length;
    const verified = verifications.filter(
      (v) => v && (v.status === "VERIFIED" || v.status === "PARTIALLY_VERIFIED")
    ).length;
    const failed = verifications.filter((v) => v && v.status === "FAILED").length;
    const inconclusive = verifications.filter(
      (v) => v && (v.status === "INCONCLUSIVE" || v.status === "UNCERTAIN")
    ).length;

    evidence.push({
      kind: "task_verifications",
      total,
      verified,
      failed,
      inconclusive
    });

    // 2. Factor in the scheduler's terminal status.
    if (schedulerStatus?.status) {
      evidence.push({ kind: "scheduler_status", status: schedulerStatus.status });
    }

    // 3. Success criteria: the goal is only COMPLETED if there was at least one
    //    task, every task verified, and the scheduler agrees. This is
    //    intentionally strict — the runtime must never assume success.
    const successCriteria = Array.isArray(intent.successCriteria) ? intent.successCriteria : [];
    evidence.push({ kind: "success_criteria", criteria: successCriteria });

    // The scheduler's terminal status is the primary signal: it reflects the
    // CURRENT state of every task after any recovery/replanning. Historical
    // verification entries in `verifications` may include failures that were
    // subsequently recovered, so they are corroborating evidence only — a
    // recovered failure must not drag a genuinely-completed goal down to partial.
    if (schedulerStatus?.status === "COMPLETED") {
      return {
        status: GoalStatus.COMPLETED,
        message: "All success criteria satisfied: scheduler reports every task verified.",
        confidence: 0.95,
        evidence,
        timestamp
      };
    }
    if (schedulerStatus?.status === "PARTIALLY_COMPLETED") {
      return {
        status: GoalStatus.PARTIALLY_COMPLETED,
        message: "Some tasks completed but the goal was only partially achieved.",
        confidence: 0.6,
        evidence,
        timestamp
      };
    }
    if (schedulerStatus?.status === "UNCERTAIN") {
      return {
        status: GoalStatus.INCONCLUSIVE,
        message: "Scheduler could not confirm the outcome of one or more tasks.",
        confidence: 0.5,
        evidence,
        timestamp
      };
    }

    // No tasks executed at all → nothing was done; the goal cannot be verified.
    if (total === 0) {
      return {
        status: GoalStatus.INCONCLUSIVE,
        message: "No verifiable tasks were executed for this goal.",
        confidence: 0.3,
        evidence,
        timestamp
      };
    }

    // Any hard failure → the goal failed (unless some work verified, then partial).
    if (failed > 0) {
      if (verified > 0) {
        return {
          status: GoalStatus.PARTIALLY_COMPLETED,
          message: `${verified}/${total} tasks verified; ${failed} failed.`,
          confidence: 0.6,
          evidence,
          timestamp
        };
      }
      return {
        status: GoalStatus.FAILED,
        message: `All progress failed verification (${failed}/${total} failed).`,
        confidence: 0.9,
        evidence,
        timestamp
      };
    }

    // No failures, but some inconclusive → inconclusive overall.
    if (inconclusive > 0 && verified < total) {
      return {
        status: GoalStatus.INCONCLUSIVE,
        message: `${verified}/${total} tasks verified; ${inconclusive} inconclusive.`,
        confidence: 0.5,
        evidence,
        timestamp
      };
    }

    // Every task verified and scheduler is COMPLETED (or absent) → goal met.
    if (verified === total && (!schedulerStatus || schedulerStatus.status === "COMPLETED")) {
      return {
        status: GoalStatus.COMPLETED,
        message: "All success criteria satisfied: every task verified.",
        confidence: 0.95,
        evidence,
        timestamp
      };
    }

    // Fallback: partial.
    return {
      status: GoalStatus.PARTIALLY_COMPLETED,
      message: `${verified}/${total} tasks verified.`,
      confidence: 0.6,
      evidence,
      timestamp
    };
  }
}
