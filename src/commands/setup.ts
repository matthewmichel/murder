import sql from "../lib/db.js";
import {
  getSeededProviders,
  storeProviderKey,
  storeAiConfig,
} from "../lib/providers.js";
import {
  promptSingleSelect,
  promptSecret,
  promptText,
  type MenuItem,
} from "../lib/prompt.js";

interface ModelOption {
  model: string;
  hint: string;
  provider: string;
}

const ORCHESTRATION_MODELS: ModelOption[] = [
  { model: "claude-sonnet-4.5", hint: "fast, strong", provider: "anthropic" },
  { model: "claude-opus-4.6", hint: "smartest", provider: "anthropic" },
  { model: "gpt-5.2", hint: "frontier", provider: "openai" },
];

const EMBEDDING_MODELS: ModelOption[] = [
  { model: "text-embedding-3-small", hint: "1536 dims, fast", provider: "openai" },
  { model: "text-embedding-3-large", hint: "3072 dims, best quality", provider: "openai" },
  { model: "voyage-4-lite", hint: "1024 dims, fast", provider: "voyage" },
  { model: "voyage-4", hint: "1024 dims, balanced", provider: "voyage" },
  { model: "voyage-4-large", hint: "1024 dims, best quality", provider: "voyage" },
  { model: "voyage-code-3", hint: "1024 dims, code-optimized", provider: "voyage" },
];

function modelsForProvider(
  models: ModelOption[],
  providerSlug: string,
  providerType: string
): MenuItem[] {
  const filtered =
    providerType === "gateway"
      ? models
      : models.filter((m) => m.provider === providerSlug);

  const items: MenuItem[] = filtered.map((m) => ({
    label: m.model,
    hint: m.hint,
  }));

  items.push({ label: "Custom…" });
  return items;
}

async function pickModel(
  menuItems: MenuItem[],
  label: string
): Promise<string | null> {
  const idx = await promptSingleSelect(menuItems, label);
  const picked = menuItems[idx];

  if (picked.label === "Custom…") {
    const custom = await promptText("  Model name:");
    return custom;
  }

  return picked.label;
}

export async function setup() {
  console.log("\n  Configure an AI provider\n");

  let providers;
  try {
    providers = await getSeededProviders();
  } catch {
    console.log("  ✗ Could not connect to the database.");
    console.log("    Make sure murder is running (murder start).\n");
    process.exit(1);
    return;
  }

  if (providers.length === 0) {
    console.log("  ✗ No AI providers found in the database.\n");
    process.exit(1);
    return;
  }

  // --- Step 1: Pick a provider ---
  const items = providers.map((p) => ({
    label: p.name,
    hint: p.supported_capabilities.join(", "),
  }));

  const idx = await promptSingleSelect(items, "Select an AI provider:");
  const provider = providers[idx];
  console.log(`  ✓ ${provider.name}\n`);

  // --- Step 2: API key ---
  const apiKey = await promptSecret(`${provider.name} API key: `);
  if (!apiKey) {
    console.log("\n  ✗ No API key entered. Aborting.\n");
    process.exit(1);
    return;
  }

  let keyId: string;
  try {
    keyId = await storeProviderKey(provider.id, apiKey);
  } catch (err) {
    console.log("\n  ✗ Failed to save API key.");
    if (err instanceof Error) console.log(`    ${err.message}`);
    console.log();
    process.exit(1);
    return;
  }
  console.log("  ✓ API key saved\n");

  // --- Step 3: Orchestration model ---
  const supportsOrchestration =
    provider.supported_capabilities.includes("orchestration");
  const supportsEmbeddings =
    provider.supported_capabilities.includes("embeddings");

  if (supportsOrchestration) {
    const orchMenu = modelsForProvider(
      ORCHESTRATION_MODELS,
      provider.slug,
      provider.provider_type
    );
    const model = await pickModel(orchMenu, "Select an orchestration model:");

    if (model) {
      await storeAiConfig(keyId, "orchestration", model);
      console.log(`  ✓ Orchestration → ${model}\n`);
    } else {
      console.log("  ⚠ Skipped (no model entered)\n");
    }
  }

  // --- Step 4: Embedding model ---
  if (supportsEmbeddings) {
    const embMenu = modelsForProvider(
      EMBEDDING_MODELS,
      provider.slug,
      provider.provider_type
    );
    const model = await pickModel(embMenu, "Select an embedding model:");

    if (model) {
      await storeAiConfig(keyId, "embeddings", model);
      console.log(`  ✓ Embeddings → ${model}\n`);
    } else {
      console.log("  ⚠ Skipped (no model entered)\n");
    }
  }

  // --- Done ---
  console.log("  ✓ Provider configured successfully!\n");
  await sql.end();
}
