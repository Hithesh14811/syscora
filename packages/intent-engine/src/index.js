import { redactSensitiveData } from "../../shared-types/src/redaction.js";
import { validateSchema } from "../../model-providers/src/index.js";
import crypto from "crypto";
const createId = () => crypto.randomBytes(16).toString("hex");

const USER_INTENT_SCHEMA = {
  type: "object",
  required: ["intentId", "rawText", "normalizedGoal", "category", "successCriteria"],
  properties: {
    intentId: { type: "string" },
    rawText: { type: "string" },
    normalizedGoal: { type: "string" },
    category: { type: "string" },
    operation: { type: "string" },
    entities: { type: "object" },
    constraints: { type: "array", items: { type: "string" } },
    successCriteria: { type: "array", items: { type: "string" } },
    requiredContext: { type: "array", items: { type: "string" } },
    ambiguity: { type: "boolean" },
    clarificationQuestions: { type: "array", items: { type: "string" } },
    sensitivityFlags: { type: "array", items: { type: "string" } }
  }
};

export class IntentEngine {
  constructor(modelProvider) {
    this.modelProvider = modelProvider;
  }

  async classify(rawText, context = {}) {
    const intentId = createId();
    const text = String(rawText ?? "").trim();
    const lower = text.toLowerCase();
    let modelResult = null;

    // Explicit-operation fast path. When a caller supplies a structured
    // `operation` (and optionally `entities`/`category`), we trust it and build
    // the intent deterministically without consulting the model. This is the
    // canonical bridge used by compatibility wrappers to translate a concrete
    // request into an intent that the deterministic planner maps 1:1 to a
    // capability. It removes all reliance on natural-language re-parsing.
    if (context.operation) {
      const intent = {
        intentId,
        rawText: text || context.operation,
        normalizedGoal: context.normalizedGoal || context.operation,
        category: context.category || "SYSTEM",
        operation: context.operation,
        entities: {
          workspacePath: context.workspacePath ?? process.cwd(),
          ...(context.entities || {})
        },
        constraints: [],
        successCriteria: Array.isArray(context.successCriteria) ? context.successCriteria : ["Operation completed and verified"],
        requiredContext: Array.isArray(context.requiredContext) ? context.requiredContext : [],
        ambiguity: false,
        clarificationQuestions: [],
        sensitivityFlags: []
      };
      const validation = validateSchema(intent, USER_INTENT_SCHEMA);
      if (!validation.valid) {
        throw new Error(`Invalid UserIntent: ${validation.errors.join(", ")}`);
      }
      return intent;
    }

    if (this.modelProvider) {
      try {
        const prompt = `
          Parse this Windows computer task request into structured intent.
          
          Request: ${text}
          
          Return JSON with:
          - normalizedGoal: clear goal description
          - category: one of SYSTEM, PROJECT, APPLICATION, BROWSER, DEVELOPER, ENVIRONMENT
          - entities: key-value pairs of extracted parameters
          - successCriteria: array of strings to verify the goal is met
          - requiredContext: array of context types needed (system, processes, port, environment, workspace, filesystem)
          - ambiguity: boolean (true if request is unclear)
          - clarificationQuestions: array of strings if ambiguous
        `.trim();
        const redactedPrompt = redactSensitiveData({ prompt });
        modelResult = await this.modelProvider.generateStructured(
          redactedPrompt.prompt,
          {
            type: "object",
            required: ["normalizedGoal", "category", "entities", "successCriteria"],
            properties: {
              normalizedGoal: { type: "string" },
              category: { type: "string" },
              entities: { type: "object" },
              constraints: { type: "array", items: { type: "string" } },
              successCriteria: { type: "array", items: { type: "string" } },
              requiredContext: { type: "array", items: { type: "string" } },
              ambiguity: { type: "boolean" },
              clarificationQuestions: { type: "array", items: { type: "string" } },
              sensitivityFlags: { type: "array", items: { type: "string" } }
            }
          },
          { validateSchema: true, timeoutMs: 30000 }
        );
      } catch (e) {
        // Fallback to deterministic classifier if model fails
        console.warn("Model-based intent classification failed, falling back to deterministic:", e);
      }
    }

    // Build final intent, using model result if available, else deterministic
    const intent = {
      intentId,
      rawText: text,
      normalizedGoal: modelResult?.normalizedGoal || this.getNormalizedGoal(lower, text),
      category: modelResult?.category || this.getCategory(lower),
      entities: {
        // Always guarantee a workspacePath so every intent satisfies domain
        // validation; model/deterministic entities override the default.
        workspacePath: context.workspacePath ?? process.cwd(),
        ...(modelResult?.entities || this.extractEntities(lower, text, context))
      },
      constraints: Array.isArray(modelResult?.constraints) ? modelResult.constraints : [],
      successCriteria: Array.isArray(modelResult?.successCriteria) ? modelResult.successCriteria : this.getSuccessCriteria(lower),
      requiredContext: Array.isArray(modelResult?.requiredContext) ? modelResult.requiredContext : this.getRequiredContext(lower),
      ambiguity: modelResult?.ambiguity || false,
      clarificationQuestions: Array.isArray(modelResult?.clarificationQuestions) ? modelResult.clarificationQuestions : [],
      sensitivityFlags: Array.isArray(modelResult?.sensitivityFlags) ? modelResult.sensitivityFlags : []
    };

    // Validate schema
    const validation = validateSchema(intent, USER_INTENT_SCHEMA);
    if (!validation.valid) {
      throw new Error(`Invalid UserIntent: ${validation.errors.join(", ")}`);
    }

    return intent;
  }

