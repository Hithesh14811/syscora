import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRuntime } from "./runtime-factory.js";
import { ValidationError } from "../../../packages/shared-types/src/domain.js";
import { buildEnvelope, parseRequestBodyWithEnvelope } from "../../../packages/protocol/src/envelope.js";
import { buildSessionResponse } from "../../../packages/protocol/src/session-protocol.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const desktopDirectory = path.resolve(__dirname, "../../desktop");

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload, null, 2));
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function parseStaticPath(urlPathname) {
  if (urlPathname === "/") {
    return path.join(desktopDirectory, "index.html");
  }
  const safePath = path.normalize(urlPathname).replace(/^(\.\.[/\\])+/, "");
  return path.join(desktopDirectory, safePath);
}

function inferContentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8";
  return "application/octet-stream";
}

async function runPrivilegedHelper({ basePath, sessionId, operation, scope, token }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [
      path.resolve(__dirname, "./privileged-helper.js"),
      "--basePath", basePath,
      "--sessionId", sessionId,
      "--operation", operation,
      "--scope", scope,
      "--token", token
    ], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("close", (code) => {
      resolve({
        exitCode: code ?? -1,
        stdout,
        stderr
      });
    });
  });
}

export function startServer({ port = 4317, basePath = process.cwd() } = {}) {
  const runtime = createRuntime(basePath);
  const apiToken = process.env.SYSCORA_API_TOKEN ?? crypto.randomBytes(24).toString("hex");

  function isAuthorized(request) {
    const token = request.headers["x-syscora-token"];
    return typeof token === "string" && token === apiToken;
  }

  const server = http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

      if (request.method === "GET" && requestUrl.pathname === "/api/health") {
        sendJson(response, 200, { status: "ok", product: "SYSCORA" });
        return;
      }

      if (requestUrl.pathname.startsWith("/api/") && !isAuthorized(request) && requestUrl.pathname !== "/api/health") {
        sendJson(response, 401, { error: "Unauthorized: missing or invalid x-syscora-token header." });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/intents") {
        const body = await readJsonBody(request);
        const parsed = parseRequestBodyWithEnvelope(body, "intent_request");
        const payload = parsed.payload;
        if (!payload.text) {
          sendJson(response, 400, { error: "text is required." });
          return;
        }
        const session = await runtime.submitIntent(payload.text, {
          workspacePath: basePath,
          autoApprove: payload.autoApprove === true
        });
        const legacy = buildSessionResponse(session);
        sendJson(response, 200, {
          envelope: buildEnvelope("intent_response", legacy, parsed.requestId),
          ...legacy
        });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/sessions") {
        const sessions = await runtime.sessionStore.list();
        const legacy = buildSessionResponse({ sessions });
        sendJson(response, 200, {
          envelope: buildEnvelope("sessions_response", legacy),
          ...legacy
        });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/system/summary") {
        const summary = await runtime.inspectWindowsSystem();
        sendJson(response, 200, {
          envelope: buildEnvelope("system_summary_response", summary),
          summary
        });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/sessions/latest/rollback") {
        const session = await runtime.rollbackLatestSession();
        const legacy = buildSessionResponse(session);
        sendJson(response, 200, {
          envelope: buildEnvelope("rollback_response", legacy),
          ...legacy
        });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname.startsWith("/api/sessions/")) {
        const match = requestUrl.pathname.match(/^\/api\/sessions\/([^/]+)\/(pause|resume|cancel)$/);
        if (match) {
          const [, sessionId, command] = match;
          const body = await readJsonBody(request);
          const expectedType = `session_${command}_request`;
          const parsed = parseRequestBodyWithEnvelope(body, expectedType);
          const reason = parsed.payload?.reason;
          let session;
          if (command === "pause") {
            session = await runtime.pauseSessionById(sessionId, reason);
          } else if (command === "resume") {
            session = await runtime.resumeSessionById(sessionId, {
              autoApprove: parsed.payload?.autoApprove === true
            });
          } else {
            session = await runtime.cancelSessionById(sessionId, reason);
          }
          const legacy = buildSessionResponse(session);
          sendJson(response, 200, {
            envelope: buildEnvelope(`session_${command}_response`, legacy, parsed.requestId),
            ...legacy
          });
          return;
        }
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/intents/set-env") {
        const body = await readJsonBody(request);
        const parsed = parseRequestBodyWithEnvelope(body, "set_env_intent_request");
        const payload = parsed.payload;
        if (!payload.workspacePath || !payload.key || !payload.value) {
          sendJson(response, 400, {
            error: "workspacePath, key, and value are required."
          });
          return;
        }

        const session = await runtime.runSetProjectEnvVariable(
          {
            rawText: `Set ${payload.key} for the current project`,
            entities: {
              workspacePath: path.resolve(payload.workspacePath),
              key: payload.key,
              value: payload.value
            }
          },
          { autoApprove: payload.autoApprove === true }
        );

        const legacy = buildSessionResponse(session);
        sendJson(response, 200, {
          envelope: buildEnvelope("set_env_intent_response", legacy, parsed.requestId),
          ...legacy
        });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/intents/run-project") {
        const body = await readJsonBody(request);
        const parsed = parseRequestBodyWithEnvelope(body, "run_project_intent_request");
        const payload = parsed.payload;
        if (!payload.workspacePath) {
          sendJson(response, 400, {
            error: "workspacePath is required."
          });
          return;
        }
        const session = await runtime.runProjectWorkflow(
          {
            rawText: "Run this project",
            entities: {
              workspacePath: path.resolve(payload.workspacePath),
              key: "PROJECT_RUN",
              value: "true"
            }
          },
          { autoApprove: payload.autoApprove === true }
        );
        const legacy = buildSessionResponse(session);
        sendJson(response, 200, {
          envelope: buildEnvelope("run_project_intent_response", legacy, parsed.requestId),
          ...legacy
        });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/intents/set-user-env") {
        const body = await readJsonBody(request);
        const parsed = parseRequestBodyWithEnvelope(body, "set_user_env_intent_request");
        const payload = parsed.payload;
        if (!payload.key || !payload.value) {
          sendJson(response, 400, {
            error: "key and value are required."
          });
          return;
        }
        const session = await runtime.setWindowsUserEnvironmentVariable(
          {
            rawText: `Set Windows user environment variable ${payload.key}`,
            entities: {
              workspacePath: basePath,
              key: payload.key,
              value: payload.value
            }
          },
          { autoApprove: payload.autoApprove === true }
        );
        const legacy = buildSessionResponse(session);
        sendJson(response, 200, {
          envelope: buildEnvelope("set_user_env_intent_response", legacy, parsed.requestId),
          ...legacy
        });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/intents/add-user-path") {
        const body = await readJsonBody(request);
        const parsed = parseRequestBodyWithEnvelope(body, "add_user_path_intent_request");
        const payload = parsed.payload;
        if (!payload.entry) {
          sendJson(response, 400, { error: "entry is required." });
          return;
        }
        const session = await runtime.addWindowsUserPathEntry(
          {
            rawText: `Add ${payload.entry} to my PATH`,
            entities: {
              workspacePath: basePath,
              key: "USER_PATH",
              value: payload.entry
            }
          },
          { autoApprove: payload.autoApprove === true }
        );
        const legacy = buildSessionResponse(session);
        sendJson(response, 200, {
          envelope: buildEnvelope("add_user_path_intent_response", legacy, parsed.requestId),
          ...legacy
        });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/intents/winget-install") {
        const body = await readJsonBody(request);
        const parsed = parseRequestBodyWithEnvelope(body, "winget_install_intent_request");
        const payload = parsed.payload;
        if (!payload.id) {
          sendJson(response, 400, { error: "id is required." });
          return;
        }
        const session = await runtime.wingetInstallIntent(
          {
            rawText: `Install ${payload.id}`,
            entities: {
              workspacePath: basePath,
              key: payload.id,
              value: "install"
            }
          },
          { autoApprove: payload.autoApprove === true }
        );
        const legacy = buildSessionResponse(session);
        sendJson(response, 200, {
          envelope: buildEnvelope("winget_install_intent_response", legacy, parsed.requestId),
          ...legacy
        });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/intents/inspect-port") {
        const body = await readJsonBody(request);
        const parsed = parseRequestBodyWithEnvelope(body, "inspect_port_intent_request");
        const payload = parsed.payload;
        if (typeof payload.port !== "number") {
          sendJson(response, 400, { error: "port (number) is required." });
          return;
        }
        const summary = await runtime.inspectPortIntent(
          {
            rawText: `What is using port ${payload.port}?`,
            entities: {
              workspacePath: basePath,
              key: "PORT",
              value: payload.port
            }
          }
        );
        sendJson(response, 200, {
          envelope: buildEnvelope("inspect_port_intent_response", summary, parsed.requestId),
          summary
        });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/intents/analyze-performance") {
        const body = await readJsonBody(request);
        const parsed = parseRequestBodyWithEnvelope(body, "analyze_performance_intent_request");
        const analysis = await runtime.analyzeSystemPerformanceIntent(
          {
            rawText: "Why is my computer slow?",
            entities: {
              workspacePath: basePath
            }
          }
        );
        sendJson(response, 200, {
          envelope: buildEnvelope("analyze_performance_intent_response", analysis, parsed.requestId),
          analysis
        });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/intents/notepad-type-and-save") {
        const body = await readJsonBody(request);
        const parsed = parseRequestBodyWithEnvelope(body, "notepad_type_and_save_intent_request");
        const payload = parsed.payload;
        if (!payload.content || !payload.filename) {
          sendJson(response, 400, { error: "content and filename are required." });
          return;
        }
        const session = await runtime.notepadTypeAndSaveIntent(
          {
            rawText: `Open Notepad, type "${payload.content}", save as ${payload.filename}`,
            entities: {
              workspacePath: basePath,
              content: payload.content,
              filename: payload.filename
            }
          },
          { autoApprove: payload.autoApprove === true }
        );
        const legacy = buildSessionResponse(session);
        sendJson(response, 200, {
          envelope: buildEnvelope("notepad_type_and_save_intent_response", legacy, parsed.requestId),
          ...legacy
        });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/intents/browser-search") {
        const body = await readJsonBody(request);
        const parsed = parseRequestBodyWithEnvelope(body, "browser_search_intent_request");
        const payload = parsed.payload;
        if (!payload.query) {
          sendJson(response, 400, { error: "query is required." });
          return;
        }
        const result = await runtime.browserSearchIntent(
          {
            rawText: `Search for ${payload.query}`,
            entities: {
              workspacePath: basePath,
              query: payload.query
            }
          }
        );
        sendJson(response, 200, {
          envelope: buildEnvelope("browser_search_intent_response", result, parsed.requestId),
          result
        });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/privileged/approve") {
        const body = await readJsonBody(request);
        const parsed = parseRequestBodyWithEnvelope(body, "privileged_approve_request");
        const payload = parsed.payload;
        if (!payload.operation || !payload.scope) {
          sendJson(response, 400, { error: "operation and scope are required." });
          return;
        }
        const approval = await runtime.permissionBroker.issuePrivilegeToken({
          sessionId: payload.sessionId ?? "privileged",
          operation: payload.operation,
          scope: payload.scope,
          approved: payload.approved === true
        });
        sendJson(response, 200, {
          envelope: buildEnvelope("privileged_approve_response", approval, parsed.requestId),
          approval
        });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/privileged/execute") {
        const body = await readJsonBody(request);
        const parsed = parseRequestBodyWithEnvelope(body, "privileged_execute_request");
        const payload = parsed.payload;
        if (!payload.operation || !payload.scope || !payload.token) {
          sendJson(response, 400, { error: "operation, scope, and token are required." });
          return;
        }
        const execution = await runPrivilegedHelper({
          basePath,
          sessionId: payload.sessionId ?? "privileged",
          operation: payload.operation,
          scope: payload.scope,
          token: payload.token
        });
        let parsedStdout;
        try {
          parsedStdout = execution.stdout ? JSON.parse(execution.stdout) : null;
        } catch {
          parsedStdout = null;
        }
        sendJson(response, 200, {
          envelope: buildEnvelope("privileged_execute_response", {
            ...execution,
            result: parsedStdout
          }, parsed.requestId),
          execution
        });
        return;
      }

      if (request.method !== "GET") {
        sendJson(response, 404, { error: "Not found" });
        return;
      }

      const staticPath = parseStaticPath(requestUrl.pathname);
      const desktopRoot = `${desktopDirectory}${path.sep}`;
      if (!staticPath.startsWith(desktopRoot) && staticPath !== path.join(desktopDirectory, "index.html")) {
        sendJson(response, 403, { error: "Forbidden" });
        return;
      }

      let file = await fs.readFile(staticPath, "utf8");
      if (requestUrl.pathname === "/" || requestUrl.pathname === "/index.html") {
        file = file.replace("__SYSCORA_API_TOKEN__", apiToken);
      }
      response.writeHead(200, { "content-type": inferContentType(staticPath) });
      response.end(file);
    } catch (error) {
      if (error instanceof ValidationError) {
        sendJson(response, 400, {
          error: "Protocol validation error",
          message: error.message
        });
        return;
      }
      sendJson(response, 500, {
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`SYSCORA daemon listening at http://127.0.0.1:${port}`);
    console.log(`SYSCORA API token: ${apiToken}`);
  });

  return server;
}

if (process.argv[1] === __filename) {
  const port = Number(process.env.SYSCORA_PORT ?? "4317");
  startServer({ port });
}
