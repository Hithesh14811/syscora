import { isCapabilityHealthy } from "./contract.js";

export class CapabilityLifecyclePipeline {
  constructor({ registry, onEvent = null } = {}) {
    this.registry = registry;
    this.onEvent = onEvent;
  }

  async prepare(task, context = {}) {
    const capability = this.registry.get(task.capability);
    if (!capability) throw new Error(`Unknown capability ${task.capability}`);
    if (!isCapabilityHealthy(capability, context)) throw new Error(`Capability ${task.capability} is not healthy`);
    if (capability.requirements.elevation !== "NONE" && !context.privilegeApproved) {
      throw new Error(`Capability ${task.capability} requires elevation`);
    }
    if (typeof context.authorize === "function") {
      const decision = await context.authorize(capability);
      await this.emit("CAPABILITY_PERMISSION_CHECKED", {
        taskId: task.taskId,
        capability: capability.name,
        approved: Boolean(decision?.approved),
        reason: decision?.reason
      });
      if (!decision?.approved) throw new Error(decision?.reason ?? `Capability ${task.capability} permission denied`);
    }
    if (typeof capability.preconditions === "function" && !capability.preconditions(task.inputs)) {
      throw new Error(`Capability ${task.capability} preconditions failed`);
    }
    await this.emit("CAPABILITY_EXECUTION_PREPARED", { taskId: task.taskId, capability: capability.name, requirements: capability.requirements });
    return capability;
  }

  async emit(type, payload) {
    return this.onEvent?.({ type, timestamp: new Date().toISOString(), ...payload });
  }

  async recordResult(task, result) {
    const capability = this.registry.get(task.capability);
    const type = ["VERIFIED", "PARTIALLY_VERIFIED"].includes(result?.verification?.status)
      ? "CAPABILITY_VERIFIED"
      : "CAPABILITY_FAILED";
    await this.emit(type, { taskId: task.taskId, capability: task.capability, verification: result?.verification });
    if (type === "CAPABILITY_VERIFIED") {
      await this.emit("CAPABILITY_SEMANTIC_UPDATES_REGISTERED", {
        taskId: task.taskId,
        capability: task.capability,
        updates: capability?.semanticUpdates ?? []
      });
      await this.emit("CAPABILITY_MEMORY_UPDATES_REGISTERED", {
        taskId: task.taskId,
        capability: task.capability,
        updates: capability?.memoryUpdates ?? []
      });
    }
    return {
      type,
      semanticUpdates: capability?.semanticUpdates ?? [],
      memoryUpdates: capability?.memoryUpdates ?? [],
      auditEvents: capability?.auditEvents ?? []
    };
  }
}
