// Default hard ceiling for a single rollback call. A hung rollback handler must
// not block the recovery/rollback phase indefinitely.
const DEFAULT_ROLLBACK_TIMEOUT_MS = 60000;

// Race a rollback call against a wall-clock deadline with cooperative abort.
function rollbackWithTimeout(fn, timeoutMs, controller) {
  const limit = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_ROLLBACK_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { controller?.abort(); } catch { /* abort is best-effort */ }
      const error = new Error(`Rollback exceeded hard timeout of ${limit}ms`);
      error.name = "TimeoutError";
      error.timedOut = true;
      reject(error);
    }, limit);
    Promise.resolve()
      .then(() => fn(controller?.signal))
      .then((value) => { if (settled) return; settled = true; clearTimeout(timer); resolve(value); })
      .catch((error) => { if (settled) return; settled = true; clearTimeout(timer); reject(error); });
  });
}

// Capability-driven rollback journal. Checkpoints are captured before each
// rollback-capable task and replayed in reverse dependency order.
export class RollbackManager {
  constructor(capabilityRegistry) {
    this.capabilityRegistry = capabilityRegistry;
  }

  async capture(task) {
    const capability = this.capabilityRegistry.get(task.capability);
    if (!capability || capability.reversibility !== "ROLLBACK_SUPPORTED") return null;
    return {
      taskId: task.taskId,
      capability: task.capability,
      inputs: structuredClone(task.inputs ?? {}),
      dependencies: [...(task.dependencies ?? [])],
      checkpoint: await capability.createCheckpoint(task.inputs ?? {})
    };
  }

  async rollback(records = []) {
    const ordered = this._reverseDependencyOrder(records);
    const entries = [];
    for (const record of ordered) {
      const capability = this.capabilityRegistry.get(record.capability);
      const controller = new AbortController();
      const timeoutMs = Number(capability?.performance?.timeoutMs ?? capability?.timeout ?? DEFAULT_ROLLBACK_TIMEOUT_MS);
      try {
        await rollbackWithTimeout(
          (signal) => capability.rollback(record.inputs, record.checkpoint, { signal }),
          timeoutMs,
          controller
        );
        entries.push({ taskId: record.taskId, capability: record.capability, status: "ROLLED_BACK" });
      } catch (error) {
        entries.push({
          taskId: record.taskId,
          capability: record.capability,
          status: "FAILED",
          timedOut: Boolean(error?.timedOut),
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    return { rolledBack: entries.length > 0 && entries.every((entry) => entry.status === "ROLLED_BACK"), entries };
  }

  _reverseDependencyOrder(records) {
    const byTaskId = new Map(records.map((record) => [record.taskId, record]));
    const visited = new Set();
    const ordered = [];
    const visit = (record) => {
      if (visited.has(record.taskId)) return;
      visited.add(record.taskId);
      for (const dependency of record.dependencies ?? []) {
        const dependencyRecord = byTaskId.get(dependency);
        if (dependencyRecord) visit(dependencyRecord);
      }
      ordered.push(record);
    };
    for (const record of records) visit(record);
    return ordered.reverse();
  }
}
