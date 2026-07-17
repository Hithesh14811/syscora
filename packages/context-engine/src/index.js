import crypto from "crypto";
const createId = () => crypto.randomBytes(16).toString("hex");

export const TRUST_LEVELS = {
  SYSTEM_TRUSTED: "SYSTEM_TRUSTED",
  LOCAL_USER_DATA: "LOCAL_USER_DATA",
  EXTERNAL_UNTRUSTED: "EXTERNAL_UNTRUSTED",
  MODEL_GENERATED: "MODEL_GENERATED"
};

export class ContextProvider {
  constructor(name, supportedContextTypes, cost = 1, sensitivity = 0) {
    this.name = name;
    this.supportedContextTypes = supportedContextTypes;
    this.cost = cost;
    this.sensitivity = sensitivity;
  }

  async collect(request) {
    throw new Error("Not implemented");
  }
}

export class SystemContextProvider extends ContextProvider {
  constructor(adapter) {
    super("system", ["system"], 1, 1);
    this.adapter = adapter;
  }

  async collect(request) {
    const system = await this.adapter.getSystemInformation?.();
    return {
      contextId: createId(),
      type: "system",
      source: this.name,
      timestamp: new Date().toISOString(),
      sensitivity: this.sensitivity,
      trustLevel: TRUST_LEVELS.SYSTEM_TRUSTED,
      freshness: "current",
      data: system
    };
  }
}

export class ProcessContextProvider extends ContextProvider {
  constructor(adapter) {
    super("process", ["processes"], 2, 1);
    this.adapter = adapter;
  }

  async collect(request) {
    const processes = await this.adapter.listProcesses?.();
    return {
      contextId: createId(),
      type: "processes",
      source: this.name,
      timestamp: new Date().toISOString(),
      sensitivity: this.sensitivity,
      trustLevel: TRUST_LEVELS.SYSTEM_TRUSTED,
      freshness: "current",
      data: processes
    };
  }
}

export class PortContextProvider extends ContextProvider {
  constructor(adapter) {
    super("port", ["port"], 1, 1);
    this.adapter = adapter;
  }

  async collect(request) {
    const port = request.port ?? 3000;
    const inspect = await this.adapter.inspectPort?.(port);
    return {
      contextId: createId(),
      type: "port",
      source: this.name,
      timestamp: new Date().toISOString(),
      sensitivity: this.sensitivity,
      trustLevel: TRUST_LEVELS.SYSTEM_TRUSTED,
      freshness: "current",
      data: { port, inspect }
    };
  }
}

export class EnvironmentContextProvider extends ContextProvider {
  constructor(adapter) {
    super("environment", ["environment"], 1, 2);
    this.adapter = adapter;
  }

  async collect(request) {
    const env = await this.adapter.getUserPath();
    const envVars = [];
    return {
      contextId: createId(),
      type: "environment",
      source: this.name,
      timestamp: new Date().toISOString(),
      sensitivity: this.sensitivity,
      trustLevel: TRUST_LEVELS.SYSTEM_TRUSTED,
      freshness: "current",
      data: {
        userPath: env,
        envVars
      }
    };
  }
}

export class ServiceContextProvider extends ContextProvider {
  constructor(adapter) {
    super("service", ["services"], 1, 1);
    this.adapter = adapter;
  }

  async collect(request) {
    const services = await this.adapter.listServices();
    return {
      contextId: createId(),
      type: "services",
      source: this.name,
      timestamp: new Date().toISOString(),
      sensitivity: this.sensitivity,
      trustLevel: TRUST_LEVELS.SYSTEM_TRUSTED,
      freshness: "current",
      data: services
    };
  }
}

export class WorkspaceContextProvider extends ContextProvider {
  constructor(adapter, developerIntelligence) {
    super("workspace", ["workspace"], 3, 1);
    this.adapter = adapter;
    this.developerIntelligence = developerIntelligence;
  }

  async collect(request) {
    const workspacePath = request.workspacePath ?? process.cwd();
    const inspection = this.developerIntelligence?.inspectProject?.(workspacePath);
    return {
      contextId: createId(),
      type: "workspace",
      source: this.name,
      timestamp: new Date().toISOString(),
      sensitivity: this.sensitivity,
      trustLevel: TRUST_LEVELS.LOCAL_USER_DATA,
      freshness: "current",
      data: { workspacePath, inspection }
    };
  }
}

export class ContextEngine {
  constructor(providers) {
    this.providers = providers;
  }

  async collectContext(requiredContextTypes, request = {}) {
    const contextItems = [];
    for (const type of requiredContextTypes) {
      const provider = this.providers.find(p => p.supportedContextTypes.includes(type));
      if (provider) {
        try {
          const item = await provider.collect(request);
          contextItems.push(item);
        } catch (e) {
          console.warn(`Failed to collect context for type ${type} via ${provider.name}:`, e);
        }
      }
    }
    return contextItems;
  }
}
