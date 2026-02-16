import sql from "./db.js";
import { encrypt } from "./crypto.js";

export interface SeededProvider {
  id: string;
  slug: string;
  name: string;
  provider_type: string;
  supported_capabilities: string[];
  default_models: Record<string, string>;
}

/**
 * Fetch all providers from the `ai_providers` seed table.
 */
export async function getSeededProviders(): Promise<SeededProvider[]> {
  const rows = await sql`
    SELECT id, slug, name, provider_type, supported_capabilities, default_models
    FROM ai_providers
    ORDER BY name ASC
  `;
  return rows as unknown as SeededProvider[];
}

/**
 * Build a short alias from an API key for display purposes.
 * e.g. "sk-proj-abc...xyz" -> "sk-...xyz"
 */
function buildKeyAlias(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (trimmed.length <= 8) return "***";
  return `${trimmed.slice(0, 3)}...${trimmed.slice(-4)}`;
}

/**
 * Encrypt and upsert an API key for a provider.
 * Returns the provider_key id.
 */
export async function storeProviderKey(
  providerId: string,
  apiKey: string
): Promise<string> {
  const encrypted = encrypt(apiKey.trim());
  const alias = buildKeyAlias(apiKey);

  const rows = await sql`
    INSERT INTO ai_provider_keys (provider_id, encrypted_api_key, key_alias, is_active)
    VALUES (${providerId}::uuid, ${encrypted}, ${alias}, true)
    ON CONFLICT (provider_id) DO UPDATE SET
      encrypted_api_key = EXCLUDED.encrypted_api_key,
      key_alias = EXCLUDED.key_alias,
      is_active = true,
      updated_at = NOW()
    RETURNING id
  `;
  return (rows[0] as unknown as { id: string }).id;
}

/**
 * Upsert a global AI config for a capability.
 * Uses the unique partial index on (capability) WHERE project_id IS NULL.
 */
export async function storeAiConfig(
  providerKeyId: string,
  capability: string,
  modelName: string
): Promise<void> {
  await sql`
    INSERT INTO ai_configs (provider_key_id, capability, model_name)
    VALUES (${providerKeyId}::uuid, ${capability}, ${modelName})
    ON CONFLICT (capability) WHERE project_id IS NULL
    DO UPDATE SET
      provider_key_id = EXCLUDED.provider_key_id,
      model_name = EXCLUDED.model_name,
      is_active = true,
      updated_at = NOW()
  `;
}
