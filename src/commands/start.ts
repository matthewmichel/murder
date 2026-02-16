import { execSync, spawn } from "child_process";
import { existsSync, openSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { runMigrations } from "../lib/migrate.js";
import {
  detectAllAgents,
  registerAgentBackends,
  promptForModel,
  updateAgentModel,
} from "../lib/agents.js";
import { step, ok, fail } from "../lib/cli-utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");

export async function start(banner: string) {
  console.log(banner);
  console.log("  Starting murder...\n");

  // Step 1: Check Docker
  step("Checking for Docker...");
  if (!commandExists("docker info")) {
    fail("Docker is not installed or not running.");
    console.log("\n  Install Docker: https://docs.docker.com/get-docker/");
    console.log("  Then make sure Docker Desktop (or the daemon) is running.\n");
    process.exit(1);
  }
  ok("Docker is running");

  // Step 2: Check Docker Compose
  step("Checking for Docker Compose...");
  if (!commandExists("docker compose version")) {
    fail("Docker Compose is not available.");
    console.log("\n  Docker Compose v2 ships with Docker Desktop.");
    console.log("  https://docs.docker.com/compose/install/\n");
    process.exit(1);
  }
  ok("Docker Compose is available");

  // Step 3: Verify docker-compose.yml exists
  const composePath = join(PROJECT_ROOT, "docker-compose.yml");
  if (!existsSync(composePath)) {
    fail(`docker-compose.yml not found at ${PROJECT_ROOT}`);
    process.exit(1);
  }

  // Step 4: Build and start containers (idempotent — starts if not running)
  step("Ensuring database is running...\n");
  const buildOk = await runStreamed(
    "docker",
    ["compose", "up", "-d", "--build"],
    PROJECT_ROOT
  );
  if (!buildOk) {
    console.log();
    fail("Failed to start containers.");
    process.exit(1);
  }
  console.log();
  ok("Containers started");

  // Step 5: Wait for healthy
  step("Waiting for database to be healthy...");
  const healthy = await waitForHealthy(PROJECT_ROOT, 60_000);
  if (!healthy) {
    fail("Database did not become healthy in time.");
    console.log("\n  Check logs with: docker compose logs postgres\n");
    process.exit(1);
  }
  ok("Database is healthy");

  // Step 6: Verify extensions
  step("Verifying extensions...");
  const extensions = verifyExtensions(PROJECT_ROOT);
  if (!extensions) {
    fail("Extension verification failed.");
    process.exit(1);
  }
  ok("pgvector and pg_cron are installed");

  // Step 7: Run migrations
  step("Running migrations...");
  try {
    const result = runMigrations();
    if (result.isFirstRun && result.applied.length === 0) {
      ok(`Initialized migration tracking (${result.total} migrations)`);
    } else if (result.applied.length > 0) {
      ok(
        `Applied ${result.applied.length} new migration(s): ${result.applied.join(", ")}`
      );
    } else {
      ok(`Migrations up to date (${result.total} tracked)`);
    }
  } catch (err) {
    fail("Migration failed.");
    if (err instanceof Error) {
      console.log(`\n  ${err.message}\n`);
    }
    process.exit(1);
  }

  // Step 8: Detect and register AI coding agents
  step("Scanning for AI coding agents...");
  const { found, missing } = detectAllAgents();

  for (const agent of found) {
    console.log(`  \u2713 ${agent.name} ${agent.version} (${agent.path})`);
  }
  for (const def of missing) {
    console.log(`  \u2717 ${def.name} not found`);
  }
  console.log();

  let defaultAgentName: string | null = null;
  let selectedModel: string | null = null;

  if (found.length > 0) {
    const defaultSlug = found[0].slug;
    try {
      await registerAgentBackends(found, defaultSlug);
      defaultAgentName = found[0].name;
      ok(`Registered ${found.length} agent(s), default: ${defaultAgentName}`);
    } catch (err) {
      fail("Failed to register agent backends.");
      if (err instanceof Error) {
        console.log(`\n  ${err.message}\n`);
      }
    }

    // Prompt for preferred Cursor CLI model
    try {
      selectedModel = await promptForModel(found[0].slug);
      await updateAgentModel(found[0].slug, selectedModel);
      console.log(`  \u2713 Model: ${selectedModel ?? "auto (Cursor default)"}\n`);
    } catch (err) {
      fail("Failed to set model preference.");
      if (err instanceof Error) {
        console.log(`\n  ${err.message}\n`);
      }
    }
  } else {
    console.log("  \u26A0 No AI coding agents found. Install one to get started.\n");
  }

  // Step 9: Start the web UI
  const uiPort = process.env.MURDER_UI_PORT ?? "1314";
  step("Starting web UI...");

  const webDir = join(PROJECT_ROOT, "web");
  if (!existsSync(join(webDir, "node_modules"))) {
    console.log("  Installing web dependencies...\n");
    const installOk = await runStreamed("npm", ["install"], webDir);
    if (!installOk) {
      fail("Failed to install web dependencies.");
      process.exit(1);
    }
    console.log();
  }

  // Spawn the web UI as a fully detached background process
  const logFile = join(webDir, ".react-router", "dev.log");
  const logDir = dirname(logFile);
  if (!existsSync(logDir)) {
    execSync(`mkdir -p "${logDir}"`);
  }
  const out = openSync(logFile, "a");

  const webProcess = spawn("npx", ["react-router", "dev", "--port", uiPort], {
    cwd: webDir,
    stdio: ["ignore", out, out],
    env: { ...process.env, MURDER_UI_PORT: uiPort },
    detached: true,
  });

  webProcess.unref();

  // Brief wait so the server has time to bind the port
  await sleep(3000);

  ok(`Web UI running on http://localhost:${uiPort}`);

  // Step 10: Start the job executor
  step("Starting job executor...");

  const executorLogFile = join(PROJECT_ROOT, ".murder", "logs", "job-executor.log");
  const executorLogDir = dirname(executorLogFile);
  if (!existsSync(executorLogDir)) {
    execSync(`mkdir -p "${executorLogDir}"`);
  }
  const executorOut = openSync(executorLogFile, "a");

  const executorProcess = spawn(
    "npx",
    ["tsx", join(PROJECT_ROOT, "src", "lib", "job-executor-process.ts")],
    {
      cwd: PROJECT_ROOT,
      stdio: ["ignore", executorOut, executorOut],
      env: { ...process.env },
      detached: true,
    }
  );

  executorProcess.unref();

  ok("Job executor running in background");

  // Print final banner
  console.log();
  console.log("  \u250C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510");
  console.log("  \u2502          Murder is running.               \u2502");
  console.log("  \u251C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2524");
  console.log("  \u2502  Database:  localhost:1313                \u2502");
  console.log(`  \u2502  Web UI:    http://localhost:${uiPort.padEnd(14)}\u2502`);
  if (defaultAgentName) {
    const padded = defaultAgentName.padEnd(28);
    console.log(`  \u2502  Agent:     ${padded}\u2502`);
    const modelDisplay = (selectedModel ?? "auto").padEnd(28);
    console.log(`  \u2502  Model:     ${modelDisplay}\u2502`);
  }
  console.log("  \u2502  Jobs:      executor polling (30s)       \u2502");
  console.log("  \u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518");
  console.log();
  console.log("  Run 'murder setup' to configure an AI provider.");
  console.log("  Run 'murder stop' to shut everything down.\n");

  process.exit(0);
}

