import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel, EmbeddingModel } from "ai";
import sql from "./db.js";
import { decrypt } from "./crypto.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ResolvedConfig {
  slug: string;
  baseUrl: string;
  providerType: string;
  apiKey: string;
  keyAlias: string;
  modelName: string;
  modelConfig: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Provider cache — keyed by slug:keyAlias so a key rotation naturally
// invalidates the cached instance on the next call.
// ---------------------------------------------------------------------------

const providers = new Map<string, unknown>();

function openaiCompatible(cacheKey: string, apiKey: string, baseUrl: string) {
  let p = providers.get(cacheKey) as
    | ReturnType<typeof createOpenAI>
    | undefined;
  if (!p) {
    p = createOpenAI({ baseURL: baseUrl, apiKey });
    providers.set(cacheKey, p);
  }
  return p;
}

function anthropicProvider(cacheKey: string, apiKey: string) {
  let p = providers.get(cacheKey) as
    | ReturnType<typeof createAnthropic>
    | undefined;
  if (!p) {
    p = createAnthropic({ apiKey });
    providers.set(cacheKey, p);
  }
  return p;
}

// ---------------------------------------------------------------------------
// Config resolution
// ---------------------------------------------------------------------------

interface ConfigRow {
  slug: string;
  base_url: string;
  provider_type: string;
  encrypted_api_key: string;
  key_alias: string;
  model_name: string;
  model_config: Record<string, unknown>;
}

/**
 * Resolve the active AI config for a given capability.
 * When `projectId` is provided, a project-scoped override is preferred;
 * otherwise falls back to the global default.
 */
export async function resolveConfig(
  capability: "orchestration" | "embeddings",
  projectId?: string
): Promise<ResolvedConfig> {
  const rows = await sql`
    SELECT
      p.slug,
      p.base_url,
      p.provider_type,
      k.encrypted_api_key,
      k.key_alias,
      c.model_name,
      c.model_config
    FROM ai_configs c
    JOIN ai_provider_keys k ON k.id = c.provider_key_id
    JOIN ai_providers p ON p.id = k.provider_id
    WHERE c.capability = ${capability}
      AND c.is_active = true
      AND k.is_active = true
      ${
        projectId
          ? sql`AND (c.project_id = ${projectId}::uuid OR c.project_id IS NULL)`
          : sql`AND c.project_id IS NULL`
      }
    ORDER BY c.project_id IS NOT NULL DESC
    LIMIT 1
  `;

  if (rows.length === 0) {
    throw new Error(
      `No active ${capability} config found. Run "murder setup" to configure a provider.`
    );
  }

  const row = rows[0] as unknown as ConfigRow;

  return {
    slug: row.slug,
    baseUrl: row.base_url,
    providerType: row.provider_type,
    apiKey: decrypt(row.encrypted_api_key),
    keyAlias: row.key_alias,
    modelName: row.model_name,
    modelConfig: row.model_config ?? {},
  };
}

// ---------------------------------------------------------------------------
// Model factories
// ---------------------------------------------------------------------------

/**
 * Return a ready-to-use language model for the active orchestration config.
 */
export async function getLanguageModel(
  projectId?: string
): Promise<LanguageModel> {
  const c = await resolveConfig("orchestration", projectId);
  const key = `${c.slug}:${c.keyAlias}`;

  if (c.slug === "anthropic") {
    return anthropicProvider(key, c.apiKey)(c.modelName);
  }

  return openaiCompatible(key, c.apiKey, c.baseUrl)(c.modelName);
}

/**
 * Return a ready-to-use embedding model for the active embeddings config.
 */
export async function getEmbeddingModel(
  projectId?: string
): Promise<EmbeddingModel<string>> {
  const c = await resolveConfig("embeddings", projectId);
  const key = `${c.slug}:${c.keyAlias}`;

  if (c.slug === "anthropic") {
    throw new Error("Anthropic does not support embeddings.");
  }

  return openaiCompatible(key, c.apiKey, c.baseUrl).textEmbeddingModel(
    c.modelName
  );
}
