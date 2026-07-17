import { app, BrowserWindow } from "electron";
import crypto from "node:crypto";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let daemonProcess = null;

function startDaemon() {
  const apiToken = process.env.SYSCORA_API_TOKEN ?? crypto.randomBytes(24).toString("hex");
  const env = {
    ...process.env,
    SYSCORA_API_TOKEN: apiToken,
    SYSCORA_PORT: process.env.SYSCORA_PORT ?? "4317"
  };

  const repoRoot = path.resolve(__dirname, "../../..");
  const daemonEntry = path.join(repoRoot, "apps", "daemon", "src", "server.js");

  daemonProcess = spawn(process.execPath, [daemonEntry], {
    cwd: repoRoot,
    env,
    stdio: "ignore",
    windowsHide: true
  });

  daemonProcess.on("exit", () => {
    daemonProcess = null;
  });

  return { apiToken, port: Number(env.SYSCORA_PORT) };
}

function createWindow({ port }) {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "SYSCORA",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  window.loadURL(`http://127.0.0.1:${port}`);
  return window;
}

app.whenReady().then(() => {
  const daemon = startDaemon();
  createWindow(daemon);
});

app.on("window-all-closed", () => {
  if (daemonProcess) {
    try {
      daemonProcess.kill();
    } catch {}
  }
  app.quit();
});

