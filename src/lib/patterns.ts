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
  // Interactive input prompts — agent is waiting for user input it can't provide
  {
    regex: /press enter|press any key|\[y\/n\]|\(y\/n\)|enter your|waiting for input|are you sure\?|confirm\?/i,
    diagnosis:
      "Agent is waiting for interactive user input it cannot provide.",
    action: "kill",
  },
  // HTTP server errors
  {
    regex: /500 internal server error|502 bad gateway|503 service unavailable/i,
    diagnosis: "Server returned an HTTP error. The API may be down.",
    action: "retry",
  },
  // Timeout and stall indicators
  {
    regex: /request timeout|timed?\s*out|ETIMEOUT|deadline exceeded|context deadline/i,
    diagnosis: "Request timed out. The API may be slow or unresponsive.",
    action: "retry",
  },
  // API authentication errors
  {
    regex: /\b401\b.*unauthorized|unauthorized.*\b401\b|\binvalid.?api.?key\b|api.?key.?expired|authentication failed|invalid_api_key/i,
    diagnosis:
      "API authentication error. Check your API key configuration.",
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
  {
    regex: /model not available|invalid model|unknown model/i,
    diagnosis:
      "The configured model is not available. Update the preferred model in agent settings (murder start or web UI).",
    action: "kill",
  },
  // Cursor-specific stall: repeated tool_call JSON events with no meaningful progress
  {
    regex: /("tool_call".*\n?){3,}/i,
    diagnosis:
      "Cursor CLI appears stalled — repeated tool_call events with no progress.",
    action: "escalate",
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
 * Detect when the last N lines of output are identical, indicating an
 * infinite loop or repeated error. Returns true if the threshold is met.
 */
export function detectRepeatedOutput(
  output: string,
  threshold: number = 5
): boolean {
  const lines = output
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < threshold) return false;

  const tail = lines.slice(-threshold);
  const first = tail[0];
  return tail.every((line) => line === first);
}

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
