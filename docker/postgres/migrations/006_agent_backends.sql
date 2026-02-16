-- ---------------------------------------------------------------------------
-- Agent backends (detected CLI tools that murder orchestrates)
-- ---------------------------------------------------------------------------
CREATE TABLE agent_backends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  cli_command TEXT NOT NULL,
  cli_path TEXT,
  version TEXT,
  is_available BOOLEAN NOT NULL DEFAULT true,
  is_default BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB NOT NULL DEFAULT '{}',
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_agent_backends_updated_at
  BEFORE UPDATE ON agent_backends
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
