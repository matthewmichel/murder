-- ---------------------------------------------------------------------------
-- Supported AI providers (registry)
-- ---------------------------------------------------------------------------
CREATE TABLE ai_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  provider_type TEXT NOT NULL CHECK (provider_type IN ('direct', 'gateway')),
  base_url TEXT NOT NULL,
  supported_capabilities TEXT[] NOT NULL DEFAULT '{}',
  default_models JSONB NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- API keys (BYOK) — one key per provider for this local instance
-- ---------------------------------------------------------------------------
CREATE TABLE ai_provider_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES ai_providers(id) ON DELETE CASCADE,
  encrypted_api_key TEXT NOT NULL,
  key_alias TEXT,
  custom_base_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_verified_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(provider_id)
);

CREATE TRIGGER trg_ai_provider_keys_updated_at
  BEFORE UPDATE ON ai_provider_keys
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- AI configuration per capability, optionally scoped to a project
--   project_id NULL  = default / global config
--   project_id set   = project-specific override
-- ---------------------------------------------------------------------------
CREATE TABLE ai_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  provider_key_id UUID NOT NULL REFERENCES ai_provider_keys(id),
  capability TEXT NOT NULL CHECK (capability IN ('embeddings', 'orchestration')),
  model_name TEXT NOT NULL,
  model_config JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_ai_configs_updated_at
  BEFORE UPDATE ON ai_configs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One config per capability per project
CREATE UNIQUE INDEX idx_ai_configs_project_capability
  ON ai_configs(project_id, capability)
  WHERE project_id IS NOT NULL;

-- One default config per capability (global)
CREATE UNIQUE INDEX idx_ai_configs_default_capability
  ON ai_configs(capability)
  WHERE project_id IS NULL;

-- ---------------------------------------------------------------------------
-- Seed: built-in provider registry
-- ---------------------------------------------------------------------------
INSERT INTO ai_providers (slug, name, provider_type, base_url, supported_capabilities, default_models) VALUES
  (
    'openai', 'OpenAI', 'direct',
    'https://api.openai.com/v1',
    ARRAY['embeddings', 'orchestration'],
    '{"embeddings": "text-embedding-3-small", "orchestration": "gpt-4o"}'
  ),
  (
    'anthropic', 'Anthropic', 'direct',
    'https://api.anthropic.com/v1',
    ARRAY['orchestration'],
    '{"orchestration": "claude-sonnet-4-20250514"}'
  ),
  (
    'openrouter', 'OpenRouter', 'gateway',
    'https://openrouter.ai/api/v1',
    ARRAY['embeddings', 'orchestration'],
    '{}'
  ),
  (
    'vercel-ai-gateway', 'Vercel AI Gateway', 'gateway',
    'https://gateway.ai.vercel.app/v1',
    ARRAY['embeddings', 'orchestration'],
    '{}'
  ),
  (
    'voyage', 'Voyage AI', 'direct',
    'https://api.voyageai.com/v1',
    ARRAY['embeddings'],
    '{"embeddings": "voyage-4"}'
  );
