import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { redactSensitiveData } from "../../shared-types/src/redaction.js";

export class SessionStore {
  constructor(baseDirectory) {
    this.baseDirectory = baseDirectory;
    this.databasePath = path.join(baseDirectory, "sessions.sqlite");
  }

  async ensureSchema() {
    await fs.mkdir(this.baseDirectory, { recursive: true });
    const db = new DatabaseSync(this.databasePath);
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          session_id TEXT PRIMARY KEY,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          state TEXT NOT NULL,
          session_json TEXT NOT NULL
        );
      `);
    } finally {
      db.close();
    }
  }

  async save(session) {
    await this.ensureSchema();
    const sanitized = redactSensitiveData(session);
    const db = new DatabaseSync(this.databasePath);
    try {
      const statement = db.prepare(`
        INSERT INTO sessions (session_id, created_at, updated_at, state, session_json)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          updated_at=excluded.updated_at,
          state=excluded.state,
          session_json=excluded.session_json
      `);
      statement.run(
        sanitized.sessionId,
        sanitized.createdAt,
        new Date().toISOString(),
        sanitized.currentState ?? "UNKNOWN",
        JSON.stringify(sanitized)
      );
    } finally {
      db.close();
    }
  }

  async get(sessionId) {
    await this.ensureSchema();
    const db = new DatabaseSync(this.databasePath);
    try {
      const statement = db.prepare("SELECT session_json FROM sessions WHERE session_id = ?");
      const row = statement.get(sessionId);
      if (!row) {
        throw new Error(`Session not found: ${sessionId}`);
      }
      return JSON.parse(row.session_json);
    } finally {
      db.close();
    }
  }

  async list() {
    await this.ensureSchema();
    const db = new DatabaseSync(this.databasePath);
    try {
      const statement = db.prepare("SELECT session_json FROM sessions ORDER BY created_at ASC");
      const rows = statement.all();
      return rows.map((row) => JSON.parse(row.session_json));
    } finally {
      db.close();
    }
  }
}
