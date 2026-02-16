-- ---------------------------------------------------------------------------
-- Tasks (dispatched agent work tracked by the heartbeat system)
-- ---------------------------------------------------------------------------
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  agent_slug TEXT NOT NULL,
  command_name TEXT NOT NULL DEFAULT 'task',
  prompt TEXT,
  pid INTEGER,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed', 'stuck', 'killed')),
  log_path TEXT,
  exit_code INTEGER,
  ai_diagnosis TEXT,
  output_bytes BIGINT NOT NULL DEFAULT 0,
  last_output_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Indexes
CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_tasks_status ON tasks(status) WHERE status = 'running';

-- ---------------------------------------------------------------------------
-- pg_cron safety net: mark tasks as stuck if running with no output for 5 min.
-- Catches cases where the murder CLI process itself crashes mid-monitor.
-- ---------------------------------------------------------------------------
SELECT cron.schedule(
  'stale-task-check',
  '*/2 * * * *',
  $$
    UPDATE tasks
    SET status = 'stuck', updated_at = NOW()
    WHERE status = 'running'
      AND last_output_at < NOW() - INTERVAL '5 minutes'
  $$
);
