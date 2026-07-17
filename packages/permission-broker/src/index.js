import { PolicyEffect } from "../../shared-types/src/domain.js";

export class PermissionBroker {
  constructor({ approvalTokenStore = null, auditRepository = null } = {}) {
    this.approvalTokenStore = approvalTokenStore;
    this.auditRepository = auditRepository;
  }

  evaluate({ policyDecision, autoApprove = false }) {
    if (!policyDecision || !policyDecision.effect) {
      return {
        required: true,
        approved: false,
        reason: "Missing policy decision."
      };
    }

    if (policyDecision.effect === PolicyEffect.DENY) {
      return {
        required: false,
        approved: false,
        reason: policyDecision.reason
      };
    }

    if (policyDecision.effect === PolicyEffect.ALLOW) {
      return {
        required: false,
        approved: true,
        reason: "No additional approval required by policy."
      };
    }

    return {
      required: true,
      approved: autoApprove === true,
      reason: autoApprove === true
        ? "Approval granted by caller."
        : "Approval required for this action."
    };
  }

  evaluatePrivilegeEscalation({ operation, scope, approved = false }) {
    if (!operation || !scope) {
      return {
        approved: false,
        reason: "Operation and scope are required for privilege escalation."
      };
    }
    if (!approved) {
      return {
        approved: false,
        reason: `Privilege escalation requires explicit approval for ${operation} (${scope}).`
      };
    }
    return {
      approved: true,
      reason: `Privilege escalation approved for ${operation} (${scope}).`
    };
  }

  async issuePrivilegeToken({ sessionId = "privileged", operation, scope, approved = false }) {
    const decision = this.evaluatePrivilegeEscalation({ operation, scope, approved });
    if (!decision.approved) {
      if (this.auditRepository) {
        await this.auditRepository.append(sessionId, "PRIVILEGED_TOKEN_DENIED", {
          operation,
          scope,
          reason: decision.reason
        });
      }
      return {
        approved: false,
        reason: decision.reason
      };
    }
    if (!this.approvalTokenStore) {
      return {
        approved: false,
        reason: "Approval token store is not configured."
      };
    }
    const tokenRecord = await this.approvalTokenStore.issue(operation, scope);
    if (this.auditRepository) {
      await this.auditRepository.append(sessionId, "PRIVILEGED_TOKEN_ISSUED", {
        operation,
        scope,
        token: tokenRecord.token,
        expiresAt: tokenRecord.expiresAt
      });
    }
    return {
      approved: true,
      token: tokenRecord.token,
      expiresAt: tokenRecord.expiresAt
    };
  }

  async consumePrivilegeToken({ sessionId = "privileged", token, operation, scope }) {
    if (!this.approvalTokenStore) {
      return {
        valid: false,
        reason: "Approval token store is not configured."
      };
    }
    const result = await this.approvalTokenStore.consume(token, operation, scope);
    if (this.auditRepository) {
      await this.auditRepository.append(sessionId, result.valid ? "PRIVILEGED_TOKEN_CONSUMED" : "PRIVILEGED_TOKEN_REJECTED", {
        operation,
        scope,
        token,
        reason: result.reason ?? "Consumed successfully."
      });
    }
    return result;
  }
}
