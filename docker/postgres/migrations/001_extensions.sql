-- Enable pgvector for embedding storage
CREATE EXTENSION IF NOT EXISTS vector;

-- Enable pg_cron for scheduled background jobs
CREATE EXTENSION IF NOT EXISTS pg_cron;
