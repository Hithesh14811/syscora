import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { SemanticState } from "../../packages/semantic-state/src/index.js";
import crypto from "node:crypto";

test("SemanticState - upsertEntity and queryEntities", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "syscora-test-"));
  const semanticState = new SemanticState(tempDir);

  const entityId = crypto.randomUUID();
  const entity = {
    id: entityId,
    type: "File",
    canonicalKey: "/test/file.txt",
    properties: { size: 100 },
    confidence: 1.0,
    firstSeenAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    provenance: "test"
  };

  await semanticState.upsertEntity(entity);

  const entities = await semanticState.queryEntities({ type: "File" });
  assert.equal(entities.length, 1);
  assert.equal(entities[0].id, entityId);
  assert.equal(entities[0].type, "File");
  assert.equal(entities[0].canonicalKey, "/test/file.txt");
  assert.deepEqual(entities[0].properties, { size: 100 });

  await semanticState.close();
});

test("SemanticState - upsertRelationship and queryRelationships", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "syscora-test-"));
  const semanticState = new SemanticState(tempDir);

  const entity1Id = crypto.randomUUID();
  const entity2Id = crypto.randomUUID();
  const relationshipId = crypto.randomUUID();

  await semanticState.upsertEntity({
    id: entity1Id,
    type: "Directory",
    canonicalKey: "/test",
    properties: {},
    provenance: "test"
  });

  await semanticState.upsertEntity({
    id: entity2Id,
    type: "File",
    canonicalKey: "/test/file.txt",
    properties: {},
    provenance: "test"
  });

  const relationship = {
    id: relationshipId,
    sourceEntityId: entity1Id,
    type: "CONTAINS",
    targetEntityId: entity2Id,
    properties: {},
    confidence: 1.0,
    firstSeenAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    provenance: "test"
  };

  await semanticState.upsertRelationship(relationship);

  const relationships = await semanticState.queryRelationships({
    sourceEntityId: entity1Id
  });
  assert.equal(relationships.length, 1);
  assert.equal(relationships[0].id, relationshipId);
  assert.equal(relationships[0].type, "CONTAINS");

  await semanticState.close();
});

test("SemanticState - getNeighborhood", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "syscora-test-"));
  const semanticState = new SemanticState(tempDir);

  const entity1Id = crypto.randomUUID();
  const entity2Id = crypto.randomUUID();
  const entity3Id = crypto.randomUUID();

  await semanticState.upsertEntity({
    id: entity1Id,
    type: "Directory",
    canonicalKey: "/test",
    properties: {},
    provenance: "test"
  });

  await semanticState.upsertEntity({
    id: entity2Id,
    type: "File",
    canonicalKey: "/test/file1.txt",
    properties: {},
    provenance: "test"
  });

  await semanticState.upsertEntity({
    id: entity3Id,
    type: "File",
    canonicalKey: "/test/file2.txt",
    properties: {},
    provenance: "test"
  });

  await semanticState.upsertRelationship({
    id: crypto.randomUUID(),
    sourceEntityId: entity1Id,
    type: "CONTAINS",
    targetEntityId: entity2Id,
    properties: {},
    provenance: "test"
  });

  await semanticState.upsertRelationship({
    id: crypto.randomUUID(),
    sourceEntityId: entity1Id,
    type: "CONTAINS",
    targetEntityId: entity3Id,
    properties: {},
    provenance: "test"
  });

  const neighborhood = await semanticState.getNeighborhood(entity1Id);
  assert.equal(neighborhood.relationships.length, 2);
  assert.equal(neighborhood.entities.length, 2);

  await semanticState.close();
});

test("SemanticState - markStale", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "syscora-test-"));
  const semanticState = new SemanticState(tempDir);

  const entityId = crypto.randomUUID();
  await semanticState.upsertEntity({
    id: entityId,
    type: "File",
    canonicalKey: "/test/file.txt",
    properties: {},
    provenance: "test"
  });

  const staleAfter = new Date(Date.now() + 3600000).toISOString();
  await semanticState.markStale(entityId, staleAfter);

  const entities = await semanticState.queryEntities({ ids: [entityId] });
  assert.equal(entities[0].staleAfter, staleAfter);

  await semanticState.close();
});

test("SemanticState - createSnapshot and getRelevantState", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "syscora-test-"));
  const semanticState = new SemanticState(tempDir);

  const entityId = crypto.randomUUID();
  await semanticState.upsertEntity({
    id: entityId,
    type: "File",
    canonicalKey: "/test/file.txt",
    properties: {},
    provenance: "test"
  });

  const snapshot = await semanticState.createSnapshot("test-session", [entityId], []);
  assert.equal(snapshot.sessionId, "test-session");
  assert.deepEqual(snapshot.entityIds, [entityId]);

  const relevantState = await semanticState.getRelevantState({});
  assert(relevantState.length >= 1);

  await semanticState.close();
});