  getCategory(lower) {
    if (lower.includes("port") || lower.includes("process") || lower.includes("system")) return "SYSTEM";
    if (lower.includes("env") || lower.includes("environment") || lower.includes("path")) return "ENVIRONMENT";
    if (lower.includes("project") || lower.includes("install") && lower.includes("dependencies")) return "PROJECT";
    if (lower.includes("notepad") || lower.includes("calc") || lower.includes("application")) return "APPLICATION";
    if (lower.includes("edge") || lower.includes("browser") || lower.includes("search")) return "BROWSER";
    return "SYSTEM";
  }

  getNormalizedGoal(lower, text) {
    if (/why.*(slow|lag|performance)|computer slow|laptop slow/.test(lower)) {
      return "Explain likely performance contributors from system state";
    }
    if (lower.includes("port")) {
      return "Identify what is listening on the specified port";
    }
    if (lower.includes("install") && lower.includes("winget")) {
      return "Install a package via WinGet";
    }
    if (lower.includes("path")) {
      return "Manage user PATH environment variable";
    }
    if (lower.includes("env") || lower.includes("environment")) {
      return "Set an environment variable";
    }
    if (lower.includes("notepad")) {
      return "Open Notepad, type text, and save";
    }
    if (lower.includes("edge") || lower.includes("browser") || lower.includes("search")) {
      return "Open Edge and search for something";
    }
    if (lower.includes("run") && lower.includes("project")) {
      return "Detect, configure, run, and verify a project";
    }
    return "Process the given request";
  }

  extractEntities(lower, text, context) {
    const entities = { workspacePath: context.workspacePath ?? process.cwd() };
    const portMatch = lower.match(/port\s+(\d{2,5})|using port\s+(\d{2,5})/);
    if (portMatch) {
      entities.port = Number(portMatch[1] ?? portMatch[2]);
    }
    const keyMatch = lower.match(/set\s+(?:user\s+)?(?:env(?:ironment)?\s+)?(\w+)/);
    if (keyMatch) {
      entities.key = keyMatch[1];
    }
    const contentMatch = text.match(/type\s+['"](.+?)['"]|write\s+['"](.+?)['"]/i);
    if (contentMatch) {
      entities.content = contentMatch[1] ?? contentMatch[2];
    }
    const fileMatch = text.match(/as\s+([\w.-]+\.txt)/i);
    if (fileMatch) {
      entities.filename = fileMatch[1];
    }
    const queryMatch = text.match(/search\s+for\s+(.+?)(?:\.|$)/i) ?? text.match(/search\s+(.+)/i);
    if (queryMatch) {
      entities.query = queryMatch[1]?.trim();
    }
    return entities;
  }

  getSuccessCriteria(lower) {
    if (lower.includes("port")) {
      return ["Process using the specified port is identified"];
    }
    if (lower.includes("env") || lower.includes("environment")) {
      return ["Environment variable is set and verified"];
    }
    if (lower.includes("path")) {
      return ["PATH is updated and verified"];
    }
    if (lower.includes("notepad")) {
      return ["Notepad is opened and file is saved"];
    }
    if (lower.includes("project")) {
      return ["Project is running and healthy"];
    }
    return ["Request is processed successfully"];
  }

  getRequiredContext(lower) {
    const contextTypes = [];
    if (lower.includes("system")) contextTypes.push("system");
    if (lower.includes("process") || lower.includes("port")) contextTypes.push("processes", "port");
    if (lower.includes("path") || lower.includes("env")) contextTypes.push("environment");
    if (lower.includes("project")) contextTypes.push("workspace");
    return contextTypes;
  }

  extractInstallTarget(lower, raw) {
    const map = {
      vlc: "VideoLAN.VLC",
      git: "Git.Git",
      node: "OpenJS.NodeJS.LTS",
      python: "Python.Python.3.12",
      docker: "Docker.DockerDesktop",
      spotify: "Spotify.Spotify",
      calculator: "Microsoft.WindowsCalculator"
    };
    for (const [key, id] of Object.entries(map)) {
      if (lower.includes(key)) return id;
    }
    const idMatch = raw.match(/install\s+([\w.-]+)/i);
    return idMatch?.[1] ?? "VideoLAN.VLC";
  }

  guessPythonPath() {
    return "C:\\Python312\\;C:\\Python312\\Scripts\\";
  }
}
