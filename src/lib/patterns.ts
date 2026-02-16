// ---------------------------------------------------------------------------
// Known stuck patterns — cheap first pass before calling the AI.
// Each pattern maps a regex to a diagnosis and recommended action.
// ---------------------------------------------------------------------------

export type StuckAction = "kill" | "retry" | "escalate";

export interface StuckPattern {
  regex: RegExp;
  diagnosis: string;
  action: StuckAction;
}

// ---------------------------------------------------------------------------
// Shared patterns (apply to all agent backends)
// ---------------------------------------------------------------------------

const SHARED_PATTERNS: StuckPattern[] = [
  {
    regex: /rate.?limit|429|too many requests/i,
    diagnosis: "Rate limited by the API provider. Wait and retry.",
    action: "retry",
  },
  {
    regex: /connection refused|ECONNREFUSED/i,
    diagnosis: "Connection refused. The API endpoint may be down.",
    action: "retry",
  },
  {
    regex: /network error|ETIMEDOUT|ENOTFOUND|fetch failed/i,
    diagnosis: "Network error. Check your internet connection.",
    action: "escalate",
  },
  {
    regex: /out of memory|heap|ENOMEM/i,
    diagnosis: "Process ran out of memory.",
    action: "kill",
  },
  {
    regex: /permission denied|EACCES/i,
    diagnosis: "Permission denied. Check file/directory permissions.",
    action: "escalate",
  },
  {
    regex: /quota exceeded|billing|payment required|402/i,
    diagnosis: "API quota or billing issue with the provider.",
    action: "kill",
  },
];

// ---------------------------------------------------------------------------
// Agent-specific patterns
// ---------------------------------------------------------------------------

const CURSOR_PATTERNS: StuckPattern[] = [
  {
    regex: /not logged in|sign in|authenticate/i,
    diagnosis:
      "Cursor CLI is not authenticated. Open Cursor IDE to sign in first.",
    action: "kill",
  },
];

// ---------------------------------------------------------------------------
// Pattern registry keyed by agent slug
// ---------------------------------------------------------------------------

const AGENT_PATTERNS: Record<string, StuckPattern[]> = {
  "cursor-cli": CURSOR_PATTERNS,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface PatternMatch {
  matched: true;
  diagnosis: string;
  action: StuckAction;
}

export interface PatternNoMatch {
  matched: false;
}

export type PatternResult = PatternMatch | PatternNoMatch;

/**
 * Scan the last chunk of agent output for known stuck patterns.
 * Checks agent-specific patterns first, then shared patterns.
 */
export function matchStuckPattern(
  agentSlug: string,
  output: string
): PatternResult {
  const agentSpecific = AGENT_PATTERNS[agentSlug] ?? [];
  const allPatterns = [...agentSpecific, ...SHARED_PATTERNS];

  for (const pattern of allPatterns) {
    if (pattern.regex.test(output)) {
      return {
        matched: true,
        diagnosis: pattern.diagnosis,
        action: pattern.action,
      };
    }
  }

  return { matched: false };
}
