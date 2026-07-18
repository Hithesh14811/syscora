import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";

// Persistent, authoritative store of capability grants. A grant authorizes a
// specific (sessionId, capability) pair to execute, and carries the scope, type,
// expiration and reuse policy that were approved. Enforcement (deny-by-default)
// lives in the PermissionBroker; this store records grants, validates lifetime
// and scope, tracks single-use consumption, and supports revocation.
//
// A grant is NEVER implicitly created: something must explicitly call grant().
// Absence of a valid grant means "denied".
export class CapabilityGrantStore {
  constructor(baseDirectory) {
    this.baseDirectory = baseDirectory;
    this.databasePath = path.join(baseDirectory, "capability-grants.sqlite");
  }

  async ensureSchema() {
    await fs.mkdir(this.baseDirectory, { recursive: true });
    const db = new DatabaseSync(this.databasePath);
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS capability_grants (
          grant_id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          capability TEXT NOT NULL,
          permissions_json TEXT NOT NULL,
          scope_json TEXT NOT NULL,
          type TEXT NOT NULL,
          reuse_policy TEXT NOT NULL,
          issued_at TEXT NOT NULL,
          expires_at TEXT,
          consumed_at TEXT,
          revoked_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_grants_session_capability
          ON capability_grants(session_id, capability);
      `);
    } finally {
      db.close();
    }
  }

  // Record a grant for a session+capability. Returns the grant record.
  async grant({ sessionId, capability, permissions = [], scope = [], type = "READ", reusePolicy = "SESSION_REUSABLE", lifetimeMs = null }) {
    if (!sessionId) throw new Error("CapabilityGrantStore.grant requires sessionId");
    if (!capability) throw new Error("CapabilityGrantStore.grant requires capability");
    await this.ensureSchema();
    const grantId = `grant_${crypto.randomUUID()}`;
    const issuedAt = new Date().toISOString();
    const ttlMs = Number(lifetimeMs ?? 0);
    const expiresAt = ttlMs > 0 ? new Date(Date.now() + ttlMs).toISOString() : null;
    const scopeList = Array.isArray(scope) ? scope : [scope].filter(Boolean);

    const db = new DatabaseSync(this.databasePath);
    try {
      db.prepare(`
        INSERT INTO capability_grants
          (grant_id, session_id, capability, permissions_json, scope_json, type, reuse_policy, issued_at, expires_at, consumed_at, revoked_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
      `).run(
        grantId,
        sessionId,
        capability,
        JSON.stringify(permissions),
        JSON.stringify(scopeList),
        type,
        reusePolicy,
        issuedAt,
        expiresAt
      );
    } finally {
      db.close();
    }
    return { grantId, sessionId, capability, permissions, scope: scopeList, type, reusePolicy, issuedAt, expiresAt };
  }

  // Validate that a currently-usable grant exists for (sessionId, capability)
  // covering every required permission and matching the requested scope. Does
  // NOT consume. Returns { valid, grant?, reason?, missing? }.
  async check({ sessionId, capability, requiredPermissions = [], scope = [] }) {
    await this.ensureSchema();
    const db = new DatabaseSync(this.databasePath);
    try {
      const rows = db.prepare(`
        SELECT * FROM capability_grants
        WHERE session_id = ? AND capability = ?
        ORDER BY issued_at DESC
      `).all(sessionId, capability);
      const now = Date.now();
      let sawExpired = false;
      let sawConsumed = false;
      let sawRevoked = false;
      for (const row of rows) {
        if (row.revoked_at) { sawRevoked = true; continue; }
        if (row.expires_at && new Date(row.expires_at).getTime() < now) { sawExpired = true; continue; }
        if (row.reuse_policy === "SINGLE_USE" && row.consumed_at) { sawConsumed = true; continue; }
        const grant = this._deserialize(row);
        const missing = requiredPermissions.filter((permission) => !grant.permissions.includes(permission));
        if (missing.length > 0) {
          return { valid: false, reason: `Grant missing permissions: ${missing.join(", ")}`, missing, grant };
        }
        const requestedScope = Array.isArray(scope) ? scope : [scope].filter(Boolean);
        const scopeMissing = requestedScope.filter((s) => !grant.scope.includes(s));
        if (scopeMissing.length > 0) {
          return { valid: false, reason: `Grant scope mismatch: needs ${scopeMissing.join(", ")}`, grant };
        }
        return { valid: true, grant };
      }
      if (sawRevoked) return { valid: false, reason: "Capability grant was revoked." };
      if (sawExpired) return { valid: false, reason: "Capability grant expired." };
      if (sawConsumed) return { valid: false, reason: "Single-use capability grant already consumed." };
      return { valid: false, reason: `No capability grant for ${capability}.` };
    } finally {
      db.close();
    }
  }

  // Consume a single-use grant by id so it can never be reused.
  async consume(grantId) {
    if (!grantId) return false;
    await this.ensureSchema();
    const db = new DatabaseSync(this.databasePath);
    try {
      const result = db.prepare("UPDATE capability_grants SET consumed_at = ? WHERE grant_id = ? AND consumed_at IS NULL")
        .run(new Date().toISOString(), grantId);
      return result.changes > 0;
    } finally {
      db.close();
    }
  }

  // Revoke every active grant for a session. Returns the number revoked.
  async revokeSession(sessionId) {
    await this.ensureSchema();
    const db = new DatabaseSync(this.databasePath);
    try {
      const result = db.prepare("UPDATE capability_grants SET revoked_at = ? WHERE session_id = ? AND revoked_at IS NULL")
        .run(new Date().toISOString(), sessionId);
      return result.changes ?? 0;
    } finally {
      db.close();
    }
  }

  _deserialize(row) {
    return {
      grantId: row.grant_id,
      sessionId: row.session_id,
      capability: row.capability,
      permissions: JSON.parse(row.permissions_json),
      scope: JSON.parse(row.scope_json),
      type: row.type,
      reusePolicy: row.reuse_policy,
      issuedAt: row.issued_at,
      expiresAt: row.expires_at,
      consumedAt: row.consumed_at,
      revokedAt: row.revoked_at
    };
  }
}
