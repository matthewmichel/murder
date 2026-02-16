import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, basename } from "path";

export interface ProjectScan {
  rootPath: string;
  directoryTree: string;
  languages: string[];
  frameworks: string[];
  packageManager: string | null;
  testRunner: string | null;
  linter: string | null;
  formatter: string | null;
  hasCi: boolean;
  hasReadme: boolean;
  hasDocker: boolean;
  existingAgentsMd: boolean;
  existingMurderDir: boolean;
  configFiles: string[];
  scripts: Record<string, string>;
}

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".nuxt",
  "dist",
  "build",
  ".output",
  "target",
  "__pycache__",
  ".venv",
  "venv",
  ".murder",
  ".cursor",
  ".vscode",
  ".idea",
  "vendor",
  "coverage",
  ".turbo",
  ".cache",
  ".parcel-cache",
]);

const CONFIG_FILES = [
  "tsconfig.json",
  ".eslintrc",
  ".eslintrc.js",
  ".eslintrc.json",
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.ts",
  ".prettierrc",
  ".prettierrc.json",
  "prettier.config.js",
  ".editorconfig",
  "biome.json",
  "biome.jsonc",
  "vite.config.ts",
  "vite.config.js",
  "next.config.js",
  "next.config.ts",
  "next.config.mjs",
  "tailwind.config.js",
  "tailwind.config.ts",
  "jest.config.js",
  "jest.config.ts",
  "vitest.config.ts",
  "turbo.json",
  "docker-compose.yml",
  "docker-compose.yaml",
  "Dockerfile",
  "Makefile",
  ".env.example",
];

function buildDirectoryTree(rootPath: string, maxDepth: number = 3): string {
  const lines: string[] = [basename(rootPath) + "/"];

  function walk(dir: string, prefix: string, depth: number) {
    if (depth > maxDepth) return;

    let entries: string[];
    try {
      entries = readdirSync(dir).sort();
    } catch {
      return;
    }

    const visible = entries.filter(
      (e) => !IGNORE_DIRS.has(e) && !e.startsWith(".")
    );

    for (let i = 0; i < visible.length; i++) {
      const name = visible[i];
      const full = join(dir, name);
      const isLast = i === visible.length - 1;

      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }

      const connector = isLast ? "└── " : "├── ";
      const nextPrefix = prefix + (isLast ? "    " : "│   ");

      if (stat.isDirectory()) {
        lines.push(`${prefix}${connector}${name}/`);
        walk(full, nextPrefix, depth + 1);
      } else {
        lines.push(`${prefix}${connector}${name}`);
      }
    }
  }

  walk(rootPath, "", 0);
  return lines.join("\n");
}

function readJsonSafe(
  filePath: string
): Record<string, unknown> | null {
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

export function scanProject(rootPath: string): ProjectScan {
  const directoryTree = buildDirectoryTree(rootPath);
  const languages: string[] = [];
  const frameworks: string[] = [];
  let packageManager: string | null = null;
  let testRunner: string | null = null;
  let linter: string | null = null;
  let formatter: string | null = null;
  let scripts: Record<string, string> = {};

  const pkg = readJsonSafe(join(rootPath, "package.json")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  } | null;

  if (pkg) {
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    languages.push("TypeScript/JavaScript");
    scripts = pkg.scripts ?? {};

    if (allDeps["react"]) frameworks.push("React");
    if (allDeps["next"]) frameworks.push("Next.js");
    if (allDeps["react-router"]) frameworks.push("React Router");
    if (allDeps["remix"] || allDeps["@remix-run/react"])
      frameworks.push("Remix");
    if (allDeps["vue"]) frameworks.push("Vue");
    if (allDeps["nuxt"]) frameworks.push("Nuxt");
    if (allDeps["svelte"]) frameworks.push("Svelte");
    if (allDeps["@angular/core"]) frameworks.push("Angular");
    if (allDeps["express"]) frameworks.push("Express");
    if (allDeps["fastify"]) frameworks.push("Fastify");
    if (allDeps["hono"]) frameworks.push("Hono");
    if (allDeps["prisma"] || allDeps["@prisma/client"])
      frameworks.push("Prisma");
    if (allDeps["drizzle-orm"]) frameworks.push("Drizzle");
    if (allDeps["tailwindcss"]) frameworks.push("Tailwind CSS");
    if (allDeps["daisyui"]) frameworks.push("DaisyUI");

    if (allDeps["vitest"]) testRunner = "vitest";
    else if (allDeps["jest"]) testRunner = "jest";
    else if (allDeps["mocha"]) testRunner = "mocha";

    if (allDeps["eslint"]) linter = "eslint";
    if (allDeps["biome"] || allDeps["@biomejs/biome"]) linter = "biome";

    if (allDeps["prettier"]) formatter = "prettier";
    if (allDeps["biome"] || allDeps["@biomejs/biome"])
      formatter = formatter ?? "biome";
  }

  if (existsSync(join(rootPath, "Cargo.toml"))) languages.push("Rust");
  if (existsSync(join(rootPath, "go.mod"))) languages.push("Go");
  if (
    existsSync(join(rootPath, "pyproject.toml")) ||
    existsSync(join(rootPath, "requirements.txt"))
  )
    languages.push("Python");
  if (existsSync(join(rootPath, "Gemfile"))) languages.push("Ruby");

  if (existsSync(join(rootPath, "pnpm-lock.yaml")))
    packageManager = "pnpm";
  else if (existsSync(join(rootPath, "bun.lockb")))
    packageManager = "bun";
  else if (existsSync(join(rootPath, "yarn.lock")))
    packageManager = "yarn";
  else if (existsSync(join(rootPath, "package-lock.json")))
    packageManager = "npm";

  const configFiles: string[] = [];
  for (const f of CONFIG_FILES) {
    if (existsSync(join(rootPath, f))) configFiles.push(f);
  }

  return {
    rootPath,
    directoryTree,
    languages,
    frameworks,
    packageManager,
    testRunner,
    linter,
    formatter,
    hasCi: existsSync(join(rootPath, ".github", "workflows")),
    hasReadme:
      existsSync(join(rootPath, "README.md")) ||
      existsSync(join(rootPath, "readme.md")),
    hasDocker:
      existsSync(join(rootPath, "docker-compose.yml")) ||
      existsSync(join(rootPath, "Dockerfile")),
    existingAgentsMd: existsSync(join(rootPath, "AGENTS.md")),
    existingMurderDir: existsSync(join(rootPath, ".murder")),
    configFiles,
    scripts,
  };
}
