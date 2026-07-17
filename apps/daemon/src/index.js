import { createRuntime } from "./runtime-factory.js";
import { buildSessionResponse } from "../../../packages/protocol/src/session-protocol.js";

async function main() {
  const runtime = createRuntime();
  const command = process.argv[2];

  if (command === "sessions") {
    const sessions = await runtime.sessionStore.list();
    console.log(JSON.stringify(buildSessionResponse({ sessions }), null, 2));
    return;
  }

  console.error("Unknown daemon command. Supported: sessions");
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
