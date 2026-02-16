import path from "node:path";
import sql from "../lib/db.js";
import { promptText } from "../lib/prompt.js";
import { slugify } from "../lib/cli-utils.js";

export async function project() {
  const cwd = process.cwd();

  console.log();

  // --- Connect to the database ---
  let rows;
  try {
    rows = await sql`SELECT * FROM projects WHERE root_path = ${cwd} LIMIT 1`;
  } catch {
    console.log("  \u2717 Could not connect to the database.");
    console.log("    Make sure murder is running (murder start).\n");
    process.exit(1);
    return;
  }

  // --- Existing project: show config ---
  if (rows.length > 0) {
    const p = rows[0];

    let memCount = 0;
    try {
      const [memResult] = await sql`
        SELECT count(*)::int AS count FROM mem0_memories
        WHERE payload->>'userId' = ${p.id}
      `;
      memCount = memResult.count;
    } catch {
      // mem0_memories table may not exist yet if mem0 hasn't initialized
    }

    const [convResult] = await sql`
      SELECT count(*)::int AS count FROM conversations WHERE project_id = ${p.id}
    `;

    console.log(`  Project:       ${p.name}`);
    console.log(`  Slug:          ${p.slug}`);
    console.log(`  Path:          ${p.root_path}`);
    if (p.description) {
      console.log(`  Description:   ${p.description}`);
    }
    console.log(`  Created:       ${new Date(p.created_at).toLocaleDateString()}`);
    console.log(`  Updated:       ${new Date(p.updated_at).toLocaleDateString()}`);
    console.log(`  Memories:      ${memCount}`);
    console.log(`  Conversations: ${convResult.count}`);
    console.log();

    await sql.end();
    return;
  }

  // --- New project: interactive setup ---
  console.log("  Register this directory as a murder project\n");

  const dirName = path.basename(cwd);

  const name = await promptText("Name:", dirName);
  if (!name) {
    console.log("\n  \u2717 No name entered. Aborting.\n");
    await sql.end();
    process.exit(1);
    return;
  }

  const defaultSlug = slugify(name);
  const slug = await promptText("Slug:", defaultSlug);
  if (!slug) {
    console.log("\n  \u2717 No slug entered. Aborting.\n");
    await sql.end();
    process.exit(1);
    return;
  }

  // Validate slug uniqueness
  const existing = await sql`SELECT id FROM projects WHERE slug = ${slug}`;
  if (existing.length > 0) {
    console.log(`\n  \u2717 A project with slug "${slug}" already exists. Aborting.\n`);
    await sql.end();
    process.exit(1);
    return;
  }

  const description = await promptText("Description:");

  try {
    await sql`
      INSERT INTO projects (name, slug, description, root_path)
      VALUES (${name}, ${slug}, ${description}, ${cwd})
    `;
  } catch (err) {
    console.log("\n  \u2717 Failed to create project.");
    if (err instanceof Error) console.log(`    ${err.message}`);
    console.log();
    await sql.end();
    process.exit(1);
    return;
  }

  console.log(`\n  \u2713 Project "${name}" registered`);
  console.log(`    ${cwd}\n`);

  await sql.end();
}
