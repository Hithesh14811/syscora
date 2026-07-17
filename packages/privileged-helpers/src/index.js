const ALLOWED_OPERATIONS = new Set([
  "service.restart",
  "package.install"
]);

export class PrivilegedOperationHelper {
  constructor({ permissionBroker, adapter }) {
    this.permissionBroker = permissionBroker;
    this.adapter = adapter;
  }

  async issueApprovalToken(operation, scope, options = {}) {
    return this.permissionBroker.issuePrivilegeToken({
      sessionId: options.sessionId,
      operation,
      scope,
      approved: options.approved === true
    });
  }

  async execute(operation, scope, options = {}) {
    if (!ALLOWED_OPERATIONS.has(operation)) {
      return {
        success: false,
        reason: `Operation ${operation} is not in allowed privileged helper list.`
      };
    }
    const tokenDecision = await this.permissionBroker.consumePrivilegeToken({
      sessionId: options.sessionId,
      token: options.token,
      operation,
      scope
    });
    if (!tokenDecision.valid) {
      return {
        success: false,
        reason: tokenDecision.reason,
        requiresApproval: true
      };
    }
    if (!this.adapter) {
      return {
        success: true,
        reason: "Privileged operation approved by scoped helper boundary.",
        operation,
        scope
      };
    }
    if (operation === "service.restart") {
      return this.adapter.executeCommand(process.cwd(), "node", ["-e", `console.log("privileged-helper service.restart ${scope}")`], { timeoutMs: 4000 });
    }
    if (operation === "package.install") {
      return this.adapter.executeCommand(process.cwd(), "node", ["-e", `console.log("privileged-helper package.install ${scope}")`], { timeoutMs: 4000 });
    }
    return {
      success: false,
      reason: `No executor mapped for ${operation}`
    };
  }
}
