import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export class ApprovalTokenStore {
  constructor(baseDirectory) {
    this.baseDirectory = baseDirectory;
    this.databasePath = path.join(baseDirectory, "approval-tokens.sqlite");
  }

  async ensureSchema() {
    await fs.mkdir(this.baseDirectory, { recursive: true });
    const db = new DatabaseSync(this.databasePath);
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS approval_tokens (
          token TEXT PRIMARY KEY,
          operation TEXT NOT NULL,
          scope TEXT NOT NULL,
          issued_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          consumed_at TEXT
        );
      `);
    } finally {
      db.close();
    }
  }

  async issue(operation, scope, ttlMs = 60000) {
    await this.ensureSchema();
    const token = `priv_${crypto.randomUUID()}`;
    const issuedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    const db = new DatabaseSync(this.databasePath);
    try {
      db.prepare(`
        INSERT INTO approval_tokens (token, operation, scope, issued_at, expires_at, consumed_at)
        VALUES (?, ?, ?, ?, ?, NULL)
      `).run(token, operation, scope, issuedAt, expiresAt);
    } finally {
      db.close();
    }
    return { token, operation, scope, issuedAt, expiresAt };
  }

  async consume(token, operation, scope) {
    await this.ensureSchema();
    const db = new DatabaseSync(this.databasePath);
    try {
      const row = db.prepare(`
        SELECT token, operation, scope, issued_at, expires_at, consumed_at
        FROM approval_tokens
        WHERE token = ?
      `).get(token);
      if (!row) {
        return { valid: false, reason: "Approval token not found." };
      }
      if (row.operation !== operation || row.scope !== scope) {
        return { valid: false, reason: "Approval token scope mismatch." };
      }
      if (row.consumed_at) {
        return { valid: false, reason: "Approval token already consumed." };
      }
      if (new Date(row.expires_at).getTime() < Date.now()) {
        return { valid: false, reason: "Approval token expired." };
      }
      db.prepare("UPDATE approval_tokens SET consumed_at = ? WHERE token = ?")
        .run(new Date().toISOString(), token);
      return {
        valid: true,
        token: row.token,
        operation: row.operation,
        scope: row.scope
      };
    } finally {
      db.close();
    }
  }
}
