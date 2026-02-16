import postgres from "postgres";
import type { Sql } from "postgres";

export interface PGVectorConfig {
  collectionName?: string;
  embeddingModelDims?: number;
  hnsw?: boolean;
  /** Re-use an existing postgres.js connection */
  sql?: Sql;
  /** OR connect with individual params */
  user?: string;
  password?: string;
  host?: string;
  port?: number;
  dbname?: string;
}

/**
 * pgvector-backed VectorStore for mem0's OSS Node SDK.
 *
 * Implements the VectorStore interface expected by mem0:
 *   insert, search, get, update, delete, deleteCol, list,
 *   getUserId, setUserId, initialize
 *
 * Uses our existing `postgres` (postgres.js) driver instead of `pg`.
 */
export class PGVectorStore {
  private sql: Sql;
  private collectionName: string;
  private embeddingModelDims: number;
  private useHnsw: boolean;
  private ownsConnection: boolean;

  constructor(config: PGVectorConfig) {
    this.collectionName = config.collectionName || "mem0_memories";
    this.embeddingModelDims = config.embeddingModelDims || 1536;
    this.useHnsw = config.hnsw ?? false;

    if (config.sql) {
      this.sql = config.sql;
      this.ownsConnection = false;
    } else {
      this.sql = postgres({
        host: config.host ?? "localhost",
        port: config.port ?? 5432,
        user: config.user ?? "murder",
        password: config.password ?? "murder",
        database: config.dbname ?? "murder",
      });
      this.ownsConnection = true;
    }
  }

  async initialize(): Promise<void> {
    await this.sql`CREATE EXTENSION IF NOT EXISTS vector`;

    await this.sql`
      CREATE TABLE IF NOT EXISTS memory_migrations (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE
      )
    `;

    const tables = await this.sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
    `;
    const tableNames = tables.map(
      (r: { table_name: string }) => r.table_name
    );

    if (!tableNames.includes(this.collectionName)) {
      await this.createCollection();
    }
  }

  private async createCollection(): Promise<void> {
    const dims = this.embeddingModelDims;
    const name = this.collectionName;

    await this.sql.unsafe(`
      CREATE TABLE IF NOT EXISTS ${name} (
        id UUID PRIMARY KEY,
        vector vector(${dims}),
        payload JSONB
      )
    `);

    if (this.useHnsw) {
      try {
        await this.sql.unsafe(`
          CREATE INDEX IF NOT EXISTS ${name}_hnsw_idx
          ON ${name}
          USING hnsw (vector vector_cosine_ops)
        `);
      } catch (err) {
        console.warn("HNSW index creation failed:", err);
      }
    }

    try {
      await this.sql.unsafe(`
        CREATE INDEX IF NOT EXISTS idx_${name}_user
        ON ${name} ((payload->>'userId'))
      `);
    } catch (err) {
      console.warn("userId index creation failed:", err);
    }
  }

  async insert(
    vectors: number[][],
    ids: string[],
    payloads: Record<string, unknown>[]
  ): Promise<void> {
    const query = `
      INSERT INTO ${this.collectionName} (id, vector, payload)
      VALUES ($1::uuid, $2::vector, $3::jsonb)
      ON CONFLICT (id) DO UPDATE SET
        vector = EXCLUDED.vector,
        payload = EXCLUDED.payload
    `;

    await Promise.all(
      vectors.map((vec, i) =>
        this.sql.unsafe(query, [
          ids[i],
          `[${vec.join(",")}]`,
          JSON.stringify(payloads[i]),
        ])
      )
    );
  }

  async search(
    query: number[],
    limit = 10,
    filters?: Record<string, unknown>
  ): Promise<{ id: string; payload: Record<string, unknown>; score: number }[]> {
    const queryVector = `[${query.join(",")}]`;

    const filterParts: string[] = [];
    const params: unknown[] = [queryVector, limit];
    let paramIdx = 3;

    if (filters) {
      for (const [key, value] of Object.entries(filters)) {
        filterParts.push(`payload->>'${key}' = $${paramIdx}`);
        params.push(value);
        paramIdx++;
      }
    }

    const whereClause =
      filterParts.length > 0 ? "WHERE " + filterParts.join(" AND ") : "";

    const rows = await this.sql.unsafe(
      `
      SELECT id, vector <=> $1::vector AS distance, payload
      FROM ${this.collectionName}
      ${whereClause}
      ORDER BY distance
      LIMIT $2
      `,
      params as any[]
    );

    return rows.map((row: any) => ({
      id: row.id,
      payload: row.payload,
      score: row.distance,
    }));
  }

  async get(
    vectorId: string
  ): Promise<{ id: string; payload: Record<string, unknown> } | null> {
    const rows = await this.sql.unsafe(
      `SELECT id, payload FROM ${this.collectionName} WHERE id = $1::uuid`,
      [vectorId]
    );

    if (rows.length === 0) return null;
    return { id: rows[0].id, payload: rows[0].payload };
  }

  async update(
    vectorId: string,
    vector: number[],
    payload: Record<string, unknown>
  ): Promise<void> {
    await this.sql.unsafe(
      `
      UPDATE ${this.collectionName}
      SET vector = $1::vector, payload = $2::jsonb
      WHERE id = $3::uuid
      `,
      [`[${vector.join(",")}]`, JSON.stringify(payload), vectorId]
    );
  }

  async delete(vectorId: string): Promise<void> {
    await this.sql.unsafe(
      `DELETE FROM ${this.collectionName} WHERE id = $1::uuid`,
      [vectorId]
    );
  }

  async deleteCol(): Promise<void> {
    await this.sql.unsafe(
      `DROP TABLE IF EXISTS ${this.collectionName}`
    );
  }

  async list(
    filters?: Record<string, unknown>,
    limit = 100
  ): Promise<[{ id: string; payload: Record<string, unknown> }[], number]> {
    const filterParts: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (filters) {
      for (const [key, value] of Object.entries(filters)) {
        filterParts.push(`payload->>'${key}' = $${paramIdx}`);
        params.push(value);
        paramIdx++;
      }
    }

    const whereClause =
      filterParts.length > 0 ? "WHERE " + filterParts.join(" AND ") : "";

    const listParams = [...params, limit];

    const [listResult, countResult] = await Promise.all([
      this.sql.unsafe(
        `SELECT id, payload FROM ${this.collectionName} ${whereClause} LIMIT $${paramIdx}`,
        listParams as any[]
      ),
      this.sql.unsafe(
        `SELECT COUNT(*)::int AS count FROM ${this.collectionName} ${whereClause}`,
        params as any[]
      ),
    ]);

    const results = listResult.map((row: any) => ({
      id: row.id,
      payload: row.payload,
    }));

    return [results, countResult[0]?.count ?? 0];
  }

  async getUserId(): Promise<string> {
    const rows = await this.sql`
      SELECT user_id FROM memory_migrations LIMIT 1
    `;

    if (rows.length > 0) {
      return (rows[0] as unknown as { user_id: string }).user_id;
    }

    const randomId =
      Math.random().toString(36).substring(2, 15) +
      Math.random().toString(36).substring(2, 15);

    await this.sql`
      INSERT INTO memory_migrations (user_id) VALUES (${randomId})
    `;
    return randomId;
  }

  async setUserId(userId: string): Promise<void> {
    await this.sql`DELETE FROM memory_migrations`;
    await this.sql`
      INSERT INTO memory_migrations (user_id) VALUES (${userId})
    `;
  }
}
