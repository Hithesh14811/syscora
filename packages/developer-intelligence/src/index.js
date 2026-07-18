import fs from "node:fs/promises";
import path from "node:path";

export class DeveloperIntelligenceEngine {
  async inspectProject(workspacePath) {
    const profile = await this.detectProject(workspacePath);
    const [repository, packageManager] = await Promise.all([
      this._inspectRepository(workspacePath),
      this._inspectPackageManager(workspacePath, profile.packageManager)
    ]);
    return { ...profile, repository, packageManagerInspection: packageManager };
  }

  async detectProject(workspacePath) {
    const packageJsonPath = path.join(workspacePath, "package.json");
    const pyprojectPath = path.join(workspacePath, "pyproject.toml");
    const requirementsPath = path.join(workspacePath, "requirements.txt");
    const nodeModulesPath = path.join(workspacePath, "node_modules");
    try {
      const raw = await fs.readFile(packageJsonPath, "utf8");
      const parsed = JSON.parse(raw);
      const scripts = parsed.scripts ?? {};
      const startScript = scripts.dev ? "dev" : scripts.start ? "start" : null;
      let installRequired = true;
      try {
        await fs.access(nodeModulesPath);
        installRequired = false;
      } catch {
        installRequired = true;
      }
      return {
        workspacePath,
        projectType: "node",
        packageManager: "npm",
        packageJsonPath,
        scripts,
        startScript,
        installRequired
      };
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }

    try {
      await fs.access(pyprojectPath);
      return {
        workspacePath,
        projectType: "python",
        packageManager: "pip",
        packageJsonPath: null,
        scripts: {
          start: "python app.py"
        },
        startScript: "start",
        installRequired: true,
        entrypoint: "app.py",
        dependencyFile: pyprojectPath
      };
    } catch {}

    try {
      await fs.access(requirementsPath);
      return {
        workspacePath,
        projectType: "python",
        packageManager: "pip",
        packageJsonPath: null,
        scripts: {
          start: "python app.py"
        },
        startScript: "start",
        installRequired: true,
        entrypoint: "app.py",
        dependencyFile: requirementsPath
      };
    } catch {}

    return {
      workspacePath,
      projectType: "unknown",
      packageManager: null,
      scripts: {},
      startScript: null,
      installRequired: false
    };
  }

  async _inspectRepository(workspacePath) {
    try {
      await fs.access(path.join(workspacePath, ".git"));
      return { present: true, rootPath: workspacePath };
    } catch {
      return { present: false, rootPath: null };
    }
  }

  async _inspectPackageManager(workspacePath, packageManager) {
    const candidates = [
      ["pnpm", "pnpm-lock.yaml"],
      ["yarn", "yarn.lock"],
      ["npm", "package-lock.json"]
    ];
    for (const [name, lockfile] of candidates) {
      try {
        await fs.access(path.join(workspacePath, lockfile));
        return { name, lockfile: path.join(workspacePath, lockfile), detected: true };
      } catch { /* try the next known lockfile */ }
    }
    return { name: packageManager, lockfile: null, detected: Boolean(packageManager) };
  }
}
