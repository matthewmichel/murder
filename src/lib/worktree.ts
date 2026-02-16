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
// Worktree setup
// ---------------------------------------------------------------------------

export interface WorktreePaths {
  engA: string;
  engB: string;
}

export function worktreeDir(cwd: string): string {
  return join(cwd, ".murder", "worktrees");
}

export function setupWorktrees(
  cwd: string,
  slug: string
): WorktreePaths {
  const base = worktreeDir(cwd);
  const engAPath = join(base, "eng-a");
  const engBPath = join(base, "eng-b");
  const featureBranch = featureBranchName(slug);

  const engABranch = `${featureBranch}--phase-1--eng-a`;
  const engBBranch = `${featureBranch}--phase-1--eng-b`;

  if (!existsSync(engAPath)) {
    git(`worktree add "${engAPath}" -b ${engABranch} ${featureBranch}`, cwd);
  }

  if (!existsSync(engBPath)) {
    git(`worktree add "${engBPath}" -b ${engBBranch} ${featureBranch}`, cwd);
  }

  return { engA: engAPath, engB: engBPath };
}

// ---------------------------------------------------------------------------
// Phase branch management
// ---------------------------------------------------------------------------

export function phaseBranchNames(
  slug: string,
  phaseNumber: number
): { engA: string; engB: string } {
  const base = featureBranchName(slug);
  return {
    engA: `${base}--phase-${phaseNumber}--eng-a`,
    engB: `${base}--phase-${phaseNumber}--eng-b`,
  };
}

/**
 * Create or reset phase branches from the feature branch, and switch
 * each worktree to its respective branch.
 */
export function setupPhaseBranches(
  cwd: string,
  slug: string,
  phaseNumber: number
): void {
  const featureBranch = featureBranchName(slug);
  const branches = phaseBranchNames(slug, phaseNumber);
  const paths = {
    engA: join(worktreeDir(cwd), "eng-a"),
    engB: join(worktreeDir(cwd), "eng-b"),
  };

  for (const [key, branch] of Object.entries(branches) as ["engA" | "engB", string][]) {
    const wtPath = paths[key];

    if (branchExists(cwd, branch)) {
      git(`branch -D ${branch}`, cwd);
    }

    git(`checkout -b ${branch} ${featureBranch}`, wtPath);
  }
}

// ---------------------------------------------------------------------------
// Merge phase branches back into the feature branch
// ---------------------------------------------------------------------------

export interface MergeResult {
  clean: boolean;
  conflicts: string[];
}

export function mergePhaseBranches(
  cwd: string,
  slug: string,
  phaseNumber: number
): MergeResult {
  const featureBranch = featureBranchName(slug);
  const branches = phaseBranchNames(slug, phaseNumber);
  const conflicts: string[] = [];

  const currentBranch = git("rev-parse --abbrev-ref HEAD", cwd);

  git(`checkout ${featureBranch}`, cwd);

  try {
    for (const branch of [branches.engA, branches.engB]) {
      const result = gitSafe(`merge ${branch} --no-edit`, cwd);
      if (!result.ok) {
        const conflictFiles = git("diff --name-only --diff-filter=U", cwd);
        if (conflictFiles) {
          conflicts.push(...conflictFiles.split("\n").filter(Boolean));
        }
        break;
      }
    }
  } finally {
    if (currentBranch !== featureBranch) {
      gitSafe(`checkout ${currentBranch}`, cwd);
    }
  }

  return {
    clean: conflicts.length === 0,
    conflicts,
  };
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

export function cleanupWorktrees(cwd: string): void {
  const base = worktreeDir(cwd);

  for (const name of ["eng-a", "eng-b"]) {
    const wtPath = join(base, name);
    if (existsSync(wtPath)) {
      gitSafe(`worktree remove "${wtPath}" --force`, cwd);
    }
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
