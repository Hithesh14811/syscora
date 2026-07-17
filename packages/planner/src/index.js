import crypto from "crypto";
const createId = () => crypto.randomBytes(16).toString("hex");
import { validateSchema } from "../../model-providers/src/index.js";

// Build a canonical scheduler task. Centralizes the task shape so every planner
// path (operation-driven and keyword-driven) produces identical structure.
export function buildTask(capability, inputs = {}, overrides = {}) {
  return {
    taskId: createId(),
    goal: overrides.goal ?? capability,
    description: overrides.description ?? capability,
    dependencies: overrides.dependencies ?? [],
    capability,
    inputs,
    expectedStateChanges: overrides.expectedStateChanges ?? [],
    affectedEntities: overrides.affectedEntities ?? [],
    riskHints: overrides.riskHints ?? "LOW",
    verificationCriteria: overrides.verificationCriteria ?? [`${capability} verified`],
    completionCriteria: overrides.completionCriteria ?? [`${capability} completed`],
    timeout: overrides.timeout ?? 15000,
    retryBudget: overrides.retryBudget ?? 1,
    idempotency: overrides.idempotency ?? true
  };
}

// Operation-driven deterministic plans. Each entry maps a named operation to a
// task graph built directly from structured entities. Compatibility wrappers
// set intent.operation to one of these keys, giving a reliable 1:1 mapping from
// a concrete request to a capability with no natural-language re-parsing.
export const OPERATION_PLANS = {
  "system.inspect": () => [
    buildTask("system.inspect", {}, {
      goal: "Inspect system",
      description: "Retrieve system summary",
      completionCriteria: ["Got system info"],
      timeout: 10000
    })
  ],
  // Aggregate read-only snapshot: system info + top processes + services. The
  // three tasks are independent (no dependencies) so the scheduler can run them
  // together; the wrapper reassembles the classic summary shape from results.
  "system.summary": () => [
    buildTask("system.inspect", {}, {
      goal: "Inspect system",
      description: "Retrieve system summary",
      completionCriteria: ["Got system info"],
      timeout: 10000
    }),
    buildTask("processes.list", {}, {
      goal: "List processes",
      description: "List running processes",
      completionCriteria: ["Got process list"],
      timeout: 15000
    }),
    buildTask("system.services.list", {}, {
      goal: "List services",
      description: "List Windows services",
      completionCriteria: ["Got service list"],
      timeout: 15000
    })
  ],
  "processes.list": () => [
    buildTask("processes.list", {}, {
      goal: "List processes",
      description: "List running processes",
      completionCriteria: ["Got process list"],
      timeout: 15000
    })
  ],
  "process.port.inspect": (e) => [
    buildTask("process.port.inspect", { port: Number(e.port) }, {
      goal: "Inspect port",
      description: "Find process on port",
      completionCriteria: ["Got port info"],
      timeout: 10000
    })
  ],
  "environment.user.inspect": (e) => [
    buildTask("environment.user.inspect", e.key ? { key: e.key } : {}, {
      goal: "Inspect user environment",
      description: "Get user environment / PATH",
      completionCriteria: ["Got env info"],
      timeout: 10000
    })
  ],
  "environment.project.set": (e, ws) => [
    buildTask("environment.project.set", {
      workspacePath: e.workspacePath ?? ws,
      key: e.key,
      value: e.value
    }, {
      goal: "Set project env var",
      description: "Set project environment variable",
      riskHints: "MEDIUM",
      expectedStateChanges: ["env.file"],
      completionCriteria: ["Env var is set and verified"],
      timeout: 10000
    })
  ],
  "environment.user.set": (e) => [
    buildTask("environment.user.set", { key: e.key, value: e.value }, {
      goal: "Set user env var",
      description: "Set Windows user environment variable",
      riskHints: "MEDIUM",
      expectedStateChanges: ["user.environment"],
      completionCriteria: ["User env var is set and verified"],
      timeout: 15000
    })
  ],
  "environment.user.path.add": (e) => [
    buildTask("environment.user.path.add", { entry: e.entry ?? e.value }, {
      goal: "Add PATH entry",
      description: "Add entry to user PATH",
      riskHints: "MEDIUM",
      expectedStateChanges: ["user.path"],
      completionCriteria: ["PATH contains entry"],
      timeout: 15000
    })
  ],
  "package.winget.search": (e) => [
    buildTask("package.winget.search", { query: e.query }, {
      goal: "Search WinGet",
      description: "Search for packages via WinGet",
      completionCriteria: ["WinGet search complete"],
      timeout: 30000
    })
  ],
  "package.winget.install": (e) => [
    buildTask("package.winget.install", { id: e.id ?? e.key }, {
      goal: "Install package",
      description: "Install a package via WinGet",
      riskHints: "MEDIUM",
      expectedStateChanges: ["system.packages"],
      completionCriteria: ["Package installed and verified"],
      timeout: 600000
    })
  ],
  "system.performance.analyze": () => [
    buildTask("system.performance.analyze", {}, {
      goal: "Analyze performance",
      description: "Analyze system performance snapshot",
      completionCriteria: ["Performance analysis complete"],
      timeout: 20000
    })
  ],
  "application.notepad.launch": (e) => [
    buildTask("application.notepad.launch", { content: e.content, filename: e.filename }, {
      goal: "Notepad task",
      description: "Open Notepad, type text, and save",
      riskHints: "MEDIUM",
      expectedStateChanges: ["user.documents"],
      completionCriteria: ["File saved"],
      timeout: 45000,
      idempotency: false
    })
  ],
  "browser.search": (e) => [
    buildTask("browser.search", { query: e.query }, {
      goal: "Browser search",
      description: "Open the default browser to a search results page",
      completionCriteria: ["Browser launched"],
      timeout: 15000
    })
  ],
  // Developer workflow. The caller resolves ordered steps from the project
  // profile (install, run) into entities.steps; the planner turns them into a
  // linear dependency chain of developer.command.run tasks.
  "developer.project.run": (e, ws) => {
    const steps = Array.isArray(e.steps) ? e.steps : [];
    const tasks = [];
    let previousId = null;
    for (const step of steps) {
      const task = buildTask("developer.command.run", {
        workspacePath: e.workspacePath ?? ws,
        command: step.command,
        args: step.args ?? []
      }, {
        goal: step.goal ?? "Run developer command",
        description: step.description ?? `${step.command} ${(step.args ?? []).join(" ")}`.trim(),
        riskHints: "MEDIUM",
        dependencies: previousId ? [previousId] : [],
        completionCriteria: [step.goal ?? "Command completed"],
        timeout: step.timeout ?? 90000
      });
      tasks.push(task);
      previousId = task.taskId;
    }
    return tasks;
  }
};

