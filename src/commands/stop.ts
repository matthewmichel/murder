import { execSync } from "child_process";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");

export function stop() {
  console.log("\n  Stopping murder...\n");

  // Kill any running web UI process
  killWebUI();

  try {
    execSync("docker compose down", {
      cwd: PROJECT_ROOT,
      stdio: "inherit",
    });
    console.log("\n  ✓ Murder has been stopped.\n");
  } catch {
    console.error("\n  ✗ Failed to stop containers.\n");
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
