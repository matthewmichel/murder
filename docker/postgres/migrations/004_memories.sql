-- ---------------------------------------------------------------------------
-- mem0 memory store (pgvector)
--
-- The mem0_memories table and HNSW index are created at runtime by mem0's
-- PGVectorStore.initialize() so the vector dimension matches the configured
-- embedding model. We only pre-create the helper tables and indexes here.
--
-- Scoping: mem0 uses payload->>'userId' (camelCase) for scoping. We map our
-- project IDs to that field; global memories use userId = 'global'.
-- ---------------------------------------------------------------------------

-- Used by mem0 internally to track a default user id
CREATE TABLE memory_migrations (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE
);
