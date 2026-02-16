import { readFileSync, writeFileSync, renameSync } from "fs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Task {
  description: string;
  completed: boolean;
}

export interface Section {
  name: string;
  tasks: Task[];
}

export interface EngineerProgress {
  status: "pending" | "in_progress" | "completed" | "failed";
  taskId: string | null;
  sections: Section[];
}

export interface PhaseReview {
  status: "pending" | "in_progress" | "completed" | "failed";
  taskId: string | null;
}

export interface Phase {
  number: number;
  name: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  engineer: EngineerProgress;
  review: PhaseReview;
}

export interface Progress {
  slug: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  currentPhase: number;
  startedAt: string | null;
  completedAt: string | null;
  phases: Phase[];
}

// ---------------------------------------------------------------------------
// Read / Write
// ---------------------------------------------------------------------------

export function readProgress(path: string): Progress {
  const raw = readFileSync(path, "utf-8");
  return JSON.parse(raw) as Progress;
}

/**
 * Atomic write — write to a temp file then rename to avoid partial reads.
 */
export function writeProgress(path: string, progress: Progress): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(progress, null, 2) + "\n", "utf-8");
  renameSync(tmp, path);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function getCurrentPhase(progress: Progress): Phase | null {
  if (progress.currentPhase >= progress.phases.length) return null;
  return progress.phases[progress.currentPhase];
}

export function isAllComplete(progress: Progress): boolean {
  return progress.currentPhase >= progress.phases.length;
}

// ---------------------------------------------------------------------------
// Mutations — all return the mutated progress for chaining
// ---------------------------------------------------------------------------

export function markEngineerStatus(
  progress: Progress,
  phaseIdx: number,
  status: EngineerProgress["status"],
  taskId?: string
): Progress {
  const eng = progress.phases[phaseIdx].engineer;
  eng.status = status;
  if (taskId !== undefined) eng.taskId = taskId;
  return progress;
}

export function markPhaseStatus(
  progress: Progress,
  phaseIdx: number,
  status: Phase["status"]
): Progress {
  progress.phases[phaseIdx].status = status;
  return progress;
}

export function markReviewStatus(
  progress: Progress,
  phaseIdx: number,
  status: PhaseReview["status"],
  taskId?: string
): Progress {
  progress.phases[phaseIdx].review.status = status;
  if (taskId !== undefined) progress.phases[phaseIdx].review.taskId = taskId;
  return progress;
}

export function advancePhase(progress: Progress): Progress {
  progress.currentPhase++;
  if (progress.currentPhase >= progress.phases.length) {
    progress.status = "completed";
    progress.completedAt = new Date().toISOString();
  }
  return progress;
}
