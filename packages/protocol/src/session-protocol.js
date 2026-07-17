import { PROTOCOL_VERSION, validateExecutionSession } from "../../shared-types/src/domain.js";

export function buildSessionResponse(session) {
  if (session?.sessions && Array.isArray(session.sessions)) {
    for (const item of session.sessions) {
      validateExecutionSession(item);
    }
  } else if (session?.sessionId) {
    validateExecutionSession(session);
  }
  return {
    protocolVersion: PROTOCOL_VERSION,
    session
  };
}
