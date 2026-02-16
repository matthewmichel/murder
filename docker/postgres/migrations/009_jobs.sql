-- ---------------------------------------------------------------------------
-- Jobs — scheduled CRON-based task execution
-- ---------------------------------------------------------------------------
CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  prompt TEXT NOT NULL,
  schedule TEXT NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_jobs_updated_at
  BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_jobs_enabled ON jobs(is_enabled) WHERE is_enabled = true;

-- ---------------------------------------------------------------------------
-- Job Runs — execution history for each job
-- ---------------------------------------------------------------------------
CREATE TABLE job_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
  slug_used TEXT,
  branch_name TEXT,
  pr_url TEXT,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_job_runs_updated_at
  BEFORE UPDATE ON job_runs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_job_runs_job_id ON job_runs(job_id);
CREATE INDEX idx_job_runs_status ON job_runs(status) WHERE status IN ('pending', 'running');

-- ---------------------------------------------------------------------------
-- pg_cron placeholder — actual schedule matching is done in TypeScript
-- by the polling loop started in `murder start`.
-- ---------------------------------------------------------------------------
SELECT cron.schedule(
  'murder-jobs-tick',
  '* * * * *',
  $$SELECT 1$$
);
