// ---------------------------------------------------------------------------
// Known stuck patterns — regex-based detection for stuck agents.
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
  {
    regex: /^(.{20,})\n(\1\n?){2,}/m,
    diagnosis:
      "The agent appears to be in a loop — repeated identical output detected.",
    action: "kill",
  },
  {
    regex:
      /waiting for (?:input|response|user)|press (?:enter|any key)|y\/n\b|\(yes\/no\)/i,
    diagnosis:
      "The agent is waiting for user input and cannot proceed without interaction.",
    action: "escalate",
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
  {
    regex: /model not available|invalid model|unknown model/i,
    diagnosis:
      "The configured model is not available. Update the preferred model in agent settings (murder start or web UI).",
    action: "kill",
  },
  {
    regex: /internal server error|unexpected error|something went wrong/i,
    diagnosis:
      "The agent backend encountered an internal error. Retrying may resolve the issue.",
    action: "retry",
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
 * When trimmed output is empty or very short, escalates immediately.
 */
export function matchStuckPattern(
  agentSlug: string,
  output: string
): PatternResult {
  // Empty or whitespace-only output after a long run
  if (output.trim().length < 5) {
    return {
      matched: true,
      diagnosis:
        "No meaningful output detected. The agent may be stuck or idle.",
      action: "escalate",
    };
  }

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
