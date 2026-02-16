// ---------------------------------------------------------------------------
// Cursor CLI model constants — single source of truth for CLI + web UI
// ---------------------------------------------------------------------------

export interface CursorCliModel {
  value: string;
  label: string;
  hint?: string;
}

export const CURSOR_CLI_MODELS: CursorCliModel[] = [
  // Auto (let Cursor decide)
  { value: "auto", label: "Auto (Cursor default)", hint: "Let Cursor pick the best model" },

  // Anthropic — Claude
  { value: "claude-4.6-opus", label: "Claude 4.6 Opus", hint: "Most capable" },
  { value: "claude-4.5-sonnet", label: "Claude 4.5 Sonnet", hint: "Balanced" },
  { value: "claude-4.5-haiku", label: "Claude 4.5 Haiku", hint: "Balanced" },

  // OpenAI — GPT
  { value: "gpt-5.3-codex", label: "GPT-5.3 Codex", hint: "Code-focused" },
  { value: "gpt-5.2-codex", label: "GPT-5.2 Codex", hint: "Code-focused" },

  // Cursor
  { value: "composer-1.5", label: "Composer 1.5", hint: "Fast, lightweight" },
];
