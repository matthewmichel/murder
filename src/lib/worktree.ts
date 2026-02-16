import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function git(cmd: string, cwd: string): string {
  return execSync(`git ${cmd}`, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

function gitSafe(cmd: string, cwd: string): { ok: boolean; output: string } {
  try {
    const output = git(cmd, cwd);
    return { ok: true, output };
  } catch (err) {
    return { ok: false, output: (err as Error).message };
  }
}

function branchExists(cwd: string, branch: string): boolean {
  const { ok } = gitSafe(`rev-parse --verify ${branch}`, cwd);
  return ok;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function ensureGitRepo(cwd: string): void {
  const { ok } = gitSafe("rev-parse --git-dir", cwd);
  if (!ok) {
    throw new Error(
      "Not a git repository. murder new requires a git repo to create worktrees and branches."
    );
  }
}

export function ensureCleanWorktree(cwd: string): void {
  const status = git("status --porcelain", cwd);
  if (status.length > 0) {
    const lines = status.split("\n").length;
    console.log(`  \u26A0 Working tree has ${lines} uncommitted change(s).`);
    console.log("    Consider committing or stashing before proceeding.\n");
  }
}

// ---------------------------------------------------------------------------
// Feature branch
// ---------------------------------------------------------------------------

export function featureBranchName(slug: string): string {
  return `murder/${slug}`;
}

export function createFeatureBranch(cwd: string, slug: string): string {
  const branch = featureBranchName(slug);
  if (branchExists(cwd, branch)) {
    console.log(`    Branch ${branch} already exists, reusing.`);
    return branch;
  }
  git(`branch ${branch}`, cwd);
  return branch;
}

// ---------------------------------------------------------------------------
// Single worktree — the engineer works here on the feature branch
// ---------------------------------------------------------------------------

export function worktreeDir(cwd: string): string {
  return join(cwd, ".murder", "worktrees");
}

/**
 * Create a single worktree checked out on the feature branch.
 * Returns the absolute path to the worktree directory.
 */
export function setupWorktree(cwd: string, slug: string): string {
  const base = worktreeDir(cwd);
  const wtPath = join(base, "work");
  const featureBranch = featureBranchName(slug);

  if (!existsSync(wtPath)) {
    git(`worktree add "${wtPath}" ${featureBranch}`, cwd);
  }

  return wtPath;
}

/**
 * Remove the worktree and prune stale references.
 */
export function cleanupWorktree(cwd: string): void {
  const base = worktreeDir(cwd);
  const wtPath = join(base, "work");

  if (existsSync(wtPath)) {
    gitSafe(`worktree remove "${wtPath}" --force`, cwd);
  }

  gitSafe("worktree prune", cwd);
}

// ---------------------------------------------------------------------------
// PR creation
// ---------------------------------------------------------------------------

export interface PrResult {
  url: string | null;
  method: "gh" | "manual";
}

export function createPullRequest(
  cwd: string,
  slug: string,
  title: string
): PrResult {
  const featureBranch = featureBranchName(slug);

  git(`push -u origin ${featureBranch}`, cwd);

  let ghAvailable = false;
  try {
    execSync("which gh", { stdio: "pipe" });
    ghAvailable = true;
  } catch {
    ghAvailable = false;
  }

  if (!ghAvailable) {
    console.log(`\n  To create a PR, run:`);
    console.log(`    gh pr create --base main --head ${featureBranch} --title "${title}"\n`);
    return { url: null, method: "manual" };
  }

  try {
    const url = execSync(
      `gh pr create --base main --head ${featureBranch} --title "${title}" --body "Automated PR from murder new"`,
      { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    ).trim();
    return { url, method: "gh" };
  } catch {
    console.log(`\n  Could not create PR automatically.`);
    console.log(`  Push succeeded. Create PR manually for branch: ${featureBranch}\n`);
    return { url: null, method: "manual" };
  }
}
