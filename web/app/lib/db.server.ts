import postgres from "postgres";

const sql = postgres({
  host: process.env.MURDER_DB_HOST ?? "localhost",
  port: Number(process.env.MURDER_DB_PORT ?? 1313),
  user: process.env.MURDER_DB_USER ?? "murder",
  password: process.env.MURDER_DB_PASSWORD ?? "murder",
  database: process.env.MURDER_DB_NAME ?? "murder",
});

export default sql;