function commandExists(cmd: string): boolean {
  try {
    execSync(cmd, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function runStreamed(
  command: string,
  args: string[],
  cwd: string
): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, { cwd, stdio: "inherit" });
    proc.on("close", (code) => resolve(code === 0));
    proc.on("error", () => resolve(false));
  });
}

async function waitForHealthy(
  projectRoot: string,
  timeoutMs: number
): Promise<boolean> {
  const spinner = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"];
  const start = Date.now();
  let i = 0;

  while (Date.now() - start < timeoutMs) {
    try {
      const output = execSync("docker compose ps --format json", {
        cwd: projectRoot,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "ignore"],
      });

      for (const line of output.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const container = JSON.parse(trimmed);
          if (
            container.Name?.includes("postgres") &&
            container.Health === "healthy"
          ) {
            process.stdout.write("\r                              \r");
            return true;
          }
        } catch {
          // skip non-JSON lines
        }
      }
    } catch {
      // compose ps failed, keep waiting
    }

    process.stdout.write(`\r  ${spinner[i % spinner.length]} Waiting...`);
    i++;
    await sleep(2000);
  }

  process.stdout.write("\r                              \r");
  return false;
}

function verifyExtensions(projectRoot: string): boolean {
  try {
    const output = execSync(
      'docker compose exec -T postgres psql -U murder -d murder -t -c "SELECT extname FROM pg_extension;"',
      { cwd: projectRoot, encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }
    );

    const missing: string[] = [];
    if (!output.includes("vector")) missing.push("pgvector");
    if (!output.includes("pg_cron")) missing.push("pg_cron");

    if (missing.length > 0) {
      console.log(`\n  Missing extensions: ${missing.join(", ")}`);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
