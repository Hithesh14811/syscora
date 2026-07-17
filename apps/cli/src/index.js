import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { createRuntime } from "../../daemon/src/runtime-factory.js";

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current.startsWith("--")) {
      const key = current.slice(2);
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        parsed[key] = true;
      } else {
        parsed[key] = next;
        index += 1;
      }
    }
  }
  return parsed;
}

async function requestApproval(message) {
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question(`${message} Type "yes" to approve: `);
    return answer.trim().toLowerCase() === "yes";
  } finally {
    rl.close();
  }
}

function buildIntent(args) {
  const workspacePath = path.resolve(args.workspace ?? process.cwd());
  const key = args.key;
  const value = args.value;

  if (!key || !value) {
    throw new Error("Missing required flags --key and --value");
  }

  return {
    rawText: `Set ${key} for the current project`,
    entities: {
      workspacePath,
      key,
      value
    }
  };
}

async function setEnvCommand(args) {
  const runtime = createRuntime(process.cwd());
  const intent = buildIntent(args);
  const autoApprove = args.approve === true
    ? true
    : await requestApproval(`SYSCORA plans to modify ${path.join(intent.entities.workspacePath, ".env")}.`);

  const session = await runtime.runSetProjectEnvVariable(intent, { autoApprove });

  console.log(JSON.stringify({
    understanding: {
      goal: session.plan?.goal ?? `Set ${intent.entities.key} for the current project`
    },
    plan: session.plan?.summary ?? "Approval pending before plan execution.",
    risk: session.riskAssessment?.overallRisk ?? "UNKNOWN",
    policy: session.policyDecision?.reason ?? "UNKNOWN",
    result: session.finalResponse
  }, null, 2));
}

async function main() {
  const command = process.argv[2];
  const args = parseArgs(process.argv.slice(3));

  switch (command) {
    case "set-env":
      await setEnvCommand(args);
      break;
    default:
      console.error("Usage: node apps/cli/src/index.js set-env --workspace . --key NAME --value VALUE [--approve]");
      process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
