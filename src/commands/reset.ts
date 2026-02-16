import { execSync } from "child_process";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { promptConfirm } from "../lib/prompt.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");

export async function reset(banner: string) {
  console.log(banner);
  console.log("  \x1B[1m\x1B[31m⚠  Factory Reset\x1B[0m\n");
  console.log("  This will permanently destroy:");
  console.log("    • All Docker containers and volumes");
  console.log("    • Your entire local database (projects, agents, memories)");
  console.log("    • All stored API keys and provider configurations");
  console.log("    • The running web UI process\n");
  console.log("  You will need to run 'murder start' and 'murder setup' again.\n");

  const confirmed = await promptConfirm("Are you sure you want to reset?");
  if (!confirmed) {
    console.log("\n  Reset cancelled.\n");
    return;
  }

  console.log("\n  Factory resetting murder...\n");

  killWebUI();

  try {
    execSync("docker compose down -v", {
      cwd: PROJECT_ROOT,
      stdio: "inherit",
    });
    console.log("\n  ✓ All containers and data have been destroyed.");
    console.log("  Run 'murder start' to start fresh.\n");
  } catch {
    console.error("\n  ✗ Failed to reset.\n");
    process.exit(1);
  }
}

function killWebUI() {
  try {
    const output = execSync(
      "lsof -ti :1314 2>/dev/null || true",
      { encoding: "utf-8" }
    ).trim();

    if (output) {
      for (const pid of output.split("\n")) {
        if (pid.trim()) {
          try {
            process.kill(Number(pid.trim()), "SIGTERM");
          } catch {
            // process already gone
          }
        }
      }
      console.log("  ✓ Web UI stopped\n");
    }
  } catch {
    // lsof not available or no process found — that's fine
  }
}
