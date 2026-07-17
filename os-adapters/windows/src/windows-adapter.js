import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

function parseEnvContents(rawContents) {
  const pairs = new Map();
  for (const line of rawContents.split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) {
      continue;
    }
    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1);
    pairs.set(key, value);
  }
  return pairs;
}

function serializeEnvContents(pairs) {
  return [...pairs.entries()].map(([key, value]) => `${key}=${value}`).join("\n") + "\n";
}

function escapePowerShellSingleQuoted(value) {
  return String(value).replace(/'/g, "''");
}

export class WindowsAdapter {
  async executeCommand(workingDirectory, command, args = [], options = {}) {
    return new Promise((resolve) => {
      const child = spawn(command, args, {
        cwd: workingDirectory,
        stdio: ["ignore", "pipe", "pipe"],
        shell: false
      });
      const timeoutMs = options.timeoutMs ?? 15000;
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs);
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("close", (code) => {
        clearTimeout(timeout);
        resolve({
          command,
          args,
          exitCode: code ?? -1,
          timedOut,
          stdout,
          stderr
        });
      });
      child.on("error", (error) => {
        clearTimeout(timeout);
        resolve({
          command,
          args,
          exitCode: -1,
          timedOut: false,
          stdout,
          stderr: `${stderr}\n${error.message}`.trim()
        });
      });
    });
  }

  async runPowerShell(script, options = {}) {
    return this.executeCommand(
      process.cwd(),
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      options
    );
  }

  async getSystemInformation() {
    const ps = await this.runPowerShell(
      "$os = Get-CimInstance Win32_OperatingSystem; " +
      "$cs = Get-CimInstance Win32_ComputerSystem; " +
      "$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1 Name,NumberOfCores,NumberOfLogicalProcessors; " +
      "[pscustomobject]@{caption=$os.Caption;version=$os.Version;build=$os.BuildNumber;hostname=$env:COMPUTERNAME;username=$env:USERNAME;architecture=$env:PROCESSOR_ARCHITECTURE;totalMemory=$cs.TotalPhysicalMemory;cpuName=$cpu.Name;cpuCores=$cpu.NumberOfCores;cpuLogical=$cpu.NumberOfLogicalProcessors} | ConvertTo-Json -Compress"
    );
    let parsed = null;
    try {
      parsed = JSON.parse(ps.stdout || "{}");
    } catch {
      parsed = null;
    }
    return {
      platform: process.platform,
      release: os.release(),
      hostname: os.hostname(),
      username: os.userInfo().username,
      architecture: os.arch(),
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
      cpus: os.cpus().length,
      windowsDetails: parsed,
      rawCommand: ps
    };
  }

  async listProcesses() {
    const ps = await this.runPowerShell(
      "Get-Process | Sort-Object -Descending WorkingSet64 | Select-Object -First 25 Id,ProcessName,CPU,WorkingSet64,Path | ConvertTo-Json -Compress"
    );
    let parsed = [];
    try {
      parsed = JSON.parse(ps.stdout || "[]");
    } catch {
      parsed = [];
    }
    return Array.isArray(parsed) ? parsed : [parsed];
  }

  async listServices() {
    const ps = await this.runPowerShell(
      "Get-Service | Select-Object -First 50 Name,DisplayName,Status,StartType | ConvertTo-Json -Compress"
    );
    let parsed = [];
    try {
      parsed = JSON.parse(ps.stdout || "[]");
    } catch {
      parsed = [];
    }
    return Array.isArray(parsed) ? parsed : [parsed];
  }

  async inspectUserEnvironmentVariable(key) {
    const escaped = escapePowerShellSingleQuoted(key);
    const ps = await this.runPowerShell(
      `[Environment]::GetEnvironmentVariable('${escaped}','User') | ConvertTo-Json -Compress`
    );
    let parsed = null;
    try {
      parsed = JSON.parse(ps.stdout || "null");
    } catch {
      parsed = ps.stdout.trim() || null;
    }
    return {
      key,
      scope: "User",
      value: parsed
    };
  }

  async getUserPath() {
    const ps = await this.runPowerShell(
      "[Environment]::GetEnvironmentVariable('Path','User') | ConvertTo-Json -Compress"
    );
    let value = null;
    try {
      value = JSON.parse(ps.stdout || "null");
    } catch {
      value = ps.stdout.trim() || null;
    }
    return {
      scope: "User",
      value,
      commandResult: ps
    };
  }

  normalizePathEntry(entry) {
    const trimmed = String(entry ?? "").trim();
    if (!trimmed) return null;
    return trimmed.replace(/[\\/]+$/g, "");
  }

  splitPath(pathValue) {
    if (!pathValue) return [];
    return String(pathValue)
      .split(";")
      .map((item) => this.normalizePathEntry(item))
      .filter(Boolean);
  }

  joinPath(entries) {
    return entries.map((item) => this.normalizePathEntry(item)).filter(Boolean).join(";");
  }

  async setUserPath(nextPathValue) {
    const previous = await this.getUserPath();
    const escapedValue = escapePowerShellSingleQuoted(nextPathValue);
    const ps = await this.runPowerShell(
      `[Environment]::SetEnvironmentVariable('Path','${escapedValue}','User'); ` +
      `[Environment]::GetEnvironmentVariable('Path','User') | ConvertTo-Json -Compress`
    );
    let parsed = null;
    try {
      parsed = JSON.parse(ps.stdout || "null");
    } catch {
      parsed = ps.stdout.trim() || null;
    }
    await this.broadcastEnvironmentChange();
    return {
      scope: "User",
      previousValue: previous.value,
      nextValue: parsed,
      commandResult: ps
    };
  }

  async broadcastEnvironmentChange() {
    // Broadcast WM_SETTINGCHANGE to notify Explorer and other apps
    await this.runPowerShell(
      "Add-Type @'\n" +
      "using System;\n" +
      "using System.Runtime.InteropServices;\n" +
      "public static class Native {\n" +
      "  [DllImport(\"user32.dll\", SetLastError=true, CharSet=CharSet.Auto)]\n" +
      "  public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, IntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out IntPtr lpdwResult);\n" +
      "}\n" +
      "'@; " +
      "$HWND_BROADCAST = [IntPtr]0xffff; $WM_SETTINGCHANGE = 0x1A; $SMTO_ABORTIFHUNG = 0x2; " +
      "[IntPtr]$r = [IntPtr]::Zero; " +
      "[void][Native]::SendMessageTimeout($HWND_BROADCAST,$WM_SETTINGCHANGE,[IntPtr]::Zero,'Environment',$SMTO_ABORTIFHUNG,2000,[ref]$r);"
    );
  }

  async verifyUserPathEntry(entry) {
    const normalized = this.normalizePathEntry(entry);
    const current = await this.getUserPath();
    const entries = this.splitPath(current.value);
    const present = entries.some((e) => e.toLowerCase() === normalized.toLowerCase());
    return {
      entry: normalized,
      present,
      currentValue: current.value,
      entries
    };
  }

  async rollbackUserPath(previousValue) {
    return this.setUserPath(previousValue);
  }

  async verifyUserPathInNewProcess(expectedContains) {
    const escaped = escapePowerShellSingleQuoted(expectedContains);
    const ps = await this.runPowerShell(
      `$p = [Environment]::GetEnvironmentVariable('Path','User'); ` +
      `$contains = $p -like '*${escaped}*'; ` +
      `[pscustomobject]@{contains=$contains; path=$p} | ConvertTo-Json -Compress`
    );
    let parsed = null;
    try {
      parsed = JSON.parse(ps.stdout || "{}");
    } catch {
      parsed = null;
    }
    return {
      contains: Boolean(parsed?.contains),
      path: parsed?.path ?? null
    };
  }

  async addUserPathEntry(entry) {
    const current = await this.getUserPath();
    const entries = this.splitPath(current.value);
    const normalized = this.normalizePathEntry(entry);
    const deduped = [...new Set(entries.map((e) => e.toLowerCase()))];
    const exists = deduped.includes(normalized.toLowerCase());
    const nextEntries = exists ? entries : [...entries, normalized];
    const nextValue = this.joinPath(nextEntries);
    const setResult = await this.setUserPath(nextValue);
    return {
      previousValue: current.value,
      nextValue: setResult.nextValue,
      added: !exists,
      entry: normalized
    };
  }

  async dedupeUserPath() {
    const current = await this.getUserPath();
    const entries = this.splitPath(current.value);
    const seen = new Set();
    const nextEntries = [];
    for (const entry of entries) {
      const key = entry.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      nextEntries.push(entry);
    }
    const nextValue = this.joinPath(nextEntries);
    const setResult = await this.setUserPath(nextValue);
    return {
      previousValue: current.value,
      nextValue: setResult.nextValue,
      removedCount: entries.length - nextEntries.length
    };
  }

  async inspectPort(portNumber) {
    const port = Number(portNumber);
    const ps = await this.runPowerShell(
      `Get-NetTCPConnection -State Listen -LocalPort ${port} | ` +
      "Select-Object -First 10 LocalAddress,LocalPort,OwningProcess | ConvertTo-Json -Compress"
    );
    let parsed = [];
    try {
      parsed = JSON.parse(ps.stdout || "[]");
    } catch {
      parsed = [];
    }
    const connections = Array.isArray(parsed) ? parsed : [parsed];
    return { port, connections, commandResult: ps };
  }

  async wingetSearch(query) {
    const q = String(query ?? "").trim();
    return this.executeCommand(process.cwd(), "winget", ["search", "--name", q, "--source", "winget"], { timeoutMs: 20000 });
  }

  async wingetShow(id) {
    return this.executeCommand(process.cwd(), "winget", ["show", "--id", id, "--source", "winget"], { timeoutMs: 20000 });
  }

  async wingetInstall(id) {
    return this.executeCommand(process.cwd(), "winget", ["install", "--id", id, "--source", "winget", "--accept-package-agreements", "--accept-source-agreements"], { timeoutMs: 300000 });
  }

  async wingetList(id) {
    return this.executeCommand(process.cwd(), "winget", ["list", "--id", id], { timeoutMs: 20000 });
  }

  async setUserEnvironmentVariable(key, value) {
    const previous = await this.inspectUserEnvironmentVariable(key);
    const escapedKey = escapePowerShellSingleQuoted(key);
    const escapedValue = escapePowerShellSingleQuoted(value);
    const ps = await this.runPowerShell(
      `[Environment]::SetEnvironmentVariable('${escapedKey}','${escapedValue}','User'); ` +
      `[Environment]::GetEnvironmentVariable('${escapedKey}','User') | ConvertTo-Json -Compress`
    );
    let parsed = null;
    try {
      parsed = JSON.parse(ps.stdout || "null");
    } catch {
      parsed = ps.stdout.trim() || null;
    }
    return {
      key,
      scope: "User",
      previousValue: previous.value,
      nextValue: parsed,
      commandResult: ps
    };
  }

  async verifyUserEnvironmentVariable(key, expectedValue) {
    const inspection = await this.inspectUserEnvironmentVariable(key);
    return {
      key,
      scope: "User",
      observedValue: inspection.value,
      matches: inspection.value === expectedValue
    };
  }

  async restoreUserEnvironmentVariable(key, previousValue) {
    const escapedKey = escapePowerShellSingleQuoted(key);
    if (previousValue === null || previousValue === undefined) {
      await this.runPowerShell(
        `[Environment]::SetEnvironmentVariable('${escapedKey}',$null,'User')`
      );
      return;
    }
    const escapedValue = escapePowerShellSingleQuoted(previousValue);
    await this.runPowerShell(
      `[Environment]::SetEnvironmentVariable('${escapedKey}','${escapedValue}','User')`
    );
  }

  async inspectProjectEnvironment(workspacePath) {
    const filePath = path.join(workspacePath, ".env");
    try {
      const rawContents = await fs.readFile(filePath, "utf8");
      const values = Object.fromEntries(parseEnvContents(rawContents));
      return {
        filePath,
        exists: true,
        rawContents,
        values
      };
    } catch (error) {
      if (error.code === "ENOENT") {
        return {
          filePath,
          exists: false,
          rawContents: "",
          values: {}
        };
      }
      throw error;
    }
  }

  async setProjectEnvironmentVariable(workspacePath, key, value) {
    const inspection = await this.inspectProjectEnvironment(workspacePath);
    const pairs = parseEnvContents(inspection.rawContents);
    pairs.set(key, value);
    await fs.writeFile(inspection.filePath, serializeEnvContents(pairs), "utf8");
    return {
      filePath: inspection.filePath,
      changedKey: key,
      previousValue: inspection.values[key] ?? null,
      nextValue: value
    };
  }

  async verifyProjectEnvironmentVariable(workspacePath, key, expectedValue) {
    const inspection = await this.inspectProjectEnvironment(workspacePath);
    const observedValue = inspection.values[key] ?? null;
    return {
      filePath: inspection.filePath,
      observedValue,
      matches: observedValue === expectedValue
    };
  }

  async restoreEnvFile(filePath, previousContents) {
    if (previousContents === "") {
      try {
        await fs.unlink(filePath);
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
      }
      return;
    }
    await fs.writeFile(filePath, previousContents, "utf8");
  }

  async inspectGitRepository(workspacePath) {
    return this.executeCommand(workspacePath, "git", ["status", "--short", "--branch"], { timeoutMs: 6000 });
  }

  async inspectDockerEnvironment(workspacePath) {
    return this.executeCommand(workspacePath, "docker", ["--version"], { timeoutMs: 6000 });
  }

  async inspectService(serviceName) {
    return this.runPowerShell(`Get-Service -Name '${escapePowerShellSingleQuoted(serviceName)}' | Select-Object Name,DisplayName,Status,StartType | ConvertTo-Json -Compress`, { timeoutMs: 6000 });
  }

  async inspectPackageManager(managerName) {
    if (managerName === "winget") {
      return this.executeCommand(process.cwd(), "winget", ["--version"], { timeoutMs: 6000 });
    }
    return this.executeCommand(process.cwd(), managerName, ["--version"], { timeoutMs: 6000 });
  }

  getDocumentsPath() {
    return path.join(os.homedir(), "Documents");
  }

  getDownloadsPath() {
    return path.join(os.homedir(), "Downloads");
  }

  async searchFiles(rootDirectory, pattern, maxResults = 50) {
    const root = rootDirectory ?? this.getDownloadsPath();
    const escapedRoot = escapePowerShellSingleQuoted(root);
    const escapedPattern = escapePowerShellSingleQuoted(pattern);
    const ps = await this.runPowerShell(
      `Get-ChildItem -Path '${escapedRoot}' -Recurse -Filter '${escapedPattern}' -ErrorAction SilentlyContinue | ` +
      `Select-Object -First ${maxResults} FullName,Length,LastWriteTime | ConvertTo-Json -Compress`,
      { timeoutMs: 30000 }
    );
    let parsed = [];
    try {
      parsed = JSON.parse(ps.stdout || "[]");
    } catch {
      parsed = [];
    }
    return { root, pattern, files: Array.isArray(parsed) ? parsed : [parsed].filter(Boolean), commandResult: ps };
  }

  async createDirectory(directoryPath) {
    const target = path.resolve(directoryPath);
    await fs.mkdir(target, { recursive: true });
    return { directoryPath: target, created: true };
  }

  async verifyDirectoryExists(directoryPath) {
    try {
      const stat = await fs.stat(directoryPath);
      return { exists: stat.isDirectory(), directoryPath };
    } catch {
      return { exists: false, directoryPath };
    }
  }

  async writeTextFile(filePath, contents) {
    const target = path.resolve(filePath);
    let previousContents = null;
    let existed = false;
    try {
      previousContents = await fs.readFile(target, "utf8");
      existed = true;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents, "utf8");
    return { filePath: target, existed, previousContents, nextContents: contents };
  }

  async readTextFile(filePath) {
    const target = path.resolve(filePath);
    const contents = await fs.readFile(target, "utf8");
    return { filePath: target, contents };
  }

  async verifyFileContains(filePath, expectedSubstring) {
    const file = await this.readTextFile(filePath);
    return {
      filePath: file.filePath,
      matches: file.contents.includes(expectedSubstring),
      length: file.contents.length
    };
  }

  async launchApplication(application) {
    const map = {
      notepad: "notepad.exe",
      calc: "calc.exe",
      calculator: "calc.exe"
    };
    const exe = map[application.toLowerCase()] ?? application;
    const result = await this.executeCommand(process.cwd(), exe, [], { timeoutMs: 8000 });
    await new Promise((r) => setTimeout(r, 1500));
    const windows = await this.listWindows();
    const match = windows.find((w) => w.ProcessName?.toLowerCase().includes(application.toLowerCase()) || w.MainWindowTitle?.toLowerCase().includes(application));
    return { application, exe, launchResult: result, window: match ?? null, windows };
  }

  async closeApplication(processName) {
    const name = processName.toLowerCase().replace(".exe", "");
    const ps = await this.runPowerShell(
      `Get-Process -Name '${escapePowerShellSingleQuoted(name)}' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue; 'ok'`,
      { timeoutMs: 8000 }
    );
    return { processName: name, commandResult: ps };
  }

  async listWindows() {
    const ps = await this.runPowerShell(
      "Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object Id,ProcessName,MainWindowTitle | ConvertTo-Json -Compress"
    );
    let parsed = [];
    try {
      parsed = JSON.parse(ps.stdout || "[]");
    } catch {
      parsed = [];
    }
    return Array.isArray(parsed) ? parsed : [parsed].filter(Boolean);
  }

  async notepadTypeAndSave({ content, filename }) {
    const documents = this.getDocumentsPath();
    const filePath = path.join(documents, filename);
    await this.launchApplication("notepad");
    await new Promise((r) => setTimeout(r, 2000));
    const escapedContent = escapePowerShellSingleQuoted(content);
    const escapedPath = escapePowerShellSingleQuoted(filePath);
    const ps = await this.runPowerShell(
      `Add-Type -AssemblyName System.Windows.Forms; ` +
      `$wshell = New-Object -ComObject WScript.Shell; ` +
      `Start-Sleep -Milliseconds 800; ` +
      `if (-not $wshell.AppActivate('Notepad')) { throw 'Notepad window not found' }; ` +
      `Start-Sleep -Milliseconds 400; ` +
      `[System.Windows.Forms.SendKeys]::SendWait('${escapedContent}'); ` +
      `Start-Sleep -Milliseconds 400; ` +
      `[System.Windows.Forms.SendKeys]::SendWait('^s'); ` +
      `Start-Sleep -Milliseconds 1200; ` +
      `[System.Windows.Forms.SendKeys]::SendWait('${escapedPath}'); ` +
      `Start-Sleep -Milliseconds 400; ` +
      `[System.Windows.Forms.SendKeys]::SendWait('{ENTER}'); ` +
      `Start-Sleep -Milliseconds 800; ` +
      `'saved'`,
      { timeoutMs: 45000 }
    );
    const verify = await this.verifyFileContains(filePath, content);
    return { filePath, content, commandResult: ps, verification: verify };
  }

  async browserSearch(query) {
    const encoded = encodeURIComponent(query);
    const url = `https://www.bing.com/search?q=${encoded}`;
    const result = await this.executeCommand(process.cwd(), "cmd", ["/c", "start", "msedge", url], { timeoutMs: 15000 });
    return { query, url, launchResult: result };
  }

  async restartService(serviceName) {
    const escaped = escapePowerShellSingleQuoted(serviceName);
    const ps = await this.runPowerShell(
      `Restart-Service -Name '${escaped}' -Force -ErrorAction Stop; ` +
      `Get-Service -Name '${escaped}' | Select-Object Name,Status | ConvertTo-Json -Compress`,
      { timeoutMs: 30000 }
    );
    let parsed = null;
    try {
      parsed = JSON.parse(ps.stdout || "{}");
    } catch {
      parsed = null;
    }
    return { serviceName, status: parsed?.Status ?? null, commandResult: ps };
  }

  async analyzeSystemPerformance() {
    const system = await this.getSystemInformation();
    const processes = await this.listProcesses();
    const top = processes.slice(0, 5);
    const memoryPressure = system.freeMemory / system.totalMemory < 0.15;
    const contributors = top.map((p) => ({
      processName: p.ProcessName,
      workingSetMb: p.WorkingSet64 ? Math.round(p.WorkingSet64 / 1024 / 1024) : null
    }));
    return {
      memoryPressure,
      freeMemoryGb: (system.freeMemory / 1024 / 1024 / 1024).toFixed(2),
      totalMemoryGb: (system.totalMemory / 1024 / 1024 / 1024).toFixed(2),
      topMemoryProcesses: contributors,
      summary: memoryPressure
        ? "Memory is under pressure; top processes may be contributing to slowness."
        : "No extreme memory pressure detected from current snapshot."
    };
  }
}
