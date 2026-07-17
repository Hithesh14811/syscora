import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { Memory } from "../../packages/memory/src/index.js";
import crypto from "node:crypto";

test("Memory - store and retrieveRelevant", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "syscora-test-"));
  const memory = new Memory(tempDir);

  const recordId = crypto.randomUUID();
  await memory.store({
    id: recordId,
    type: "EPISODIC",
    content: { message: "Test content" },
    summary: "Test summary",
    provenance: "test",
    confidence: 1.0,
    sensitivity: "LOW",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expiresAt: null,
    relatedEntities: [],
    relatedSession: null,
    relatedIntent: null
  });

  const records = await memory.retrieveRelevant({});
  assert.equal(records.length, 1);
  assert.equal(records[0].id, recordId);

  await memory.close();
});

test("Memory - secrets are redacted", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "syscora-test-"));
  const memory = new Memory(tempDir);

  const secretValue = "sk_test_123456789";
  const recordId = crypto.randomUUID();
  const stored = await memory.store({
    id: recordId,
    type: "EPISODIC",
    content: { apiKey: secretValue },
    summary: "Test secret content",
    provenance: "test",
    confidence: 1.0,
    sensitivity: "LOW",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expiresAt: null,
    relatedEntities: [],
    relatedSession: null,
    relatedIntent: null
  });

  const records = await memory.list({});
  assert.equal(records.length, 1);
  // Secret should be redacted
  assert.notEqual(records[0].content.apiKey, secretValue);
  assert.equal(records[0].content.apiKey, "***REDACTED***");

  await memory.close();
});

test("Memory - delete and expire", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "syscora-test-"));
  const memory = new Memory(tempDir);

  const recordId = crypto.randomUUID();
  await memory.store({
    id: recordId,
    type: "EPISODIC",
    content: { message: "Delete test" },
    summary: "Delete summary",
    provenance: "test",
    confidence: 1.0,
    sensitivity: "LOW",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expiresAt: null,
    relatedEntities: [],
    relatedSession: null,
    relatedIntent: null
  });

  let records = await memory.list({});
  assert.equal(records.length, 1);

  await memory.delete(recordId);
  records = await memory.list({});
  assert.equal(records.length, 0);

  // Test expire
  const expiredRecordId = crypto.randomUUID();
  await memory.store({
    id: expiredRecordId,
    type: "EPISODIC",
    content: { message: "Expired test" },
    summary: "Expired summary",
    provenance: "test",
    confidence: 1.0,
    sensitivity: "LOW",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
    relatedEntities: [],
    relatedSession: null,
    relatedIntent: null
  });

  records = await memory.list({});
  assert.equal(records.length, 1);

  await memory.expire();
  records = await memory.list({});
  assert.equal(records.length, 0);

  await memory.close();
});

test("Memory - recordSuccessfulWorkflow and recordFailurePattern", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "syscora-test-"));
  const memory = new Memory(tempDir);

  await memory.recordSuccessfulWorkflow({ summary: "Success test" });
  await memory.recordFailurePattern({ summary: "Failure test" });

  const records = await memory.list({});
  assert.equal(records.length, 2);

  await memory.close();
});
