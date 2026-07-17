import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createAuditEvent } from "../../shared-types/src/domain.js";
import { redactSensitiveData } from "../../shared-types/src/redaction.js";

export class AuditRepository {
  constructor(baseDirectory) {
    this.baseDirectory = baseDirectory;
    this.databasePath = path.join(baseDirectory, "audit.sqlite");
  }

  async ensureSchema() {
    await fs.mkdir(this.baseDirectory, { recursive: true });
    const db = new DatabaseSync(this.databasePath);
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS audit_events (
          event_id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          event_type TEXT NOT NULL,
          event_timestamp TEXT NOT NULL,
          protocol_version TEXT NOT NULL,
          payload_json TEXT NOT NULL
        );
      `);
    } finally {
      db.close();
    }
  }

  async append(sessionId, eventType, payload) {
    await this.ensureSchema();
    const auditEvent = createAuditEvent(eventType, redactSensitiveData(payload), sessionId);
    const db = new DatabaseSync(this.databasePath);
    try {
      const statement = db.prepare(`
        INSERT INTO audit_events (
          event_id, session_id, event_type, event_timestamp, protocol_version, payload_json
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      statement.run(
        auditEvent.eventId,
        auditEvent.sessionId,
        auditEvent.eventType,
        auditEvent.timestamp,
        auditEvent.protocolVersion,
        JSON.stringify(auditEvent.payload)
      );
    } finally {
      db.close();
    }
    return auditEvent;
  }

  async readAll() {
    await this.ensureSchema();
    const db = new DatabaseSync(this.databasePath);
    try {
      const statement = db.prepare(`
        SELECT event_id, session_id, event_type, event_timestamp, protocol_version, payload_json
        FROM audit_events
        ORDER BY event_timestamp ASC
      `);
      const rows = statement.all();
      return rows.map((row) => ({
        eventId: row.event_id,
        sessionId: row.session_id,
        eventType: row.event_type,
        timestamp: row.event_timestamp,
        protocolVersion: row.protocol_version,
        payload: JSON.parse(row.payload_json)
      }));
    } finally {
      db.close();
    }
  }

  async close() {
    // Since we create a new DB connection per operation, no persistent handle to close
  }
}
