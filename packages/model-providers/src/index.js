import { redactSensitiveData } from "../../shared-types/src/redaction.js";
import crypto from "crypto";
const createId = () => crypto.randomBytes(16).toString("hex");

export function validateSchema(data, schema) {
  if (!data) return { valid: false, errors: ["No data provided"] };
  const errors = [];
  const required = schema.required || [];
  for (const key of required) {
    if (!(key in data)) {
      errors.push(`Missing required field: ${key}`);
    }
  }
  const properties = schema.properties || {};
  for (const key in properties) {
    if (key in data && data[key] !== null && data[key] !== undefined) {
      const expectedType = properties[key].type;
      let actualType = typeof data[key];
      
      // Special case for arrays and null
      if (expectedType === "array" && Array.isArray(data[key])) {
        // OK!
      } else if (expectedType === "array" && !Array.isArray(data[key])) {
        errors.push(`Field ${key} must be ${expectedType}, got ${actualType}`);
      } else if (expectedType && actualType !== expectedType) {
        errors.push(`Field ${key} must be ${expectedType}, got ${actualType}`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

export class LanguageModelProvider {
  constructor(config = {}) {
    this.config = config;
    this.usage = { calls: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 };
  }

  async generateStructured(prompt, schema, options = {}) {
    throw new Error("Not implemented");
  }

  async healthCheck() {
    return { ok: true };
  }

  async getUsage() {
    return { ...this.usage };
  }
}

export class MockModelProvider extends LanguageModelProvider {
  constructor(config = {}) {
    super(config);
    this.name = "mock";
  }

  async healthCheck() {
    return { ok: true, type: "MockModelProvider", date: new Date().toISOString() };
  }

  async generateStructured(prompt, schema, options = {}) {
    this.usage.calls += 1;
    if (options.forceFailure) {
      throw new Error("Forced model failure");
    }
    if (options.forceInvalidSchema) {
      return { invalid: "schema" };
    }
    if (options.forceRepairable) {
      return { normalizedGoal: "Fixable", category: "SYSTEM", entities: {} };
    }
    // Handle known test scenarios
    if (prompt.includes("set env") || prompt.includes("environment variable")) {
      return {
        normalizedGoal: "Set an environment variable in the project",
        category: "PROJECT",
        entities: {
          key: "API_URL",
          value: "http://localhost:3000"
        },
        successCriteria: ["API_URL is present in the .env file"],
        requiredContext: ["workspace"],
        constraints: [],
        clarificationQuestions: [],
        sensitivityFlags: []
      };
    }
    if (prompt.includes("system information") || prompt.includes("Show me my system") || prompt.includes("inspect system")) {
      return { 
        normalizedGoal: "Show system information", 
        category: "SYSTEM", 
        entities: {}, 
        successCriteria: ["System information is displayed"], 
        requiredContext: ["system"], 
        constraints: [], 
        clarificationQuestions: [], 
        sensitivityFlags: []
      };
    }
    if (prompt.includes("processes running") || prompt.includes("What processes")) {
      return { 
        normalizedGoal: "List running processes", 
        category: "SYSTEM", 
        entities: {}, 
        successCriteria: ["Running processes are displayed"], 
        requiredContext: ["processes"],
        constraints: [], 
        clarificationQuestions: [], 
        sensitivityFlags: [] 
      };
    }
    if (prompt.includes("PATH") || prompt.includes("Show me my PATH")) {
      return { 
        normalizedGoal: "Show user PATH environment variable", 
        category: "SYSTEM", 
        entities: {}, 
        successCriteria: ["User PATH is displayed"], 
        requiredContext: ["environment"], 
        constraints: [], 
        clarificationQuestions: [], 
        sensitivityFlags: [] 
      };
    }
    if (prompt.includes("port") && (prompt.includes("3000") || options.port)) {
      return { 
        normalizedGoal: "Find the process using port 3000", 
        category: "SYSTEM", 
        entities: { port: options.port || 3000 }, 
        successCriteria: ["Process using port 3000 is identified"], 
        requiredContext: ["port"], 
        constraints: [], 
        clarificationQuestions: [], 
        sensitivityFlags: [] 
      };
    }
    if (prompt.includes("inspect this project") || prompt.includes("what stack")) {
      return { 
        normalizedGoal: "Inspect this project and determine its tech stack", 
        category: "PROJECT", 
        entities: {}, 
        successCriteria: ["Project tech stack is identified"], 
        requiredContext: ["workspace"], 
        constraints: [], 
        clarificationQuestions: [], 
        sensitivityFlags: [] 
      };
    }
    if (prompt.includes("WinGet") || prompt.includes("winget")) {
      return { 
        normalizedGoal: "Search WinGet for a package", 
        category: "SYSTEM", 
        entities: { query: "vlc" }, 
        successCriteria: ["WinGet search results are displayed"], 
        requiredContext: ["system"], 
        constraints: [], 
        clarificationQuestions: [], 
        sensitivityFlags: [] 
      };
    }
    if (prompt.includes("Notepad") || prompt.includes("notepad")) {
      return { 
        normalizedGoal: "Launch Notepad", 
        category: "APPLICATION", 
        entities: { content: "SYSCORA test", filename: "test.txt" }, 
        successCriteria: ["Notepad is launched"], 
        requiredContext: [], 
        constraints: [], 
        clarificationQuestions: [], 
        sensitivityFlags: [] 
      };
    }
    return { 
      normalizedGoal: "Do something", 
      category: "SYSTEM", 
      entities: {}, 
      successCriteria: ["Something done"], 
      requiredContext: [], 
      constraints: [], 
      clarificationQuestions: [], 
      sensitivityFlags: [] 
    };
  }
}

export class OpenAIModelProvider extends LanguageModelProvider {
  constructor(config = {}) {
    super(config);
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY;
    this.model = config.model || "gpt-4o-mini";
    this.baseUrl = config.baseUrl || "https://api.openai.com/v1";
    this.name = "openai";
  }

  async healthCheck() {
    if (!this.apiKey) {
      return { ok: false, error: "No OpenAI API key" };
    }
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        method: "GET",
        headers: { Authorization: `Bearer ${this.apiKey}` }
      });
      return { ok: response.ok, status: response.status };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async generateStructured(prompt, schema, options = {}) {
    this.usage.calls += 1;
    if (!this.apiKey) {
      throw new Error("No OpenAI API key");
    }
    const timeoutMs = options.timeoutMs || 30000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const maxRetries = options.maxRetries || 3;
    let attempt = 0;
    let lastError = null;
    while (attempt < maxRetries) {
      try {
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
          body: JSON.stringify({
            model: this.model,
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_schema", json_schema: { name: "schema", schema, strict: true } },
            temperature: options.temperature || 0.3
          }),
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const result = await response.json();
        const usage = result.usage || {};
        this.usage.tokensIn += usage.prompt_tokens || 0;
        this.usage.tokensOut += usage.completion_tokens || 0;
        this.usage.costUsd += ((usage.prompt_tokens || 0) * 0.00015 + (usage.completion_tokens || 0) * 0.0006) / 1000;
        const content = result.choices?.[0]?.message?.content;
        const parsed = JSON.parse(content);
        if (options.validateSchema) {
          const validation = validateSchema(parsed, schema);
          if (!validation.valid) {
            throw new Error(`Invalid schema: ${validation.errors.join(", ")}`);
          }
        }
        return parsed;
      } catch (error) {
        lastError = error;
        attempt += 1;
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, Math.min(1000 * Math.pow(2, attempt), 10000)));
        }
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError;
  }
}

export function createModelProvider(settings = {}) {
  if (settings.provider === "openai" && settings.apiKey) {
    return new OpenAIModelProvider({ apiKey: settings.apiKey, model: settings.model });
  }
  return new MockModelProvider();
}
