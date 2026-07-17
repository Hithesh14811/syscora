import { PROTOCOL_VERSION, ValidationError, assertString } from "../../shared-types/src/domain.js";

export function buildEnvelope(type, payload, requestId = null) {
  assertString(type, "envelope.type");
  return {
    protocolVersion: PROTOCOL_VERSION,
    requestId,
    type,
    timestamp: new Date().toISOString(),
    payload
  };
}

export function validateEnvelope(envelope, expectedType) {
  if (!envelope || typeof envelope !== "object") {
    throw new ValidationError("Envelope must be an object");
  }
  assertString(envelope.protocolVersion, "envelope.protocolVersion");
  assertString(envelope.type, "envelope.type");
  if (expectedType && envelope.type !== expectedType) {
    throw new ValidationError(`Envelope type must be ${expectedType}`);
  }
  if (!("payload" in envelope)) {
    throw new ValidationError("Envelope payload is required");
  }
  return envelope;
}

export function parseRequestBodyWithEnvelope(body, expectedType) {
  if (body?.envelope) {
    const envelope = validateEnvelope(body.envelope, expectedType);
    return {
      requestId: envelope.requestId ?? null,
      payload: envelope.payload
    };
  }
  return {
    requestId: null,
    payload: body
  };
}
