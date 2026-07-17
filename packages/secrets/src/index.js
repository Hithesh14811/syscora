import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { redactSensitiveData } from "../../shared-types/src/redaction.js";

function escapePs(value) {
  return String(value).replace(/'/g, "''");
}

export class WindowsSecretBroker {
  constructor(baseDirectory) {
    this.baseDirectory = baseDirectory;
    this.databasePath = path.join(baseDirectory, "secrets.sqlite");
  }

  async ensureSchema() {
    await fs.mkdir(this.baseDirectory, { recursive: true });
    const db = new DatabaseSync(this.databasePath);
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS secret_metadata (
          secret_ref TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL,
          scope TEXT NOT NULL
        );
      `);
    } finally {
      db.close();
    }
  }

  async storeSecret(name, value, scope = "user") {
    await this.ensureSchema();
    const secretRef = `secret_${crypto.randomUUID()}`;
    const dpapiPath = path.join(this.baseDirectory, `${secretRef}.bin`);
    const { spawn } = await import("node:child_process");
    const script =
      `$bytes = [Text.Encoding]::UTF8.GetBytes('${escapePs(value)}'); ` +
      `$prot = [System.Security.Cryptography.ProtectedData]::Protect($bytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); ` +
      `[IO.File]::WriteAllBytes('${escapePs(dpapiPath)}',$prot)`;
    await new Promise((resolve, reject) => {
      const child = spawn("powershell.exe", ["-NoProfile", "-Command", script], { stdio: "ignore" });
      child.on("close", (code) => (code === 0 ? resolve() : reject(new Error("DPAPI protect failed"))));
    });
    const db = new DatabaseSync(this.databasePath);
    try {
      db.prepare(
        `INSERT INTO secret_metadata (secret_ref, name, created_at, scope) VALUES (?, ?, ?, ?)`
      ).run(secretRef, name, new Date().toISOString(), scope);
    } finally {
      db.close();
    }
    return { secretRef, name, scope };
  }

  async retrieveSecret(secretRef) {
    await this.ensureSchema();
    const dpapiPath = path.join(this.baseDirectory, `${secretRef}.bin`);
    const { spawn } = await import("node:child_process");
    const script =
      `$prot = [IO.File]::ReadAllBytes('${escapePs(dpapiPath)}'); ` +
      `$bytes = [System.Security.Cryptography.ProtectedData]::Unprotect($prot,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); ` +
      `[Text.Encoding]::UTF8.GetString($bytes)`;
    const value = await new Promise((resolve, reject) => {
      const child = spawn("powershell.exe", ["-NoProfile", "-Command", script], { stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      child.stdout.on("data", (c) => { out += c.toString(); });
      child.on("close", (code) => (code === 0 ? resolve(out.trim()) : reject(new Error("DPAPI unprotect failed"))));
    });
    return value;
  }

  async listMetadata() {
    await this.ensureSchema();
    const db = new DatabaseSync(this.databasePath);
    try {
      return db.prepare(`SELECT secret_ref, name, created_at, scope FROM secret_metadata ORDER BY created_at DESC`).all();
    } finally {
      db.close();
    }
  }

  redactForAudit(payload) {
    return redactSensitiveData(payload);
  }
}