export class PlanValidator {
  constructor(capabilityRegistry) {
    this.capabilityRegistry = capabilityRegistry;
  }

  validatePlan(taskGraph) {
    const errors = [];
    const visited = new Set();
    const taskMap = new Map(taskGraph.tasks.map(t => [t.taskId, t]));
    const taskIds = new Set();

    // Validate each task
    for (const task of taskGraph.tasks) {
      if (!task.taskId) {
        errors.push("Task must have an ID");
        continue;
      }
      if (taskIds.has(task.taskId)) {
        errors.push(`Duplicate task ID ${task.taskId}`);
      }
      taskIds.add(task.taskId);

      if (!task.capability) {
        errors.push(`Task ${task.taskId} must specify a capability`);
      } else if (!this.capabilityRegistry.has(task.capability)) {
        errors.push(`Unknown capability ${task.capability} for task ${task.taskId}`);
      } else {
        const cap = this.capabilityRegistry.get(task.capability);
        const inputValidation = validateSchema(task.inputs, cap.inputSchema);
        if (!inputValidation.valid) {
          errors.push(`Invalid inputs for task ${task.taskId}: ${inputValidation.errors.join(", ")}`);
        }

        // Check if mutating, but has verification criteria
        if (cap.mutates && (!task.verificationCriteria || task.verificationCriteria.length === 0)) {
          errors.push(`Task ${task.taskId} has a mutating capability but no verification criteria`);
        }
      }

      // Check dependencies
      for (const depId of (task.dependencies || [])) {
        if (!taskMap.has(depId)) errors.push(`Task ${task.taskId} depends on non-existent task ${depId}`);
        if (depId === task.taskId) errors.push(`Task ${task.taskId} cannot depend on itself`);
      }

      // Check retry budget and timeout
      if (task.retryBudget === undefined || task.retryBudget < 0 || task.retryBudget > 10) {
        errors.push(`Task ${task.taskId} has invalid retry budget`);
      }
      if (task.timeout === undefined || task.timeout < 1000 || task.timeout > 300000) {
        errors.push(`Task ${task.taskId} has invalid timeout`);
      }
    }

    // Check for cycles
    for (const task of taskGraph.tasks) {
      if (this.hasCycle(task.taskId, taskMap, visited, new Set())) {
        errors.push(`Cycle detected involving task ${task.taskId}`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  hasCycle(taskId, taskMap, visited, recursionStack) {
    if (recursionStack.has(taskId)) return true;
    if (visited.has(taskId)) return false;
    visited.add(taskId);
    recursionStack.add(taskId);
    const task = taskMap.get(taskId);
    for (const dep of (task?.dependencies || [])) {
      if (this.hasCycle(dep, taskMap, visited, recursionStack)) return true;
    }
    recursionStack.delete(taskId);
    return false;
  }
}

export class GeneralPlanner {
  constructor(modelProvider, capabilityRegistry) {
    this.modelProvider = modelProvider;
    this.capabilityRegistry = capabilityRegistry;
  }

  async generatePlan(
    userIntent, 
    resolvedContext, 
    relevantSemanticState = [], 
    relevantMemory = [], 
    previousExecutionState = null
  ) {
    const catalog = this.capabilityRegistry.getCatalog();
    let plan = null;

    // Use model to generate plan if available, else use deterministic fallback
    if (this.modelProvider) {
      try {
        const prompt = `
          Generate a task plan for this intent using ONLY the registered capabilities.
          
          Intent: ${JSON.stringify(userIntent)}
          Capabilities: ${JSON.stringify(catalog)}
          Context: ${JSON.stringify(resolvedContext.map(c => ({ type: c.type, data: c.data })))}
          Semantic State: ${JSON.stringify(relevantSemanticState)}
          Memory: ${JSON.stringify(relevantMemory)}
          
          Return JSON:
          {
            "planId": "string",
            "planVersion": 1,
            "parentPlanId": null,
            "goal": "string",
            "finalSuccessCriteria": ["string"],
            "summary": "string",
            "taskGraph": {
              "graphId": "string",
              "tasks": [
                {
                  "taskId": "string",
                  "goal": "string",
                  "description": "string",
                  "dependencies": ["taskId"],
                  "capability": "capability.name",
                  "inputs": {},
                  "expectedStateChanges": [],
                  "affectedEntities": [],
                  "riskHints": "LOW/MEDIUM/HIGH",
                  "verificationCriteria": [],
                  "completionCriteria": [],
                  "timeout": 30000,
                  "retryBudget": 1,
                  "idempotency": "true/false"
                }
              ]
            }
          }
        `.trim();
        plan = await this.modelProvider.generateStructured(
          prompt,
          {
            type: "object",
            required: ["planId", "goal", "taskGraph", "finalSuccessCriteria"],
            properties: {
              planId: { type: "string" },
              planVersion: { type: "number" },
              parentPlanId: { type: ["string", "null"] },
              goal: { type: "string" },
              finalSuccessCriteria: { type: "array", items: { type: "string" } },
              summary: { type: "string" },
              taskGraph: { type: "object" }
            }
          },
          { validateSchema: true, timeoutMs: 45000 }
        );
      } catch (e) {
        console.warn("Model-based planning failed, using fallback:", e);
      }
    }

    // Only accept a model-produced plan if it is structurally a plan (has a
    // task graph with a tasks array). Providers such as MockModelProvider may
    // return an object that does not match the plan schema; in that case we
    // fall back to deterministic planning rather than trusting bad output.
    if (!this._isStructurallyPlan(plan)) {
      plan = this.fallbackPlan(userIntent, resolvedContext);
    }

    // Ensure all required fields exist
    plan.planId = plan.planId ?? createId();
    plan.planVersion = plan.planVersion ?? 1;
    plan.parentPlanId = plan.parentPlanId ?? null;
    plan.finalSuccessCriteria = plan.finalSuccessCriteria ?? ["Task completed"];
    plan.taskGraph.graphId = plan.taskGraph.graphId ?? createId();
    return plan;
  }

  _isStructurallyPlan(plan) {
    return Boolean(
      plan &&
      typeof plan === "object" &&
      plan.taskGraph &&
      typeof plan.taskGraph === "object" &&
      Array.isArray(plan.taskGraph.tasks)
    );
  }

  // Deterministic planner. This is the production planner when no real language
  // model is configured. It maps an intent to a task graph in two ways:
  //   1. Operation-driven (preferred): intent.operation names the workflow, and
  //      OPERATION_PLANS[operation] produces the task(s) directly from entities.
  //      Compatibility wrappers use this path for a reliable 1:1 mapping.
  //   2. Keyword-driven (fallback): free-text intents are matched heuristically.
  fallbackPlan(userIntent, resolvedContext) {
    const entities = userIntent.entities || {};
    const workspacePath = entities.workspacePath ?? process.cwd();

    let tasks = [];
    const opBuilder = OPERATION_PLANS[userIntent.operation];
    if (opBuilder) {
      tasks = opBuilder(entities, workspacePath);
    } else {
      tasks = this._keywordTasks(userIntent);
    }

    return {
      planId: createId(),
      planVersion: 1,
      parentPlanId: null,
      goal: userIntent.normalizedGoal,
      finalSuccessCriteria: userIntent.successCriteria?.length
        ? userIntent.successCriteria
        : ["Tasks completed"],
      summary: userIntent.normalizedGoal,
      taskGraph: {
        graphId: createId(),
        tasks
      }
    };
  }

  _keywordTasks(userIntent) {
    const tasks = [];
    const category = userIntent.category;
    const lower = userIntent.rawText.toLowerCase();
    const entities = userIntent.entities || {};

    if (category === "SYSTEM" && lower.includes("system")) {
      tasks.push(buildTask("system.inspect", {}, {
        goal: "Inspect system",
        description: "Retrieve system summary",
        riskHints: "LOW",
        completionCriteria: ["Got system info"],
        timeout: 10000
      }));
    }
    if (category === "SYSTEM" && lower.includes("process")) {
      tasks.push(buildTask("processes.list", {}, {
        goal: "List processes",
        description: "List running processes",
        riskHints: "LOW",
        completionCriteria: ["Got process list"],
        timeout: 15000
      }));
    }
    if (category === "SYSTEM" && entities.port) {
      tasks.push(buildTask("process.port.inspect", { port: entities.port }, {
        goal: "Inspect port",
        description: "Find process on port",
        riskHints: "LOW",
        completionCriteria: ["Got port info"],
        timeout: 10000
      }));
    }
    if (category === "ENVIRONMENT" && lower.includes("path")) {
      tasks.push(buildTask("environment.user.inspect", {}, {
        goal: "Inspect environment",
        description: "Get user environment",
        riskHints: "LOW",
        completionCriteria: ["Got env info"],
        timeout: 5000
      }));
    }
    if (category === "PROJECT" && entities.key && entities.value) {
      tasks.push(buildTask("environment.project.set", {
        workspacePath: entities.workspacePath ?? process.cwd(),
        key: entities.key,
        value: entities.value
      }, {
        goal: "Set env var",
        description: "Set project environment variable",
        riskHints: "MEDIUM",
        expectedStateChanges: ["env.file"],
        completionCriteria: ["Env var is set and verified"],
        timeout: 10000
      }));
    }
    if (category === "APPLICATION" && entities.content && entities.filename) {
      tasks.push(buildTask("application.notepad.launch", {
        content: entities.content,
        filename: entities.filename
      }, {
        goal: "Notepad task",
        description: "Open Notepad and save",
        riskHints: "MEDIUM",
        expectedStateChanges: ["user.documents"],
        completionCriteria: ["File saved"],
        timeout: 45000,
        idempotency: false
      }));
    }
    return tasks;
  }
}
