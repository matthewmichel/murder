-- 008: Add preferred_model column to agent_backends
-- Allows users to pin a specific Cursor CLI model for agent dispatch.
-- NULL means "use agent default / auto".

ALTER TABLE agent_backends
  ADD COLUMN IF NOT EXISTS preferred_model TEXT DEFAULT NULL;
