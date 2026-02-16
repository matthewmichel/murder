export default {
  validate: {
    typecheck: "npx tsc --noEmit",
    // lint: null,     // no linter configured
    // test: null,     // no test runner configured
    // build: null,    // no build script — CLI runs via tsx directly
  },
  boot: {
    command: "pnpm dev",  // tsx src/index.ts
    // port: null,        // CLI tool, not a server
    // healthCheck: null,
  },
  web: {
    command: "npm run dev --prefix web",
    port: 1314,
    healthCheck: "/",
  },
  database: {
    start: "docker compose up -d --build",
    stop: "docker compose down",
    port: 1313,
    healthCheck: "docker compose exec -T postgres pg_isready -U murder -d murder",
  },
};
