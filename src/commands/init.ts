import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "fs";
import { join, basename } from "path";
import sql from "../lib/db.js";
import { scanProject, type ProjectScan } from "../lib/scanner.js";
import {
  getDefaultAgent,
  getAvailableAgents,
  dispatchAgent,
} from "../lib/dispatch.js";
import { preflightCheck } from "../lib/preflight.js";
import { monitorTask } from "../lib/heartbeat.js";
import { promptSingleSelect, promptConfirm } from "../lib/prompt.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function step(msg: string) {
  console.log(`  ● ${msg}`);
}

function ok(msg: string) {
  console.log(`  ✓ ${msg}\n`);
}

function fail(msg: string) {
  console.log(`  ✗ ${msg}`);
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// ---------------------------------------------------------------------------
// Project registration (auto-registers if not already linked)
// ---------------------------------------------------------------------------

async function ensureProjectRegistered(cwd: string): Promise<string> {
  const rows = await sql`
    SELECT id, name FROM projects WHERE root_path = ${cwd} LIMIT 1
  `;

  if (rows.length > 0) {
    const p = rows[0] as unknown as { id: string; name: string };
    ok(`Project "${p.name}" registered`);
    return p.id;
  }

  const name = basename(cwd);
  let slug = slugify(name);

  const existing = await sql`SELECT id FROM projects WHERE slug = ${slug}`;
  if (existing.length > 0) {
    slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
  }

  const [inserted] = await sql`
    INSERT INTO projects (name, slug, root_path)
    VALUES (${name}, ${slug}, ${cwd})
    RETURNING id
  `;

  ok(`Project "${name}" auto-registered`);
  return (inserted as unknown as { id: string }).id;
}

// ---------------------------------------------------------------------------
// Prompt builder — writes detailed instructions the agent will read
// ---------------------------------------------------------------------------

function buildInitPrompt(scan: ProjectScan): string {
  const stackLines: string[] = [];
  if (scan.languages.length)
    stackLines.push(`Languages: ${scan.languages.join(", ")}`);
  if (scan.frameworks.length)
    stackLines.push(`Frameworks: ${scan.frameworks.join(", ")}`);
  if (scan.packageManager)
    stackLines.push(`Package manager: ${scan.packageManager}`);
  if (scan.testRunner) stackLines.push(`Test runner: ${scan.testRunner}`);
  if (scan.linter) stackLines.push(`Linter: ${scan.linter}`);
  if (scan.formatter) stackLines.push(`Formatter: ${scan.formatter}`);
  if (scan.hasCi) stackLines.push(`CI: GitHub Actions detected`);
  if (scan.hasDocker) stackLines.push(`Docker: detected`);

  const scriptLines = Object.entries(scan.scripts)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join("\n");

  return `# Murder Init — Project Scaffolding

You are setting up this project for agent-first development. Analyze the codebase thoroughly and create files that make it navigable and legible for AI coding agents.

## What murder detected

${stackLines.map((l) => `- ${l}`).join("\n")}

## Available package.json scripts

${scriptLines || "(none detected)"}

## Config files present

${scan.configFiles.map((f) => `- ${f}`).join("\n") || "(none detected)"}

## Directory structure

\`\`\`
${scan.directoryTree}
\`\`\`

## Files to create

You MUST create all four of these files. Read the actual source code to understand the project before writing them.

### 1. \`AGENTS.md\` (project root)

Create a concise AGENTS.md at the project root (~100-150 lines). This is the PRIMARY entry point that all AI coding agents read first when working on this project. It should function as a **map, not a manual**.

Include:
- One-paragraph project description
- Tech stack summary (language, framework, database, etc.)
- Directory map with 1-line descriptions of key directories
- Validation commands that agents should run after making changes (typecheck, lint, test, build)
- Key conventions and patterns (discovered by reading actual code)
- Common tasks and how to accomplish them
- Pointer to \`.murder/ARCHITECTURE.md\` for deeper context

Do NOT make it a monolith. Keep it scannable and actionable.

### 2. \`.murder/ARCHITECTURE.md\`

Create a detailed architecture document by actually reading the source code. Include:
- System overview (what the app does, how data flows)
- Key modules/directories and their responsibilities
- Dependency graph (what depends on what)
- Database schema (if applicable — look for migrations, schema files, ORMs)
- API structure (if applicable — look for route files, controllers)
- Build and deploy pipeline
- Known patterns (how errors are handled, how state is managed, etc.)

### 3. \`.murder/config.ts\`

Create a TypeScript configuration file that defines validation and boot commands for this project. Detect the actual commands from package.json scripts:

\`\`\`typescript
export default {
  validate: {
    typecheck: "...",  // detect from tsconfig presence / scripts
    lint: "...",       // detect from eslint/biome config / scripts
    test: "...",       // detect from test runner / scripts
    build: "...",      // detect from build script
  },
  boot: {
    command: "...",    // detect from dev script
    port: 3000,        // detect from config or scripts
    healthCheck: "/",  // detect if API health endpoint exists
  },
};
\`\`\`

Use the ACTUAL commands from the project's package.json scripts and configuration. If a command doesn't exist, comment it out or set it to null.

### 4. \`.murder/core-beliefs.md\`

Analyze the codebase's existing patterns and conventions. Document:
- Code style conventions (from config files AND actual code patterns)
- Component/module patterns in use
- State management approach
- Error handling patterns
- Testing conventions (what's tested, how tests are structured)
- Import conventions (absolute vs relative, barrel files)
- Any other patterns that agents should follow when contributing

Derive these from the ACTUAL code, not assumptions.

## Important rules

- **Read the actual source files.** Don't make assumptions about the codebase.
- The \`.murder/\` directory already exists. Create files directly in it.
- \`AGENTS.md\` goes at the **project root**, not in .murder/.
- Keep all generated content factual and grounded in what the code actually does.
- If the project has a README.md, read it for additional context.
`;
}

// ---------------------------------------------------------------------------
// Main command
// ---------------------------------------------------------------------------

export async function init() {
  const cwd = process.cwd();
  console.log("\n  Initializing project for agent-first development...\n");

  // Step 1: Connect to database
  step("Checking database connection...");
  try {
    await sql`SELECT 1`;
  } catch {
    fail("Could not connect to the database.");
    console.log("    Make sure murder is running (murder start).\n");
    process.exit(1);
    return;
  }
  ok("Connected");

  // Step 2: Ensure project is registered
  step("Checking project registration...");
  const projectId = await ensureProjectRegistered(cwd);

  // Step 3: Get the agent to dispatch to
  step("Finding agent...");
  let agent = await getDefaultAgent();

  if (!agent) {
    const agents = await getAvailableAgents();
    if (agents.length === 0) {
      fail("No AI coding agents available.");
      console.log("    Run 'murder start' to detect installed agents.\n");
      await sql.end();
      process.exit(1);
      return;
    }
    const items = agents.map((a) => ({ label: a.name }));
    const idx = await promptSingleSelect(items, "Select an agent:");
    agent = agents[idx];
  }
  ok(`Using ${agent.name}`);

  // Step 4: Pre-flight check
  step(`Pre-flight check for ${agent.name}...`);
  const preflight = preflightCheck(agent, cwd);

  if (!preflight.ok) {
    fail(`${agent.name} failed pre-flight: ${preflight.message}`);
    console.log();
    await sql.end();
    process.exit(1);
    return;
  }
  ok(preflight.message);

  // Step 5: Scan the project
  step("Scanning project...");
  const scan = scanProject(cwd);

  const details: string[] = [];
  if (scan.languages.length)
    details.push(`Languages:       ${scan.languages.join(", ")}`);
  if (scan.frameworks.length)
    details.push(`Frameworks:      ${scan.frameworks.join(", ")}`);
  if (scan.packageManager)
    details.push(`Package manager: ${scan.packageManager}`);
  if (scan.testRunner) details.push(`Test runner:     ${scan.testRunner}`);
  if (scan.linter) details.push(`Linter:          ${scan.linter}`);
  if (scan.formatter) details.push(`Formatter:       ${scan.formatter}`);

  for (const d of details) {
    console.log(`    ${d}`);
  }
  if (details.length) console.log();
  ok("Scan complete");

  // Step 6: Handle existing .murder/ directory
  if (scan.existingMurderDir) {
    const hasContent = readdirSync(join(cwd, ".murder")).length > 0;
    if (hasContent) {
      const proceed = await promptConfirm(
        "A .murder/ directory already exists. Re-initialize?"
      );
      if (!proceed) {
        console.log("\n  Aborted.\n");
        await sql.end();
        process.exit(0);
        return;
      }
      console.log();
    }
  }

  // Step 7: Create .murder/ directory structure
  step("Creating .murder/ directory...");
  const murderDir = join(cwd, ".murder");
  mkdirSync(murderDir, { recursive: true });
  mkdirSync(join(murderDir, "design-docs"), { recursive: true });
  mkdirSync(join(murderDir, "exec-plans", "active"), { recursive: true });
  mkdirSync(join(murderDir, "exec-plans", "completed"), { recursive: true });
  mkdirSync(join(murderDir, "references"), { recursive: true });
  mkdirSync(join(murderDir, "logs"), { recursive: true });
  ok(".murder/ directory created");

  // Step 7b: Ensure .murder/ is gitignored
  step("Checking .gitignore...");
  const gitignorePath = join(cwd, ".gitignore");
  const murderIgnoreEntry = ".murder/";

  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, "utf-8");
    const lines = content.split("\n").map((l) => l.trim());
    if (!lines.includes(".murder") && !lines.includes(".murder/")) {
      const separator = content.endsWith("\n") ? "" : "\n";
      writeFileSync(gitignorePath, `${content}${separator}${murderIgnoreEntry}\n`);
      ok(".murder/ added to .gitignore");
    } else {
      ok(".murder/ already in .gitignore");
    }
  } else {
    writeFileSync(gitignorePath, `${murderIgnoreEntry}\n`);
    ok(".gitignore created with .murder/");
  }

  // Step 8: Build prompt and dispatch to the agent
  step(`Dispatching to ${agent.name}...`);
  console.log();
  console.log("  ─────────────────────────────────────────");
  console.log(`  ${agent.name} is analyzing your project.`);
  console.log("  It will read the codebase and create:");
  console.log("    AGENTS.md, .murder/ARCHITECTURE.md,");
  console.log("    .murder/config.ts, .murder/core-beliefs.md");
  console.log("  ─────────────────────────────────────────\n");

  const dispatchPrompt = buildInitPrompt(scan);

  const handle = await dispatchAgent(
    agent,
    dispatchPrompt,
    cwd,
    projectId,
    "init",
    { outputFormat: "stream-json" }
  );

  // Step 9: Monitor the agent with heartbeat
  // Init tasks are long-running (reading many files, generating docs).
  // stream-json: dispatch parses JSON events and shows progress inline.
  // The log file captures raw events so stuck detection still works.
  const result = await monitorTask(handle, {
    outputTimeoutMs: 120_000,
    checkIntervalMs: 5_000,
    projectId,
    outputFormat: "stream-json",
  });

  // Step 10: Post-check — verify what was created
  console.log();
  console.log("  ─────────────────────────────────────────");
  console.log("  Results:\n");

  const checks = [
    { path: "AGENTS.md", label: "AGENTS.md" },
    { path: ".murder/ARCHITECTURE.md", label: ".murder/ARCHITECTURE.md" },
    { path: ".murder/config.ts", label: ".murder/config.ts" },
    { path: ".murder/core-beliefs.md", label: ".murder/core-beliefs.md" },
  ];

  const created: string[] = [];
  const missing: string[] = [];

  for (const check of checks) {
    if (existsSync(join(cwd, check.path))) {
      console.log(`  ✓ ${check.label}`);
      created.push(check.label);
    } else {
      console.log(`  ✗ ${check.label} (not created)`);
      missing.push(check.label);
    }
  }

  console.log("\n  ─────────────────────────────────────────\n");

  if (result.status === "killed" || result.status === "stuck") {
    if (result.diagnosis) {
      console.log(`  Diagnosis: ${result.diagnosis}`);
    }
    console.log(`  Log: ${handle.logPath}\n`);
  } else if (missing.length === 0) {
    console.log("  ✓ Initialization complete! Your project is agent-ready.\n");
  } else if (created.length > 0) {
    console.log(
      `  ⚠ Partially initialized. ${missing.length} file(s) not created.`
    );
    console.log("    Run 'murder init' again to retry.\n");
  } else {
    console.log("  ✗ No files were created.");
    if (result.exitCode !== null && result.exitCode !== 0) {
      console.log(`    Agent exited with code ${result.exitCode}.`);
    }
    console.log(`    Log: ${handle.logPath}\n`);
  }

  await sql.end();
}
