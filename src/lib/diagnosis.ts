import { generateText } from "ai";
import { getLanguageModel } from "./ai.js";
import type { StuckAction } from "./patterns.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiagnosisResult {
  verdict: StuckAction | "continue";
  diagnosis: string;
  confidence: number;
}

// ---------------------------------------------------------------------------
// System prompt for the diagnostic AI
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a process monitor for AI coding agents (Claude Code, OpenAI Codex, Cursor CLI).
You are given the recent terminal output of an agent process, along with timing information.
Your job is to determine if the agent is stuck and what action to take.

Respond with ONLY a JSON object (no markdown, no code fences) matching this schema:
{
  "verdict": "continue" | "kill" | "retry" | "escalate",
  "diagnosis": "Brief explanation of what's happening",
  "confidence": 0.0-1.0
}

Verdicts:
- "continue": The agent appears to be working normally. Long pauses can be normal during complex tasks (reading files, thinking, generating code).
- "kill": The agent is definitively stuck and cannot recover. Examples: authentication failure, missing API key, fatal error, infinite loop with repeated identical output.
- "retry": The agent hit a transient error that might resolve on retry. Examples: rate limiting, temporary network issues, API timeout.
- "escalate": The situation is ambiguous and needs human judgment. The agent might be stuck or might be doing heavy processing.

Guidelines:
- Agents often pause for 10-30 seconds between actions. This is NORMAL.
- If the agent has produced substantial output and then paused, lean toward "continue" — it may be thinking.
- If the output contains error messages or authentication prompts, lean toward "kill".
- If there is zero output after a long time, lean toward "escalate".
- Be conservative — killing a working agent is worse than waiting a bit longer.`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send recent agent output to the orchestration model for diagnosis.
 * Throws if no orchestration model is configured.
 */
export async function diagnoseOutput(
  agentName: string,
  recentOutput: string,
  totalElapsedMs: number,
  silenceDurationMs: number,
  projectId?: string
): Promise<DiagnosisResult> {
  const model = await getLanguageModel(projectId);

  const elapsedSecs = Math.round(totalElapsedMs / 1000);
  const silenceSecs = Math.round(silenceDurationMs / 1000);

  const truncatedOutput =
    recentOutput.length > 4000
      ? recentOutput.slice(-4000)
      : recentOutput;

  const userPrompt = [
    `Agent: ${agentName}`,
    `Total elapsed: ${elapsedSecs}s`,
    `Time since last output: ${silenceSecs}s`,
    `Output length: ${recentOutput.length} chars`,
    ``,
    `--- Recent output (last 50 lines) ---`,
    truncatedOutput || "(no output)",
    `--- End of output ---`,
  ].join("\n");

  const { text } = await generateText({
    model,
    system: SYSTEM_PROMPT,
    prompt: userPrompt,
    maxOutputTokens: 200,
    temperature: 0.1,
  });

  return parseResponse(text);
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

function parseResponse(raw: string): DiagnosisResult {
  const cleaned = raw
    .replace(/```json\s*/g, "")
    .replace(/```\s*/g, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned);

    const verdict = validateVerdict(parsed.verdict);
    const diagnosis =
      typeof parsed.diagnosis === "string"
        ? parsed.diagnosis
        : "Unable to determine issue.";
    const confidence =
      typeof parsed.confidence === "number"
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0.5;

    return { verdict, diagnosis, confidence };
  } catch {
    return {
      verdict: "escalate",
      diagnosis: "AI diagnosis returned an unparseable response. Manual review needed.",
      confidence: 0.1,
    };
  }
}

function validateVerdict(v: unknown): DiagnosisResult["verdict"] {
  if (v === "continue" || v === "kill" || v === "retry" || v === "escalate") {
    return v;
  }
  return "escalate";
}
