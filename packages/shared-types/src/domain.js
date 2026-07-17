import crypto from "node:crypto";

export const PROTOCOL_VERSION = "0.1.0";

export const RuntimeState = Object.freeze({
  RECEIVE_INTENT: "RECEIVE_INTENT",
  BUILD_CONTEXT: "BUILD_CONTEXT",
  GENERATE_PLAN: "GENERATE_PLAN",
  ASSESS_RISK: "ASSESS_RISK",
  APPLY_POLICY: "APPLY_POLICY",
  REQUEST_CONFIRMATION_IF_REQUIRED: "REQUEST_CONFIRMATION_IF_REQUIRED",
  EXECUTE_NEXT_ACTION: "EXECUTE_NEXT_ACTION",
  OBSERVE_RESULT: "OBSERVE_RESULT",
  VERIFY_RESULT: "VERIFY_RESULT",
  UPDATE_SEMANTIC_STATE: "UPDATE_SEMANTIC_STATE",
  UPDATE_MEMORY: "UPDATE_MEMORY",
  VERIFY_FINAL_GOAL: "VERIFY_FINAL_GOAL",
  GENERATE_RESPONSE: "GENERATE_RESPONSE",
  PAUSED: "PAUSED",
  CANCELLED: "CANCELLED",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  ROLLED_BACK: "ROLLED_BACK",
  CLARIFICATION_REQUIRED: "CLARIFICATION_REQUIRED",
  // States used by the canonical graph runtime (submitIntent).
  AMBIGUOUS_INTENT: "AMBIGUOUS_INTENT",
  VALIDATE_PLAN: "VALIDATE_PLAN",
  PLAN_REJECTED: "PLAN_REJECTED",
  EXECUTING: "EXECUTING",
  DIAGNOSING: "DIAGNOSING",
  RECOVERING: "RECOVERING",
  ROLLING_BACK: "ROLLING_BACK"
});

export const RiskLevel = Object.freeze({
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  CRITICAL: "CRITICAL"
});

export const PolicyEffect = Object.freeze({
  ALLOW: "ALLOW",
  CONFIRM: "CONFIRM",
  DENY: "DENY"
});

export const ActionType = Object.freeze({
  FILE_READ: "FileReadAction",
  ENVIRONMENT_VARIABLE_SET: "EnvironmentVariableSetAction",
  ENVIRONMENT_VARIABLE_READ: "EnvironmentVariableReadAction",
  FILE_ROLLBACK: "FileRollbackAction",
  COMMAND_EXECUTION: "CommandExecutionAction",
  PROCESS_START: "ProcessStartAction",
  USER_PATH_SET: "UserPathSetAction",
  WINGET_SEARCH: "WinGetSearchAction",
  WINGET_INSTALL: "WinGetInstallAction",
  PORT_INSPECT: "PortInspectAction"
});

export class ValidationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ValidationError";
    this.details = details;
  }
}

export function createId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function assertString(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ValidationError(`${fieldName} must be a non-empty string`);
  }
}

export function assertEnum(value, values, fieldName) {
  if (!Object.values(values).includes(value)) {
    throw new ValidationError(`${fieldName} must be one of ${Object.values(values).join(", ")}`);
  }
}

export function validateIntent(intent) {
  assertString(intent.rawText, "intent.rawText");
  if (!intent.entities || typeof intent.entities !== "object") {
    throw new ValidationError("intent.entities must be an object");
  }
  if (intent.intentType) {
    return intent;
  }
  // workspacePath should always be present
  assertString(intent.entities.workspacePath, "intent.entities.workspacePath");
  // key and value are only required for environment setting intents, not all intents
  return intent;
}

export function validateAction(action) {
  assertString(action.actionId, "action.actionId");
  assertEnum(action.actionType, ActionType, "action.actionType");
  assertString(action.description, "action.description");
  if (!action.parameters || typeof action.parameters !== "object") {
    throw new ValidationError("action.parameters must be an object");
  }
  if (!Array.isArray(action.requiredCapabilities)) {
    throw new ValidationError("action.requiredCapabilities must be an array");
  }
  if (!Array.isArray(action.requiredPermissions)) {
    throw new ValidationError("action.requiredPermissions must be an array");
  }
  if (!Array.isArray(action.dependencies)) {
    throw new ValidationError("action.dependencies must be an array");
  }
  if (!action.timeout || typeof action.timeout !== "object") {
    throw new ValidationError("action.timeout must be an object");
  }
  if (!action.retryPolicy || typeof action.retryPolicy !== "object") {
    throw new ValidationError("action.retryPolicy must be an object");
  }
  return action;
}

export function validateTaskGraph(taskGraph) {
  if (!taskGraph || !Array.isArray(taskGraph.tasks) || taskGraph.tasks.length === 0) {
    throw new ValidationError("taskGraph.tasks must contain at least one task");
  }
  assertString(taskGraph.graphId, "taskGraph.graphId");
  for (const task of taskGraph.tasks) {
    assertString(task.taskId, "task.taskId");
    if (!Array.isArray(task.dependencies)) {
      throw new ValidationError("task.dependencies must be an array");
    }
    // Two task shapes are supported: the canonical scheduler shape
    // (task.capability, validated in depth by PlanValidator) and the legacy
    // typed-action shape (task.selectedCapability + task.action). Detect which
    // one this is and validate accordingly.
    const canonicalCapability = task.capability ?? task.selectedCapability;
    assertString(canonicalCapability, "task.capability");
    if (task.action) {
      assertString(task.description, "task.description");
      if (!Array.isArray(task.completionCriteria) || task.completionCriteria.length === 0) {
        throw new ValidationError("task.completionCriteria must contain at least one value");
      }
      validateAction(task.action);
    }
  }
  return taskGraph;
}

export function validateExecutionPlan(plan) {
  if (!plan || typeof plan !== "object") {
    throw new ValidationError("plan must be an object");
  }
  assertString(plan.planId, "plan.planId");
  assertString(plan.goal, "plan.goal");
  assertString(plan.summary, "plan.summary");
  validateTaskGraph(plan.taskGraph);
  return plan;
}

export function validateActionResult(actionResult) {
  if (!actionResult || typeof actionResult !== "object") {
    throw new ValidationError("actionResult must be an object");
  }
  assertString(actionResult.resultId, "actionResult.resultId");
  assertString(actionResult.actionId, "actionResult.actionId");
  assertString(actionResult.status, "actionResult.status");
  if (!actionResult.output || typeof actionResult.output !== "object") {
    throw new ValidationError("actionResult.output must be an object");
  }
  if (typeof actionResult.attempt !== "number") {
    throw new ValidationError("actionResult.attempt must be a number");
  }
  return actionResult;
}

export function validateExecutionSession(session) {
  if (!session || typeof session !== "object") {
    throw new ValidationError("session must be an object");
  }
  assertString(session.sessionId, "session.sessionId");
  assertString(session.createdAt, "session.createdAt");
  assertEnum(session.currentState, RuntimeState, "session.currentState");
  if (session.intent) {
    if (session.intent.intentType) {
      assertString(session.intent.rawText, "intent.rawText");
    } else {
      validateIntent(session.intent);
    }
  }
  if (session.plan) {
    validateExecutionPlan(session.plan);
  }
  if (!Array.isArray(session.taskResults)) {
    throw new ValidationError("session.taskResults must be an array");
  }
  return session;
}

export function createAuditEvent(eventType, payload, sessionId) {
  return {
    eventId: createId("audit"),
    sessionId,
    eventType,
    payload,
    protocolVersion: PROTOCOL_VERSION,
    timestamp: new Date().toISOString()
  };
}
