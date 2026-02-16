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
  { value: "claude-4-opus", label: "Claude 4 Opus", hint: "Most capable" },
  { value: "claude-4-sonnet", label: "Claude 4 Sonnet", hint: "Balanced" },
  { value: "claude-3.7-sonnet", label: "Claude 3.7 Sonnet" },
  { value: "claude-3.5-sonnet", label: "Claude 3.5 Sonnet" },
  { value: "claude-3.5-haiku", label: "Claude 3.5 Haiku", hint: "Fast" },

  // OpenAI — GPT
  { value: "gpt-4.1", label: "GPT-4.1" },
  { value: "gpt-4.1-mini", label: "GPT-4.1 Mini", hint: "Fast" },
  { value: "gpt-4.1-nano", label: "GPT-4.1 Nano", hint: "Fastest" },
  { value: "gpt-4o", label: "GPT-4o" },
  { value: "gpt-4o-mini", label: "GPT-4o Mini" },

  // OpenAI — o-series (reasoning)
  { value: "o3", label: "o3", hint: "Reasoning" },
  { value: "o3-mini", label: "o3 Mini", hint: "Reasoning, fast" },
  { value: "o4-mini", label: "o4 Mini", hint: "Reasoning, fast" },

  // Google — Gemini
  { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash", hint: "Fast" },
  { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },

  // xAI — Grok
  { value: "grok-3", label: "Grok 3" },
  { value: "grok-3-mini", label: "Grok 3 Mini", hint: "Fast" },

  // Cursor
  { value: "cursor-small", label: "Cursor Small", hint: "Fast, lightweight" },
];
